/**
 * Scan scope — the one rule of the crawler: it only reads the dealership's saved scan pages.
 *
 * - A crawl never starts from the website's home page and never "falls back" to it.
 * - Every address a crawl opens must be a saved scan page, or a result page of that same list
 *   (page 2, 3 … of it). A "next" link that leaves the list is not followed.
 * - A scan page that forwards to the home page (or another website) is reported as "redirected"
 *   and nothing is read from it.
 *
 * Pure functions (no database, no browser) so the same rules run when a page is saved, when a
 * crawl is created and at every step of the crawl.
 */

export type ScopeStatus = 'pending' | 'running' | 'done' | 'empty' | 'redirected' | 'blocked' | 'stuck' | 'skipped' | 'error'
/** One saved scan page inside a crawl: what happened to it. */
export interface ScopeEntry {
  url: string, label: string, status: ScopeStatus
  /** Vehicle cards collected from this list (advertisements included until the photo check removes them). */
  vehicles: number
  /** Result pages read (page 1, 2, 3 … of this list). */
  resultPages: number
  /** What the list itself says it has ("42 vehicles"). */
  advertised: number | null
  /** Where the address really landed, when the site forwarded it. */
  landedUrl?: string | null
  note?: string
  /** The address exactly as it is saved on the dealership (the crawl address may be normalised). */
  savedUrl?: string
  /** Advertisement tiles found in this list (left out of every count). */
  ads?: number
}
/** Last known state of a saved scan page — shown next to it everywhere scan pages are listed. */
export interface ScanPageHealth { status: 'ok' | 'empty' | 'redirected' | 'blocked' | 'error', vehicles: number, advertised: number | null, at: string, note: string, landedUrl?: string | null }
export interface ScanPage { url: string, label: string, health?: ScanPageHealth | null }

const TRACKING = /^(utm_\w+|gclid|gbraid|wbraid|fbclid|msclkid|_ga|_gl|mc_[ce]id|ref|referrer|source|cmpid|campaign)$/i
const INDEX_FILE = /\/(index|default|home)\.(html?|php|aspx?)$/i

