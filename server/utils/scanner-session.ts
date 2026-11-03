/**
 * Inventory Scanner — live browser sessions + the scan itself.
 *
 * One session = one private headless Chrome tab at desktop size (1440×900) that the user drives
 * from the CRM through a live screencast (clicks, scrolling, typing are forwarded). "Continue"
 * starts the scan in that same tab: scroll to load every card → collect → next page / load more →
 * repeat → download every main photo → analyse → verdicts. Progress, frames and results stream to
 * the browser over Server-Sent Events.
 *
 * Sessions live in memory on the server process (kept on globalThis so dev hot-reloads don't orphan
 * Chrome) and close after 20 idle minutes. Saving writes an append-only CRM audit (source
 * 'automated') plus the full scan in turboCleanScannerScans for traceability.
 */
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import type { Db } from 'mongodb'
import type { SessionActor } from './crm'
import { CRM_COLLECTIONS, str } from './crm'
import { openBrowser, SCANNER_VIEWPORT } from './scanner-cdp'
import type { BrowserHandle } from './scanner-cdp'
import { ANALYZE_FN_JS, EXTRACT_JS, FIND_NEXT_JS, NAV_LINKS_JS, SCANNER_BOOTSTRAP_JS, SCROLL_STEP_JS } from './scanner-page'
import { classify, downloadImage, finalVerdict, listRules, summarize, VERDICT_LABEL } from './scanner-images'
import type { ImageCluster, ImageInfo, PhotoVerdict, ScanVehicle } from './scanner-images'

export const SCANS_COLLECTION = 'turboCleanScannerScans'
const IDLE_MS = 20 * 60_000
const MAX_SESSIONS = 3
const MAX_PAGES = 60
const MAX_VEHICLES = 2500
const SCAN_TIME_LIMIT_MS = 8 * 60_000

export type ScanPhase = 'browsing' | 'collecting' | 'analyzing' | 'done' | 'stopped' | 'error'
export interface ScanProgress { phase: ScanPhase, page: number, vehicles: number, advertised: number | null, analyzed: number, toAnalyze: number, message: string, startedAt: string | null, finishedAt: string | null, pagesVisited: string[] }

interface Listener { (event: string, data: any): void }

export interface ScannerSession {
  id: string
  dealershipId: string
  dealershipName: string
  ownerId: string
  createdAt: string
  lastActivity: number
  browser: BrowserHandle
  sid: string
  targetId: string
  url: string
  title: string
  loading: boolean
  navLinks: { label: string, href: string, kind: string }[]
  history: { canBack: boolean, canForward: boolean }
  frame: { data: string, w: number, h: number, ts: number } | null
  listeners: Set<Listener>
  progress: ScanProgress
  log: { at: string, text: string }[]
  vehicles: ScanVehicle[]
  images: Map<string, ImageInfo>
  clusters: ImageCluster[]
  countStockAsMissing: boolean
  evidence: string | null
  abort: boolean
  stopRequested: boolean
  scanning: boolean
  closed: boolean
  savedAuditId: string | null
}

const g = globalThis as any
const sessions: Map<string, ScannerSession> = g.__zrzScannerSessions ||= new Map()
if (!g.__zrzScannerSweeper) {
  g.__zrzScannerSweeper = setInterval(() => {
    for (const s of sessions.values()) if (!s.scanning && Date.now() - s.lastActivity > IDLE_MS) closeSession(s.id).catch(() => {})
  }, 60_000)
  const killAll = () => { for (const s of sessions.values()) s.browser.close().catch(() => {}) }
  process.once('exit', killAll)
}

export function getScannerSession(id: string, actor?: SessionActor | null) {
  const s = sessions.get(id)
  if (!s || s.closed) throw createError({ statusCode: 404, statusMessage: 'Scanner session ended', message: 'This scanner session has ended — open the scanner again' })
  if (actor && s.ownerId !== actor.id) throw createError({ statusCode: 403, statusMessage: 'This scanner session belongs to someone else' })
  s.lastActivity = Date.now()
  return s
}

