/**
 * Prospecting — discover dealerships around our base with Google Places API (New) and add them to the CRM.
 *
 * How a scan works
 *  1. The search area (base location + range, from Settings › General) is turned into a grid of ~25-mile
 *     rectangles. Cells that don't touch the range circle are dropped.
 *  2. Each cell is searched with Places Text Search (`locationRestriction.rectangle`, `includedType: car_dealer`),
 *     up to 3 pages × 20 results. Google caps a query at 60 results, so a cell that comes back full is
 *     "dense" — it is split into 4 smaller cells (quadtree) and searched again until every area returns
 *     fewer than 60. That is how we get *every* dealership in a 75-mile radius, not just Google's top 60.
 *  3. The scan is a job in Mongo. The browser drives it with short `step` calls, so it works on serverless
 *     (no long-running request), shows live progress, survives a refresh, and can be cancelled.
 *  4. Results are matched against the CRM (Google place id → website → phone → name+state) so reps only see
 *     dealerships that are genuinely new. Dismissed places stay hidden from future scans.
 *
 * Google Maps Platform terms: Places content may only be cached temporarily, so discovered places expire
 * from `turboCleanCrmProspects` after 30 days (TTL index). Place ids (allowed indefinitely) are kept on
 * imported dealerships and dismissals.
 */
import type { Db } from 'mongodb'
import { ObjectId } from 'mongodb'
import { CRM_COLLECTIONS, DEALERSHIP_STAGES, DEFAULT_STAGE, WON_STAGE, logActivity, nextDealershipId, normalizeUrl, str } from './crm'
import type { SessionActor } from './crm'
import { recordStageChange } from './crm-stage'
import { CAR_BRANDS, nameKey, normalizeCity, normalizePhone, normalizeState, phoneKey, websiteKey } from './crm-normalize'

export const PROSPECT_COLLECTIONS = {
  scans: 'turboCleanCrmProspectScans',
  places: 'turboCleanCrmProspects',
  dismissals: 'turboCleanCrmProspectDismissals',
} as const

export const PROSPECT_LEAD_SOURCE = 'Web discovery'
/** Text Search Enterprise SKU (we request phone, website and rating) — USD per 1,000 calls, first 1,000/month free. */
export const PLACES_PRICE_PER_1000 = 35
export const PLACES_FREE_MONTHLY_CALLS = 1000
const PLACES_CACHE_DAYS = 30
const MAX_PAGES = 3
const PAGE_SIZE = 20
const GOOGLE_CAP = MAX_PAGES * PAGE_SIZE
const GRID_TARGET_MILES = 25
const MIN_CELL_MILES = 1.5
const CONCURRENCY = 4
const STEP_BUDGET_MS = 7000
const LOCK_MS = 45_000

// ─────────────────────────────────────────── Config (Settings › General) ───────────────────────────────────────────

export interface ProspectingOrigin {
  address: string
  city: string
  state: string
  postalCode: string
  country: string
  lat: number
  lng: number
}
export interface ProspectingConfig {
  origin: ProspectingOrigin
  radiusMiles: number
  queries: string[]
  includedType: string
  strictType: boolean
  excludeKeywords: string[]
  minReviews: number
  maxApiCalls: number
  defaultStage: string
}

export const DEFAULT_PROSPECTING: ProspectingConfig = {
  origin: { address: '351 Foster St', city: 'South Windsor', state: 'CT', postalCode: '06074', country: 'USA', lat: 41.826485, lng: -72.52834 },
  radiusMiles: 75,
  queries: ['car dealer'],
  includedType: 'car_dealer',
  strictType: true,
  excludeKeywords: ['rental', 'rent a car', 'auto parts', 'salvage', 'junk', 'scrap', 'tire', 'collision', 'body shop', 'car wash', 'towing', 'detailing'],
  minReviews: 0,
  maxApiCalls: 400,
  defaultStage: DEFAULT_STAGE,
}

const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : fallback)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const strList = (v: unknown, max = 30, len = 60) => (Array.isArray(v) ? v : String(v ?? '').split(/[,\n]+/))
  .map(s => String(s ?? '').trim().slice(0, len)).filter(Boolean).filter((s, i, a) => a.findIndex(x => x.toLowerCase() === s.toLowerCase()) === i).slice(0, max)

