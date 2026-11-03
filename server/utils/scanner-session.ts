/**
 * Inventory Scanner — the scan engine (stateless; built for serverless hosting such as Vercel).
 *
 * Every request stands on its own and starts its own headless Chromium, so nothing lives in
 * server memory between requests:
 *  - preview  → opens the dealer site at desktop size (1440×900), returns a full-page screenshot,
 *               the page title, inventory shortcuts and how many vehicle cards it can see.
 *  - run      → one long streaming request (Server-Sent Events): scroll to load every card → collect
 *               → next page / load more → repeat → download every main photo → analyse → verdicts.
 *               Progress and low-res live frames stream to the browser while it works.
 *  - the scan itself is written to MongoDB (turboCleanScannerScans) as it goes, so results survive
 *    a dropped connection and the review / save steps are plain requests against the stored scan.
 *
 * No images are stored anywhere: photos are downloaded only to measure them, then discarded. The
 * review screen shows the dealer's own image URLs.
 *
 * Time budget: Vercel Pro allows up to 800 s per request. Collection stops at ~55% of the budget and
 * photo checks at ~88%, so there is always time left to classify and save what was found.
 */
import process from 'node:process'
import type { Db } from 'mongodb'
import type { SessionActor } from './crm'
import { CRM_COLLECTIONS, str } from './crm'
import { isServerless, openBrowser, SCANNER_VIEWPORT } from './scanner-cdp'
import type { BrowserHandle, CdpConnection } from './scanner-cdp'
import { ANALYZE_FN_JS, EXTRACT_JS, FIND_NEXT_JS, HOTSPOTS_JS, NAV_LINKS_JS, SCANNER_BOOTSTRAP_JS, SCROLL_STEP_JS } from './scanner-page'
import { classify, downloadImage, finalVerdict, listRules, RULES_COLLECTION, summarize, VERDICT_LABEL } from './scanner-images'
import type { ImageCluster, ImageInfo, PhotoVerdict, ScanVehicle } from './scanner-images'

export const SCANS_COLLECTION = 'turboCleanScannerScans'
export const ENGINE_VERSION = '2.0'
const MAX_PAGES = 60
const MAX_VEHICLES = 2500
const MAX_CONCURRENT = 2
/** A running scan that has not written a heartbeat for this long was cut off (deploy, timeout, crash). */
const STALE_MS = 120_000

/** Seconds one scan may take: Vercel Pro max is 800 s (maxDuration in nuxt.config.ts). */
function budgetMs() {
  const s = Number(process.env.SCANNER_MAX_SECONDS) || (isServerless() ? 780 : 1500)
  return Math.max(60, s) * 1000
}

export type ScanPhase = 'collecting' | 'analyzing' | 'done' | 'stopped' | 'error'
export interface ScanProgress { phase: ScanPhase, page: number, vehicles: number, advertised: number | null, analyzed: number, toAnalyze: number, message: string, startedAt: string, finishedAt: string | null, pagesVisited: string[] }
export type ScanStatus = 'running' | 'done' | 'stopped' | 'failed' | 'saved' | 'interrupted'

const g = globalThis as any
const live: Set<BrowserHandle> = g.__zrzScannerBrowsers ||= new Set()

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

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

async function loadDealership(db: Db, dealershipId: string) {
  const { ObjectId } = await import('mongodb')
  if (!ObjectId.isValid(dealershipId)) throw createError({ statusCode: 400, statusMessage: 'Invalid dealership' })
  const d = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: new ObjectId(dealershipId) })
  if (!d) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  return d
}

// ───────────────────────── Browser tab ─────────────────────────
interface Tab { browser: BrowserHandle, conn: CdpConnection, sid: string, loading: boolean, url: string }