function emit(s: ScannerSession, event: string, data: any) {
  for (const l of s.listeners) { try { l(event, data) } catch {} }
}
function log(s: ScannerSession, text: string) {
  const entry = { at: new Date().toISOString(), text }
  s.log.push(entry)
  if (s.log.length > 200) s.log.shift()
  emit(s, 'log', entry)
}
export function publicState(s: ScannerSession) {
  return {
    id: s.id, dealershipId: s.dealershipId, dealershipName: s.dealershipName, url: s.url, title: s.title, loading: s.loading,
    navLinks: s.navLinks, history: s.history, viewport: SCANNER_VIEWPORT, progress: s.progress, scanning: s.scanning,
    hasResults: s.vehicles.length > 0 && !s.scanning, savedAuditId: s.savedAuditId, browser: s.browser.kind,
  }
}
const pushState = (s: ScannerSession) => emit(s, 'state', publicState(s))

export function subscribe(s: ScannerSession, l: Listener) {
  s.listeners.add(l)
  return () => s.listeners.delete(l)
}

// ───────────────────────── URL safety ─────────────────────────
export function safeUrl(raw: string) {
  let u: URL
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) }
  catch { throw createError({ statusCode: 400, statusMessage: 'That is not a valid web address' }) }
  if (!/^https?:$/.test(u.protocol)) throw createError({ statusCode: 400, statusMessage: 'Only http(s) websites can be scanned' })
  const h = u.hostname.toLowerCase()
  if (process.env.SCANNER_ALLOW_PRIVATE === '1') return u.href
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h) || h === '[::1]' || h === '::1')
    throw createError({ statusCode: 400, statusMessage: 'Private network addresses cannot be scanned' })
  return u.href
}

// ───────────────────────── Lifecycle ─────────────────────────
export async function createSession(db: Db, dealershipId: string, urlInput: string | undefined, actor: SessionActor) {
  const { ObjectId } = await import('mongodb')
  if (!ObjectId.isValid(dealershipId)) throw createError({ statusCode: 400, statusMessage: 'Invalid dealership' })
  const d = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: new ObjectId(dealershipId) })
  if (!d) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  const raw = str(urlInput, 1000) || d.website
  if (!raw) throw createError({ statusCode: 400, statusMessage: 'This dealership has no website — add one first' })
  const url = safeUrl(raw)
  // One live session per person: reuse slots instead of piling up browsers.
  for (const s of sessions.values()) if (s.ownerId === actor.id && !s.scanning) await closeSession(s.id)
  if ([...sessions.values()].filter(s => !s.closed).length >= MAX_SESSIONS) throw createError({ statusCode: 429, statusMessage: 'The scanner is busy with other scans — try again in a minute' })

  return launchSession({ dealershipId, dealershipName: d.name || '', ownerId: actor.id, url })
}