/** Validates + normalises a config payload (unknown keys dropped, numbers clamped). */
export function sanitizeConfig(input: any, base: ProspectingConfig = DEFAULT_PROSPECTING): ProspectingConfig {
  const o = input?.origin ?? {}
  const lat = num(o.lat, base.origin.lat)
  const lng = num(o.lng, base.origin.lng)
  if (lat < -90 || lat > 90) throw createError({ statusCode: 400, statusMessage: 'Latitude must be between -90 and 90' })
  if (lng < -180 || lng > 180) throw createError({ statusCode: 400, statusMessage: 'Longitude must be between -180 and 180' })
  const queries = strList(input?.queries ?? base.queries, 5, 80)
  if (!queries.length) throw createError({ statusCode: 400, statusMessage: 'Add at least one search term' })
  const stage = String(input?.defaultStage ?? base.defaultStage)
  return {
    origin: {
      address: str(o.address ?? base.origin.address, 200),
      city: normalizeCity(o.city ?? base.origin.city),
      state: normalizeState(o.state ?? base.origin.state).slice(0, 40),
      postalCode: str(o.postalCode ?? base.origin.postalCode, 20),
      country: str(o.country ?? base.origin.country, 60) || 'USA',
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
    },
    radiusMiles: clamp(Math.round(num(input?.radiusMiles, base.radiusMiles)), 1, 250),
    queries,
    includedType: /^[a-z_]{0,40}$/.test(String(input?.includedType ?? base.includedType)) ? String(input?.includedType ?? base.includedType) : base.includedType,
    strictType: input?.strictType === undefined ? base.strictType : !!input.strictType,
    excludeKeywords: strList(input?.excludeKeywords ?? base.excludeKeywords, 40, 40),
    minReviews: clamp(Math.round(num(input?.minReviews, base.minReviews)), 0, 100_000),
    maxApiCalls: clamp(Math.round(num(input?.maxApiCalls, base.maxApiCalls)), 10, 5000),
    defaultStage: (DEALERSHIP_STAGES as readonly string[]).includes(stage) && stage !== WON_STAGE && stage !== 'Lost' ? stage : DEFAULT_STAGE,
  }
}

export async function loadProspectingConfig(db: Db): Promise<ProspectingConfig> {
  const doc: any = await db.collection('settings').findOne({ type: 'general' }, { projection: { prospecting: 1 } })
  try { return sanitizeConfig(doc?.prospecting ?? {}) } catch { return DEFAULT_PROSPECTING }
}

export async function saveProspectingConfig(db: Db, input: any, actor: SessionActor | null) {
  const current = await loadProspectingConfig(db)
  const next = sanitizeConfig(input, current)
  await db.collection('settings').updateOne(
    { type: 'general' },
    { $set: { prospecting: { ...next, updatedAt: new Date().toISOString(), updatedBy: actor } }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  )
  return next
}

export function placesApiKey() {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.NUXT_GOOGLE_PLACES_API_KEY || ''
}

// ─────────────────────────────────────────── Geometry ───────────────────────────────────────────

export interface LatLng { lat: number, lng: number }
export interface Cell { s: number, w: number, n: number, e: number, depth: number, query: string, tries?: number }

const R_MILES = 3958.8
const rad = (d: number) => d * Math.PI / 180
export function haversineMiles(a: LatLng, b: LatLng) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}
/** Longest side of a cell in miles. */
export function cellSpanMiles(c: Cell) {
  const mid = (c.s + c.n) / 2
  return Math.max(haversineMiles({ lat: c.s, lng: c.w }, { lat: c.n, lng: c.w }), haversineMiles({ lat: mid, lng: c.w }, { lat: mid, lng: c.e }))
}
/** Shortest distance from a point to a rectangle (0 when inside). */
export function distanceToCellMiles(p: LatLng, c: Cell) {
  return haversineMiles(p, { lat: clamp(p.lat, c.s, c.n), lng: clamp(p.lng, c.w, c.e) })
}
export function splitCell(c: Cell): Cell[] {
  const mLat = (c.s + c.n) / 2, mLng = (c.w + c.e) / 2, d = c.depth + 1
  return [
    { s: c.s, w: c.w, n: mLat, e: mLng, depth: d, query: c.query },
    { s: c.s, w: mLng, n: mLat, e: c.e, depth: d, query: c.query },
    { s: mLat, w: c.w, n: c.n, e: mLng, depth: d, query: c.query },
    { s: mLat, w: mLng, n: c.n, e: c.e, depth: d, query: c.query },
  ]
}
/** Square-ish grid over the range circle; cells outside the circle are dropped. */
export function planGrid(origin: LatLng, radiusMiles: number, queries: string[]): Cell[] {
  const dLat = radiusMiles / 69.0
  const dLng = radiusMiles / (69.172 * Math.cos(rad(origin.lat)))
  const n = Math.max(1, Math.ceil((radiusMiles * 2) / GRID_TARGET_MILES))
  const stepLat = (2 * dLat) / n, stepLng = (2 * dLng) / n
  const cells: Cell[] = []
  for (const query of queries) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const c: Cell = { s: origin.lat - dLat + i * stepLat, n: origin.lat - dLat + (i + 1) * stepLat, w: origin.lng - dLng + j * stepLng, e: origin.lng - dLng + (j + 1) * stepLng, depth: 0, query }
        if (distanceToCellMiles(origin, c) <= radiusMiles) cells.push(c)
      }
    }
  }
  // Closest cells first, so the map fills outward from base.
  return cells.sort((a, b) => distanceToCellMiles(origin, a) - distanceToCellMiles(origin, b))
}

// ─────────────────────────────────────────── Google Places ───────────────────────────────────────────

const PLACE_FIELDS = [
  'id', 'displayName', 'formattedAddress', 'addressComponents', 'location', 'types', 'primaryType', 'primaryTypeDisplayName',
  'businessStatus', 'nationalPhoneNumber', 'internationalPhoneNumber', 'websiteUri', 'googleMapsUri', 'rating', 'userRatingCount',
]
const SEARCH_MASK = [...PLACE_FIELDS.map(f => `places.${f}`), 'nextPageToken'].join(',')
const GEOCODE_MASK = ['places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents', 'places.location'].join(',')

