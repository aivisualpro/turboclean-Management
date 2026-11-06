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
import { classify, countable, downloadImage, finalVerdict, listRules, RULES_COLLECTION, summarize, VERDICT_LABEL } from './scanner-images'
import type { ImageCluster, ImageInfo, PhotoVerdict, ScanVehicle } from './scanner-images'

export const SCANS_COLLECTION = 'turboCleanScannerScans'
export const ENGINE_VERSION = '2.0'
const MAX_PAGES = 60
const MAX_VEHICLES = 2500
/** A running scan that has not written a heartbeat for this long was cut off (deploy, timeout, crash). */
const STALE_MS = 120_000

/** Seconds one scan may take: Vercel Pro max is 800 s (maxDuration in nuxt.config.ts). */
function budgetMs() {
  const s = Number(process.env.SCANNER_MAX_SECONDS) || (isServerless() ? 780 : 1500)
  return Math.max(60, s) * 1000
}

export type ScanPhase = 'collecting' | 'analyzing' | 'done' | 'stopped' | 'error'
export interface ScanProgress { phase: ScanPhase, page: number, vehicles: number, advertised: number | null, analyzed: number, toAnalyze: number, message: string, startedAt: string, finishedAt: string | null, pagesVisited: string[]
  /** Checkpoints — a resumed scan skips finished inventory pages and re-opens the exact result page it was on. */
  doneUrls?: string[], resumeAt?: { url: string, href: string, page: number, clicks?: number } | null, memMb?: number, restarts?: number
  /** What each inventory list says it has ("42 vehicles") — coverage = collected vs these. */
  advertisedByUrl?: Record<string, number>
  /** Result pages the dealer's site refused (bot protection) — retried later from this exact page. */
  blocked?: { url: string, href: string, page: number, at: string }[]
  /** Lists whose "next page" never moved although the site lists more vehicles. */
  stuck?: { url: string, page: number }[] }
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

export async function loadDealership(db: Db, dealershipId: string) {
  const { ObjectId } = await import('mongodb')
  if (!ObjectId.isValid(dealershipId)) throw createError({ statusCode: 400, statusMessage: 'Invalid dealership' })
  const d = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: new ObjectId(dealershipId) })
  if (!d) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  return d
}

// ───────────────────────── Browser tab ─────────────────────────
export interface Tab { browser: BrowserHandle, conn: CdpConnection, sid: string, targetId: string, loading: boolean, url: string, status: number | null, mainFrameId: string }

/**
 * One warm browser per server instance, shared by previews and scans (each gets its own tab).
 * Starting Chromium costs 2–4 s and every fresh start looks like a new bot to the dealer's site —
 * reusing it makes clicking around the snapshot fast and far less likely to trip "too many requests".
 * The browser closes after a short idle time.
 */
const WARM_IDLE_MS = 90_000
const MAX_TABS = 3
const pool: { browser: BrowserHandle | null, tabs: number, idleTimer: ReturnType<typeof setTimeout> | null, opening: Promise<BrowserHandle> | null } = g.__zrzScannerPool ||= { browser: null, tabs: 0, idleTimer: null, opening: null }

async function warmBrowser(): Promise<BrowserHandle> {
  if (pool.browser && !pool.browser.conn.closed) return pool.browser
  if (pool.opening) return pool.opening
  pool.opening = (async () => {
    const b = await openBrowser()
    live.add(b)
    b.conn.once('disconnected', () => { live.delete(b); if (pool.browser === b) { pool.browser = null; pool.tabs = 0 } })
    b.conn.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {})
    pool.browser = b
    pool.tabs = 0
    return b
  })()
  try { return await pool.opening }
  finally { pool.opening = null }
}
function scheduleIdleClose() {
  if (pool.idleTimer) clearTimeout(pool.idleTimer)
  pool.idleTimer = setTimeout(async () => {
    if (pool.tabs > 0 || !pool.browser) return
    const b = pool.browser
    pool.browser = null
    live.delete(b)
    await b.close().catch(() => {})
  }, WARM_IDLE_MS)
}

const BLOCKED_URLS = [
  '*.mp4*', '*.webm*', '*.m3u8*', '*.mov*', '*.woff*', '*.ttf*', '*.otf*', '*.eot*',
  '*googletagmanager.com*', '*google-analytics.com*', '*doubleclick.net*', '*googleadservices.com*', '*googlesyndication.com*',
  '*facebook.net*', '*connect.facebook*', '*hotjar.com*', '*clarity.ms*', '*bing.com/bat*', '*tiktok*', '*snapchat*', '*pinterest*', '*linkedin*', '*twitter*',
  '*youtube.com*', '*vimeo.com*', '*fullstory*', '*segment.io*', '*segment.com*', '*newrelic*', '*nr-data*', '*quantserve*', '*adroll*', '*criteo*', '*taboola*', '*outbrain*',
  '*carnow.com*', '*gubagoo*', '*contactatonce*', '*activengage*', '*podium.com*', '*livechat*', '*drift.com*', '*intercom*', '*zopim*', '*tawk.to*', '*olark*',
  '*trueCar*', '*cdk-ga*', '*dealerfire*/tracking*', '*cdn.cookielaw*', '*onetrust*', '*recaptcha*', '*gstatic.com/recaptcha*', '*maps.googleapis.com*', '*maps.gstatic.com*',
]