/** Start Chrome, open a desktop-size tab, wire the screencast and page events, then load `url`. */
export async function launchSession(o: { dealershipId: string, dealershipName: string, ownerId: string, url: string }) {
  const { dealershipId, url } = o
  const browser = await openBrowser()
  const { conn } = browser
  const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId: sid } = await conn.send('Target.attachToTarget', { targetId, flatten: true })
  const s: ScannerSession = {
    id: randomUUID(), dealershipId, dealershipName: o.dealershipName, ownerId: o.ownerId, createdAt: new Date().toISOString(), lastActivity: Date.now(),
    browser, sid, targetId, url, title: '', loading: true, navLinks: [], history: { canBack: false, canForward: false }, frame: null, listeners: new Set(),
    progress: { phase: 'browsing', page: 0, vehicles: 0, advertised: null, analyzed: 0, toAnalyze: 0, message: '', startedAt: null, finishedAt: null, pagesVisited: [] },
    log: [], vehicles: [], images: new Map(), clusters: [], countStockAsMissing: true, evidence: null, abort: false, stopRequested: false, scanning: false, closed: false, savedAuditId: null,
  }
  sessions.set(s.id, s)
  conn.on('disconnected', (reason: string) => { if (!s.closed) { s.closed = true; emit(s, 'closed', { reason }); sessions.delete(s.id) } })

  const version = await conn.send('Browser.getVersion')
  const ua = String(version.userAgent || '').replace(/HeadlessChrome/g, 'Chrome')
  await Promise.all([
    conn.send('Page.enable', {}, sid),
    conn.send('Runtime.enable', {}, sid),
    conn.send('Network.enable', {}, sid),
    conn.send('Network.setUserAgentOverride', { userAgent: ua, acceptLanguage: 'en-US,en;q=0.9', platform: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux' }, sid),
    conn.send('Emulation.setDeviceMetricsOverride', { width: SCANNER_VIEWPORT.width, height: SCANNER_VIEWPORT.height, deviceScaleFactor: 1, mobile: false }, sid),
    conn.send('Page.addScriptToEvaluateOnNewDocument', { source: SCANNER_BOOTSTRAP_JS }, sid),
    conn.send('Page.setLifecycleEventsEnabled', { enabled: true }, sid),
  ])
  conn.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {})

  conn.on(`${sid}:Page.screencastFrame`, (p: any) => {
    conn.send('Page.screencastFrameAck', { sessionId: p.sessionId }, sid).catch(() => {})
    s.frame = { data: p.data, w: p.metadata?.deviceWidth || SCANNER_VIEWPORT.width, h: p.metadata?.deviceHeight || SCANNER_VIEWPORT.height, ts: Date.now() }
    emit(s, 'frame', s.frame)
  })
  conn.on(`${sid}:Page.frameStartedLoading`, () => { if (!s.loading) { s.loading = true; pushState(s) } })
  conn.on(`${sid}:Page.frameNavigated`, (p: any) => { if (!p.frame?.parentId) { s.url = p.frame.url; pushState(s) } })
  conn.on(`${sid}:Page.navigatedWithinDocument`, (p: any) => { s.url = p.url; refreshPageInfo(s).catch(() => {}) })
  conn.on(`${sid}:Page.loadEventFired`, () => { s.loading = false; refreshPageInfo(s).catch(() => {}) })
  conn.on(`${sid}:Page.javascriptDialogOpening`, () => { conn.send('Page.handleJavaScriptDialog', { accept: true }, sid).catch(() => {}) })

  await conn.send('Page.startScreencast', { format: 'jpeg', quality: 72, maxWidth: SCANNER_VIEWPORT.width, maxHeight: SCANNER_VIEWPORT.height, everyNthFrame: 1 }, sid)
  log(s, `Opening ${url}`)
  conn.send('Page.navigate', { url }, sid).then((r: any) => { if (r?.errorText) { log(s, `Could not open the site: ${r.errorText}`); emit(s, 'failure', { message: `Could not open the site (${r.errorText})` }) } }).catch(() => {})
  return s
}

async function refreshPageInfo(s: ScannerSession) {
  const [title, links, hist] = await Promise.all([
    evaluate(s, 'document.title').catch(() => s.title),
    evaluate(s, NAV_LINKS_JS).catch(() => s.navLinks),
    s.browser.conn.send('Page.getNavigationHistory', {}, s.sid).catch(() => null),
  ])
  s.title = String(title || '')
  if (Array.isArray(links) && links.length) s.navLinks = links
  if (hist) s.history = { canBack: hist.currentIndex > 0, canForward: hist.currentIndex < hist.entries.length - 1 }
  pushState(s)
}

export async function closeSession(id: string) {
  const s = sessions.get(id)
  if (!s) return
  s.abort = true
  s.closed = true
  sessions.delete(id)
  emit(s, 'closed', { reason: 'closed' })
  s.listeners.clear()
  await s.browser.close().catch(() => {})
}

