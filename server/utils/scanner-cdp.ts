/**
 * Inventory Scanner — browser transport.
 *
 * A small, dependency-free Chrome DevTools Protocol (CDP) client — the same protocol Puppeteer and
 * Playwright are built on. Two transports:
 *  - pipe:      launches the machine's own Chrome/Chromium/Edge headless with `--remote-debugging-pipe`
 *               (fd 3 = commands in, fd 4 = events out, NUL-delimited JSON). No ports are opened.
 *  - websocket: connects to a remote browser (e.g. a hosted Chrome such as Browserless) when
 *               SCANNER_BROWSER_WS is set — the way to run the scanner on serverless hosting.
 *
 * On serverless hosting (Vercel / AWS Lambda) there is no Chrome installed, so a serverless build of
 * Chromium (@sparticuz/chromium-min) is downloaded once per cold start into /tmp and launched the
 * same way over a pipe.
 *
 * Env: SCANNER_CHROME_PATH (explicit browser binary), SCANNER_BROWSER_WS (remote ws endpoint),
 *      SCANNER_CHROMIUM_PACK_URL (serverless Chromium pack; defaults to the official release),
 *      SCANNER_SERVERLESS=1 (force the serverless Chromium), SCANNER_HEADFUL=1 (debugging only).
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

type Pending = { resolve: (v: any) => void, reject: (e: Error) => void, method: string, timer: NodeJS.Timeout }

export class CdpConnection extends EventEmitter {
  private seq = 0
  private pending = new Map<number, Pending>()
  closed = false
  constructor(private writeRaw: (msg: string) => void) { super(); this.setMaxListeners(100) }

  /** Feed one raw JSON message from the transport. */
  handle(raw: string) {
    let msg: any
    try { msg = JSON.parse(raw) } catch { return }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}${msg.error.data ? ` (${msg.error.data})` : ''}`))
      else p.resolve(msg.result)
      return
    }
    if (msg.method) {
      this.emit('event', msg)
      this.emit(msg.sessionId ? `${msg.sessionId}:${msg.method}` : msg.method, msg.params, msg.sessionId)
    }
  }

  send<T = any>(method: string, params: Record<string, any> = {}, sessionId?: string, timeoutMs = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Browser connection is closed'))
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)) }, timeoutMs)
      this.pending.set(id, { resolve, reject, method, timer })
      try { this.writeRaw(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })) }
      catch (e: any) { clearTimeout(timer); this.pending.delete(id); reject(e) }
    })
  }

  /** Resolve on the next matching event (or reject on timeout). */
  waitFor(name: string, timeoutMs = 20_000, predicate?: (p: any) => boolean): Promise<any> {
    return new Promise((resolve, reject) => {
      const on = (p: any) => { if (!predicate || predicate(p)) { cleanup(); resolve(p) } }
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${name}`)) }, timeoutMs)
      const cleanup = () => { clearTimeout(timer); this.off(name, on) }
      this.on(name, on)
    })
  }

  dispose(reason = 'closed') {
    if (this.closed) return
    this.closed = true
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(`Browser ${reason}`)) }
    this.pending.clear()
    this.emit('disconnected', reason)
  }
}

/** Common install locations, most likely first. */
export function findBrowserBinary(): string | null {
  const explicit = process.env.SCANNER_CHROME_PATH
  if (explicit && existsSync(explicit)) return explicit
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        `${home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      ]
    : process.platform === 'win32'
      ? [
          `${process.env['PROGRAMFILES'] || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/opt/google/chrome/chrome']
  return candidates.find(p => p && existsSync(p)) || null
}

export interface BrowserHandle {
  conn: CdpConnection
  kind: 'local' | 'remote' | 'serverless'
  binary: string | null
  /** Set when pages go through SCANNER_PROXY with a user name / password (answered per tab via CDP Fetch). */
  proxyAuth?: { username: string, password: string } | null
  close: () => Promise<void>
}

export const SCANNER_VIEWPORT = { width: 1440, height: 900 }

/** Official serverless Chromium build matching @sparticuz/chromium-min in package.json. */
const DEFAULT_PACK_URL = 'https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar'
export const isServerless = () => !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.SCANNER_SERVERLESS === '1')