async function openTab(): Promise<Tab> {
  if (live.size >= MAX_CONCURRENT) throw createError({ statusCode: 429, statusMessage: 'The scanner is busy', message: 'The scanner is busy with another scan — try again in a minute' })
  const browser = await openBrowser()
  live.add(browser)
  try {
    const { conn } = browser
    const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId: sid } = await conn.send('Target.attachToTarget', { targetId, flatten: true })
    const t: Tab = { browser, conn, sid, loading: false, url: '' }
    const version = await conn.send('Browser.getVersion')
    const ua = String(version.userAgent || '').replace(/HeadlessChrome/g, 'Chrome')
    await Promise.all([
      conn.send('Page.enable', {}, sid),
      conn.send('Runtime.enable', {}, sid),
      conn.send('Network.enable', {}, sid),
      // Present as a normal desktop Chrome on Windows — the most common dealer-site visitor.
      conn.send('Network.setUserAgentOverride', { userAgent: ua.replace(/\(X11; Linux x86_64\)/, '(Windows NT 10.0; Win64; x64)'), acceptLanguage: 'en-US,en;q=0.9', platform: 'Windows' }, sid),
      conn.send('Emulation.setDeviceMetricsOverride', { width: SCANNER_VIEWPORT.width, height: SCANNER_VIEWPORT.height, deviceScaleFactor: 1, mobile: false }, sid),
      conn.send('Page.addScriptToEvaluateOnNewDocument', { source: SCANNER_BOOTSTRAP_JS }, sid),
    ])
    conn.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {})
    conn.on(`${sid}:Page.frameStartedLoading`, () => { t.loading = true })
    conn.on(`${sid}:Page.loadEventFired`, () => { t.loading = false })
    conn.on(`${sid}:Page.frameNavigated`, (p: any) => { if (!p.frame?.parentId) t.url = p.frame.url })
    conn.on(`${sid}:Page.navigatedWithinDocument`, (p: any) => { t.url = p.url })
    conn.on(`${sid}:Page.javascriptDialogOpening`, () => { conn.send('Page.handleJavaScriptDialog', { accept: true }, sid).catch(() => {}) })
    return t
  } catch (e) { await closeTab({ browser } as Tab); throw e }
}

async function closeTab(t: Tab) {
  live.delete(t.browser)
  await t.browser.close().catch(() => {})
}

async function evaluate<T = any>(t: Tab, expression: string, timeoutMs = 30_000): Promise<T> {
  const r = await t.conn.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, t.sid, timeoutMs)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text || 'Script error')
  return r.result?.value as T
}

async function waitForSettle(t: Tab, ms = 15_000) {
  const start = Date.now()
  while (Date.now() - start < ms) { if (!t.loading) break; await sleep(250) }
  await sleep(900)
}

async function goto(t: Tab, url: string, timeoutMs = 25_000) {
  t.loading = true
  const r = await t.conn.send('Page.navigate', { url }, t.sid, timeoutMs)
  if (r?.errorText) throw createError({ statusCode: 502, statusMessage: 'Could not open the site', message: `Could not open ${url.replace(/^https?:\/\//, '')} (${r.errorText})` })
  await waitForSettle(t, timeoutMs)
}

// ───────────────────────── Preview ─────────────────────────
/**
 * Open the page once and return a full-page screenshot (scrollable in the popup but not clickable),
 * the inventory shortcuts on it and how many vehicle cards are visible.
 */
export async function previewSite(db: Db, dealershipId: string, urlInput: string | undefined) {
  const d = await loadDealership(db, dealershipId)
  const raw = str(urlInput, 2000) || d.website
  if (!raw) throw createError({ statusCode: 400, statusMessage: 'This dealership has no website — add one first' })
  const url = safeUrl(raw)
  const t = await openTab()
  try {
    await goto(t, url)
    // Nudge lazy-loaded images in the first few screens, then back to the top.
    for (let y = 0; y < 3600; y += 900) { await evaluate(t, `window.scrollTo(0, ${y})`).catch(() => {}); await sleep(220) }
    await evaluate(t, 'window.scrollTo(0, 0)').catch(() => {})
    await sleep(700)
    const [title, navLinks, cards, metrics] = await Promise.all([
      evaluate<string>(t, 'document.title').catch(() => ''),
      evaluate<any[]>(t, NAV_LINKS_JS).catch(() => []),
      evaluate<any>(t, EXTRACT_JS, 30_000).catch(() => null),
      t.conn.send('Page.getLayoutMetrics', {}, t.sid).catch(() => null),
    ])
    const fullH = Math.round(metrics?.cssContentSize?.height || metrics?.contentSize?.height || SCANNER_VIEWPORT.height)
    let height = Math.max(SCANNER_VIEWPORT.height, Math.min(fullH, 4000))
    let shot = await t.conn.send('Page.captureScreenshot', { format: 'jpeg', quality: 60, captureBeyondViewport: true, clip: { x: 0, y: 0, width: SCANNER_VIEWPORT.width, height, scale: 1 } }, t.sid, 30_000)
    // Stay well inside the 4.5 MB response limit of serverless hosting.
    if (shot.data.length > 3_000_000) {
      height = Math.min(height, 2700)
      shot = await t.conn.send('Page.captureScreenshot', { format: 'jpeg', quality: 45, captureBeyondViewport: true, clip: { x: 0, y: 0, width: SCANNER_VIEWPORT.width, height, scale: 1 } }, t.sid, 30_000)
    }
    const finalUrl = (await evaluate<string>(t, 'location.href').catch(() => '')) || t.url || url
    // Link positions → the snapshot becomes clickable; menu links → a Pages list.
    const hot = await evaluate<{ spots: any[], pages: any[] }>(t, HOTSPOTS_JS(height), 15_000).catch(() => ({ spots: [], pages: [] }))
    return {
      url: finalUrl,
      title: String(title || ''),
      screenshot: `data:image/jpeg;base64,${shot.data}`,
      width: SCANNER_VIEWPORT.width,
      height,
      pageHeight: fullH,
      navLinks: Array.isArray(navLinks) ? navLinks : [],
      hotspots: Array.isArray(hot?.spots) ? hot.spots : [],
      pages: Array.isArray(hot?.pages) ? hot.pages : [],
      detected: { cards: cards?.cards?.length || 0, advertised: cards?.total || null, strategy: cards?.strategy || null },
    }
  }
  finally { await closeTab(t) }
}