async function evaluate<T = any>(s: ScannerSession, expression: string, timeoutMs = 30_000): Promise<T> {
  const r = await s.browser.conn.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, s.sid, timeoutMs)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text || 'Script error')
  return r.result?.value as T
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ───────────────────────── Remote control ─────────────────────────
const KEYS: Record<string, { code: string, vk: number, text?: string }> = {
  Enter: { code: 'Enter', vk: 13, text: '\r' }, Backspace: { code: 'Backspace', vk: 8 }, Tab: { code: 'Tab', vk: 9 }, Escape: { code: 'Escape', vk: 27 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 }, ArrowUp: { code: 'ArrowUp', vk: 38 }, ArrowRight: { code: 'ArrowRight', vk: 39 }, ArrowDown: { code: 'ArrowDown', vk: 40 },
  Delete: { code: 'Delete', vk: 46 }, Home: { code: 'Home', vk: 36 }, End: { code: 'End', vk: 35 }, PageUp: { code: 'PageUp', vk: 33 }, PageDown: { code: 'PageDown', vk: 34 }, ' ': { code: 'Space', vk: 32, text: ' ' },
}
export async function sendInput(s: ScannerSession, body: any) {
  const { conn } = s.browser
  const x = Math.max(0, Math.min(SCANNER_VIEWPORT.width, Number(body.x) || 0))
  const y = Math.max(0, Math.min(SCANNER_VIEWPORT.height, Number(body.y) || 0))
  switch (body.type) {
    case 'move': return conn.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, s.sid)
    case 'click': {
      await conn.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, s.sid)
      await conn.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 }, s.sid)
      return conn.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 }, s.sid)
    }
    case 'wheel': return conn.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: Number(body.dx) || 0, deltaY: Math.max(-3000, Math.min(3000, Number(body.dy) || 0)) }, s.sid)
    case 'text': { const text = str(body.text, 500); return text ? conn.send('Input.insertText', { text }, s.sid) : null }
    case 'key': {
      const k = KEYS[String(body.key)]
      if (!k) return null
      await conn.send('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', key: body.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}) }, s.sid)
      return conn.send('Input.dispatchKeyEvent', { type: 'keyUp', key: body.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk }, s.sid)
    }
    default: throw createError({ statusCode: 400, statusMessage: 'Unknown input' })
  }
}

export async function navigate(s: ScannerSession, body: any) {
  const { conn } = s.browser
  if (s.scanning) throw createError({ statusCode: 409, statusMessage: 'A scan is running — stop it first' })
  if (body.action === 'reload') return conn.send('Page.reload', {}, s.sid)
  if (body.action === 'back' || body.action === 'forward') {
    const h = await conn.send('Page.getNavigationHistory', {}, s.sid)
    const entry = h.entries[h.currentIndex + (body.action === 'back' ? -1 : 1)]
    return entry ? conn.send('Page.navigateToHistoryEntry', { entryId: entry.id }, s.sid) : null
  }
  const url = safeUrl(str(body.url, 2000))
  s.loading = true
  pushState(s)
  const r = await conn.send('Page.navigate', { url }, s.sid)
  if (r?.errorText) throw createError({ statusCode: 502, statusMessage: `Could not open that page (${r.errorText})` })
  return r
}

// ───────────────────────── The scan ─────────────────────────
function vehicleKey(c: any) {
  if (c.vin) return `vin:${c.vin}`
  if (c.url) return `url:${String(c.url).split('#')[0]}`
  if (c.stock) return `stock:${c.stock}`
  return `t:${c.title}|${c.price}|${c.image?.url || ''}`
}
function setProgress(s: ScannerSession, patch: Partial<ScanProgress>) {
  Object.assign(s.progress, patch)
  emit(s, 'progress', s.progress)
}

async function waitForSettle(s: ScannerSession, ms = 12_000) {
  const start = Date.now()
  while (Date.now() - start < ms) { if (!s.loading) break; await sleep(250) }
  await sleep(900)
}

/**
 * Scroll the page top → bottom so lazy images and infinite-scroll batches load. `collect` runs every
 * few steps as well as at the end, so virtualised lists (cards removed once off-screen) are captured too.
 */
async function scrollThrough(s: ScannerSession, collect: () => Promise<void>) {
  await evaluate(s, 'window.scrollTo({ top: 0, behavior: "instant" })').catch(() => {})
  await sleep(300)
  let stableAtBottom = 0
  let lastH = 0
  for (let i = 0; i < 220 && !s.abort && !s.stopRequested; i++) {
    const r = await evaluate<{ y: number, h: number, atBottom: boolean }>(s, SCROLL_STEP_JS).catch(() => null)
    if (!r) break
    await sleep(r.atBottom ? 1100 : 300)
    if (i % 4 === 3) await collect()
    if (r.atBottom) {
      if (r.h === lastH) stableAtBottom++
      else stableAtBottom = 0
      if (stableAtBottom >= 2) break
    }
    lastH = r.h
  }
  await collect()
}