export class PlacesError extends Error {
  constructor(message: string, public status: number, public retryable: boolean) { super(message) }
}

async function placesSearch(body: Record<string, any>, mask: string): Promise<{ places?: any[], nextPageToken?: string }> {
  const key = placesApiKey()
  if (!key) throw new PlacesError('Google Places API key is not configured (GOOGLE_PLACES_API_KEY)', 412, false)
  try {
    return await $fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': mask, 'Content-Type': 'application/json' },
      body,
      timeout: 20_000,
    })
  } catch (e: any) {
    const status = e?.response?.status || e?.statusCode || 0
    const msg = e?.data?.error?.message || e?.message || 'Google Places request failed'
    throw new PlacesError(msg, status, status === 0 || status === 429 || status >= 500)
  }
}

export interface ProspectPlace {
  placeId: string
  name: string
  formattedAddress: string
  address: string
  city: string
  state: string
  zip: string
  country: string
  lat: number
  lng: number
  phone: string
  website: string
  mapsUrl: string
  rating: number | null
  reviews: number
  primaryType: string
  primaryTypeLabel: string
  businessStatus: string
  brands: string[]
}

const BRAND_WORDS: [RegExp, string[]][] = [
  [/\bcdjr\b|\bchrysler dodge jeep ram\b/i, ['Chrysler', 'Dodge', 'Jeep', 'Ram']],
  [/\bchevy\b/i, ['Chevrolet']],
  [/\bvw\b/i, ['Volkswagen']],
  [/\bmercedes\b/i, ['Mercedes-Benz']],
  [/\brange rover\b/i, ['Land Rover']],
  [/\bharley\b/i, ['Harley-Davidson']],
]
/** "Hartford Toyota" → ["Toyota"]; "Manchester CDJR" → Chrysler, Dodge, Jeep, Ram. */
export function inferBrands(name: string): string[] {
  const out: string[] = []
  for (const b of CAR_BRANDS) {
    if (b === 'Used / independent') continue
    const re = new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-\s]/g, '[-\\s]?')}\\b`, 'i')
    if (re.test(name)) out.push(b)
  }
  for (const [re, brands] of BRAND_WORDS) if (re.test(name)) out.push(...brands)
  return [...new Set(out)]
}

function component(p: any, type: string, short = false) {
  const c = (p.addressComponents || []).find((x: any) => (x.types || []).includes(type))
  return c ? String(short ? c.shortText : c.longText) : ''
}
export function normalizePlace(p: any): ProspectPlace | null {
  if (!p?.id || !p?.location) return null
  const name = String(p.displayName?.text || '').trim()
  const street = [component(p, 'street_number'), component(p, 'route')].filter(Boolean).join(' ')
  const city = component(p, 'locality') || component(p, 'postal_town') || component(p, 'sublocality_level_1') || component(p, 'administrative_area_level_3')
  return {
    placeId: String(p.id),
    name,
    formattedAddress: String(p.formattedAddress || ''),
    address: street || String(p.formattedAddress || '').split(',')[0] || '',
    city: normalizeCity(city),
    state: normalizeState(component(p, 'administrative_area_level_1', true)),
    zip: component(p, 'postal_code'),
    country: component(p, 'country', true),
    lat: Number(p.location.latitude),
    lng: Number(p.location.longitude),
    phone: normalizePhone(p.nationalPhoneNumber || p.internationalPhoneNumber || ''),
    website: p.websiteUri ? normalizeUrl(p.websiteUri) : '',
    mapsUrl: String(p.googleMapsUri || ''),
    rating: typeof p.rating === 'number' ? p.rating : null,
    reviews: Number(p.userRatingCount || 0),
    primaryType: String(p.primaryType || ''),
    primaryTypeLabel: String(p.primaryTypeDisplayName?.text || ''),
    businessStatus: String(p.businessStatus || 'OPERATIONAL'),
    brands: inferBrands(name),
  }
}

/** Address → coordinates (used by Settings › "Find coordinates"). */
export async function geocodeAddress(query: string) {
  const res = await placesSearch({ textQuery: query, pageSize: 1, languageCode: 'en' }, GEOCODE_MASK)
  const p = res.places?.[0]
  if (!p?.location) return null
  return {
    lat: Math.round(Number(p.location.latitude) * 1e6) / 1e6,
    lng: Math.round(Number(p.location.longitude) * 1e6) / 1e6,
    formattedAddress: String(p.formattedAddress || ''),
    address: [component(p, 'street_number'), component(p, 'route')].filter(Boolean).join(' '),
    city: normalizeCity(component(p, 'locality') || component(p, 'postal_town')),
    state: normalizeState(component(p, 'administrative_area_level_1', true)),
    postalCode: component(p, 'postal_code'),
    country: component(p, 'country', true),
  }
}

/** Every page of one cell (≤ 60 results). `saturated` = Google had more → the cell must be split. */
async function searchCell(cell: Cell, params: ScanParams, onCall: () => void) {
  const places: any[] = []
  let token: string | undefined
  let pages = 0
  do {
    const body: Record<string, any> = {
      textQuery: cell.query,
      pageSize: PAGE_SIZE,
      languageCode: 'en',
      regionCode: 'US',
      locationRestriction: { rectangle: { low: { latitude: cell.s, longitude: cell.w }, high: { latitude: cell.n, longitude: cell.e } } },
    }
    if (params.includedType) { body.includedType = params.includedType; body.strictTypeFiltering = params.strictType }
    if (token) body.pageToken = token
    let res: { places?: any[], nextPageToken?: string }
    try {
      onCall()
      res = await placesSearch(body, SEARCH_MASK)
    } catch (e) {
      // A fresh page token is occasionally "not ready yet" — wait briefly and try once more.
      if (token && e instanceof PlacesError && e.status === 400) {
        await new Promise(r => setTimeout(r, 1500))
        onCall()
        res = await placesSearch(body, SEARCH_MASK)
      }
      else { throw e }
    }
    places.push(...(res.places || []))
    token = res.nextPageToken
    pages++
  } while (token && pages < MAX_PAGES)
  return { places, saturated: !!token || places.length >= GOOGLE_CAP }
}

// ─────────────────────────────────────────── CRM matching ───────────────────────────────────────────

/** Domains shared by many rooftops — never treat a shared one as "same dealership". */
const SHARED_HOSTS = new Set([
  'facebook.com', 'm.facebook.com', 'instagram.com', 'google.com', 'sites.google.com', 'business.site', 'g.page', 'linktr.ee', 'yelp.com',
  'cars.com', 'autotrader.com', 'cargurus.com', 'carfax.com', 'carmax.com', 'carvana.com', 'enterprise.com', 'enterprisecarsales.com', 'hertz.com',
  'toyota.com', 'ford.com', 'honda.com', 'automobiles.honda.com', 'chevrolet.com', 'gmc.com', 'buick.com', 'cadillac.com', 'nissanusa.com',
  'hyundaiusa.com', 'kia.com', 'subaru.com', 'vw.com', 'bmwusa.com', 'mbusa.com', 'lexus.com', 'acura.com', 'jeep.com', 'ramtrucks.com',
  'dodge.com', 'chrysler.com', 'mazdausa.com', 'volvocars.com', 'audiusa.com', 'porsche.com', 'tesla.com', 'mitsubishicars.com', 'genesis.com',
  'infinitiusa.com', 'lincoln.com', 'landroverusa.com', 'jaguarusa.com', 'miniusa.com', 'fiatusa.com', 'alfaromeousa.com', 'rivian.com',
])

export interface CrmMatch { id: string, dealershipId: string, name: string, stage: string, archived: boolean, assignedUserName: string, reason: string }
export interface ProspectStatus { status: 'new' | 'in_crm' | 'dismissed', match: CrmMatch | null, dismissed: { reason: string, at: string, by: string } | null }

export async function buildMatchIndex(db: Db) {
  const [docs, dismissals] = await Promise.all([
    db.collection(CRM_COLLECTIONS.dealerships).find({ mergedInto: null }, { projection: { name: 1, website: 1, phone: 1, city: 1, state: 1, stage: 1, dealershipId: 1, googlePlaceId: 1, archivedAt: 1, assignedUserName: 1 } }).toArray(),
    db.collection(PROSPECT_COLLECTIONS.dismissals).find({}).toArray(),
  ])
  const byPlace = new Map<string, any>(), byWeb = new Map<string, any[]>(), byPhone = new Map<string, any>(), byName = new Map<string, any>()
  for (const d of docs) {
    if (d.googlePlaceId) byPlace.set(d.googlePlaceId, d)
    const w = websiteKey(d.website)
    if (w && !SHARED_HOSTS.has(w)) byWeb.set(w, [...(byWeb.get(w) || []), d])
    const p = phoneKey(d.phone)
    if (p) byPhone.set(p, d)
    const n = nameKey(d.name)
    if (n) byName.set(`${n}|${d.state || ''}`, d)
  }
  return { byPlace, byWeb, byPhone, byName, dismissals: new Map<string, any>(dismissals.map(x => [String(x._id), x])) }
}
export type MatchIndex = Awaited<ReturnType<typeof buildMatchIndex>>

export function matchPlace(idx: MatchIndex, p: ProspectPlace): ProspectStatus {
  const hit = (d: any, reason: string): ProspectStatus => ({
    status: 'in_crm',
    match: { id: d._id.toString(), dealershipId: d.dealershipId || '', name: d.name || '', stage: d.stage || '', archived: !!d.archivedAt, assignedUserName: d.assignedUserName || '', reason },
    dismissed: null,
  })
  const byId = idx.byPlace.get(p.placeId)
  if (byId) return hit(byId, 'Same Google listing')
  const w = websiteKey(p.website)
  if (w && !SHARED_HOSTS.has(w)) {
    const list = idx.byWeb.get(w) || []
    const same = list.find(d => !d.city || !p.city || String(d.city).toLowerCase() === p.city.toLowerCase())
    if (same) return hit(same, `Same website (${w})`)
  }
  const ph = phoneKey(p.phone)
  if (ph && idx.byPhone.has(ph)) return hit(idx.byPhone.get(ph), 'Same phone number')
  const nk = nameKey(p.name)
  const byN = nk && (idx.byName.get(`${nk}|${p.state}`) || idx.byName.get(`${nk}|`))
  if (byN) return hit(byN, 'Same name')
  const dis = idx.dismissals.get(p.placeId)
  if (dis) return { status: 'dismissed', match: null, dismissed: { reason: dis.reason || '', at: dis.dismissedAt || '', by: dis.dismissedBy?.name || '' } }
  return { status: 'new', match: null, dismissed: null }
}

export function enrich(p: ProspectPlace, origin: LatLng, idx: MatchIndex) {
  return { ...p, distanceMiles: Math.round(haversineMiles(origin, p) * 10) / 10, ...matchPlace(idx, p) }
}
export type ProspectResult = ReturnType<typeof enrich>

// ─────────────────────────────────────────── Scans ───────────────────────────────────────────

export type ScanParams = Pick<ProspectingConfig, 'origin' | 'radiusMiles' | 'queries' | 'includedType' | 'strictType' | 'excludeKeywords' | 'minReviews' | 'maxApiCalls'>
export type ProspectScanStatus = 'running' | 'completed' | 'cancelled' | 'failed' | 'budget'

let _indexes = false
export async function ensureProspectIndexes(db: Db) {
  if (_indexes) return
  _indexes = true
  try {
    await Promise.all([
      db.collection(PROSPECT_COLLECTIONS.places).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection(PROSPECT_COLLECTIONS.scans).createIndex({ startedAt: -1 }),
      db.collection(CRM_COLLECTIONS.dealerships).createIndex({ googlePlaceId: 1 }, { sparse: true }),
    ])
  } catch (e) { console.warn('[prospecting] index creation skipped:', (e as Error).message) }
}

function summarize(scan: any) {
  const remaining = scan.queue?.length ?? 0
  const done = scan.cellsDone || 0
  return {
    id: scan._id.toString(),
    status: scan.status as ProspectScanStatus,
    params: scan.params as ScanParams,
    cellsDone: done,
    cellsQueued: remaining,
    progress: scan.status === 'running' ? (done + remaining ? done / (done + remaining) : 0) : 1,
    apiCalls: scan.apiCalls || 0,
    estCostUsd: Math.round((scan.apiCalls || 0) * PLACES_PRICE_PER_1000 / 10) / 100,
    found: scan.foundCount ?? (scan.placeIds?.length || 0),
    excluded: scan.excluded || 0,
    splits: scan.splits || 0,
    log: (scan.log || []).slice(-25),
    error: scan.error || '',
    startedAt: scan.startedAt,
    finishedAt: scan.finishedAt || null,
    startedBy: scan.startedBy?.name || '',
  }
}
export type ScanSummary = ReturnType<typeof summarize>

export async function startScan(db: Db, overrides: Partial<ScanParams>, actor: SessionActor | null) {
  if (!placesApiKey()) throw createError({ statusCode: 412, statusMessage: 'Add GOOGLE_PLACES_API_KEY to the server environment first' })
  await ensureProspectIndexes(db)
  const running = await db.collection(PROSPECT_COLLECTIONS.scans).findOne({ status: 'running', updatedAt: { $gt: new Date(Date.now() - 5 * 60_000).toISOString() } })
  if (running) return summarize(running)
  const cfg = await loadProspectingConfig(db)
  const params: ScanParams = sanitizeConfig({ ...cfg, ...pickOverrides(overrides) }, cfg)
  const queue = planGrid(params.origin, params.radiusMiles, params.queries)
  const now = new Date().toISOString()
  const doc = {
    status: 'running' as ProspectScanStatus,
    params: { origin: params.origin, radiusMiles: params.radiusMiles, queries: params.queries, includedType: params.includedType, strictType: params.strictType, excludeKeywords: params.excludeKeywords, minReviews: params.minReviews, maxApiCalls: params.maxApiCalls },
    queue,
    cellsDone: 0,
    apiCalls: 0,
    placeIds: [] as string[],
    foundCount: 0,
    excluded: 0,
    splits: 0,
    log: [{ at: now, msg: `Search area: ${params.radiusMiles} mi around ${params.origin.city || 'base'} — ${queue.length} areas to scan` }],
    error: '',
    startedAt: now,
    updatedAt: now,
    finishedAt: null as string | null,
    startedBy: actor,
    lockUntil: null as string | null,
  }
  const res = await db.collection(PROSPECT_COLLECTIONS.scans).insertOne(doc)
  return summarize({ _id: res.insertedId, ...doc })
}
function pickOverrides(o: any) {
  const out: any = {}
  if (o?.radiusMiles != null) out.radiusMiles = o.radiusMiles
  if (Array.isArray(o?.queries) && o.queries.length) out.queries = o.queries
  return out
}

/** mongodb ≥6 returns the document; older drivers wrap it in `{ value }`. */
const unwrap = (r: any) => (r && r._id ? r : r?.value ?? null)

function excludedReason(p: ProspectPlace, params: ScanParams) {
  if (p.businessStatus === 'CLOSED_PERMANENTLY') return 'closed'
  const lower = p.name.toLowerCase()
  if (params.excludeKeywords.some(k => lower.includes(k.toLowerCase()))) return 'keyword'
  if (p.reviews < params.minReviews) return 'reviews'
  return ''
}
function topCity(places: ProspectPlace[]) {
  const counts = new Map<string, number>()
  for (const p of places) if (p.city) counts.set(p.city, (counts.get(p.city) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
}

/**
 * Processes queued cells for a few seconds and returns progress plus the places first seen in this step
 * (already matched against the CRM) so the UI can drop them on the map as they arrive.
 */
export async function stepScan(db: Db, scanId: string) {
  if (!ObjectId.isValid(scanId)) throw createError({ statusCode: 400, statusMessage: 'Invalid scan id' })
  const col = db.collection(PROSPECT_COLLECTIONS.scans)
  const _id = new ObjectId(scanId)
  const nowIso = () => new Date().toISOString()
  const locked = await col.findOneAndUpdate(
    { _id, status: 'running', $or: [{ lockUntil: null }, { lockUntil: { $lt: nowIso() } }] },
    { $set: { lockUntil: new Date(Date.now() + LOCK_MS).toISOString() } },
    { returnDocument: 'after' },
  )
  const scan: any = unwrap(locked)
  if (!scan) {
    const cur = await col.findOne({ _id })
    if (!cur) throw createError({ statusCode: 404, statusMessage: 'Scan not found' })
    return { scan: summarize(cur), places: [] as ProspectResult[], busy: cur.status === 'running' }
  }

  const params: ScanParams = scan.params
  const origin = { lat: params.origin.lat, lng: params.origin.lng }
  const queue: Cell[] = [...(scan.queue || [])]
  const seen = new Set<string>(scan.placeIds || [])
  const fresh: ProspectPlace[] = []
  const log: { at: string, msg: string }[] = []
  let apiCalls = scan.apiCalls || 0, cellsDone = scan.cellsDone || 0, excluded = scan.excluded || 0, splits = scan.splits || 0
  let status: ProspectScanStatus = 'running', error = '', skippedAreas = 0, lastError = ''
  const started = Date.now()

  while (queue.length && Date.now() - started < STEP_BUDGET_MS) {
    const budgetLeft = params.maxApiCalls - apiCalls
    if (budgetLeft <= 0) { status = 'budget'; break }
    const batch = queue.splice(0, Math.max(1, Math.min(CONCURRENCY, Math.floor(budgetLeft / MAX_PAGES))))
    const results = await Promise.allSettled(batch.map(cell => searchCell(cell, params, () => { apiCalls++ })))
    for (let i = 0; i < batch.length; i++) {
      const cell = batch[i]!
      const r = results[i]!
      if (r.status === 'rejected') {
        const err = r.reason as PlacesError
        if (err instanceof PlacesError && !err.retryable) { status = 'failed'; error = err.message; break }
        if ((cell.tries || 0) < 2) queue.push({ ...cell, tries: (cell.tries || 0) + 1 })
        else { skippedAreas++; lastError = (err as Error)?.message || 'unknown error'; log.push({ at: nowIso(), msg: `Skipped one area after repeated errors: ${lastError}` }) }
        continue
      }
      const normalized = r.value.places.map(normalizePlace).filter(Boolean) as ProspectPlace[]
      if (r.value.saturated && cellSpanMiles(cell) > MIN_CELL_MILES) {
        const kids = splitCell(cell).filter(k => distanceToCellMiles(origin, k) <= params.radiusMiles)
        queue.unshift(...kids)
        splits++
        const where = topCity(normalized)
        log.push({ at: nowIso(), msg: `${where ? `${where} area` : 'Dense area'} has 60+ results — zooming in (${kids.length} sub-areas)` })
      }
      let added = 0
      for (const p of normalized) {
        if (seen.has(p.placeId)) continue
        if (haversineMiles(origin, p) > params.radiusMiles) continue
        seen.add(p.placeId)
        if (excludedReason(p, params)) { excluded++; continue }
        fresh.push(p)
        added++
      }
      cellsDone++
      if (added && !r.value.saturated) {
        const where = topCity(normalized)
        log.push({ at: nowIso(), msg: `${where ? `${where} area` : 'Area'} scanned — ${added} new dealership${added === 1 ? '' : 's'}` })
      }
    }
    if (status === 'failed') break
  }
  if (status === 'running' && !queue.length) status = 'completed'
  // Nothing got through at all (network / quota) — report a failure, not an empty success.
  if (status === 'completed' && cellsDone === 0 && skippedAreas > 0) { status = 'failed'; error = `Couldn't reach Google Places: ${lastError}` }
  if (status === 'running' && apiCalls >= params.maxApiCalls && queue.length) status = 'budget'
  if (status === 'budget') log.push({ at: nowIso(), msg: `Stopped at the ${params.maxApiCalls}-call budget — ${queue.length} areas not scanned. Raise the budget in Settings › General to cover everything.` })
  if (status === 'completed') log.push({ at: nowIso(), msg: `Scan complete — ${seen.size - excluded} dealerships found with ${apiCalls} API calls` })
  if (status === 'failed') log.push({ at: nowIso(), msg: `Google Places error: ${error}` })

  // Cache the places (30-day TTL — Google terms allow temporary caching only).
  if (fresh.length) {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + PLACES_CACHE_DAYS * 86_400_000)
    await db.collection(PROSPECT_COLLECTIONS.places).bulkWrite(fresh.map(p => ({
      updateOne: {
        filter: { _id: p.placeId as any },
        update: { $set: { ...p, lastSeenAt: now.toISOString(), expiresAt }, $setOnInsert: { firstSeenAt: now.toISOString() }, $addToSet: { scanIds: scanId } },
        upsert: true,
      },
    })), { ordered: false })
  }

  const finished = status !== 'running'
  const update: any = {
    $set: {
      status, queue, cellsDone, apiCalls, excluded, splits, error, updatedAt: nowIso(), lockUntil: null,
      foundCount: (scan.foundCount || 0) + fresh.length,
      ...(finished ? { finishedAt: nowIso() } : {}),
    },
  }
  if (fresh.length) update.$addToSet = { placeIds: { $each: fresh.map(p => p.placeId) } }
  if (log.length) update.$push = { log: { $each: log, $slice: -60 } }
  const after = await col.findOneAndUpdate({ _id }, update, { returnDocument: 'after' })
  const doc: any = unwrap(after)
  const idx = fresh.length ? await buildMatchIndex(db) : null
  return { scan: summarize(doc), places: idx ? fresh.map(p => enrich(p, origin, idx)) : [], busy: false }
}