function parse(raw: string, base?: string): URL | null {
  try { const u = new URL(/^https?:\/\//i.test(raw) || base ? raw : `https://${raw}`, base); return /^https?:$/.test(u.protocol) ? u : null } catch { return null }
}
const hostOf = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '')
const cleanQuery = (u: URL) => [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).map(([k, v]) => `${k.toLowerCase()}=${v}`).sort().join('&')

/** Same page ⇒ same key: host without "www.", path without a trailing slash or "index.htm", query without tracking, no #fragment. */
export function scopeKey(raw: string): string {
  const u = parse(String(raw || '').trim())
  if (!u) return ''
  const path = u.pathname.toLowerCase().replace(INDEX_FILE, '').replace(/\/+$/, '')
  const q = cleanQuery(u)
  return `${hostOf(u)}${path}${q ? `?${q}` : ''}`
}

/** The site's front page ("/", "/index.htm", "/home") — never an inventory list. */
export function isHomePage(raw: string): boolean {
  const u = parse(String(raw || '').trim())
  if (!u) return false
  const path = u.pathname.toLowerCase().replace(INDEX_FILE, '').replace(/\/+$/, '').replace(/^\/(home|index|en|en-us)$/, '')
  return !path && !cleanQuery(u)
}

/** A single vehicle's own page (a VIN in the address) — not a list. */
export function isVehiclePage(raw: string): boolean {
  const u = parse(String(raw || '').trim())
  if (!u) return false
  let s = u.pathname + u.search
  try { s = decodeURIComponent(s) } catch {}
  const m = s.match(/(?:^|[^A-Za-z0-9])([A-HJ-NPR-Z0-9]{17})(?![A-Za-z0-9])/i)
  if (m && /\d.*\d.*\d/.test(m[1]!) && /[A-Z].*[A-Z]/i.test(m[1]!)) return true
  return /\/(viewdetails|vehicle-details|vdp)\//i.test(u.pathname)
}

export type ScanPageProblem = 'invalid' | 'home' | 'vehicle' | 'file'
/** Can this address be saved as a scan page? Returns the reason in plain words when it cannot. */
export function checkScanPage(raw: string): { ok: boolean, code: ScanPageProblem | 'ok', message: string } {
  const u = parse(String(raw || '').trim())
  if (!u || !/^[^.\s]+(\.[^.\s]+)+$/.test(u.hostname)) return { ok: false, code: 'invalid', message: 'That is not a valid web address' }
  if (/\.(pdf|jpe?g|png|gif|svg|webp|mp4|zip|xml|css|js)$/i.test(u.pathname)) return { ok: false, code: 'file', message: 'That is a file, not an inventory page' }
  if (isHomePage(u.href)) return { ok: false, code: 'home', message: 'That is the website\'s home page, not an inventory page — pick the page that lists the vehicles (for example “Used inventory”)' }
  if (isVehiclePage(u.href)) return { ok: false, code: 'vehicle', message: 'That is one vehicle\'s own page — pick the page that lists all of them' }
  return { ok: true, code: 'ok', message: '' }
}

/** The part of the address that stays the same on every result page of a list. */
function family(u: URL) {
  return u.pathname.toLowerCase()
    .replace(/[-_]?\d{1,3}(\.(html?|php|aspx?))$/, '$1') // "index2.html", "used-cars-3.html" → the list's own file
    .replace(INDEX_FILE, '').replace(/\/+$/, '')
    .replace(/[-/](page|pg|p)[-/=:]?\d+$/, '') // "/page/2", "-page-2", "/p:2"
    .replace(/[-_/]\d{1,3}$/, '') // "/used/2", "/used-cars-2"
    .replace(/\/+$/, '')
}

/**
 * Is `candidate` a result page of the list at `listUrl`? Same website and the list's own path
 * (or below it): "/used-vehicles/" → "/used-vehicles/?_p=2", "/used-vehicles/page/2/",
 * "/used-inventory/index.htm?start=18". Anything else — the home page, specials, another list — is outside.
 */
export function inList(listUrl: string, candidate: string): boolean {
  const a = parse(listUrl)
  const b = parse(candidate, listUrl)
  if (!a || !b) return false
  if (hostOf(a) !== hostOf(b)) return false
  if (isHomePage(b.href) && !isHomePage(a.href)) return false
  if (isVehiclePage(b.href) && !isVehiclePage(a.href)) return false
  const fa = family(a)
  const fb = family(b)
  if (!fa) return !fb
  return fb === fa || fb.startsWith(`${fa}/`)
}

export type Landing = 'same' | 'moved' | 'home' | 'offsite'
/** Where a scan page really landed: on itself, on another page of the site, on the home page, or on another website. */
export function landing(listUrl: string, landedUrl: string): Landing {
  const a = parse(listUrl)
  const b = parse(landedUrl)
  if (!a || !b) return 'same'
  if (hostOf(a) !== hostOf(b)) return 'offsite'
  if (isHomePage(b.href) && !isHomePage(a.href)) return 'home'
  return inList(listUrl, landedUrl) ? 'same' : 'moved'
}

export const shortPath = (raw: string) => { const u = parse(raw); if (!u) return raw; try { return decodeURIComponent(u.pathname + u.search) || '/' } catch { return u.pathname + u.search || '/' } }

/** The saved scan pages of a dealership, cleaned: valid ones to crawl, and the ones that can never be crawled (with the reason). */
export function scopeOf(dealership: any): { pages: ScanPage[], rejected: { url: string, label: string, message: string }[] } {
  const list: any[] = Array.isArray(dealership?.scanPages) ? dealership.scanPages : []
  const pages: ScanPage[] = []
  const rejected: { url: string, label: string, message: string }[] = []
  const seen = new Set<string>()
  for (const p of list) {
    const url = String(typeof p === 'string' ? p : p?.url || '').trim()
    const label = String(typeof p === 'string' ? '' : p?.label || '').trim()
    if (!url) continue
    const c = checkScanPage(url)
    if (!c.ok) { rejected.push({ url, label, message: c.message }); continue }
    const k = scopeKey(url)
    if (seen.has(k)) continue
    seen.add(k)
    pages.push({ url, label, health: (typeof p === 'object' && p?.health) || null })
  }
  return { pages, rejected }
}

/** Find the saved scan page an address belongs to (exact page, not "somewhere on the site"). */
export function matchScanPage<T extends { url: string }>(url: string, pages: T[]): T | null {
  const k = scopeKey(url)
  return (k && pages.find(p => scopeKey(p.url) === k)) || null
}

/** Ad-click / analytics leftovers that make a pasted link long and change nothing on the page. */
const JUNK_PARAM = /^(utm_\w+|gclid|gbraid|wbraid|fbclid|msclkid|_ga|_gl|mc_[ce]id)$/i
/** The address as it is stored: no #fragment, no tracking leftovers; filters stay exactly as pasted (not re-encoded). */
function tidy(u: URL) {
  const kept = u.search.replace(/^\?/, '').split('&').filter(part => part && !JUNK_PARAM.test(part.split('=')[0] || ''))
  return `${u.origin}${u.pathname}${kept.length ? `?${kept.join('&')}` : ''}`
}

/**
 * Clean a list of scan pages about to be saved. Bad addresses are returned with the reason instead of
 * being stored; labels and health of pages that stay are kept.
 */
export function sanitizeScanPages(input: any, before: any[] = []): { pages: ScanPage[], rejected: { url: string, message: string }[] } {
  const list: any[] = Array.isArray(input) ? input : []
  const old = new Map<string, any>()
  for (const p of Array.isArray(before) ? before : []) { const k = scopeKey(String(p?.url || p || '')); if (k) old.set(k, p) }
  const pages: ScanPage[] = []
  const rejected: { url: string, message: string }[] = []
  const seen = new Set<string>()
  for (const p of list) {
    const raw = String(typeof p === 'string' ? p : p?.url || '').trim().slice(0, 2000)
    if (!raw) continue
    const u = parse(raw)
    const c = checkScanPage(raw)
    if (!u || !c.ok) { rejected.push({ url: raw, message: c.message || 'That is not a valid web address' }); continue }
    const href = tidy(u)
    const k = scopeKey(href)
    if (seen.has(k)) continue
    seen.add(k)
    const prev = old.get(k)
    const label = String((typeof p === 'object' && p?.label) || '').trim().slice(0, 80) || String(prev?.label || '').slice(0, 80)
    const health = prev?.health && typeof prev.health === 'object' ? prev.health : null
    pages.push({ url: href, label, ...(health ? { health } : {}) })
  }
  return { pages: pages.slice(0, 40), rejected }
}

const HEALTH_OF: Partial<Record<ScopeStatus, ScanPageHealth['status']>> = { done: 'ok', stuck: 'ok', empty: 'empty', redirected: 'redirected', blocked: 'blocked', error: 'error' }
/** After a crawl: remember on each scan page how it went (shown wherever scan pages are listed). */
export function healthFromScope(e: ScopeEntry, at = new Date().toISOString()): ScanPageHealth | null {
  const status = HEALTH_OF[e.status]
  if (!status) return null
  // A blocked list that still gave vehicles is a working page — the block is about the visit, not the address.
  return { status: status === 'blocked' && e.vehicles > 0 ? 'ok' : status, vehicles: e.vehicles, advertised: e.advertised ?? null, at, note: e.note || '', landedUrl: e.landedUrl || null }
}