export async function openTab(): Promise<Tab> {
  if (pool.tabs >= MAX_TABS) throw createError({ statusCode: 429, statusMessage: 'The scanner is busy', message: 'The scanner is busy with other pages — wait a moment and try again' })
  const browser = await warmBrowser()
  pool.tabs++
  if (pool.idleTimer) { clearTimeout(pool.idleTimer); pool.idleTimer = null }
  let targetId = ''
  try {
    const { conn } = browser
    ;({ targetId } = await conn.send('Target.createTarget', { url: 'about:blank' }))
    const { sessionId: sid } = await conn.send('Target.attachToTarget', { targetId, flatten: true })
    const t: Tab = { browser, conn, sid, targetId, loading: false, url: '', status: null, mainFrameId: '' }
    const version = await conn.send('Browser.getVersion')
    const ua = String(version.userAgent || '').replace(/HeadlessChrome/g, 'Chrome')
    // Client hints must tell the same story as the user agent (Windows desktop Chrome) — bot managers
    // (Akamai, Cloudflare) block visitors whose Sec-CH-UA-Platform says "Linux" but whose UA says Windows.
    const full = ua.match(/Chrome\/([\d.]+)/)?.[1] || '130.0.0.0'
    const major = full.split('.')[0]!
    const brands = [{ brand: 'Chromium', version: major }, { brand: 'Google Chrome', version: major }, { brand: 'Not?A_Brand', version: '99' }]
    const userAgentMetadata = { brands, fullVersionList: brands.map(b => ({ brand: b.brand, version: b.brand === 'Not?A_Brand' ? '99.0.0.0' : full })), fullVersion: full, platform: 'Windows', platformVersion: '15.0.0', architecture: 'x86', model: '', mobile: false, bitness: '64', wow64: false }
    await Promise.all([
      conn.send('Page.enable', {}, sid),
      conn.send('Runtime.enable', {}, sid),
      conn.send('Network.enable', {}, sid),
      // Present as a normal desktop Chrome on Windows — the most common dealer-site visitor.
      conn.send('Network.setUserAgentOverride', { userAgent: ua.replace(/\(X11; Linux x86_64\)/, '(Windows NT 10.0; Win64; x64)'), acceptLanguage: 'en-US,en;q=0.9', platform: 'Win32', userAgentMetadata }, sid),
      conn.send('Emulation.setDeviceMetricsOverride', { width: SCANNER_VIEWPORT.width, height: SCANNER_VIEWPORT.height, deviceScaleFactor: 1, mobile: false }, sid),
      conn.send('Page.addScriptToEvaluateOnNewDocument', { source: SCANNER_BOOTSTRAP_JS }, sid),
      // Skip what a crawler never needs (videos, fonts, chat widgets, trackers, ads): dealer sites load
      // 5–15 MB of it per page, and it is what runs a cloud browser out of memory mid-crawl.
      conn.send('Network.setBlockedURLs', { urls: BLOCKED_URLS }, sid).catch(() => {}),
      conn.send('Network.setCacheDisabled', { cacheDisabled: false }, sid).catch(() => {}),
    ])
    const tree = await conn.send('Page.getFrameTree', {}, sid).catch(() => null)
    t.mainFrameId = tree?.frameTree?.frame?.id || ''
    conn.on(`${sid}:Page.frameStartedLoading`, (p: any) => { if (!t.mainFrameId || p.frameId === t.mainFrameId) { t.loading = true; t.status = null } })
    conn.on(`${sid}:Page.loadEventFired`, () => { t.loading = false })
    conn.on(`${sid}:Page.frameNavigated`, (p: any) => { if (!p.frame?.parentId) { t.url = p.frame.url; t.mainFrameId = p.frame.id } })
    // Same-page navigations (history.pushState) start "loading" but never fire a load event.
    conn.on(`${sid}:Page.navigatedWithinDocument`, (p: any) => { t.url = p.url })
    conn.on(`${sid}:Page.frameStoppedLoading`, (p: any) => { if (!t.mainFrameId || p.frameId === t.mainFrameId) t.loading = false })
    conn.on(`${sid}:Network.responseReceived`, (p: any) => { if (p.type === 'Document' && (!p.frameId || p.frameId === t.mainFrameId)) t.status = Number(p.response?.status) || null })
    conn.on(`${sid}:Page.javascriptDialogOpening`, () => { conn.send('Page.handleJavaScriptDialog', { accept: true }, sid).catch(() => {}) })
    return t
  }
  catch (e) {
    pool.tabs = Math.max(0, pool.tabs - 1)
    if (targetId) browser.conn.send('Target.closeTarget', { targetId }).catch(() => {})
    scheduleIdleClose()
    throw e
  }
}

export async function closeTab(t: Tab) {
  pool.tabs = Math.max(0, pool.tabs - 1)
  await t.conn.send('Target.closeTarget', { targetId: t.targetId }, undefined, 5000).catch(() => {})
  scheduleIdleClose()
}

export async function evaluate<T = any>(t: Tab, expression: string, timeoutMs = 30_000): Promise<T> {
  const r = await t.conn.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, t.sid, timeoutMs)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text || 'Script error')
  return r.result?.value as T
}

async function waitForSettle(t: Tab, ms = 15_000) {
  const start = Date.now()
  while (Date.now() - start < ms) { if (!t.loading) break; await sleep(250) }
  await sleep(900)
}

/** Sites that say "too many requests" (429) or "busy" (503) get a polite pause and up to two retries. */
const RATE_LIMIT_WAITS = [4000, 9000]
export async function goto(t: Tab, url: string, timeoutMs = 25_000, log?: (s: string) => void, referrer?: string) {
  for (let attempt = 0; ; attempt++) {
    t.loading = true
    t.status = null
    let r: any
    try { r = await t.conn.send('Page.navigate', referrer ? { url, referrer } : { url }, t.sid, timeoutMs) }
    catch (e: any) {
      // Some dealer sites take ages to answer (bot checks, slow CDNs). Give the page one more
      // stretch; if anything rendered we carry on, otherwise it's a clear "did not respond".
      if (!/timed out/i.test(String(e?.message))) throw e
      log?.(`${url.replace(/^https?:\/\//, '')} is slow to answer — waiting a little longer`)
      await waitForSettle(t, 20_000)
      const alive = await evaluate<boolean>(t, '!!document.body && document.body.innerText.trim().length > 0', 5_000).catch(() => false)
      if (!alive) throw createError({ statusCode: 504, statusMessage: 'The website did not respond', message: `${url.replace(/^https?:\/\//, '')} did not respond within ${Math.round((timeoutMs + 20_000) / 1000)} s. Try again later or check the address.` })
      return
    }
    if (r?.errorText) throw createError({ statusCode: 502, statusMessage: 'Could not open the site', message: `Could not open ${url.replace(/^https?:\/\//, '')} (${r.errorText})` })
    await waitForSettle(t, timeoutMs)
    // Akamai / Cloudflare "Access Denied": most US dealer sites refuse visitors from outside the US.
    if (t.status === 403) {
      const title = await evaluate<string>(t, 'document.title', 5_000).catch(() => '')
      throw createError({ statusCode: 403, statusMessage: 'The website blocked this visit', message: `${url.replace(/^https?:\/\//, '')} answered "Access Denied" (HTTP 403${title ? `, "${title}"` : ''}). Dealer websites usually block traffic from outside the US — run this from zrzops.com (US servers) or through a US VPN.` })
    }
    const limited = t.status === 429 || t.status === 503 || t.status === 509
    if (!limited || attempt >= RATE_LIMIT_WAITS.length) {
      if (limited) throw createError({ statusCode: 503, statusMessage: 'The website is rate-limiting us', message: `The dealer's website answered "too many requests" (HTTP ${t.status}) three times. Wait a minute, then try again.` })
      return
    }
    const wait = RATE_LIMIT_WAITS[attempt]!
    log?.(`The website answered HTTP ${t.status} (too many requests) — waiting ${Math.round(wait / 1000)} s and trying again`)
    await sleep(wait)
  }
}

