/**
 * Scan scope (client side) — the same rules the server enforces in server/utils/scanner-scope.ts,
 * used here to explain things before a request is made: which addresses can be scan pages, whether
 * the page on screen is one, and how each scan page did in its last crawl.
 */
export type ScopeStatus = 'pending' | 'running' | 'done' | 'empty' | 'redirected' | 'blocked' | 'stuck' | 'skipped' | 'error'
export interface ScopeRow { url: string, label: string, status: ScopeStatus, statusText?: string, vehicles: number, ads?: number, resultPages: number, advertised: number | null, landedUrl?: string | null, note?: string, withoutReal?: number, withoutRealPct?: number | null }
export interface ScanPageHealth { status: 'ok' | 'empty' | 'redirected' | 'blocked' | 'error', vehicles: number, advertised: number | null, at: string, note: string, landedUrl?: string | null }
export interface ScanPage { url: string, label: string, health?: ScanPageHealth | null }
export type Tone = 'ok' | 'warn' | 'bad' | 'idle' | 'live'

export const TONE: Record<Tone, { text: string, soft: string, dot: string }> = {
  ok: { text: 'text-emerald-700 dark:text-emerald-300', soft: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/25', dot: 'bg-emerald-500' },
  warn: { text: 'text-amber-700 dark:text-amber-300', soft: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-500/30', dot: 'bg-amber-500' },
  bad: { text: 'text-rose-700 dark:text-rose-300', soft: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/30', dot: 'bg-rose-500' },
  idle: { text: 'text-muted-foreground', soft: 'bg-muted text-muted-foreground ring-1 ring-inset ring-border', dot: 'bg-muted-foreground/40' },
  live: { text: 'text-red-600 dark:text-red-400', soft: 'bg-red-500/10 text-red-600 dark:text-red-400 ring-1 ring-inset ring-red-500/30', dot: 'bg-red-500' },
}
/** How a scan page did in a crawl. */
export const SCOPE_META: Record<ScopeStatus, { label: string, tone: Tone }> = {
  pending: { label: 'Waiting', tone: 'idle' },
  running: { label: 'Reading', tone: 'live' },
  done: { label: 'Read in full', tone: 'ok' },
  stuck: { label: 'Partly read', tone: 'warn' },
  blocked: { label: 'Blocked by the site', tone: 'warn' },
  skipped: { label: 'Not reached', tone: 'idle' },
  empty: { label: 'No vehicles found', tone: 'bad' },
  redirected: { label: 'Forwards to the home page', tone: 'bad' },
  error: { label: 'Could not be opened', tone: 'bad' },
}
/** The health badge of a saved scan page (its last test or crawl). */
export const HEALTH_META: Record<ScanPageHealth['status'], { label: string, tone: Tone }> = {
  ok: { label: 'Working', tone: 'ok' },
  empty: { label: 'No vehicles', tone: 'bad' },
  redirected: { label: 'Forwards to home', tone: 'bad' },
  blocked: { label: 'Blocked', tone: 'warn' },
  error: { label: 'Not opening', tone: 'bad' },
}

const TRACKING = /^(utm_\w+|gclid|gbraid|wbraid|fbclid|msclkid|_ga|_gl|mc_[ce]id|ref|referrer|source|cmpid|campaign)$/i
const INDEX_FILE = /\/(index|default|home)\.(html?|php|aspx?)$/i
function parse(raw: string): URL | null {
  try { const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); return /^https?:$/.test(u.protocol) ? u : null } catch { return null }
}
const cleanQuery = (u: URL) => [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).map(([k, v]) => `${k.toLowerCase()}=${v}`).sort().join('&')

/** Same page ⇒ same key (ignores "www.", a trailing slash, "index.htm", tracking and #fragments). */
export function scopeKey(raw: string): string {
  const u = parse(String(raw || '').trim())
  if (!u) return ''
  const q = cleanQuery(u)
  return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.toLowerCase().replace(INDEX_FILE, '').replace(/\/+$/, '')}${q ? `?${q}` : ''}`
}
export function isHomePage(raw: string): boolean {
  const u = parse(String(raw || '').trim())
  if (!u) return false
  return !u.pathname.toLowerCase().replace(INDEX_FILE, '').replace(/\/+$/, '').replace(/^\/(home|index|en|en-us)$/, '') && !cleanQuery(u)
}
export function isVehiclePage(raw: string): boolean {
  const u = parse(String(raw || '').trim())
  if (!u) return false
  let s = u.pathname + u.search
  try { s = decodeURIComponent(s) } catch {}
  const m = s.match(/(?:^|[^A-Za-z0-9])([A-HJ-NPR-Z0-9]{17})(?![A-Za-z0-9])/i)
  if (m && /\d.*\d.*\d/.test(m[1]!) && /[A-Z].*[A-Z]/i.test(m[1]!)) return true
  return /\/(viewdetails|vehicle-details|vdp)\//i.test(u.pathname)
}
/** Can this address be a scan page? `short` is the badge text, `message` the full sentence. */
export function checkScanPage(raw: string): { ok: boolean, short: string, message: string } {
  const u = parse(String(raw || '').trim())
  if (!u || !/^[^.\s]+(\.[^.\s]+)+$/.test(u.hostname)) return { ok: false, short: 'Not a web address', message: 'That is not a valid web address' }
  if (/\.(pdf|jpe?g|png|gif|svg|webp|mp4|zip|xml|css|js)$/i.test(u.pathname)) return { ok: false, short: 'A file', message: 'That is a file, not an inventory page' }
  if (isHomePage(u.href)) return { ok: false, short: 'Home page', message: 'That is the website\'s home page, not an inventory page — pick the page that lists the vehicles (for example “Used inventory”)' }
  if (isVehiclePage(u.href)) return { ok: false, short: 'One vehicle', message: 'That is one vehicle\'s own page — pick the page that lists all of them' }
  return { ok: true, short: '', message: '' }
}
export const normalizeAddress = (raw: string) => { const u = parse(String(raw || '').trim()); if (!u) return ''; u.hash = ''; return u.href }
/** "/used-inventory/index.htm?start=18" */
export const pagePath = (raw: string) => { const u = parse(raw); if (!u) return raw; try { return decodeURIComponent(u.pathname + u.search) || '/' } catch { return (u.pathname + u.search) || '/' } }
export const pageHost = (raw: string) => parse(raw)?.hostname.replace(/^www\./, '') || ''
/** A label for a page that has none: from its address. */
export function guessPageLabel(raw: string) {
  const p = pagePath(raw).toLowerCase()
  if (/certified|\bcpo\b/.test(p)) return 'Certified pre-owned'
  if (/pre-?owned|used/.test(p)) return 'Pre-owned inventory'
  if (/\bnew\b|new-|-new|searchnew|\/new/.test(p)) return 'New inventory'
  return 'Inventory'
}