export function startScan(s: ScannerSession, opts: { allPages: boolean, append: boolean }) {
  if (s.scanning) throw createError({ statusCode: 409, statusMessage: 'Already scanning' })
  s.scanning = true
  s.abort = false
  s.stopRequested = false
  s.savedAuditId = null
  if (!opts.append) { s.vehicles = []; s.images = new Map(); s.clusters = []; s.progress.pagesVisited = [] }
  setProgress(s, { phase: 'collecting', page: 0, vehicles: s.vehicles.length, advertised: null, analyzed: 0, toAnalyze: 0, message: 'Finding vehicle cards…', startedAt: new Date().toISOString(), finishedAt: null })
  pushState(s)
  runScan(s, opts).catch((e) => {
    setProgress(s, { phase: 'error', message: e?.message || 'Scan failed', finishedAt: new Date().toISOString() })
    log(s, `Scan failed: ${e?.message}`)
  }).finally(() => { s.scanning = false; s.lastActivity = Date.now(); pushState(s) })
}

async function runScan(s: ScannerSession, opts: { allPages: boolean }) {
  const started = Date.now()
  const seen = new Map(s.vehicles.map(v => [v.key, v]))
  let advertised: number | null = null
  const better = (a: any, b: any) => (!a?.url && b?.url) || (a?.url && b?.url && a.url !== b.url && (a.nw || 0) === 0 && (b.nw || 0) > 0)
  for (let page = 1; page <= MAX_PAGES && !s.abort && !s.stopRequested; page++) {
    setProgress(s, { page, message: page === 1 ? 'Loading every vehicle on this page…' : `Page ${page}: loading vehicles…` })
    let res: any = null
    let added = 0
    let pageCards = 0
    const collect = async () => {
      const r = await evaluate<any>(s, EXTRACT_JS, 45_000).catch(() => null)
      if (!r) return
      res = r
      pageCards = Math.max(pageCards, r.cards?.length || 0)
      if (r.total) advertised = Math.max(advertised || 0, r.total)
      for (const c of r.cards || []) {
        const key = vehicleKey(c)
        const had = seen.get(key)
        if (had) { if (better(had.image, c.image)) had.image = c.image; if (!had.noPhotoText && c.noPhotoText) had.noPhotoText = c.noPhotoText; continue }
        const v: ScanVehicle = {
          key, title: c.title || '', year: c.year ?? null, make: c.make || '', model: c.model || '', vin: c.vin || '', stock: c.stock || '', price: c.price || '',
          condition: (['new', 'used', 'certified'].includes(c.condition) ? c.condition : '') as any, url: c.url || '', image: c.image || null, imageId: null,
          imageCount: c.imageCount || 0, photoCountText: c.photoCountText || '', noPhotoText: c.noPhotoText || '', page, sourceUrl: r.url,
          verdict: 'review', suggested: 'real', confidence: 0, reasons: [], clusterId: null, override: null,
        }
        seen.set(key, v)
        s.vehicles.push(v)
        added++
      }
      setProgress(s, { vehicles: s.vehicles.length, advertised, message: `${s.vehicles.length} vehicles found` })
    }
    await scrollThrough(s, collect)
    if (s.abort) break
    if (!s.evidence) {
      // Evidence screenshot for the audit / email: the inventory page with the first cards in view.
      try {
        const first = (res?.cards || [])[0]
        await evaluate(s, `window.scrollTo({ top: ${Math.max(0, (first?.box?.y || 0) - 140)}, behavior: "instant" })`)
        await sleep(900)
        const shot = await s.browser.conn.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }, s.sid)
        s.evidence = `data:image/jpeg;base64,${shot.data}`
      } catch {}
    }
    s.progress.pagesVisited.push(res?.url || s.url)
    log(s, `Page ${page}: ${pageCards} cards on screen, ${added} new — ${res?.strategy === 'known' ? 'recognised layout' : 'detected by structure'}`)
    if (!s.vehicles.length && page === 1) throw new Error('No vehicle cards found on this page. Open the inventory / search results page, then press Continue.')
    if (!opts.allPages || s.vehicles.length >= MAX_VEHICLES || Date.now() - started > SCAN_TIME_LIMIT_MS) break
    if (added === 0 && page > 1) break
    if (advertised && s.vehicles.length >= advertised) break

    // Next page or "Load more"
    const next = await evaluate<any>(s, FIND_NEXT_JS).catch(() => null)
    if (!next) break
    if (next.kind === 'href') {
      log(s, `${next.label} → ${next.href}`)
      s.loading = true
      await s.browser.conn.send('Page.navigate', { url: next.href }, s.sid)
      await waitForSettle(s, 20_000)
    } else {
      log(s, `Clicking “${next.label}”`)
      await sleep(400)
      await evaluate(s, `(() => { const el = document.querySelector('[data-zrz-next]'); if (el) el.click(); return !!el })()`)
      await sleep(1500)
      await waitForSettle(s, 15_000)
    }
  }

  // Photos
  await analyzePhotos(s)
  if (s.abort) return
  const sum = summarize(s.vehicles, s.clusters, { countStockAsMissing: s.countStockAsMissing })
  setProgress(s, { phase: s.stopRequested ? 'stopped' : 'done', message: `${s.stopRequested ? 'Stopped early — ' : ''}${sum.total} vehicles · ${sum.withoutReal} without a real photo (${sum.withoutRealPct ?? 0}%)`, finishedAt: new Date().toISOString() })
  log(s, `Done in ${Math.round((Date.now() - started) / 1000)}s`)
  emit(s, 'result', await resultsOf(s))
}