export async function cancelScan(db: Db, scanId: string, actor: SessionActor | null) {
  if (!ObjectId.isValid(scanId)) throw createError({ statusCode: 400, statusMessage: 'Invalid scan id' })
  const now = new Date().toISOString()
  await db.collection(PROSPECT_COLLECTIONS.scans).updateOne(
    { _id: new ObjectId(scanId), status: 'running' },
    { $set: { status: 'cancelled', finishedAt: now, updatedAt: now, lockUntil: null }, $push: { log: { at: now, msg: `Cancelled by ${actor?.name || 'user'}` } } as any },
  )
  const doc = await db.collection(PROSPECT_COLLECTIONS.scans).findOne({ _id: new ObjectId(scanId) })
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'Scan not found' })
  return summarize(doc)
}

export async function listScans(db: Db, limit = 20) {
  const docs = await db.collection(PROSPECT_COLLECTIONS.scans).find({}, { projection: { queue: 0, placeIds: 0, log: 0 } }).sort({ startedAt: -1 }).limit(limit).toArray()
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0)
  const agg = await db.collection(PROSPECT_COLLECTIONS.scans).aggregate([
    { $match: { startedAt: { $gte: monthStart.toISOString() } } },
    { $group: { _id: null, calls: { $sum: '$apiCalls' } } },
  ]).toArray()
  const monthCalls = agg[0]?.calls || 0
  return {
    scans: docs.map(summarize),
    usage: {
      monthCalls,
      freeCalls: PLACES_FREE_MONTHLY_CALLS,
      pricePer1000: PLACES_PRICE_PER_1000,
      estMonthCostUsd: Math.round(Math.max(0, monthCalls - PLACES_FREE_MONTHLY_CALLS) * PLACES_PRICE_PER_1000 / 10) / 100,
    },
  }
}