// ───────────────────────── Stored scans ─────────────────────────
export interface ScanDoc {
  _id?: any
  scannerVersion: string
  dealershipId: string
  dealershipName: string
  status: ScanStatus
  stopRequested: boolean
  startUrl: string
  allPages: boolean
  progress: ScanProgress
  log: { at: string, text: string }[]
  vehicles: ScanVehicle[]
  images: ImageInfo[]
  clusters: ImageCluster[]
  countStockAsMissing: boolean
  auditId: string | null
  error: string | null
  heartbeatAt: string
  createdAt: string
  createdBy: { id: string, name: string }
  savedAt?: string | null
  savedBy?: { id: string, name: string } | null
}

const statusOf = (doc: ScanDoc): ScanStatus => doc.status === 'running' && Date.now() - new Date(doc.heartbeatAt).getTime() > STALE_MS ? 'interrupted' : doc.status

export function scanMeta(doc: ScanDoc) {
  return {
    id: String(doc._id), dealershipId: doc.dealershipId, status: statusOf(doc), startUrl: doc.startUrl, allPages: doc.allPages,
    progress: doc.progress, log: (doc.log || []).slice(-30), error: doc.error, auditId: doc.auditId, createdAt: doc.createdAt, createdBy: doc.createdBy,
    savedAt: doc.savedAt || null, vehicles: doc.vehicles?.length || 0,
  }
}

export function resultsOf(doc: ScanDoc) {
  const summary = summarize(doc.vehicles, doc.clusters, { countStockAsMissing: doc.countStockAsMissing })
  const used = new Set(doc.vehicles.map(v => v.imageId).filter(Boolean) as string[])
  const images: Record<string, any> = {}
  for (const i of doc.images) {
    if (!used.has(i.id)) continue
    images[i.id] = { id: i.id, url: i.url, ok: i.ok, error: i.error || null, w: i.w || null, h: i.h || null, hash: i.hash || null, text: i.text || '', ocr: !!i.ocr }
  }
  const cmap = new Map(doc.clusters.map(c => [c.id, c]))
  return {
    scanId: String(doc._id), summary, countStockAsMissing: doc.countStockAsMissing, advertised: doc.progress.advertised, pages: doc.progress.pagesVisited,
    vehicles: doc.vehicles.map(v => ({ ...v, final: finalVerdict(v, cmap) })), clusters: doc.clusters, images,
    savedAuditId: doc.auditId, labels: VERDICT_LABEL, finishedAt: doc.progress.finishedAt,
  }
}