async function analyzePhotos(s: ScannerSession) {
  const { conn } = s.browser
  // One image entry per distinct URL.
  const byUrl = new Map<string, string>()
  for (const [id, info] of s.images) byUrl.set(info.url, id)
  for (const v of s.vehicles) {
    const u = v.image?.url
    if (!u) continue
    let id = byUrl.get(u)
    if (!id) { id = `i${s.images.size + 1}`; s.images.set(id, { id, url: u, ok: false }); byUrl.set(u, id) }
    v.imageId = id
  }
  const todo = [...s.images.values()].filter(i => !i.hash && !i.error)
  setProgress(s, { phase: 'analyzing', analyzed: 0, toAnalyze: todo.length, message: `Checking ${todo.length} photos…` })
  if (todo.length) {
    // A blank tab does the image maths (no page scripts, no cross-origin limits on our own bytes).
    const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId: asid } = await conn.send('Target.attachToTarget', { targetId, flatten: true })
    try {
      let done = 0
      const queue = [...todo]
      const referer = s.url
      const worker = async () => {
        while (queue.length && !s.abort) {
          const batch = queue.splice(0, 4)
          const dl = await Promise.all(batch.map(async (img) => {
            const r = await downloadImage(img.url, referer)
            if ('error' in r) { img.ok = false; img.error = r.error; return null }
            img.bytes = r.bytes
            return { id: img.id, b64: r.b64, mime: r.mime }
          }))
          const items = dl.filter(Boolean) as { id: string, b64: string, mime: string }[]
          if (items.length) {
            const res = await conn.send('Runtime.evaluate', { expression: `(${ANALYZE_FN_JS})(${JSON.stringify(items)})`, returnByValue: true, awaitPromise: true }, asid, 60_000).catch((e: any) => ({ result: { value: items.map(i => ({ id: i.id, ok: false, error: e.message })) } }))
            for (const a of (res?.result?.value || []) as any[]) {
              const img = s.images.get(a.id)
              if (img) Object.assign(img, a)
            }
          }
          done += batch.length
          setProgress(s, { analyzed: done, message: `Checking photos… ${done} of ${todo.length}` })
        }
      }
      await Promise.all([worker(), worker(), worker()])
    }
    finally { conn.send('Target.closeTarget', { targetId }).catch(() => {}) }
  }
  await reclassify(s)
}