/** Serverless Chromium: binary path + the flags it needs (single process, no sandbox, /tmp only). */
async function serverlessChromium(): Promise<{ binary: string, args: string[] }> {
  const mod: any = await import('@sparticuz/chromium-min')
  const Chromium = mod.default || mod
  try { Chromium.setGraphicsMode = false } catch {} // no WebGL needed — skips unpacking SwiftShader
  const binary = await Chromium.executablePath(process.env.SCANNER_CHROMIUM_PACK_URL || DEFAULT_PACK_URL)
  return { binary, args: Chromium.args as string[] }
}

/**
 * SCANNER_PROXY — send the crawler's page traffic through a proxy (e.g. a US residential proxy, so dealer
 * sites protected by Akamai / Cloudflare see a normal home visitor instead of a cloud server):
 *   http://USER:PASS@host:port   ·   socks5://host:port
 * "{session}" anywhere in it is replaced by a random id per browser → one sticky IP for a whole crawl
 * (e.g. Bright Data: brd-customer-…-zone-…-session-{session}; Decodo: user-…-session-{session}).
 */
export function scannerProxy() {
  const raw = (process.env.SCANNER_PROXY || '').trim()
  if (!raw) return null
  try {
    const u = new URL(raw.replace(/\{session\}/g, Math.random().toString(36).slice(2, 10)))
    const scheme = u.protocol.replace(':', '') || 'http'
    return { server: `${scheme}://${u.hostname}:${u.port || (scheme === 'https' ? 443 : scheme.startsWith('socks') ? 1080 : 80)}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password), host: u.hostname }
  } catch { console.warn('[Scanner] SCANNER_PROXY is not a valid URL — ignored'); return null }
}

/** Launch local Chrome over a pipe, or connect to SCANNER_BROWSER_WS. `proxy: false` = never through SCANNER_PROXY (PDF printing). */
export async function openBrowser(opts: { proxy?: boolean } = {}): Promise<BrowserHandle> {
  const ws = process.env.SCANNER_BROWSER_WS
  if (ws) return connectRemote(ws)
  const proxy = opts.proxy === false ? null : scannerProxy()
  const proxyArgs = proxy ? [`--proxy-server=${proxy.server}`, '--proxy-bypass-list=<-loopback>'] : []
  const profile = mkdtempSync(join(tmpdir(), 'zrz-scanner-'))
  let binary: string | null
  let args: string[]
  if (!process.env.SCANNER_CHROME_PATH && isServerless()) {
    let sl: { binary: string, args: string[] }
    try { sl = await serverlessChromium() }
    catch (e: any) { throw createError({ statusCode: 500, statusMessage: 'Could not prepare the browser', message: `Could not prepare the serverless browser: ${e?.message}` }) }
    binary = sl.binary
    args = [
      ...sl.args,
      // Serverless functions (Vercel / Lambda) have no /dev/shm — Chromium must use /tmp for shared memory.
      '--disable-dev-shm-usage',
      '--disable-gpu',
      // Memory diet — a serverless instance has a few GB shared by every tab; dealer sites are heavy.
      '--disable-site-isolation-trials', '--renderer-process-limit=2', '--disk-cache-size=1', '--media-cache-size=1',
      '--js-flags=--max-old-space-size=512', '--disable-features=Translate,MediaRouter,OptimizationHints,BackForwardCache,IsolateOrigins,site-per-process',
      '--remote-debugging-pipe',
      ...proxyArgs,
      `--user-data-dir=${profile}`,
      '--no-first-run', '--disable-background-networking', '--disable-sync', '--disable-extensions', '--disable-component-update',
      '--mute-audio', '--hide-scrollbars', '--force-color-profile=srgb', '--lang=en-US',
      `--window-size=${SCANNER_VIEWPORT.width},${SCANNER_VIEWPORT.height}`,
      'about:blank',
    ]
  }
  else {
  binary = findBrowserBinary()
  if (!binary) throw createError({ statusCode: 501, statusMessage: 'No Chrome found on the server. Install Google Chrome, or set SCANNER_CHROME_PATH (or SCANNER_BROWSER_WS for a hosted browser).' })
  args = [
    process.env.SCANNER_HEADFUL === '1' ? '' : '--headless=new',
    '--remote-debugging-pipe',
    ...proxyArgs,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-default-apps',
    '--disable-background-networking', '--disable-sync', '--disable-extensions', '--disable-component-update',
    '--disable-features=Translate,MediaRouter,OptimizationHints,DialMediaRouteProvider',
    '--disable-blink-features=AutomationControlled',
    '--enable-experimental-web-platform-features', // Shape Detection API (TextDetector) for reading "Photos coming soon" banners
    // Containers running as root can't use Chrome's sandbox.
    process.platform === 'linux' && process.getuid?.() === 0 ? '--no-sandbox' : '',
    // Docker / small Linux servers often have a tiny or missing /dev/shm.
    process.platform === 'linux' ? '--disable-dev-shm-usage' : '',
    '--mute-audio', '--hide-scrollbars', '--force-color-profile=srgb', '--lang=en-US',
    `--window-size=${SCANNER_VIEWPORT.width},${SCANNER_VIEWPORT.height}`,
    'about:blank',
  ].filter(Boolean)
  }
  const child: ChildProcess = spawn(binary!, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], detached: false })
  const input = child.stdio[3] as NodeJS.WritableStream
  const output = child.stdio[4] as NodeJS.ReadableStream
  let stderr = ''
  child.stderr?.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-4000) })
  child.stderr?.on('error', () => {})
  const conn = new CdpConnection(msg => input.write(`${msg}\0`))
  // A dying browser must never take the web server down with it.
  input.on('error', () => conn.dispose('pipe closed'))
  output.on('error', () => conn.dispose('pipe closed'))
  let buf = ''
  output.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8')
    let i: number
    while ((i = buf.indexOf('\0')) !== -1) {
      const m = buf.slice(0, i)
      buf = buf.slice(i + 1)
      // A listener bug must never crash the server process.
      if (m) { try { conn.handle(m) } catch (e: any) { console.error('[Scanner] event handler failed:', e?.message) } }
    }
  })
  const cleanup = () => { try { rmSync(profile, { recursive: true, force: true }) } catch {} }
  child.on('exit', (code) => { conn.dispose(code ? `exited (${code})` : 'closed'); cleanup() })
  child.on('error', (e) => { conn.dispose(`failed to start: ${e.message}`) })
  try { await conn.send('Browser.getVersion', {}, undefined, 20_000) }
  catch (e: any) {
    try { child.kill('SIGKILL') } catch {}
    throw createError({ statusCode: 500, statusMessage: `Chrome did not start: ${e.message}${stderr ? ` — ${stderr.split('\n').filter(Boolean).slice(-2).join(' ')}` : ''}` })
  }
  return {
    conn, kind: isServerless() && !process.env.SCANNER_CHROME_PATH ? 'serverless' : 'local', binary,
    proxyAuth: proxy && proxy.username ? { username: proxy.username, password: proxy.password } : null,
    close: async () => {
      try { await conn.send('Browser.close', {}, undefined, 3000) } catch {}
      // Wait briefly for a clean exit, then make sure no Chromium outlives the request.
      if (child.exitCode === null) await new Promise<void>((resolve) => { const t = setTimeout(resolve, 1500); child.once('exit', () => { clearTimeout(t); resolve() }) })
      try { if (child.exitCode === null) child.kill('SIGKILL') } catch {}
      cleanup()
    },
  }
}

async function connectRemote(endpoint: string): Promise<BrowserHandle> {
  const WS: any = (globalThis as any).WebSocket
  if (!WS) throw createError({ statusCode: 501, statusMessage: 'This Node version has no WebSocket client — use Node 22+ for SCANNER_BROWSER_WS' })
  const sock = new WS(endpoint)
  const conn = new CdpConnection(msg => sock.send(msg))
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Remote browser did not answer')), 15_000)
    sock.addEventListener('open', () => { clearTimeout(t); resolve() })
    sock.addEventListener('error', () => { clearTimeout(t); reject(new Error('Could not connect to the remote browser')) })
  }).catch((e) => { throw createError({ statusCode: 502, statusMessage: e.message }) })
  sock.addEventListener('message', (ev: any) => conn.handle(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')))
  sock.addEventListener('close', () => conn.dispose('disconnected'))
  return { conn, kind: 'remote', binary: null, close: async () => { try { sock.close() } catch {} } }
}

export function browserAvailability() {
  if (process.env.SCANNER_BROWSER_WS) return { ok: true, kind: 'remote' as const, binary: null }
  if (!process.env.SCANNER_CHROME_PATH && isServerless()) return { ok: true, kind: 'serverless' as const, binary: null }
  const binary = findBrowserBinary()
  return { ok: !!binary, kind: 'local' as const, binary }
}