export async function getScan(db: Db, id: string) {
  const { ObjectId } = await import('mongodb')
  if (!ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid scan' })
  const doc = await db.collection<ScanDoc>(SCANS_COLLECTION).findOne({ _id: new ObjectId(id) as any })
  if (!doc || doc.scannerVersion !== ENGINE_VERSION) throw createError({ statusCode: 404, statusMessage: 'Scan not found' })
  return finalizeIfInterrupted(db, doc as ScanDoc)
}

/**
 * A scan whose server process was cut off (deploy, time limit, crash) still has the vehicles it
 * collected. Turn it into a usable "stopped" result: photos it did not get to are judged by their
 * web address and card text only.
 */
async function finalizeIfInterrupted(db: Db, doc: ScanDoc) {
  if (statusOf(doc) !== 'interrupted') return doc
  const now = new Date().toISOString()
  if (!doc.vehicles?.length) {
    doc.status = 'failed'
    doc.error = doc.error || 'The scan was cut off before it found any vehicles'
    Object.assign(doc.progress, { phase: 'error', message: doc.error, finishedAt: now })
    await db.collection(SCANS_COLLECTION).updateOne({ _id: doc._id }, { $set: { status: 'failed', error: doc.error, progress: doc.progress } }).catch(() => {})
    return doc
  }
  doc.images = doc.images || []
  doc.clusters = doc.clusters || []
  // Give every vehicle an image entry (no download) so URL / text rules can run.
  const byUrl = new Map(doc.images.map(i => [i.url, i]))
  for (const v of doc.vehicles) {
    const u = v.image?.url
    if (!u) continue
    let i = byUrl.get(u)
    if (!i) { i = { id: `i${doc.images.length + 1}`, url: u, ok: false, error: 'Not checked (scan was cut off)' }; doc.images.push(i); byUrl.set(u, i) }
    v.imageId = i.id
  }
  await reclassify(db, doc)
  const sum = summarize(doc.vehicles, doc.clusters, { countStockAsMissing: doc.countStockAsMissing })
  doc.status = 'stopped'
  doc.log = [...(doc.log || []), { at: now, text: 'The server cut this scan off — keeping the vehicles found so far; photos judged by address and text only' }].slice(-60)
  Object.assign(doc.progress, { phase: 'stopped', message: `Cut off early — ${sum.total} vehicles · ${sum.withoutReal} without a real photo (${sum.withoutRealPct ?? 0}%)`, finishedAt: now })
  await db.collection(SCANS_COLLECTION).updateOne({ _id: doc._id }, { $set: { status: 'stopped', progress: doc.progress, log: doc.log, vehicles: doc.vehicles, images: doc.images, clusters: doc.clusters, heartbeatAt: now } }).catch(() => {})
  return doc
}

const hasResults = (doc: ScanDoc) => ['done', 'stopped', 'saved'].includes(doc.status) && doc.vehicles.length > 0

/** The scan + its results (when finished). */
export function scanPayload(doc: ScanDoc) {
  return { scan: scanMeta(doc), results: hasResults(doc) ? resultsOf(doc) : null }
}

/** Most recent scan for a dealership (running or finished). */
export async function latestScan(db: Db, dealershipId: string) {
  const doc = await db.collection<ScanDoc>(SCANS_COLLECTION).find({ dealershipId, scannerVersion: ENGINE_VERSION }).sort({ createdAt: -1 }).limit(1).next()
  return doc ? scanPayload(await finalizeIfInterrupted(db, doc as ScanDoc)) : { scan: null, results: null }
}

export async function requestStop(db: Db, id: string) {
  const doc = await getScan(db, id)
  if (doc.status !== 'running') return { stopping: false }
  await db.collection(SCANS_COLLECTION).updateOne({ _id: doc._id }, { $set: { stopRequested: true } })
  return { stopping: true }
}

// ───────────────────────── The scan ─────────────────────────
type Emit = (event: string, data: any) => void

function vehicleKey(c: any) {
  if (c.vin) return `vin:${c.vin}`
  if (c.url) return `url:${String(c.url).split('#')[0]}`
  if (c.stock) return `stock:${c.stock}`
  return `t:${c.title}|${c.price}|${c.image?.url || ''}`
}

/**
 * Start a scan: validates, creates the stored scan and returns it plus a `run(emit)` function that
 * does the work and streams events. `appendTo` continues an earlier scan (e.g. New after Used).
 */
export async function createScan(db: Db, body: any, actor: SessionActor) {
  const d = await loadDealership(db, str(body?.dealershipId, 40))
  const raw = str(body?.url, 2000) || d.website
  if (!raw) throw createError({ statusCode: 400, statusMessage: 'This dealership has no website — add one first' })
  const url = safeUrl(raw)
  const dealershipId = String(d._id)
  const col = db.collection<ScanDoc>(SCANS_COLLECTION)
  const busy = await col.findOne({ dealershipId, scannerVersion: ENGINE_VERSION, status: 'running', heartbeatAt: { $gt: new Date(Date.now() - STALE_MS).toISOString() } })
  if (busy) throw createError({ statusCode: 409, statusMessage: 'Already scanning', message: 'A scan is already running for this dealership — wait for it or stop it first' })

  const base = body?.appendTo ? await getScan(db, str(body.appendTo, 40)) : null
  if (base && base.dealershipId !== dealershipId) throw createError({ statusCode: 400, statusMessage: 'That scan belongs to another dealership' })
  const now = new Date().toISOString()
  const progress: ScanProgress = { phase: 'collecting', page: 0, vehicles: base?.vehicles.length || 0, advertised: base?.progress.advertised ?? null, analyzed: 0, toAnalyze: 0, message: 'Opening the website…', startedAt: now, finishedAt: null, pagesVisited: base ? [...base.progress.pagesVisited] : [] }
  const doc: ScanDoc = {
    scannerVersion: ENGINE_VERSION, dealershipId, dealershipName: d.name || '', status: 'running', stopRequested: false, startUrl: url, allPages: body?.allPages !== false,
    progress, log: [], vehicles: base ? base.vehicles.map(v => ({ ...v })) : [], images: base ? base.images.map(i => ({ ...i })) : [], clusters: base ? base.clusters.map(c => ({ ...c })) : [],
    countStockAsMissing: base ? base.countStockAsMissing : true, auditId: null, error: null, heartbeatAt: now, createdAt: now, createdBy: { id: actor.id, name: actor.name },
  }
  if (base) {
    // Continue the same scan record so one audit covers both lists.
    await col.updateOne({ _id: base._id }, { $set: { status: 'running', stopRequested: false, startUrl: url, progress, heartbeatAt: now, auditId: null, error: null } })
    doc._id = base._id
    doc.log = base.log || []
  }
  else {
    const r = await col.insertOne(doc as any)
    doc._id = r.insertedId
  }
  return { doc, run: (emit: Emit, opts: { isClosed: () => boolean }) => runScan(db, doc, emit, opts) }
}

async function runScan(db: Db, doc: ScanDoc, emit: Emit, opts: { isClosed: () => boolean }) {
  const col = db.collection<ScanDoc>(SCANS_COLLECTION)
  const t0 = Date.now()
  const budget = budgetMs()
  const collectUntil = t0 + budget * 0.55
  const analyzeUntil = t0 + budget * 0.88
  let stop = false
  let lastPersist = 0

  const log = (text: string) => {
    const entry = { at: new Date().toISOString(), text }
    doc.log.push(entry)
    if (doc.log.length > 120) doc.log.shift()
    emit('log', entry)
  }
  /** Throttled heartbeat: progress + log to the DB, and pick up a Stop pressed in another request. */
  const persist = async (force = false) => {
    if (!force && Date.now() - lastPersist < 3000) return
    lastPersist = Date.now()
    try {
      // Vehicles go with every heartbeat, so a scan cut off by the server keeps what it found.
      const r = await col.findOneAndUpdate({ _id: doc._id }, { $set: { progress: doc.progress, log: doc.log.slice(-60), vehicles: doc.vehicles, heartbeatAt: new Date().toISOString() } }, { projection: { stopRequested: 1 }, returnDocument: 'after' })
      if ((r as any)?.stopRequested && !stop) { stop = true; log('Stopping — checking the photos found so far…') }
    } catch {}
  }
  const setProgress = (patch: Partial<ScanProgress>) => {
    Object.assign(doc.progress, patch)
    emit('progress', doc.progress)
    persist().catch(() => {})
  }

  let t: Tab | null = null
  let frameTimer: ReturnType<typeof setInterval> | null = null
  try {
    emit('scan', { id: String(doc._id) })
    emit('progress', doc.progress)
    log(`Starting a private browser${isServerless() ? ' in the cloud' : ''}…`)
    t = await openTab()
    const tab = t

    // Live view: a small frame every ~2.5 s while collecting (non-interactive), capped in total size.
    let frameBytes = 0
    let framing = false
    const FRAME_CAP = 4_000_000
    frameTimer = setInterval(async () => {
      if (framing || frameBytes > FRAME_CAP || doc.progress.phase !== 'collecting' || opts.isClosed()) return
      framing = true
      try {
        const shot = await tab.conn.send('Page.captureScreenshot', { format: 'jpeg', quality: 40 }, tab.sid, 8000)
        frameBytes += shot.data.length
        emit('frame', { data: shot.data, w: SCANNER_VIEWPORT.width, h: SCANNER_VIEWPORT.height, ts: Date.now() })
      } catch {}
      framing = false
    }, 3000)

    log(`Opening ${doc.startUrl.replace(/^https?:\/\//, '')}`)
    setProgress({ message: 'Loading the inventory page…' })
    await goto(tab, doc.startUrl)

    // ── Collect ──
    const seen = new Map(doc.vehicles.map(v => [v.key, v]))
    let advertised: number | null = doc.progress.advertised
    const better = (a: any, b: any) => (!a?.url && b?.url) || (a?.url && b?.url && a.url !== b.url && (a.nw || 0) === 0 && (b.nw || 0) > 0)
    const startCount = doc.vehicles.length
    for (let page = 1; page <= MAX_PAGES && !stop; page++) {
      setProgress({ page, message: page === 1 ? 'Loading every vehicle on this page…' : `Page ${page}: loading vehicles…` })
      let res: any = null
      let added = 0
      let pageCards = 0
      const collect = async () => {
        const r = await evaluate<any>(tab, EXTRACT_JS, 45_000).catch(() => null)
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
          doc.vehicles.push(v)
          added++
        }
        setProgress({ vehicles: doc.vehicles.length, advertised, message: `${doc.vehicles.length} vehicles found` })
      }
      // Scroll top → bottom so lazy images and infinite-scroll batches load; collect as we go so
      // virtualised lists (cards removed once off-screen) are captured too.
      await evaluate(tab, 'window.scrollTo({ top: 0, behavior: "instant" })').catch(() => {})
      await sleep(300)
      let stableAtBottom = 0
      let lastH = 0
      for (let i = 0; i < 220 && !stop && Date.now() < collectUntil; i++) {
        const r = await evaluate<{ y: number, h: number, atBottom: boolean }>(tab, SCROLL_STEP_JS).catch(() => null)
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
      doc.progress.pagesVisited.push(res?.url || tab.url)
      log(`Page ${page}: ${pageCards} cards on screen, ${added} new — ${res?.strategy === 'known' ? 'recognised layout' : 'detected by structure'}`)
      if (doc.vehicles.length === startCount && page === 1) throw createError({ statusCode: 422, statusMessage: 'No vehicle cards found', message: 'No vehicle cards found on this page. Pick the inventory / search results page (e.g. Used Inventory), then press Continue.' })
      if (!doc.allPages || doc.vehicles.length >= MAX_VEHICLES) break
      if (Date.now() >= collectUntil) { log('Time limit for collecting reached — checking the photos found so far'); break }
      if (added === 0 && page > 1) break
      if (advertised && doc.vehicles.length >= advertised) break

      const next = await evaluate<any>(tab, FIND_NEXT_JS).catch(() => null)
      if (!next) break
      if (next.kind === 'href') {
        log(`${next.label} → ${String(next.href).replace(/^https?:\/\/[^/]+/, '')}`)
        await goto(tab, next.href).catch((e: any) => log(`Could not open the next page (${e?.message})`))
      }
      else {
        log(`Clicking “${next.label}”`)
        await sleep(400)
        await evaluate(tab, `(() => { const el = document.querySelector('[data-zrz-next]'); if (el) el.click(); return !!el })()`)
        await sleep(1500)
        await waitForSettle(tab, 15_000)
      }
    }
    // Keep what was collected even if the photo step is cut short.
    await col.updateOne({ _id: doc._id }, { $set: { vehicles: doc.vehicles, progress: doc.progress, heartbeatAt: new Date().toISOString() } }).catch(() => {})

    // ── Photos ──
    await analyzePhotos(tab, doc, { setProgress, log, deadline: analyzeUntil })
    await reclassify(db, doc, log)

    const sum = summarize(doc.vehicles, doc.clusters, { countStockAsMissing: doc.countStockAsMissing })
    doc.status = stop ? 'stopped' : 'done'
    Object.assign(doc.progress, { phase: doc.status, message: `${stop ? 'Stopped early — ' : ''}${sum.total} vehicles · ${sum.withoutReal} without a real photo (${sum.withoutRealPct ?? 0}%)`, finishedAt: new Date().toISOString() })
    log(`Done in ${Math.round((Date.now() - t0) / 1000)}s`)
    await col.updateOne({ _id: doc._id }, { $set: { status: doc.status, progress: doc.progress, log: doc.log.slice(-60), vehicles: doc.vehicles, images: doc.images.map(stripImage), clusters: doc.clusters, heartbeatAt: new Date().toISOString() } })
    emit('progress', doc.progress)
    emit('done', { id: String(doc._id), status: doc.status, summary: sum })
  }
  catch (e: any) {
    const message = e?.message || e?.statusMessage || 'Scan failed'
    doc.status = 'failed'
    Object.assign(doc.progress, { phase: 'error', message, finishedAt: new Date().toISOString() })
    log(`Scan failed: ${message}`)
    await col.updateOne({ _id: doc._id }, { $set: { status: 'failed', error: message, progress: doc.progress, log: doc.log.slice(-60), vehicles: doc.vehicles, heartbeatAt: new Date().toISOString() } }).catch(() => {})
    emit('progress', doc.progress)
    emit('failure', { message })
  }
  finally {
    if (frameTimer) clearInterval(frameTimer)
    if (t) await closeTab(t)
  }
}

const stripImage = (i: ImageInfo): ImageInfo => { const { bytes, thumb, ...rest } = i as any; return rest }

async function analyzePhotos(t: Tab, doc: ScanDoc, o: { setProgress: (p: Partial<ScanProgress>) => void, log: (s: string) => void, deadline: number }) {
  const images = new Map(doc.images.map(i => [i.id, i]))
  const byUrl = new Map<string, string>()
  for (const [id, info] of images) byUrl.set(info.url, id)
  for (const v of doc.vehicles) {
    const u = v.image?.url
    if (!u) continue
    let id = byUrl.get(u)
    if (!id) { id = `i${images.size + 1}`; images.set(id, { id, url: u, ok: false }); byUrl.set(u, id) }
    v.imageId = id
  }
  const todo = [...images.values()].filter(i => !i.hash && !i.error)
  o.setProgress({ phase: 'analyzing', analyzed: 0, toAnalyze: todo.length, message: `Checking ${todo.length} photos…` })
  if (todo.length) {
    // A blank tab does the image maths (no page scripts, no cross-origin limits on our own bytes).
    const { targetId } = await t.conn.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId: asid } = await t.conn.send('Target.attachToTarget', { targetId, flatten: true })
    let timedOut = false
    try {
      let done = 0
      const queue = [...todo]
      const referer = doc.progress.pagesVisited[0] || doc.startUrl
      const worker = async () => {
        while (queue.length) {
          if (Date.now() > o.deadline) { timedOut = true; return }
          const batch = queue.splice(0, 4)
          const dl = await Promise.all(batch.map(async (img) => {
            const r = await downloadImage(img.url, referer)
            if ('error' in r) { img.ok = false; img.error = r.error; return null }
            return { id: img.id, b64: r.b64, mime: r.mime }
          }))
          const items = dl.filter(Boolean) as { id: string, b64: string, mime: string }[]
          if (items.length) {
            const res = await t.conn.send('Runtime.evaluate', { expression: `(${ANALYZE_FN_JS})(${JSON.stringify(items)})`, returnByValue: true, awaitPromise: true }, asid, 60_000).catch((e: any) => ({ result: { value: items.map(i => ({ id: i.id, ok: false, error: e.message })) } }))
            for (const a of (res?.result?.value || []) as any[]) {
              const img = images.get(a.id)
              if (img) Object.assign(img, a)
            }
          }
          done += batch.length
          o.setProgress({ analyzed: done, message: `Checking photos… ${done} of ${todo.length}` })
        }
      }
      await Promise.all([worker(), worker(), worker()])
    }
    finally { t.conn.send('Target.closeTarget', { targetId }).catch(() => {}) }
    if (timedOut) {
      const left = todo.filter(i => !i.hash && !i.error)
      for (const i of left) { i.ok = false; i.error = 'Not checked (time limit)' }
      o.log(`Time limit reached — ${left.length} photos judged by their web address and text only`)
    }
  }
  doc.images = [...images.values()].map(stripImage)
}