async function reclassify(s: ScannerSession) {
  let db: Db | null = null
  let rules: Awaited<ReturnType<typeof listRules>> = []
  try {
    const { getCrmDb } = await import('./crm')
    db = await getCrmDb()
    rules = await listRules(db)
  } catch (e: any) { log(s, `Saved image rules unavailable (${e?.message}) — using built-in checks only`) }
  const keepCluster = new Map(s.clusters.map(c => [c.hash, c.override]))
  const { clusters, ruleHits } = classify(s.vehicles, s.images, rules)
  for (const c of clusters) { const o = keepCluster.get(c.hash); if (o) c.override = o }
  s.clusters = clusters
  if (ruleHits.size && db) {
    const { ObjectId } = await import('mongodb')
    const { RULES_COLLECTION } = await import('./scanner-images')
    for (const [id, n] of ruleHits) if (ObjectId.isValid(id)) await db!.collection(RULES_COLLECTION).updateOne({ _id: new ObjectId(id) }, { $inc: { hits: n }, $set: { lastHitAt: new Date().toISOString() } })
  }
}

export async function resultsOf(s: ScannerSession) {
  const summary = summarize(s.vehicles, s.clusters, { countStockAsMissing: s.countStockAsMissing })
  const usedImageIds = new Set(s.vehicles.map(v => v.imageId).filter(Boolean) as string[])
  const images: Record<string, any> = {}
  for (const [id, i] of s.images) {
    if (!usedImageIds.has(id)) continue
    images[id] = { id, url: i.url, ok: i.ok, error: i.error || null, w: i.w || null, h: i.h || null, hash: i.hash || null, thumb: i.thumb || null, text: i.text || '', ocr: !!i.ocr }
  }
  const cmap = new Map(s.clusters.map(c => [c.id, c]))
  return {
    summary, countStockAsMissing: s.countStockAsMissing, advertised: s.progress.advertised, pages: s.progress.pagesVisited,
    vehicles: s.vehicles.map(v => ({ ...v, final: finalVerdict(v, cmap) })), clusters: s.clusters, images,
    hasEvidence: !!s.evidence, savedAuditId: s.savedAuditId, labels: VERDICT_LABEL,
  }
}

/** Overrides from the review screen (per vehicle, per duplicate group) + the stock setting. */
export async function applyReview(s: ScannerSession, body: any) {
  if (s.scanning) throw createError({ statusCode: 409, statusMessage: 'Wait for the scan to finish' })
  const ok = (v: any): Exclude<PhotoVerdict, 'review'> | null => ['real', 'placeholder', 'stock', 'missing'].includes(v) ? v : null
  if (Array.isArray(body.vehicles)) {
    const set = new Map<string, any>(body.vehicles.map((x: any) => [String(x.key), x.verdict]))
    for (const v of s.vehicles) if (set.has(v.key)) v.override = ok(set.get(v.key))
  }
  if (Array.isArray(body.clusters)) {
    for (const x of body.clusters) { const c = s.clusters.find(c => c.id === x.id); if (c) c.override = ok(x.verdict) }
  }
  if (typeof body.countStockAsMissing === 'boolean') s.countStockAsMissing = body.countStockAsMissing
  if (body.reapplyRules) await reclassify(s)
  s.savedAuditId = null
  return resultsOf(s)
}

