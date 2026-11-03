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
 * Env: SCANNER_CHROME_PATH (explicit browser binary), SCANNER_BROWSER_WS (remote ws endpoint),
 *      SCANNER_HEADFUL=1 (show the browser window — debugging only).
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
  kind: 'local' | 'remote'
  binary: string | null
  close: () => Promise<void>
}

export const SCANNER_VIEWPORT = { width: 1440, height: 900 }

/** Launch local Chrome over a pipe, or connect to SCANNER_BROWSER_WS. */
export async function openBrowser(): Promise<BrowserHandle> {
  const ws = process.env.SCANNER_BROWSER_WS
  if (ws) return connectRemote(ws)
  const binary = findBrowserBinary()
  if (!binary) throw createError({ statusCode: 501, statusMessage: 'No Chrome found on the server. Install Google Chrome, or set SCANNER_CHROME_PATH (or SCANNER_BROWSER_WS for a hosted browser).' })
  const profile = mkdtempSync(join(tmpdir(), 'zrz-scanner-'))
  const args = [
    process.env.SCANNER_HEADFUL === '1' ? '' : '--headless=new',
    '--remote-debugging-pipe',
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-default-apps',
    '--disable-background-networking', '--disable-sync', '--disable-extensions', '--disable-component-update',
    '--disable-features=Translate,MediaRouter,OptimizationHints,DialMediaRouteProvider',
    '--disable-blink-features=AutomationControlled',
    '--enable-experimental-web-platform-features', // Shape Detection API (TextDetector) for reading "Photos coming soon" banners
    // Containers running as root can't use Chrome's sandbox.
    process.platform === 'linux' && process.getuid?.() === 0 ? '--no-sandbox' : '',
    '--mute-audio', '--hide-scrollbars', '--force-color-profile=srgb', '--lang=en-US',
    `--window-size=${SCANNER_VIEWPORT.width},${SCANNER_VIEWPORT.height}`,
    'about:blank',
  ].filter(Boolean)
  const child: ChildProcess = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], detached: false })
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
    conn, kind: 'local', binary,
    close: async () => {
      try { await conn.send('Browser.close', {}, undefined, 3000) } catch {}
      setTimeout(() => { try { if (child.exitCode === null) child.kill('SIGKILL') } catch {} }, 1500)
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
  const binary = findBrowserBinary()
  return { ok: !!binary, kind: 'local' as const, binary }
}