/** A scan with all its (still cached) places, matched against the CRM as it is right now. */
export async function scanResults(db: Db, scanId: string) {
  if (!ObjectId.isValid(scanId)) throw createError({ statusCode: 400, statusMessage: 'Invalid scan id' })
  const scan: any = await db.collection(PROSPECT_COLLECTIONS.scans).findOne({ _id: new ObjectId(scanId) })
  if (!scan) throw createError({ statusCode: 404, statusMessage: 'Scan not found' })
  const ids: string[] = scan.placeIds || []
  const [docs, idx] = await Promise.all([
    ids.length ? db.collection(PROSPECT_COLLECTIONS.places).find({ _id: { $in: ids as any[] } }).toArray() : Promise.resolve([]),
    buildMatchIndex(db),
  ])
  const origin = { lat: scan.params.origin.lat, lng: scan.params.origin.lng }
  const places = docs.map(({ _id, scanIds, firstSeenAt, lastSeenAt, expiresAt, ...p }: any) => enrich(p as ProspectPlace, origin, idx))
  return { scan: summarize(scan), places, expired: Math.max(0, ids.length - docs.length) }
}

// ─────────────────────────────────────────── Import & dismiss ───────────────────────────────────────────

export interface ImportOptions { stage?: string, assignedUserId?: string, assignedUserName?: string, tags?: string[], scanId?: string }