/** Save the scan to the CRM: an automated audit (+ evidence screenshot) and the full scan record. */
export async function saveScan(db: Db, s: ScannerSession, actor: SessionActor) {
  if (s.scanning) throw createError({ statusCode: 409, statusMessage: 'Wait for the scan to finish' })
  if (!s.vehicles.length) throw createError({ statusCode: 400, statusMessage: 'Nothing scanned yet' })
  const { ObjectId } = await import('mongodb')
  const d = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: new ObjectId(s.dealershipId) })
  if (!d) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  const sum = summarize(s.vehicles, s.clusters, { countStockAsMissing: s.countStockAsMissing })
  const cmap = new Map(s.clusters.map(c => [c.id, c]))
  const without = s.vehicles.filter((v) => { const f = finalVerdict(v, cmap); return f === 'missing' || f === 'placeholder' || (s.countStockAsMissing && f === 'stock') })
  let screenshotFileId: string | null = null
  if (s.evidence) {
    try {
      const { saveDataUrl } = await import('./crm-files')
      const f = await saveDataUrl(db, { dataUrl: s.evidence, filename: `${(d.name || 'inventory').replace(/[^\w]+/g, '-')}-inventory.jpg`, dealershipId: s.dealershipId, purpose: 'audit-screenshot' }, actor)
      screenshotFileId = f.id
    } catch (e: any) { log(s, `Evidence screenshot not saved: ${e?.statusMessage || e?.message}`) }
  }
  const parts = [
    `Inventory Scanner: ${sum.total} vehicles on ${s.progress.pagesVisited.length} page${s.progress.pagesVisited.length === 1 ? '' : 's'}${s.progress.advertised ? ` (site advertises ${s.progress.advertised})` : ''}.`,
    `${sum.by.real} real photos · ${sum.by.missing + sum.by.placeholder} no photo (${sum.by.placeholder} showing a placeholder image such as “photos unavailable”, ${sum.by.missing} with no image) · ${sum.by.stock} stock images${s.countStockAsMissing ? ' (counted as no photo)' : ' (counted as photos)'}.`,
  ]
  const { recordAudit } = await import('./crm-audit')
  const audit = await recordAudit(db, d, {
    ...sum.counts,
    source: 'automated',
    inventoryUrl: s.progress.pagesVisited[0] || s.url,
    examples: without.filter(v => v.url).slice(0, 25).map(v => ({ url: v.url, label: `${v.title}${v.stock ? ` #${v.stock}` : ''} — ${VERDICT_LABEL[finalVerdict(v, cmap)]}` })),
    merchandisingIssues: [
      ...(sum.by.missing + sum.by.placeholder ? ['Vehicles listed with no photos (placeholder / “photos unavailable”)'] : []),
      ...(sum.by.stock ? ['Stock images instead of real photos'] : []),
    ],
    notes: parts.join('\n'),
    screenshotFileId,
    collector: { name: 'ZRZ Inventory Scanner', version: '1.0', runId: s.id },
  }, actor)
  await db.collection(SCANS_COLLECTION).insertOne({
    sessionId: s.id, dealershipId: s.dealershipId, dealershipName: s.dealershipName, auditId: audit?.id || null,
    startUrl: s.progress.pagesVisited[0] || s.url, pages: s.progress.pagesVisited, advertised: s.progress.advertised,
    summary: sum, countStockAsMissing: s.countStockAsMissing,
    vehicles: s.vehicles.map(v => ({ key: v.key, title: v.title, vin: v.vin, stock: v.stock, price: v.price, condition: v.condition, url: v.url, imageUrl: v.image?.url || '', verdict: v.verdict, final: finalVerdict(v, cmap), override: v.override, confidence: v.confidence, reasons: v.reasons, clusterId: v.clusterId })),
    clusters: s.clusters.map(c => ({ id: c.id, hash: c.hash, url: c.url, vehicles: c.vehicles, models: c.models, verdict: c.verdict, override: c.override })),
    startedAt: s.progress.startedAt, finishedAt: s.progress.finishedAt, savedAt: new Date().toISOString(), savedBy: { id: actor.id, name: actor.name },
    scannerVersion: '1.0',
  })
  try {
    const { logEventRun } = await import('./automation')
    await logEventRun(db, 'count_inventory', `${d.name}: ${sum.total} vehicles scanned, ${sum.withoutReal} without a real photo (${sum.withoutRealPct ?? 0}%)`, { vehicles: sum.total, withoutReal: sum.withoutReal }, [{ dealershipId: s.dealershipId, name: d.name }])
  } catch {}
  s.savedAuditId = audit?.id || null
  log(s, 'Saved to the CRM as an inventory audit')
  pushState(s)
  return { audit, summary: sum }
}

/** Used on server shutdown / dev reload. */
export async function closeAllScannerSessions() {
  await Promise.all([...sessions.keys()].map(id => closeSession(id).catch(() => {})))
}

export function stopScan(s: ScannerSession) {
  if (!s.scanning) return false
  s.stopRequested = true
  log(s, 'Stopping — checking the photos found so far…')
  return true
}