async function reclassify(db: Db | null, doc: ScanDoc, log?: (s: string) => void) {
  let rules: Awaited<ReturnType<typeof listRules>> = []
  try { if (db) rules = await listRules(db) }
  catch (e: any) { log?.(`Saved image rules unavailable (${e?.message}) — using built-in checks only`) }
  const keep = new Map(doc.clusters.map(c => [c.hash, c.override]))
  const images = new Map(doc.images.map(i => [i.id, i]))
  const { clusters, ruleHits } = classify(doc.vehicles, images, rules)
  for (const c of clusters) { const o = keep.get(c.hash); if (o) c.override = o }
  doc.clusters = clusters
  if (ruleHits.size && db) {
    const { ObjectId } = await import('mongodb')
    for (const [id, n] of ruleHits) if (ObjectId.isValid(id)) await db.collection(RULES_COLLECTION).updateOne({ _id: new ObjectId(id) }, { $inc: { hits: n }, $set: { lastHitAt: new Date().toISOString() } }).catch(() => {})
  }
}

// ───────────────────────── Review & save ─────────────────────────
/** Overrides from the review screen (per vehicle, per duplicate group) + the stock setting. */
export async function applyReview(db: Db, id: string, body: any) {
  const doc = await getScan(db, id)
  if (!hasResults(doc)) throw createError({ statusCode: 409, statusMessage: 'Wait for the scan to finish' })
  const ok = (v: any): Exclude<PhotoVerdict, 'review'> | null => ['real', 'placeholder', 'stock', 'missing'].includes(v) ? v : null
  if (Array.isArray(body?.vehicles)) {
    const set = new Map<string, any>(body.vehicles.map((x: any) => [String(x.key), x.verdict]))
    for (const v of doc.vehicles) if (set.has(v.key)) v.override = ok(set.get(v.key))
  }
  if (Array.isArray(body?.clusters)) {
    for (const x of body.clusters) { const c = doc.clusters.find(c => c.id === x.id); if (c) c.override = ok(x.verdict) }
  }
  if (typeof body?.countStockAsMissing === 'boolean') doc.countStockAsMissing = body.countStockAsMissing
  if (body?.reapplyRules) await reclassify(db, doc)
  // Any change after saving makes it a draft again until saved once more.
  if (doc.status === 'saved') doc.status = 'done'
  doc.auditId = null
  await db.collection(SCANS_COLLECTION).updateOne({ _id: doc._id }, { $set: { vehicles: doc.vehicles, clusters: doc.clusters, countStockAsMissing: doc.countStockAsMissing, status: doc.status, auditId: null } })
  return resultsOf(doc)
}