/** A real (trusted) mouse click on the element marked [data-zrz-next] — what a visitor's click looks like. */
async function trustedClick(t: Tab) {
  // Only when the point really lands on the link (no cookie bar / chat bubble / sticky footer on top of it).
  const box = await evaluate<{ x: number, y: number } | null>(t, `(() => { const el = document.querySelector('[data-zrz-next]'); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return null; const x = r.left + r.width / 2, y = r.top + r.height / 2; const hit = document.elementFromPoint(x, y); if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) return null; return { x: x, y: y } })()`, 5_000).catch(() => null)
  if (!box) return false
  await sleep(250 + Math.round(Math.random() * 450))
  await t.conn.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x - 30, y: box.y - 12 }, t.sid).catch(() => {})
  await sleep(80 + Math.round(Math.random() * 120))
  await t.conn.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y }, t.sid).catch(() => {})
  await t.conn.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 }, t.sid)
  await sleep(60 + Math.round(Math.random() * 80))
  await t.conn.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 }, t.sid)
  return true
}
/** Did the site answer with a bot-protection block ("Access Denied", HTTP 403, a challenge page)? */
async function isBlockedPage(t: Tab) {
  if (t.status === 403 || t.status === 401) return true
  const r = await evaluate<{ title: string, text: string }>(t, '({ title: document.title || "", text: (document.body ? document.body.innerText : "").slice(0, 400) })', 5_000).catch(() => null)
  if (!r) return false
  return /^access denied$|attention required|just a moment|request blocked|pardon our interruption|are you a robot|verify you are human/i.test(r.title.trim()) || (/access denied/i.test(r.text) && /reference #|you don.t have permission/i.test(r.text))
}
/** A fingerprint of what the result list shows (address + first vehicle links) — tells whether "next" really moved. */
const PAGE_SIG_JS = `(() => { var hs = []; var as = document.querySelectorAll('a[href]'); for (var i = 0; i < as.length && hs.length < 12; i++) { var h = as[i].href; if (/vin|vehicle|inventory\\/[^?#]*\\d|detail|vdp|stock|\\/(used|new|certified)[-/][^?#]*\\d{4}/i.test(h) && hs.indexOf(h) < 0) hs.push(h) } return location.href + '|' + hs.join('|') })()`
async function pageSig(t: Tab) { return evaluate<string>(t, PAGE_SIG_JS, 5_000).catch(() => '') }
/** After a click: wait (up to ~8 s) until the list really changed — single-page sites swap the cards without a page load. */
async function waitForChange(t: Tab, before: string) {
  for (let i = 0; i < 16; i++) {
    await sleep(500)
    if (t.loading) await waitForSettle(t, 3_000)
    const now = await pageSig(t)
    if (now && now !== before && now.split('|').slice(1).join('|') !== before.split('|').slice(1).join('|')) { await sleep(600); return true }
  }
  return false
}
/** Wait for a navigation the page itself started (link click / location change) to finish. */
async function settleAfterInPageNav(t: Tab, urlBefore: string) {
  for (let i = 0; i < 20 && t.url === urlBefore && !t.loading; i++) await sleep(150)
  await sleep(600)
  await waitForSettle(t, 25_000)
}

/**
 * Open the next result page the way a visitor would, and get past bot protection when it blocks us.
 * 1. a real click on the link (same-site referrer, trusted event) — or the page's own navigation
 * 2. blocked → pause, re-open the last good page (lets the site's bot check run), slow scroll, try again
 * 3. still blocked → fresh session (cookies cleared), via the home page, then the result page
 * Returns false when the site keeps refusing — the caller keeps a checkpoint so a later retry continues here.
 */
async function followNextLink(t: Tab, href: string, lastGood: string, log: (s: string) => void): Promise<boolean | 'same'> {
  const attempt = async (how: 'click' | 'assign'): Promise<boolean | 'same'> => {
    const before = await pageSig(t)
    const urlBefore = t.url
    t.status = null
    const clicked = how === 'click' ? await trustedClick(t) : false
    if (!clicked) await evaluate(t, `location.assign(${JSON.stringify(href)})`, 5_000).catch(() => {})
    await settleAfterInPageNav(t, urlBefore)
    if (await isBlockedPage(t)) return false
    if (await waitForChange(t, before)) return true
    // The click did nothing (an overlay, a dead link) — open the address from the page itself.
    if (how === 'click') {
      t.status = null
      await evaluate(t, `location.assign(${JSON.stringify(href)})`, 5_000).catch(() => {})
      await settleAfterInPageNav(t, t.url)
      if (await isBlockedPage(t)) return false
      if (await waitForChange(t, before)) return true
    }
    return 'same'
  }
  const first = await attempt('click')
  if (first === 'same') return 'same'
  if (first) return true
  log('The dealer\'s site blocked that page (bot protection) — pausing, then trying again like a visitor')
  await sleep(8_000 + Math.round(Math.random() * 4_000))
  try { await goto(t, lastGood, 25_000, log, new URL(lastGood).origin + '/') } catch {}
  await evaluate(t, SCROLL_STEP_JS).catch(() => {}); await sleep(1_500); await evaluate(t, SCROLL_STEP_JS).catch(() => {}); await sleep(3_000)
  if (!(await isBlockedPage(t)) && (await attempt('assign')) === true) { log('Got through on the second try'); return true }
  log('Still blocked — starting a fresh session through the home page')
  await t.conn.send('Network.clearBrowserCookies', {}, t.sid).catch(() => {})
  await sleep(5_000)
  try {
    const origin = new URL(lastGood).origin
    await goto(t, `${origin}/`, 25_000, log, 'https://www.google.com/')
    await evaluate(t, SCROLL_STEP_JS).catch(() => {}); await sleep(4_000)
    await evaluate(t, `location.assign(${JSON.stringify(lastGood)})`, 5_000).catch(() => {})
    await settleAfterInPageNav(t, `${origin}/`)
    await sleep(3_000)
    if (!(await isBlockedPage(t)) && (await attempt('assign')) === true) { log('Got through with a fresh session'); return true }
  } catch {}
  return false
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
      httpStatus: t.status,
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
  /** Every inventory page to scan (each one is paginated on its own). */
  urls: string[]
  allPages: boolean
  /** Batch run: auto-save the audit when done and report back to the batch. */
  batchId: string | null
  autoSave: boolean
  progress: ScanProgress
  log: { at: string, text: string }[]
  vehicles: ScanVehicle[]
  images: ImageInfo[]
  clusters: ImageCluster[]
  countStockAsMissing: boolean
  auditId: string | null
  /** The audit a reviewed (re-labelled) result will correct when saved again. */
  revisesAuditId?: string | null
  error: string | null
  heartbeatAt: string
  /** Latest live-view frame (server-run batches; overwritten every few seconds). */
  frame?: { data: string, ts: number } | null
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
    images[i.id] = { id: i.id, url: i.url, ok: i.ok, error: i.error || null, w: i.w || null, h: i.h || null, hash: i.hash || null, hash2: i.hash2 || null, text: i.text || '', ocr: !!i.ocr }
  }
  const cmap = new Map(doc.clusters.map(c => [c.id, c]))
  return {
    scanId: String(doc._id), summary, countStockAsMissing: doc.countStockAsMissing, advertised: advertisedTotal(doc), pages: doc.progress.pagesVisited,
    // Coverage: how much of what the site lists we could actually check (blocked pages are retried from their checkpoint).
    coverage: { checked: countable(doc.vehicles).length, advertised: advertisedTotal(doc), blocked: (doc.progress.blocked || []).map(b => ({ url: b.url, page: b.page })) },
    vehicles: doc.vehicles.map(v => ({ ...v, listUrl: listKey(v, doc), final: finalVerdict(v, cmap) })), clusters: doc.clusters, images,
    // Results per crawl page (URL) — the review screen can filter by page.
    crawlPages: pageBreakdown(doc, null, cmap).map(p => ({ url: p.url, label: p.label, total: p.total, withoutReal: p.withoutReal, withoutRealPct: p.withoutRealPct })),
    savedAuditId: doc.auditId, revisesAuditId: doc.revisesAuditId || null, labels: VERDICT_LABEL, finishedAt: doc.progress.finishedAt,
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
    if (doc.batchId) batchNote(db, doc, 'failed', { error: doc.error }).catch(() => {})
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
  await db.collection(SCANS_COLLECTION).updateOne({ _id: doc._id }, { $set: { status: 'stopped', error: 'Cut off by the server', progress: doc.progress, log: doc.log, vehicles: doc.vehicles, images: doc.images, clusters: doc.clusters, heartbeatAt: now } }).catch(() => {})
  if (doc.batchId) batchNote(db, doc, 'stopped', { summary: { total: sum.total, withoutReal: sum.withoutReal, withoutRealPct: sum.withoutRealPct, by: sum.by }, error: 'Cut off by the server' }).catch(() => {})
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

export async function requestStop(db: Db, id: string, reason: 'stop' | 'pause' = 'stop') {
  const doc = await getScan(db, id)
  if (doc.status !== 'running') return { stopping: false }
  await db.collection(SCANS_COLLECTION).updateOne({ _id: doc._id }, { $set: { stopRequested: true, stopReason: reason } })
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
  const urlList = (Array.isArray(body?.urls) ? body.urls : []).map((u: any) => str(u, 2000)).filter(Boolean).slice(0, 30)
  const raw = urlList[0] || str(body?.url, 2000) || d.website
  if (!raw) throw createError({ statusCode: 400, statusMessage: 'This dealership has no website — add one first' })
  const urls = (urlList.length ? urlList : [raw]).map(safeUrl)
  const url = urls[0]!
  const dealershipId = String(d._id)
  const col = db.collection<ScanDoc>(SCANS_COLLECTION)
  const busy = await col.findOne({ dealershipId, scannerVersion: ENGINE_VERSION, status: 'running', heartbeatAt: { $gt: new Date(Date.now() - STALE_MS).toISOString() } })
  if (busy) throw createError({ statusCode: 409, statusMessage: 'Already scanning', message: 'A scan is already running for this dealership — wait for it or stop it first' })

  const base = body?.appendTo ? await getScan(db, str(body.appendTo, 40)) : null
  if (base && base.dealershipId !== dealershipId) throw createError({ statusCode: 400, statusMessage: 'That scan belongs to another dealership' })
  const now = new Date().toISOString()
  const progress: ScanProgress = { phase: 'collecting', page: 0, vehicles: base?.vehicles.length || 0, advertised: base?.progress.advertised ?? null, analyzed: 0, toAnalyze: 0, message: 'Opening the website…', startedAt: now, finishedAt: null, pagesVisited: base ? [...base.progress.pagesVisited] : [], doneUrls: base ? [...(base.progress.doneUrls || [])] : [], resumeAt: base?.progress.resumeAt || null, advertisedByUrl: { ...(base?.progress.advertisedByUrl || {}) }, blocked: [...(base?.progress.blocked || [])] }
  const doc: ScanDoc = {
    scannerVersion: ENGINE_VERSION, dealershipId, dealershipName: d.name || '', status: 'running', stopRequested: false, startUrl: url, urls, allPages: body?.allPages !== false,
    batchId: str(body?.batchId, 40) || null, autoSave: !!body?.autoSave,
    progress, log: [], vehicles: base ? base.vehicles.map(v => ({ ...v })) : [], images: base ? base.images.map(i => ({ ...i })) : [], clusters: base ? base.clusters.map(c => ({ ...c })) : [],
    countStockAsMissing: base ? base.countStockAsMissing : true, auditId: null, error: null, heartbeatAt: now, createdAt: now, createdBy: { id: actor.id, name: actor.name },
  }
  if (base) {
    // Continue the same scan record so one audit covers both lists.
    await col.updateOne({ _id: base._id }, { $set: { status: 'running', stopRequested: false, startUrl: url, urls, progress, heartbeatAt: now, auditId: null, revisesAuditId: base.auditId || base.revisesAuditId || null, error: null, batchId: doc.batchId, autoSave: doc.autoSave } })
    doc._id = base._id
    doc.log = base.log || []
    doc.revisesAuditId = base.auditId || base.revisesAuditId || null
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
  /** Paused (not stopped): keep everything for the resume, don't save a half audit. */
  let pausing = false
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
      doc.progress.memMb = Math.round(process.memoryUsage().rss / 1e6)
      const r = await col.findOneAndUpdate({ _id: doc._id }, { $set: { progress: doc.progress, log: doc.log.slice(-60), vehicles: doc.vehicles, ...(doc.progress.phase === 'analyzing' ? { images: doc.images.map(stripImage) } : {}), heartbeatAt: new Date().toISOString() } }, { projection: { stopRequested: 1, stopReason: 1 }, returnDocument: 'after' })
      if ((r as any)?.stopRequested && !stop) {
        stop = true
        pausing = (r as any)?.stopReason === 'pause'
        log(pausing ? 'Pausing — everything found so far is saved; it continues from here when resumed' : 'Stopping — checking the photos found so far…')
      }
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
    let tab = t
    let restarts = 0
    let lastRestartAt = ''
    let stalledRestarts = 0
    /** Chromium can die mid-scan (memory, host teardown); start a fresh one and carry on — the vehicles found so far stay. */
    const restartBrowser = async (e: any) => {
      if (!isBrowserGone(e)) return false
      // Keep restarting as long as each run gets further than the last (checkpoints make every restart cheaper).
      const at = `${doc.progress.doneUrls?.length || 0}:${doc.progress.resumeAt?.page || 0}:${doc.vehicles.length}`
      if (at === lastRestartAt) stalledRestarts++
      else stalledRestarts = 0
      lastRestartAt = at
      if (restarts >= 12 || stalledRestarts >= 2) return false
      restarts++
      doc.progress.restarts = restarts
      log(`The browser crashed (${String(e?.message || e).slice(0, 60)}) — starting a fresh one and continuing`)
      try { await closeTab(tab) } catch {}
      await sleep(1500)
      t = tab = await openTab()
      return true
    }

    // Live view: a small frame every ~2.5 s while collecting (non-interactive), capped in total size.
    let frameBytes = 0
    let framing = false
    const FRAME_CAP = 4_000_000
    frameTimer = setInterval(async () => {
      if (framing || doc.progress.phase !== 'collecting') return
      const streaming = !opts.isClosed() && frameBytes <= FRAME_CAP
      // Server-run batches have no stream: the latest frame is kept on the scan for the live view.
      if (!streaming && !doc.batchId) return
      framing = true
      try {
        const cur = tab
        const shot = await cur.conn.send('Page.captureScreenshot', { format: 'jpeg', quality: streaming ? 40 : 30 }, cur.sid, 8000)
        if (streaming) { frameBytes += shot.data.length; emit('frame', { data: shot.data, w: SCANNER_VIEWPORT.width, h: SCANNER_VIEWPORT.height, ts: Date.now() }) }
        if (doc.batchId) await col.updateOne({ _id: doc._id }, { $set: { frame: { data: shot.data, ts: Date.now() } } }).catch(() => {})
      } catch {}
      framing = false
    }, 3000)

    if (doc.batchId) batchNote(db, doc, 'running').catch(() => {})
    // ── Collect ──
    const seen = new Map(doc.vehicles.map(v => [v.key, v]))
    let advertised: number | null = doc.progress.advertised
    const better = (a: any, b: any) => (!a?.url && b?.url) || (a?.url && b?.url && a.url !== b.url && (a.nw || 0) === 0 && (b.nw || 0) > 0)
    const startCount = doc.vehicles.length
    const urls = doc.urls?.length ? doc.urls : [doc.startUrl]
    let pageNo = 0
    for (let u = 0; u < urls.length && !stop; u++) {
    try {
    const startUrl = urls[u]!
    const countBefore = doc.vehicles.length
    doc.progress.doneUrls ||= []
    if (doc.progress.doneUrls.includes(startUrl)) { log(`Already collected: ${startUrl.replace(/^https?:\/\/[^/]+/, '') || '/'} — skipping (saved earlier)`); continue }
    const resumeAt = doc.progress.resumeAt?.url === startUrl ? doc.progress.resumeAt : null
    log(urls.length > 1 ? `Inventory page ${u + 1} of ${urls.length}: ${startUrl.replace(/^https?:\/\/[^/]+/, '') || '/'}` : `Opening ${startUrl.replace(/^https?:\/\//, '')}`)
    setProgress({ message: 'Loading the inventory page…' })
    if (resumeAt) { log(`Continuing from result page ${resumeAt.page} where the last run stopped`); pageNo = resumeAt.page - 1 }
    let openBlocked = false
    try {
      const target = resumeAt?.href || startUrl
      const wasBlocked = (doc.progress.blocked || []).some(b => b.url === startUrl)
      if (wasBlocked && target !== startUrl) {
        // This result page was refused last time: arrive the way a visitor does — list first, then the page.
        log('This page was blocked last time — going through the list page first')
        await goto(tab, startUrl, 25_000, log, `${new URL(startUrl).origin}/`)
        if ((await followNextLink(tab, target, startUrl, log)) !== true) openBlocked = true
      }
      else {
        try { await goto(tab, target, 25_000, log, `${new URL(target).origin}/`) }
        catch (e: any) {
          if (e?.statusCode !== 403) throw e
          // Refused straight away: fresh session through the home page, then this page.
          if ((await followNextLink(tab, target, `${new URL(target).origin}/`, log)) !== true) openBlocked = true
        }
      }
      if (openBlocked) {
        doc.progress.blocked = [...(doc.progress.blocked || []).filter(b => b.url !== startUrl), { url: startUrl, href: target, page: resumeAt?.page || 1, at: new Date().toISOString() }]
        log(`The site refused ${target.replace(/^https?:\/\/[^/]+/, '') || '/'} — kept as a checkpoint for a retry`)
        await persist(true)
        continue
      }
      // Click-paginated lists (no page address): fast-forward to the saved result page without re-reading the ones before it.
      if (resumeAt?.clicks) {
        log(`Fast-forwarding ${resumeAt.clicks} result page${resumeAt.clicks === 1 ? '' : 's'} to the checkpoint`)
        for (let k = 0; k < resumeAt.clicks; k++) {
          const ok = await evaluate<boolean>(tab, `(() => { const n = ${FIND_NEXT_JS}; if (!n) return false; if (n.kind === 'href') { location.href = n.href; return true } const el = document.querySelector('[data-zrz-next]'); if (el) { el.click(); return true } return false })()`).catch(() => false)
          if (!ok) { log('Could not fast-forward any further — collecting from here'); break }
          await sleep(1200)
          await waitForSettle(tab, 15_000)
        }
      }
    }
    catch (e: any) { if (isBrowserGone(e)) throw e; if (urls.length > 1) { log(`Skipped: ${e?.message || e}`); continue } throw e }
    let ckBase = resumeAt?.href || startUrl
    let ckClicks = resumeAt?.clicks || 0
    let blockedHere: { url: string, href: string, page: number, at: string } | null = null
    const followed = new Set<string>()
    let stuckPage = 0
    let zeroStreak = 0
    for (let p = 1; p <= MAX_PAGES && !stop; p++) {
      const page = ++pageNo
      setProgress({ page, message: page === 1 ? 'Loading every vehicle on this page…' : `Page ${page}: loading vehicles…` })
      let res: any = null
      let added = 0
      let pageCards = 0
      const collect = async () => {
        const r = await evaluate<any>(tab, EXTRACT_JS, 45_000).catch(() => null)
        if (!r) return
        res = r
        pageCards = Math.max(pageCards, r.cards?.length || 0)
        if (r.total) { advertised = Math.max(advertised || 0, r.total); (doc.progress.advertisedByUrl ||= {})[startUrl] = advertised }
        for (const c of r.cards || []) {
          const key = vehicleKey(c)
          const had = seen.get(key)
          if (had) { if (better(had.image, c.image)) had.image = c.image; if (!had.noPhotoText && c.noPhotoText) had.noPhotoText = c.noPhotoText; continue }
          const v: ScanVehicle = {
            key, title: c.title || '', year: c.year ?? null, make: c.make || '', model: c.model || '', vin: c.vin || '', stock: c.stock || '', price: c.price || '',
            condition: (['new', 'used', 'certified'].includes(c.condition) ? c.condition : '') as any, url: c.url || '', image: c.image || null, imageId: null,
            imageCount: c.imageCount || 0, photoCountText: c.photoCountText || '', noPhotoText: c.noPhotoText || '', cardText: String(c.text || '').slice(0, 240), page, sourceUrl: r.url, listUrl: startUrl,
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
      if (tab.conn.closed) throw new Error('Browser connection is closed')
      // After a browser restart (or a resumed scan) pages are seen again: nothing "new" is normal then.
      const revisit = doc.progress.pagesVisited.includes(res?.url || tab.url)
      if (!revisit) doc.progress.pagesVisited.push(res?.url || tab.url)
      await persist(true)
      log(`Page ${page}: ${pageCards} cards on screen, ${added} new — ${res?.strategy === 'known' ? 'recognised layout' : 'detected by structure'}`)
      if (pageCards === 0 && p === 1) { log('No vehicle cards on this page — moving on'); break }
      if (!doc.allPages || doc.vehicles.length >= MAX_VEHICLES) break
      if (Date.now() >= collectUntil) { log('Time limit for collecting reached — checking the photos found so far'); stop = stop || u < urls.length - 1; break }
      // Nothing new twice in a row = going in circles (also right after a restart, where one repeat is normal).
      zeroStreak = added === 0 && p > 1 ? zeroStreak + 1 : 0
      if (added === 0 && p > 1 && (!revisit || zeroStreak >= 2)) break
      if (advertised && doc.vehicles.length - countBefore >= advertised) break

      const next = await evaluate<any>(tab, FIND_NEXT_JS).catch(() => null)
      if (tab.conn.closed) throw new Error('Browser connection is closed')
      if (!next) break
      if (next.kind === 'href') {
        log(`${next.label} → ${String(next.href).replace(/^https?:\/\/[^/]+/, '')}`)
        // Checkpoint: a restart re-opens this exact result page instead of page 1.
        const lastGood = tab.url || ckBase
        ckBase = String(next.href); ckClicks = 0
        doc.progress.resumeAt = { url: startUrl, href: ckBase, page: page + 1, clicks: 0 }
        await persist(true)
        if (followed.has(String(next.href))) { log('The “next” link points to a page already read — end of this list'); break }
        followed.add(String(next.href))
        const through = await followNextLink(tab, String(next.href), lastGood, log).catch((e: any) => { if (isBrowserGone(e)) throw e; log(`Could not open the next page (${e?.message})`); return false })
        if (through === 'same') {
          log('The site did not move to the next page — end of this list')
          const adv = doc.progress.advertisedByUrl?.[startUrl]
          if (adv && doc.vehicles.length - countBefore < adv) stuckPage = page + 1
          break
        }
        if (!through) { blockedHere = { url: startUrl, href: ckBase, page: page + 1, at: new Date().toISOString() }; break }
      }
      else {
        log(`Clicking “${next.label}”`)
        await sleep(400)
        const urlBefore = tab.url
        // A real click first (trusted event); the element's own click() if that is not possible.
        if (!(await trustedClick(tab))) await evaluate(tab, `(() => { const el = document.querySelector('[data-zrz-next]'); if (el) el.click(); return !!el })()`)
        await sleep(1500)
        await waitForSettle(tab, 15_000)
        // Checkpoint: if the click changed the address use it; otherwise remember how many clicks from the last address.
        const urlAfter = tab.url
        if (urlAfter && urlAfter !== urlBefore && /^https?:/.test(urlAfter)) { ckBase = urlAfter; ckClicks = 0 }
        else ckClicks++
        doc.progress.resumeAt = { url: startUrl, href: ckBase, page: page + 1, clicks: ckClicks }
        await persist(true)
      }
    }
    // Each inventory page advertises its own total; the next one starts fresh.
    advertised = null
    if (stuckPage) doc.progress.stuck = [...(doc.progress.stuck || []).filter(b => b.url !== startUrl), { url: startUrl, page: stuckPage }]
    if (blockedHere) {
      // Keep the checkpoint: a retry (autopilot does it automatically) continues from this exact result page.
      doc.progress.blocked = [...(doc.progress.blocked || []).filter(b => b.url !== startUrl), blockedHere]
      log(`The site kept refusing result page ${blockedHere.page} — kept what was collected; a retry continues from page ${blockedHere.page}`)
      await persist(true)
    }
    else if (!stop) { doc.progress.doneUrls.push(startUrl); doc.progress.resumeAt = null; doc.progress.blocked = (doc.progress.blocked || []).filter(b => b.url !== startUrl); await persist(true) }
    }
    catch (e: any) {
      // Same inventory page again on a fresh browser (already-collected vehicles are de-duplicated).
      if (await restartBrowser(e)) { u--; continue }
      throw e
    }
    }
    if (doc.vehicles.length === startCount && startCount > 0) log('Nothing new on these pages — keeping the vehicles found earlier')
    if (pausing) {
      doc.status = 'stopped'
      Object.assign(doc.progress, { phase: 'stopped', message: `Paused — ${doc.vehicles.length} vehicles saved, continues from here`, finishedAt: new Date().toISOString() })
      log(`Paused with ${doc.vehicles.length} vehicles saved`)
      await col.updateOne({ _id: doc._id }, { $set: { status: 'stopped', progress: doc.progress, log: doc.log.slice(-60), vehicles: doc.vehicles, images: doc.images.map(stripImage), heartbeatAt: new Date().toISOString() } })
      emit('progress', doc.progress)
      if (doc.batchId) await batchNote(db, doc, 'stopped', { error: null }).catch(() => {})
      return
    }
    if (doc.vehicles.length === 0) throw createError({ statusCode: 422, statusMessage: 'No vehicle cards found', message: urls.length > 1 ? 'No vehicle cards were found on any of the pages — check the scan pages for this dealership.' : 'No vehicle cards found on this page. Pick the inventory / search results page (e.g. Used Inventory), then press Continue.' })
    // Keep what was collected even if the photo step is cut short.
    await col.updateOne({ _id: doc._id }, { $set: { vehicles: doc.vehicles, progress: doc.progress, heartbeatAt: new Date().toISOString() } }).catch(() => {})

    // ── Photos ──
    try { await analyzePhotos(tab, doc, { setProgress, log, deadline: analyzeUntil, db }) }
    catch (e: any) { if (!(await restartBrowser(e))) throw e; await analyzePhotos(tab, doc, { setProgress, log, deadline: analyzeUntil, db }) }
    await reclassify(db, doc, log)

    const sum = summarize(doc.vehicles, doc.clusters, { countStockAsMissing: doc.countStockAsMissing })
    const blockedPages = doc.progress.blocked || []
    doc.status = stop || blockedPages.length ? 'stopped' : 'done'
    const stuck = doc.progress.stuck || []
    doc.error = blockedPages.length ? `Blocked by the dealer's site on result page ${blockedPages.map(b => b.page).join(', ')} — ${coverageText(doc)}; a retry continues from there`
      : stuck.length ? `Could not get past result page ${stuck.map(b => b.page - 1).join(', ')} — ${coverageText(doc)}` : null
    if (!blockedPages.length && stuck.length) doc.status = 'stopped'
    Object.assign(doc.progress, { phase: doc.status, message: `${stop ? 'Stopped early — ' : blockedPages.length ? 'Partly blocked — ' : ''}${sum.total} vehicles · ${sum.withoutReal} without a real photo (${sum.withoutRealPct ?? 0}%)`, finishedAt: new Date().toISOString() })
    log(`Done in ${Math.round((Date.now() - t0) / 1000)}s`)
    await col.updateOne({ _id: doc._id }, { $set: { status: doc.status, error: doc.error, progress: doc.progress, log: doc.log.slice(-60), vehicles: doc.vehicles, images: doc.images.map(stripImage), clusters: doc.clusters, heartbeatAt: new Date().toISOString() } })
    emit('progress', doc.progress)
    let auditId: string | null = null
    if (doc.autoSave) {
      try {
        const r = await saveScan(db, String(doc._id), { id: doc.createdBy.id, name: doc.createdBy.name, email: '' })
        auditId = r.audit?.id || null
        doc.auditId = auditId
        log('Saved to the CRM as an inventory audit')
        emit('saved', { auditId })
      }
      catch (e: any) { log(`Could not save the audit: ${e?.message || e}`) }
    }
    emit('done', { id: String(doc._id), status: doc.status, summary: sum, auditId })
    if (doc.batchId) batchNote(db, doc, doc.status === 'stopped' ? 'stopped' : 'done', { summary: { total: sum.total, withoutReal: sum.withoutReal, withoutRealPct: sum.withoutRealPct, by: sum.by, advertised: advertisedTotal(doc) }, auditId, error: doc.error || null }).catch(() => {})
  }
  catch (e: any) {
    const message = e?.message || e?.statusMessage || 'Scan failed'
    doc.status = 'failed'
    Object.assign(doc.progress, { phase: 'error', message, finishedAt: new Date().toISOString() })
    log(`Scan failed: ${message}`)
    await col.updateOne({ _id: doc._id }, { $set: { status: 'failed', error: message, progress: doc.progress, log: doc.log.slice(-60), vehicles: doc.vehicles, heartbeatAt: new Date().toISOString() } }).catch(() => {})
    emit('progress', doc.progress)
    emit('failure', { message })
    if (doc.batchId) batchNote(db, doc, 'failed', { error: message }).catch(() => {})
  }
  finally {
    if (frameTimer) clearInterval(frameTimer)
    if (t) await closeTab(t)
  }
}

/** The shared Chromium died (crash, out of memory, host teardown) — not the dealer's fault. */
const isBrowserGone = (e: any) => /connection is closed|Target closed|Session closed|target crashed|Inspected target navigated or closed|browser (has )?disconnected|No target with given id/i.test(String(e?.message || e || ''))

/** Report a batch item's state back to its batch (see scanner-batch.ts). */
async function batchNote(db: Db, doc: ScanDoc, status: 'running' | 'done' | 'stopped' | 'failed', extra: Record<string, any> = {}) {
  const { updateBatchItem } = await import('./scanner-batch')
  await updateBatchItem(db, doc.batchId!, doc.dealershipId, { status, scanId: String(doc._id), ...extra })
}

/** What the dealer's lists say they have in total (sum over the inventory pages that showed a count). */
export function advertisedTotal(doc: ScanDoc): number | null {
  const by = doc.progress.advertisedByUrl || {}
  const n = Object.values(by).reduce((a, b) => a + (Number(b) || 0), 0)
  return n || doc.progress.advertised || null
}
function coverageText(doc: ScanDoc) {
  const adv = advertisedTotal(doc)
  const n = countable(doc.vehicles).length
  return adv && adv > n ? `checked ${n} of the ${adv} vehicles listed` : `checked ${n} vehicles`
}
const stripImage = (i: ImageInfo): ImageInfo => { const { bytes, thumb, ...rest } = i as any; return rest }

async function analyzePhotos(t: Tab, doc: ScanDoc, o: { setProgress: (p: Partial<ScanProgress>) => void, log: (s: string) => void, deadline: number, db?: Db | null }) {
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
  const todo = [...images.values()].filter(i => !i.hash && (!i.error || /^Not checked/.test(i.error)))
  for (const i of todo) delete i.error
  doc.images = [...images.values()]
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
            return { id: img.id, b64: r.b64, mime: r.mime, thumb: true }
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
          doc.images = [...images.values()]
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
  // AI photo check (Gemini): every photo, cached by fingerprint — instant for pictures seen before.
  try {
    const { visionCheck } = await import('./scanner-vision')
    await visionCheck(o.db || null, [...images.values()], doc.vehicles, { log: o.log, deadline: Math.min(o.deadline, Date.now() + 90_000), onProgress: (d, n) => o.setProgress({ message: `AI photo check… ${d} of ${n}` }) })
  }
  catch (e: any) { o.log(`AI photo check skipped (${String(e?.message || e).slice(0, 100)})`) }
  for (const i of images.values()) delete (i as any).thumb
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
  // Corrections teach the AI cache too: the same picture on any future crawl gets this answer straight away.
  try {
    const { teachVision } = await import('./scanner-vision')
    const imgs = new Map(doc.images.map(i => [i.id, i]))
    for (const x of Array.isArray(body?.vehicles) ? body.vehicles : []) {
      const v = doc.vehicles.find(v => v.key === String(x.key)); const im = v?.imageId ? imgs.get(v.imageId) : null
      const f = ok(x.verdict); if (im && f) await teachVision(db, im, f)
    }
    for (const x of Array.isArray(body?.clusters) ? body.clusters : []) {
      const c = doc.clusters.find(c => c.id === x.id); const f = ok(x.verdict)
      if (c && f) for (const id of c.imageIds) { const im = imgs.get(id); if (im) await teachVision(db, im, f) }
    }
  } catch {}
  // "This is an ad" / "This is a vehicle" — a person's call, remembered for that picture on every future crawl.
  if (Array.isArray(body?.listings)) {
    const imgs = new Map(doc.images.map(i => [i.id, i]))
    for (const x of body.listings) {
      const v = doc.vehicles.find(v => v.key === String(x?.key))
      if (!v) continue
      v.listing = x?.ad === true ? 'ad' : x?.ad === false ? 'vehicle' : null
      const im = v.imageId ? imgs.get(v.imageId) : null
      if (im && v.listing) { try { const { teachVision } = await import('./scanner-vision'); await teachVision(db, im, null, v.listing === 'ad') } catch {} }
    }
  }
  if (typeof body?.countStockAsMissing === 'boolean') doc.countStockAsMissing = body.countStockAsMissing
  if (body?.reapplyRules) await reclassify(db, doc)
  // Any change after saving makes it a draft again until saved once more.
  if (doc.status === 'saved') doc.status = 'done'
  // Remember which audit these results came from: saving again corrects that audit (no duplicate).
  if (doc.auditId) doc.revisesAuditId = doc.auditId
  doc.auditId = null
  await db.collection(SCANS_COLLECTION).updateOne({ _id: doc._id }, { $set: { vehicles: doc.vehicles, clusters: doc.clusters, countStockAsMissing: doc.countStockAsMissing, status: doc.status, auditId: null, revisesAuditId: doc.revisesAuditId || null } })
  return resultsOf(doc)
}

/** Save the scan to the CRM as an automated inventory audit (no screenshots or images kept). */
/** Which crawl page a vehicle belongs to (older scans: matched by address). */
function listKey(v: ScanVehicle, doc: ScanDoc) {
  if (v.listUrl) return v.listUrl
  const urls = doc.urls?.length ? doc.urls : [doc.startUrl]
  if (urls.length === 1) return urls[0]!
  const path = (u: string) => { try { const x = new URL(u); return x.hostname + x.pathname.replace(/\/(index\.html?)?$/, '') } catch { return u } }
  const src = path(v.sourceUrl || '')
  return urls.find(u => src.startsWith(path(u))) || urls[0]!
}
const KIND_LABEL: Record<string, string> = { used: 'Pre-owned inventory', certified: 'Certified pre-owned', new: 'New inventory', all: 'All inventory' }
/** "/used-inventory/index.htm" → used; else the cars' own condition decides. */
function pageKind(url: string, vs: ScanVehicle[]) {
  // Path first ("/used-vehicles/?type=Certified Used" is the pre-owned page), then the query.
  const parts = (() => { try { const x = new URL(url); return [x.pathname.toLowerCase(), decodeURIComponent(x.search).toLowerCase()] } catch { return [url.toLowerCase()] } })()
  for (const u of parts) {
    if (/certified|cpo/.test(u)) return 'certified'
    if (/used|pre-?owned|preowned|searchused|second/.test(u)) return 'used'
    if (/\bnew\b|new-|\/new|searchnew|type=new|condition=new/.test(u)) return 'new'
  }
  const n: Record<string, number> = {}
  for (const v of vs) if (v.condition) n[v.condition] = (n[v.condition] || 0) + 1
  const top = Object.entries(n).sort((a, b) => b[1] - a[1])[0]
  return top && top[1] / Math.max(1, vs.length) >= 0.8 ? top[0] : 'all'
}
/** Per crawl page: how many vehicles and how many without a real photo — the report and emails group by this. */
export function pageBreakdown(doc: ScanDoc, d: any, cmap: Map<string, any>) {
  const groups = new Map<string, ScanVehicle[]>()
  for (const v of countable(doc.vehicles)) { const k = listKey(v, doc); groups.set(k, [...(groups.get(k) || []), v]) }
  const saved = new Map<string, string>((Array.isArray(d?.scanPages) ? d.scanPages : []).map((p: any) => [String(p?.url || '').replace(/\/$/, ''), String(p?.label || '')]))
  const order = doc.urls?.length ? doc.urls : [doc.startUrl]
  return [...groups.entries()]
    .sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99))
    .map(([url, vs]) => {
      const by = { real: 0, placeholder: 0, stock: 0, missing: 0 }
      for (const v of vs) by[finalVerdict(v, cmap)]++
      const withoutReal = by.missing + by.placeholder + (doc.countStockAsMissing ? by.stock : 0)
      const kind = pageKind(url, vs)
      const label = saved.get(url.replace(/\/$/, '')) || KIND_LABEL[kind] || 'Inventory'
      return { url, label, kind, total: vs.length, withoutReal, withoutRealPct: vs.length ? Math.round((withoutReal / vs.length) * 1000) / 10 : null, ...by }
    })
}

export async function saveScan(db: Db, id: string, actor: SessionActor) {
  const doc = await getScan(db, id)
  if (!hasResults(doc)) throw createError({ statusCode: 409, statusMessage: 'Wait for the scan to finish' })
  const d = await loadDealership(db, doc.dealershipId)
  const sum = summarize(doc.vehicles, doc.clusters, { countStockAsMissing: doc.countStockAsMissing })
  const cmap = new Map(doc.clusters.map(c => [c.id, c]))
  const without = countable(doc.vehicles).filter((v) => { const f = finalVerdict(v, cmap); return f === 'missing' || f === 'placeholder' || (doc.countStockAsMissing && f === 'stock') })
  const pages = doc.progress.pagesVisited
  const parts = [
    `Inventory Scanner: ${sum.total} vehicles on ${pages.length} page${pages.length === 1 ? '' : 's'}${doc.progress.advertised ? ` (site advertises ${doc.progress.advertised})` : ''}.`,
    `${sum.by.real} real photos · ${sum.by.missing + sum.by.placeholder} no photo (${sum.by.placeholder} showing a placeholder image such as “photos unavailable”, ${sum.by.missing} with no image) · ${sum.by.stock} stock images${doc.countStockAsMissing ? ' (counted as no photo)' : ' (counted as photos)'}.`,
  ]
  const adv = advertisedTotal(doc)
  const blockedN = (doc.progress.blocked || []).length
  if (adv && adv > sum.total) parts.push(`Coverage: checked ${sum.total} of the ${adv} vehicles the site lists${blockedN ? ` — the site's bot protection refused ${blockedN} result page${blockedN === 1 ? '' : 's'}` : ''}. Percentages are of the vehicles checked.`)
  const byPage = pageBreakdown(doc, d, cmap)
  if (byPage.length > 1) parts.push(`By crawl page: ${byPage.map(p => `${p.label} — ${p.total} vehicles, ${p.withoutReal} without a real photo`).join(' · ')}.`)
  // Used cars first, then "No photo" before stock images — the strongest evidence leads; spread across the crawl pages.
  const ranked = without.filter(v => v.url)
    .sort((a, b) => (Number(a.condition === 'new') - Number(b.condition === 'new')) || (Number(finalVerdict(a, cmap) === 'stock') - Number(finalVerdict(b, cmap) === 'stock')))
  const perPage = byPage.length > 1 ? Math.max(4, Math.floor(40 / byPage.length)) : 40
  const taken = new Map<string, number>()
  const picked = ranked.filter((v) => { const k = listKey(v, doc); const n = taken.get(k) || 0; if (n >= perPage) return false; taken.set(k, n + 1); return true }).slice(0, 40)
  const { recordAudit, reviseAudit } = await import('./crm-audit')
  // Already saved (e.g. a batch crawl) → the review corrects that audit instead of adding a second one.
  const prevAudit = doc.auditId || doc.revisesAuditId || null
  const audit = await (prevAudit ? (body: any, a: any) => reviseAudit(db, d, String(prevAudit), body, a) : (body: any, a: any) => recordAudit(db, d, body, a))({
    ...sum.counts,
    source: 'automated',
    inventoryUrl: doc.urls?.[0] || pages[0] || doc.startUrl,
    pages: byPage,
    coverage: { checked: sum.total, advertised: adv, blockedPages: blockedN },
    examples: picked.map((v) => { const f = finalVerdict(v, cmap); return { url: v.url, label: `${v.title}${v.stock ? ` #${v.stock}` : ''} — ${VERDICT_LABEL[f]}`, title: v.title, stock: v.stock, price: v.price, condition: v.condition, verdict: f, listUrl: listKey(v, doc) } }),
    photoBreakdown: { real: sum.by.real, placeholder: sum.by.placeholder, missing: sum.by.missing, stock: sum.by.stock, countStockAsMissing: doc.countStockAsMissing },
    merchandisingIssues: [
      ...(sum.by.missing + sum.by.placeholder ? ['Vehicles listed with no photos (placeholder / “photos unavailable”)'] : []),
      ...(sum.by.stock ? ['Stock images instead of real photos'] : []),
    ],
    notes: parts.join('\n'),
    screenshotFileId: null,
    collector: { name: 'ZRZ Inventory Scanner', version: ENGINE_VERSION, runId: String(doc._id) },
  }, actor)
  // A batch crawl corrected after review: the batch (and its email step) shows the corrected numbers.
  if (doc.batchId && prevAudit) {
    const { updateBatchItem } = await import('./scanner-batch')
    await updateBatchItem(db, doc.batchId, doc.dealershipId, { summary: { total: sum.total, withoutReal: sum.withoutReal, withoutRealPct: sum.withoutRealPct, by: sum.by }, auditId: audit?.id || null }).catch(() => {})
  }
  await db.collection(SCANS_COLLECTION).updateOne({ _id: doc._id }, { $set: { status: 'saved', auditId: audit?.id || null, summary: sum, savedAt: new Date().toISOString(), savedBy: { id: actor.id, name: actor.name } } })
  try {
    const { logEventRun } = await import('./automation')
    await logEventRun(db, 'count_inventory', `${d.name}: ${sum.total} vehicles scanned, ${sum.withoutReal} without a real photo (${sum.withoutRealPct ?? 0}%)`, { vehicles: sum.total, withoutReal: sum.withoutReal }, [{ dealershipId: doc.dealershipId, name: d.name }])
  } catch {}
  return { audit, summary: sum }
}

/** Used on server shutdown / dev reload: no Chromium may outlive the server. */
export async function closeAllScannerSessions() {
  if (pool.idleTimer) clearTimeout(pool.idleTimer)
  pool.browser = null; pool.tabs = 0
  await Promise.all([...live].map(b => b.close().catch(() => {})))
  live.clear()
}