export async function importProspects(db: Db, placeIds: string[], opts: ImportOptions, actor: SessionActor | null) {
  const ids = [...new Set((placeIds || []).map(String))].slice(0, 500)
  if (!ids.length) throw createError({ statusCode: 400, statusMessage: 'Pick at least one dealership to add' })
  const cfg = await loadProspectingConfig(db)
  const stageReq = String(opts.stage || cfg.defaultStage)
  const stage = (DEALERSHIP_STAGES as readonly string[]).includes(stageReq) && stageReq !== WON_STAGE && stageReq !== 'Lost' ? stageReq : DEFAULT_STAGE
  const tags = [...new Set([PROSPECT_LEAD_SOURCE, ...(opts.tags || []).map(t => str(t, 40)).filter(Boolean)])]
  const docs = await db.collection(PROSPECT_COLLECTIONS.places).find({ _id: { $in: ids as any[] } }).toArray()
  const byId = new Map(docs.map(d => [String(d._id), d]))
  const idx = await buildMatchIndex(db)
  const origin = { lat: cfg.origin.lat, lng: cfg.origin.lng }
  const created: { placeId: string, id: string, dealershipId: string, name: string }[] = []
  const skipped: { placeId: string, name: string, reason: string, match?: CrmMatch | null }[] = []

  for (const placeId of ids) {
    const raw = byId.get(placeId)
    if (!raw) { skipped.push({ placeId, name: '', reason: 'No longer cached — run the scan again' }); continue }
    const { _id, scanIds, firstSeenAt, lastSeenAt, expiresAt, ...rest } = raw as any
    const p = rest as ProspectPlace
    const m = matchPlace(idx, p)
    if (m.status === 'in_crm') { skipped.push({ placeId, name: p.name, reason: `Already in the CRM — ${m.match?.reason}`, match: m.match }); continue }
    if (!p.state) { skipped.push({ placeId, name: p.name, reason: 'Google has no state for this listing' }); continue }

    const now = new Date().toISOString()
    const distance = Math.round(haversineMiles(origin, p) * 10) / 10
    const doc = {
      dealershipId: await nextDealershipId(db),
      name: str(p.name, 200),
      dealerGroup: '',
      brands: p.brands || [],
      website: p.website,
      address: str(p.address, 300),
      city: p.city,
      state: p.state,
      zip: str(p.zip, 20),
      phone: p.phone,
      territory: '',
      assignedUserId: str(opts.assignedUserId, 64),
      assignedUserName: str(opts.assignedUserName, 120),
      leadSource: PROSPECT_LEAD_SOURCE,
      leadSourceDetail: `Google Places · ${distance} mi from ${cfg.origin.city || 'base'}`,
      stage,
      stageChangedAt: now,
      stageChangedBy: actor,
      notes: '',
      estMonthlyValue: null,
      tags,
      googlePlaceId: p.placeId,
      googlePlace: {
        placeId: p.placeId,
        mapsUrl: p.mapsUrl,
        rating: p.rating,
        reviews: p.reviews,
        primaryType: p.primaryType,
        businessStatus: p.businessStatus,
        location: { lat: p.lat, lng: p.lng },
        distanceMiles: distance,
        scanId: opts.scanId || null,
        importedAt: now,
      },
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      archivedAt: null as string | null,
    }
    const res = await db.collection(CRM_COLLECTIONS.dealerships).insertOne(doc)
    const id = res.insertedId.toString()
    const ratingTxt = p.rating != null ? ` · ★ ${p.rating.toFixed(1)} (${p.reviews} reviews)` : ''
    await logActivity(db, { dealershipId: id, type: 'dealership.created', message: `Dealership record ${doc.dealershipId} created from a Google Places scan — ${distance} mi from base${ratingTxt}`, actor })
    await recordStageChange(db, { dealership: { _id: res.insertedId, ...doc }, fromStage: null, toStage: stage, actor, source: 'create', at: new Date(now) })
    // Register it in the in-memory index so two listings of the same store in one batch don't both get created.
    idx.byPlace.set(p.placeId, { _id: res.insertedId, ...doc })
    if (phoneKey(p.phone)) idx.byPhone.set(phoneKey(p.phone), { _id: res.insertedId, ...doc })
    if (nameKey(p.name)) idx.byName.set(`${nameKey(p.name)}|${p.state}`, { _id: res.insertedId, ...doc })
    created.push({ placeId, id, dealershipId: doc.dealershipId, name: doc.name })
  }
  if (created.length) await db.collection(PROSPECT_COLLECTIONS.dismissals).deleteMany({ _id: { $in: created.map(c => c.placeId) as any[] } })
  return { created, skipped }
}

export async function dismissProspects(db: Db, placeIds: string[], reason: string, undo: boolean, actor: SessionActor | null) {
  const ids = [...new Set((placeIds || []).map(String))].slice(0, 1000)
  if (!ids.length) throw createError({ statusCode: 400, statusMessage: 'Nothing selected' })
  const col = db.collection(PROSPECT_COLLECTIONS.dismissals)
  if (undo) {
    const r = await col.deleteMany({ _id: { $in: ids as any[] } })
    return { count: r.deletedCount }
  }
  const places = await db.collection(PROSPECT_COLLECTIONS.places).find({ _id: { $in: ids as any[] } }, { projection: { name: 1 } }).toArray()
  const names = new Map(places.map(p => [String(p._id), p.name]))
  const now = new Date().toISOString()
  await col.bulkWrite(ids.map(id => ({
    updateOne: {
      filter: { _id: id as any },
      update: { $set: { reason: str(reason, 200), dismissedAt: now, dismissedBy: actor, name: names.get(id) || '' } },
      upsert: true,
    },
  })), { ordered: false })
  return { count: ids.length }
}