/** Save the scan to the CRM as an automated inventory audit (no screenshots or images kept). */
export async function saveScan(db: Db, id: string, actor: SessionActor) {
  const doc = await getScan(db, id)
  if (!hasResults(doc)) throw createError({ statusCode: 409, statusMessage: 'Wait for the scan to finish' })
  const d = await loadDealership(db, doc.dealershipId)
  const sum = summarize(doc.vehicles, doc.clusters, { countStockAsMissing: doc.countStockAsMissing })
  const cmap = new Map(doc.clusters.map(c => [c.id, c]))
  const without = doc.vehicles.filter((v) => { const f = finalVerdict(v, cmap); return f === 'missing' || f === 'placeholder' || (doc.countStockAsMissing && f === 'stock') })
  const pages = doc.progress.pagesVisited
  const parts = [
    `Inventory Scanner: ${sum.total} vehicles on ${pages.length} page${pages.length === 1 ? '' : 's'}${doc.progress.advertised ? ` (site advertises ${doc.progress.advertised})` : ''}.`,
    `${sum.by.real} real photos · ${sum.by.missing + sum.by.placeholder} no photo (${sum.by.placeholder} showing a placeholder image such as “photos unavailable”, ${sum.by.missing} with no image) · ${sum.by.stock} stock images${doc.countStockAsMissing ? ' (counted as no photo)' : ' (counted as photos)'}.`,
  ]
  const { recordAudit } = await import('./crm-audit')
  const audit = await recordAudit(db, d, {
    ...sum.counts,
    source: 'automated',
    inventoryUrl: pages[0] || doc.startUrl,
    // Used cars first, then "No photo" before stock images — the strongest evidence leads.
    examples: without.filter(v => v.url)
      .sort((a, b) => (Number(a.condition === 'new') - Number(b.condition === 'new')) || (Number(finalVerdict(a, cmap) === 'stock') - Number(finalVerdict(b, cmap) === 'stock')))
      .slice(0, 25)
      .map((v) => { const f = finalVerdict(v, cmap); return { url: v.url, label: `${v.title}${v.stock ? ` #${v.stock}` : ''} — ${VERDICT_LABEL[f]}`, title: v.title, stock: v.stock, price: v.price, condition: v.condition, verdict: f } }),
    photoBreakdown: { real: sum.by.real, placeholder: sum.by.placeholder, missing: sum.by.missing, stock: sum.by.stock, countStockAsMissing: doc.countStockAsMissing },
    merchandisingIssues: [
      ...(sum.by.missing + sum.by.placeholder ? ['Vehicles listed with no photos (placeholder / “photos unavailable”)'] : []),
      ...(sum.by.stock ? ['Stock images instead of real photos'] : []),
    ],
    notes: parts.join('\n'),
    screenshotFileId: null,
    collector: { name: 'ZRZ Inventory Scanner', version: ENGINE_VERSION, runId: String(doc._id) },
  }, actor)
  await db.collection(SCANS_COLLECTION).updateOne({ _id: doc._id }, { $set: { status: 'saved', auditId: audit?.id || null, summary: sum, savedAt: new Date().toISOString(), savedBy: { id: actor.id, name: actor.name } } })
  try {
    const { logEventRun } = await import('./automation')
    await logEventRun(db, 'count_inventory', `${d.name}: ${sum.total} vehicles scanned, ${sum.withoutReal} without a real photo (${sum.withoutRealPct ?? 0}%)`, { vehicles: sum.total, withoutReal: sum.withoutReal }, [{ dealershipId: doc.dealershipId, name: d.name }])
  } catch {}
  return { audit, summary: sum }
}

/** Used on server shutdown / dev reload: no Chromium may outlive the server. */
export async function closeAllScannerSessions() {
  await Promise.all([...live].map(b => b.close().catch(() => {})))
  live.clear()
}
