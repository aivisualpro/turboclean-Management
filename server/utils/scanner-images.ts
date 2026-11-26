/**
 * Inventory Scanner — photo verdicts.
 *
 * Every vehicle's main photo gets one verdict:
 *   real         a live photo of that vehicle
 *   placeholder  "Photos coming soon" / "Vehicle photos unavailable" / blank / spacer images
 *   stock        manufacturer or stock-library images (EVOX, Chrome Data, izmo…), or one photo reused
 *                across several different vehicles of the same model
 *   missing      no photo at all, or the photo link is broken
 *   blurry       a real photo of the car, but out of focus / smeared / a tiny picture blown up — shown on
 *                its own (own count and tag); it is NOT part of "without a real photo"
 *   review       signals disagree — the scanner's best guess is kept in `suggested`
 *
 * Evidence (each with a plain-English reason shown in the UI):
 *  - duplicates: perceptual hash (dHash) clusters — a real photo belongs to one VIN, so the same
 *    picture on many cars is a placeholder (different models) or a stock image (same model)
 *  - what the image says: on-image text read with the browser's Shape Detection API (OCR)
 *  - file name / image host (coming-soon.jpg, evox, chromedata…), alt text, card wording
 *  - how it looks: mostly blank & colourless, or a car on a pure white studio background
 *  - how sharp it is: measured on the picture itself (works without AI), confirmed by the AI when it is on
 *  - your saved rules: "always treat this image as …" (learned across every dealership)
 */
import type { Db } from 'mongodb'
import { ObjectId } from 'mongodb'
import type { SessionActor } from './crm'

export type PhotoVerdict = 'real' | 'placeholder' | 'stock' | 'missing' | 'blurry' | 'review'
/** What a person (or a rule) may set. */
export const FINAL_VERDICTS = ['real', 'placeholder', 'stock', 'missing', 'blurry'] as const
/** A placeholder image ("Vehicle photos unavailable", "coming soon") means the car has no photo — same label. */
export const VERDICT_LABEL: Record<PhotoVerdict, string> = { real: 'Real photo', placeholder: 'No photo', stock: 'Stock image', missing: 'No photo', blurry: 'Blurry photo', review: 'Needs review' }

export interface CardImage { url: string, alt: string, nw: number, nh: number, complete: boolean, rw: number, rh: number, kind: 'img' | 'background' }
export interface ImageInfo {
  id: string
  url: string
  ok: boolean
  error?: string
  w?: number
  h?: number
  hash?: string
  /** 256-bit detail hash of the picture's centre (edges / dealer banners ignored). */
  hash2?: string
  /** "The very same picture?" fingerprint (base64, 304 bytes: 16×16 grey + 4×4 colour) — see `samePictureFp`. */
  fp?: string
  whiteRatio?: number
  grayRatio?: number
  colorfulness?: number
  edgeDensity?: number
  borderWhite?: number
  uniqueColors?: number
  /** Sharpness, measured on the picture: `blur` 0–1 (how little a small extra blur changes it), `detail` = fine detail in its busiest parts. */
  blur?: number
  detail?: number
  text?: string
  ocr?: boolean
  /** Gemini's look at the photo (cached by fingerprint). */
  ai?: { v: 'real' | 'placeholder' | 'stock', c: number, why: string, text: string, model: string, ad?: boolean, adWhy?: string, cached?: boolean, /** The photo itself is out of focus / smeared. */ blur?: boolean }
  bytes?: number
}
export interface ScanVehicle {
  key: string
  /** The crawl page (inventory list URL) this vehicle was found on — results and reports are grouped by it. */
  listUrl?: string
  title: string
  year: number | null
  make: string
  model: string
  vin: string
  stock: string
  price: string
  condition: 'new' | 'used' | 'certified' | ''
  url: string
  image: CardImage | null
  imageId: string | null
  imageCount: number
  photoCountText: string
  noPhotoText: string
  page: number
  sourceUrl: string
  verdict: PhotoVerdict
  suggested: Exclude<PhotoVerdict, 'review'>
  confidence: number
  reasons: string[]
  clusterId: string | null
  override: Exclude<PhotoVerdict, 'review'> | null
  /** First words of the card (helps tell a vehicle from a promo tile). */
  cardText?: string
  /** Set when the card looks like an advertisement / promo tile, not a vehicle — left out of every count. */
  adReason?: string | null
  /** A person's call: 'ad' (leave out) or 'vehicle' (count it) — beats the automatic one. */
  listing?: 'ad' | 'vehicle' | null
  /** Set when the picture is a car placed on a generic background that many other listings share (see `buildBackdrops`). */
  backdropId?: string | null
}
/** Is this card an advertisement (not part of the inventory)? A person's call wins. */
export const isAd = (v: ScanVehicle) => v.listing ? v.listing === 'ad' : !!v.adReason
/** The vehicles that count (ads left out). */
export const countable = (vs: ScanVehicle[]) => vs.filter(v => !isAd(v))
const AD_TEXT = /pre-?approv|value your trade|trade[- ]in value|get approved|apply (now|online)|financ|special offers?|lease (special|offer|deal)|sell (us )?your (car|vehicle)|we buy cars|schedule (a )?(test drive|service)|service (special|coupon)|coupon|rebate|shop online|can.t find|not finding|sign up|subscribe|gift card|award|why buy|learn more|explore (the|our)|build (&|and) price|view (all )?specials/i
/** Built-in ad check: an offer headline — or no VIN, no stock #, no year and no price — or promo wording without a VIN / stock #. */
/** Offer tiles written like a headline ("Lease a 2027 Corolla LE …", "… (Natl)"): a manufacturer special, even when it links to one car. */
export const OFFER_TITLE = /^\s*(lease|finance|buy|get|save|drive)\s+(a|an|the|your|up|on|now)\b|\(\s*natl\.?\s*\)|\b\d(\.\d+)?\s*%\s*apr\b|\$\s*\d[\d,]*\s*(\/|per)\s*mo(nth)?\b|\bdue at signing\b/i
export function adSignal(v: ScanVehicle): string | null {
  if (OFFER_TITLE.test(v.title || '')) return `Offer tile (“${short(v.title, 50)}”) — a lease / finance special, not a listing`
  if (v.vin || v.stock) return null
  // Promo wording in the card's TITLE (button text like "Get financing" sits on real cards too, so the body is not used).
  const m = (v.title || '').match(AD_TEXT) || (v.title || '').match(/\b(lease|special|event|offer|sale|deal)s?\b/i)
  if (m) return `Promo tile (“${short(v.title, 50)}”) — no VIN or stock #`
  if (!v.year && !v.price) return 'No year, price, VIN or stock # — looks like a banner, not a vehicle'
  return null
}
export interface ImageCluster { id: string, imageIds: string[], hash: string, hash2?: string, vehicles: number, models: number, modelNames: string[], thumb: string, url: string, verdict: PhotoVerdict, reason: string, override: Exclude<PhotoVerdict, 'review'> | null
  /** True when the pictures are the very same file (one address, or matching fingerprints). False = an older scan, matched by the coarse hashes only. */
  exact?: boolean }

export const RULES_COLLECTION = 'turboCleanScannerImageRules'

const PLACEHOLDER_URL = /(no[-_ ]?(image|photo|pic|img)s?|missing[-_ ]?(image|photo|pic|img|vehicle|car)?s?|coming[-_ ]?soon|photos?[-_ ]?coming|image[-_ ]?coming|placeholder|unavailable|not[-_ ]?available|awaiting[-_ ]?(photo|image)|default[-_ ]?(vehicle|car|image|photo)|nophoto|noimage|no_pic|spacer|blank\.(gif|png|jpg)|1x1|pixel\.gif|image[-_]?not[-_]?found|photo[-_]?not)/i
const STOCK_HOST = /(evox|izmo|chromedata|chrome-data|autodata|jdpower|nadaguides|fuelapi|oemphotos?|carsdirect\/images|vehicle-?renders?|colorized|images\.dealer\.com\/autodata|stock[-_]?(photo|image|pic)s?)/i
const STOCK_PATH = /\/(stock|oem|manufacturer|model[-_]?images?)\//i
const PLACEHOLDER_TEXT = /(photos?|images?|pictures?|pics)\s*(are\s*)?(coming\s*soon|unavailable|not\s*available|to\s*follow|pending|on\s*the\s*way)|no\s*(photos?|images?|pictures?)(\s*available)?|check\s*back\s*soon|photos?\s*coming|image\s*coming|awaiting\s*photos?/i
const STOCK_TEXT = /stock\s*(photo|image)|for\s*illustration|representative\s*(photo|image|only)|image\s*may\s*not\s*represent|actual\s*vehicle\s*may\s*vary|similar\s*vehicle/i

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Download one image (server-side, so cross-origin rules don't apply). */
export async function downloadImage(url: string, referer: string): Promise<{ b64: string, mime: string, bytes: number } | { error: string }> {
  if (!/^https?:\/\//i.test(url)) return { error: 'not an http(s) image' }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': UA, 'accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'referer': referer } })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const mime = (res.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase()
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 6 * 1024 * 1024) return { error: 'image larger than 6 MB' }
    if (!buf.length) return { error: 'empty image' }
    if (mime && !mime.startsWith('image/') && mime !== 'application/octet-stream' && mime !== 'binary/octet-stream') return { error: `not an image (${mime})` }
    return { b64: buf.toString('base64'), mime: mime.startsWith('image/') ? mime : 'image/jpeg', bytes: buf.length }
  }
  catch (e: any) { return { error: e?.name === 'AbortError' ? 'timed out' : (e?.message || 'download failed') } }
  finally { clearTimeout(t) }
}

export function hamming(a?: string, b?: string) {
  if (!a || !b || a.length !== b.length) return 64
  let d = 0
  for (let i = 0; i < a.length; i++) {
    let x = Number.parseInt(a[i]!, 16) ^ Number.parseInt(b[i]!, 16)
    while (x) { d += x & 1; x >>= 1 }
  }
  return d
}
/**
 * THE SAME PICTURE — what that means here.
 *
 * A repeated picture is evidence ("a real photo belongs to one car"), so a wrong match is costly: at a
 * dealership that photographs every car at the same spot, the old coarse hashes (9×8 / 17×16 difference
 * hashes) called different cars "the same picture", chained them into one group of 148 and turned a lot
 * full of real photos into "no photo". They were also unstable: the same file at another size often did
 * not match itself.
 *
 * Now two pictures are the same only when their fingerprints (`fp`, made in the analysis tab) agree almost
 * pixel for pixel: overall difference ≤ 1%, no 4×4 block off by more than 1.3%, colours within 1%.
 * Measured: the same file re-saved (other size / quality) stays under 0.4% / 0.7%; different cars at one
 * fixed spot, same colour and body style, start at 1.7% in their worst block; ordinary different photos
 * are 5–10× further apart. Groups are built around one picture (no chaining).
 */
const FP_BYTES = 304
const fpCache = new Map<string, Uint8Array | null>()
function fpBytes(fp?: string): Uint8Array | null {
  if (!fp || fp.length < 400) return null
  let b = fpCache.get(fp)
  if (b === undefined) {
    try { const raw = Buffer.from(fp, 'base64'); b = raw.length === FP_BYTES ? new Uint8Array(raw) : null } catch { b = null }
    if (fpCache.size > 6000) fpCache.clear()
    fpCache.set(fp, b)
  }
  return b
}
const FP_ALL = 0.010 * 256 * 255, FP_BLOCK = 0.013 * 16 * 255, FP_COLOUR = 0.010 * 48 * 255
function sameFpBytes(a: Uint8Array, b: Uint8Array) {
  let sum = 0
  const blocks = new Float64Array(16)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) { const d = Math.abs(a[y * 16 + x]! - b[y * 16 + x]!); sum += d; blocks[(y >> 2) * 4 + (x >> 2)]! += d }
    if (sum > FP_ALL) return false
  }
  for (let k = 0; k < 16; k++) if (blocks[k]! > FP_BLOCK) return false
  let col = 0
  for (let i = 256; i < FP_BYTES; i++) col += Math.abs(a[i]! - b[i]!)
  return col <= FP_COLOUR
}
/** The very same picture, by fingerprint (false when either has none). */
export function samePictureFp(a?: string, b?: string) {
  const x = fpBytes(a), y = fpBytes(b)
  return !!x && !!y && sameFpBytes(x, y)
}
/** A fingerprint of a (nearly) flat picture — blanks and spacers are judged on their own, never grouped. */
function flatFp(b: Uint8Array) { let lo = 255, hi = 0; for (let i = 0; i < 256; i++) { if (b[i]! < lo) lo = b[i]!; if (b[i]! > hi) hi = b[i]! } return hi - lo < 10 }

/** Older scans and rules carry only the coarse hashes: they count as the same picture only when nearly identical. */
export const SAME_IMAGE_DISTANCE = 2
export const SAME_DETAIL_DISTANCE = 12
export function samePicture(a: { hash?: string, hash2?: string, fp?: string } | undefined, b: { hash?: string, hash2?: string, fp?: string } | undefined) {
  if (!a || !b) return false
  if (a.fp && b.fp) return samePictureFp(a.fp, b.fp)
  if (!a.hash || !b.hash) return false
  if (hamming(a.hash, b.hash) > SAME_IMAGE_DISTANCE) return false
  if (a.hash2 && b.hash2 && a.hash2.length === b.hash2.length) return hamming(a.hash2, b.hash2) <= SAME_DETAIL_DISTANCE
  // No detail hash on one side (very old data): only an identical coarse hash counts.
  return a.hash === b.hash
}

export interface ImageRule { id: string, hash: string, hash2?: string, fp?: string, urlContains: string, verdict: Exclude<PhotoVerdict, 'review'>, label: string, thumb: string, hits: number, createdAt: string, createdBy: { id: string, name: string } | null }
export async function listRules(db: Db): Promise<ImageRule[]> {
  const rows = await db.collection(RULES_COLLECTION).find({}).sort({ createdAt: -1 }).limit(500).toArray()
  return rows.map(({ _id, ...r }) => ({ id: _id.toString(), ...r } as any))
}
export async function saveRule(db: Db, body: { hash?: string, hash2?: string, fp?: string, urlContains?: string, verdict: string, label?: string, thumb?: string }, actor: SessionActor | null) {
  const verdict = (['real', 'placeholder', 'stock', 'missing'].includes(body.verdict) ? body.verdict : null) as ImageRule['verdict'] | null
  if (!verdict) throw createError({ statusCode: 400, statusMessage: 'Pick what this image is' })
  const hash = /^[0-9a-f]{16}$/i.test(String(body.hash || '')) ? String(body.hash).toLowerCase() : ''
  const hash2 = hash && /^[0-9a-f]{64}$/i.test(String(body.hash2 || '')) ? String(body.hash2).toLowerCase() : ''
  const urlContains = String(body.urlContains || '').trim().slice(0, 200)
  if (!hash && !urlContains) throw createError({ statusCode: 400, statusMessage: 'A rule needs an image or a piece of the image address' })
  const col = db.collection(RULES_COLLECTION)
  const existing = hash ? await col.findOne(hash2 ? { hash, hash2 } : { hash, hash2: { $in: ['', null] } }) : await col.findOne({ urlContains })
  const fp = hash && fpBytes(String(body.fp || '')) ? String(body.fp) : ''
  const doc = { hash, hash2, ...(fp ? { fp } : {}), urlContains, verdict, label: String(body.label || '').slice(0, 120) || (verdict === 'real' ? 'Real photo' : verdict === 'stock' ? 'Stock image' : 'Placeholder image'), thumb: /^https?:\/\//i.test(String(body.thumb || '')) ? String(body.thumb).slice(0, 2000) : '', updatedAt: new Date().toISOString() }
  if (existing) { await col.updateOne({ _id: existing._id }, { $set: doc }); return { id: existing._id.toString(), ...existing, ...doc } }
  const res = await col.insertOne({ ...doc, hits: 0, createdAt: doc.updatedAt, createdBy: actor ? { id: actor.id, name: actor.name } : null })
  return { id: res.insertedId.toString(), ...doc, hits: 0 }
}
export async function deleteRule(db: Db, id: string) {
  if (!ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  await db.collection(RULES_COLLECTION).deleteOne({ _id: new ObjectId(id) })
}

const modelKey = (v: ScanVehicle) => `${v.make} ${v.model}`.trim().toLowerCase() || v.title.toLowerCase().replace(/\b(new|used|certified|pre-owned)\b/g, '').replace(/\b(19|20)\d{2}\b/, '').trim().split(/\s+/).slice(0, 2).join(' ')
const short = (s: string, n = 48) => s.length > n ? `${s.slice(0, n - 1)}…` : s

/** Group images that are the very same picture (one address, or matching fingerprints — see `samePictureFp`). */
export function buildClusters(vehicles: ScanVehicle[], images: Map<string, ImageInfo>): ImageCluster[] {
  const ids = [...images.keys()]
  // Each group is built around ONE picture: an image joins the first group whose picture it matches.
  // (No chaining — "A looks like B, B looks like C" must never put A and C in one group.)
  const groups: { rep: ImageInfo, bytes: Uint8Array | null, ids: string[], exact: boolean }[] = []
  const grouped = new Set<string>()
  for (const id of ids) {
    const i = images.get(id)!
    if ((i.w || 0) < 80 || (i.h || 0) < 60) continue
    const bytes = fpBytes(i.fp)
    if (bytes) {
      // Spacers and flat blanks all look alike — they are judged on their own, not grouped.
      if (flatFp(bytes)) continue
      const g = groups.find(g => g.bytes && sameFpBytes(g.bytes, bytes))
      if (g) g.ids.push(id)
      else groups.push({ rep: i, bytes, ids: [id], exact: true })
      grouped.add(id)
    }
    else if (i.hash) {
      // An older scan (no fingerprint): the coarse hashes, nearly identical only.
      const bits = [...i.hash].reduce((n, c) => n + Number.parseInt(c, 16).toString(2).replace(/0/g, '').length, 0)
      if (bits < 4 || bits > 60) continue
      const g = groups.find(g => !g.bytes && samePicture(g.rep, i))
      if (g) g.ids.push(id)
      else groups.push({ rep: i, bytes: null, ids: [id], exact: false })
      grouped.add(id)
    }
  }
  // One address on several listings is the same picture too, measured or not.
  for (const id of ids) if (!grouped.has(id)) groups.push({ rep: images.get(id)!, bytes: null, ids: [id], exact: true })
  const clusters: ImageCluster[] = []
  let n = 0
  for (const g of groups) {
    const imgIds = g.ids
    const vs = vehicles.filter(v => v.imageId && imgIds.includes(v.imageId))
    if (vs.length < 2) continue
    const models = [...new Set(vs.map(modelKey).filter(Boolean))]
    const first = g.rep
    clusters.push({ id: `c${++n}`, imageIds: imgIds, hash: first.hash || '', hash2: first.hash2 || '', vehicles: vs.length, models: models.length, modelNames: [...new Set(vs.map(v => `${v.make} ${v.model}`.trim() || modelKey(v)))].slice(0, 6), thumb: first.url, url: first.url, verdict: 'review', reason: '', override: null, exact: g.exact })
  }
  return clusters.sort((a, b) => b.vehicles - a.vehicles)
}

/**
 * ONE BACKGROUND, MANY CARS — stock images placed on a generic backdrop.
 *
 * Many dealer websites show new cars as a rendered car pasted onto one stock background (the brand's
 * showroom under a blue sky, sometimes inside the dealer's own banner frame). Every picture is different
 * (another car in the middle), so it is not a "repeated picture" — and it is not a photo of the car
 * either. What gives it away: everything around the car is the same, cell for cell, on listing after
 * listing. Real photos never do that — not even at a fixed spot (the light, the clouds, the cars behind
 * and the framing change): measured on a real crawl, two real photos of one lot share 4% of their cells
 * (13% at the 95th percentile), two of these composites 71%.
 *
 * A group needs: ≥ 4 pictures that share ≥ 60% of their 256 cells within 3 grey levels AND ≥ 50% of their
 * detailed cells (cells on an edge — flat sky or asphalt proves nothing; on the same real crawl two real
 * photos never shared more than 28% of those, two composites 65%); a common area
 * (cells ≥ 80% of the group agrees on) of at least a quarter of the frame; and that area must be detailed
 * scenery (≥ 30% of its cells sit on an edge) — a plain studio wall or a photo booth is not a "backdrop".
 * A picture that matches a group's common area on ≥ 80% of it joins the group.
 */
const BACKDROP_T = 3
/** The detailed cells of a fingerprint: those that differ from a neighbour by 10+ grey levels. */
function detailedCells(a: Uint8Array) {
  const on = new Uint8Array(256)
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const c = y * 16 + x, v = a[c]!
    if ((x < 15 && Math.abs(v - a[c + 1]!) >= 10) || (x > 0 && Math.abs(v - a[c - 1]!) >= 10) || (y < 15 && Math.abs(v - a[c + 16]!) >= 10) || (y > 0 && Math.abs(v - a[c - 16]!) >= 10)) on[c] = 1
  }
  return on
}
/** How much of picture `a` is also in `b`, cell for cell: of all cells, and of a's detailed cells. */
function sharedCells(a: Uint8Array, detailed: Uint8Array, b: Uint8Array) {
  let all = 0, d = 0, dAll = 0
  for (let i = 0; i < 256; i++) {
    const same = Math.abs(a[i]! - b[i]!) <= BACKDROP_T
    if (same) all++
    if (detailed[i]) { dAll++; if (same) d++ }
  }
  return { share: all / 256, detailShare: dAll >= 40 ? d / dAll : 0 }
}
export function buildBackdrops(images: Map<string, ImageInfo>): Map<string, string> {
  const of = new Map<string, string>()
  const list: { id: string, b: Uint8Array }[] = []
  for (const [id, i] of images) { const b = i.ok ? fpBytes(i.fp) : null; if (b && !flatFp(b) && (i.w || 0) >= 200 && (i.h || 0) >= 140) list.push({ id, b }) }
  if (list.length < 4) return of
  const groups: { rep: Uint8Array, detailed: Uint8Array, members: { id: string, b: Uint8Array }[] }[] = []
  for (const x of list) {
    const g = groups.find((g) => { const r = sharedCells(g.rep, g.detailed, x.b); return r.share >= 0.6 && r.detailShare >= 0.5 })
    if (g) g.members.push(x)
    else groups.push({ rep: x.b, detailed: detailedCells(x.b), members: [x] })
  }
  const taken = new Set<string>()
  const backdrops: { id: string, common: Uint8Array, mask: number[] }[] = []
  let n = 0
  for (const g of groups) {
    if (g.members.length < 4) continue
    // The common area: cells nearly every member agrees on (the car in the middle is what differs).
    const common = new Uint8Array(256), on = new Uint8Array(256), mask: number[] = []
    for (let c = 0; c < 256; c++) {
      const vals = g.members.map(m => m.b[c]!).sort((a, b) => a - b)
      const med = vals[vals.length >> 1]!
      common[c] = med
      if (vals.filter(v => Math.abs(v - med) <= BACKDROP_T).length / vals.length >= 0.8) { on[c] = 1; mask.push(c) }
    }
    if (mask.length < 64) continue
    // Detailed scenery, not a plain wall: how many of its cells sit on an edge.
    let edges = 0
    for (const c of mask) {
      const x = c % 16, y = c >> 4
      const d = Math.max(x < 15 && on[c + 1] ? Math.abs(common[c]! - common[c + 1]!) : 0, y < 15 && on[c + 16] ? Math.abs(common[c]! - common[c + 16]!) : 0)
      if (d >= 10) edges++
    }
    if (edges / mask.length < 0.3) continue
    const id = `b${++n}`
    backdrops.push({ id, common, mask })
    for (const m of g.members) { of.set(m.id, id); taken.add(m.id) }
  }
  // Two groups on the very same backdrop (their first pictures were too different to meet) are one group.
  const same = new Map<string, string>()
  for (let i = 0; i < backdrops.length; i++) {
    for (let j = 0; j < i; j++) {
      const A = backdrops[i]!, B = backdrops[j]!
      const inB = new Set(B.mask)
      const both = A.mask.filter(c => inB.has(c))
      if (both.length >= 48 && both.filter(c => Math.abs(A.common[c]! - B.common[c]!) <= BACKDROP_T).length / both.length >= 0.9) { same.set(A.id, same.get(B.id) || B.id); break }
    }
  }
  if (same.size) for (const [img, id] of of) if (same.has(id)) of.set(img, same.get(id)!)
  // Pictures that did not match the group's first picture closely (a bigger car hides more) but do sit on its backdrop.
  for (const x of list) {
    if (taken.has(x.id)) continue
    for (const bd of backdrops) {
      let ok = 0
      for (const c of bd.mask) if (Math.abs(x.b[c]! - bd.common[c]!) <= BACKDROP_T + 1) ok++
      if (ok / bd.mask.length >= 0.8) { of.set(x.id, same.get(bd.id) || bd.id); break }
    }
  }
  return of
}
/** A car on a plain, smooth, colourless studio background (the outer ring of the picture is featureless)? */
function plainStudio(i?: ImageInfo): boolean {
  const b = i?.ok ? fpBytes(i.fp) : null
  if (!b) return false
  let n = 0, sum = 0, rough = 0, pairs = 0
  const ring = (x: number, y: number) => x < 2 || x > 13 || y < 2 || y > 13
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (!ring(x, y)) continue
    const v = b[y * 16 + x]!; n++; sum += v
    if (x < 15 && ring(x + 1, y)) { rough += Math.abs(v - b[y * 16 + x + 1]!); pairs++ }
    if (y < 15 && ring(x, y + 1)) { rough += Math.abs(v - b[(y + 1) * 16 + x]!); pairs++ }
  }
  if (sum / n < 150 || rough / pairs > 2.5) return false
  // colourless corners
  for (const c of [0, 3, 12, 15]) { const o = 256 + c * 3; if (Math.max(b[o]!, b[o + 1]!, b[o + 2]!) - Math.min(b[o]!, b[o + 1]!, b[o + 2]!) > 14) return false }
  return true
}

/**
 * Is the picture blurry? Measured, not guessed (calibrated on sharp photos and the same photos blurred):
 *   'blurry'  clearly out of focus / smeared / a small picture blown up
 *   'soft'    noticeably soft — only called blurry when the AI looking at it agrees
 *   'sharp'   fine          ·  null = not measured (too small to judge, or not downloaded)
 */
export function blurLevel(i?: ImageInfo | null): 'blurry' | 'soft' | 'sharp' | null {
  if (!i?.ok || typeof i.blur !== 'number' || typeof i.detail !== 'number') return null
  if ((i.w || 0) < 200 || (i.h || 0) < 140) return null
  if ((i.blur >= 0.56 && i.detail < 110) || (i.blur >= 0.5 && i.detail < 25)) return 'blurry'
  if (i.blur >= 0.5 && i.detail < 160) return 'soft'
  return 'sharp'
}
/** Sharpness as a number people can read: 0 (a smear) … 100 (crisp). Null when not measured. */
export function sharpnessScore(i?: ImageInfo | null): number | null {
  if (!i?.ok || typeof i.blur !== 'number' || typeof i.detail !== 'number') return null
  const a = Math.max(0, Math.min(1, (0.75 - i.blur) / 0.5))
  const b = Math.max(0, Math.min(1, Math.log10(Math.max(1, i.detail) / 8) / Math.log10(1500 / 8)))
  return Math.round(100 * Math.min(a, b))
}
/** A real photo: is it blurry? The measurement decides; the AI confirms the in-between cases; a person's earlier call wins. */
function blurCall(info: ImageInfo | undefined): { blurry: boolean, confidence: number, reason: string, measuredOnly: boolean } | null {
  if (!info?.ok) return null
  const ai = info.ai
  const level = blurLevel(info)
  const score = sharpnessScore(info)
  const tail = score === null ? '' : ` (sharpness ${score} of 100)`
  if (ai?.model === 'you' && typeof ai.blur === 'boolean') return ai.blur ? { blurry: true, confidence: 1, reason: 'Marked as blurry by you on an earlier crawl', measuredOnly: false } : null
  if (level === 'blurry') return { blurry: true, confidence: ai?.blur === true ? 0.93 : ai?.blur === false ? 0.7 : 0.82, reason: `The photo is out of focus or smeared${tail}${ai?.blur === true ? ' — the AI check agrees' : ''}`, measuredOnly: ai?.blur !== true }
  if (level === 'soft' && ai?.blur === true) return { blurry: true, confidence: 0.8, reason: `The photo is soft and the AI check calls it blurry${tail}`, measuredOnly: false }
  if (level === null && ai?.blur === true && ai.c >= 0.85) return { blurry: true, confidence: 0.75, reason: 'AI check: the photo is blurry', measuredOnly: false }
  return null
}

/** Noisy-OR: independent pieces of evidence add up without exceeding 1. */
const combine = (xs: number[]) => 1 - xs.reduce((p, x) => p * (1 - x), 1)

export function classify(vehicles: ScanVehicle[], images: Map<string, ImageInfo>, rules: ImageRule[]) {
  const clusters = buildClusters(vehicles, images)
  const clusterOf = new Map<string, ImageCluster>()
  for (const c of clusters) for (const id of c.imageIds) clusterOf.set(id, c)
  // Stock images on one generic backdrop: how many listings stand on each.
  const backdropOf = buildBackdrops(images)
  const onBackdrop = new Map<string, number>()
  for (const v of vehicles) { const b = v.imageId ? backdropOf.get(v.imageId) : undefined; if (b) onBackdrop.set(b, (onBackdrop.get(b) || 0) + 1) }
  const ruleHits = new Map<string, number>()
  /** Called blurry by the measurement alone (no AI, no person) — re-checked as a group below. */
  const measured: ScanVehicle[] = []

  for (const v of vehicles) {
    const P: [number, string][] = []
    const S: [number, string][] = []
    const R: [number, string][] = []
    const img = v.image
    const info = v.imageId ? images.get(v.imageId) : undefined
    const cluster = v.imageId ? clusterOf.get(v.imageId) : undefined
    v.clusterId = cluster?.id || null
    const backdrop = v.imageId ? backdropOf.get(v.imageId) : undefined
    const backdropCars = backdrop ? onBackdrop.get(backdrop) || 0 : 0
    v.backdropId = backdrop && backdropCars >= 4 ? backdrop : null
    v.reasons = []
    // Advertisement / promo tile in the grid? The AI's call (it sees picture + card) first, else the built-in check.
    const aiAd = info?.ok && typeof info.ai?.ad === 'boolean' ? info.ai : null
    v.adReason = aiAd ? (aiAd.ad && !(v.vin && v.stock) ? `AI check: advertisement, not a vehicle${aiAd.adWhy ? ` — ${short(aiAd.adWhy, 60)}` : ''}` : null) : adSignal(v)
    const decide = (verdict: Exclude<PhotoVerdict, 'review'>, confidence: number, reasons: string[]) => {
      v.verdict = verdict; v.suggested = verdict; v.confidence = confidence; v.reasons = reasons
      // A real photo can still be a bad one: out of focus, smeared, a thumbnail blown up.
      if (verdict !== 'real') return
      const b = blurCall(info)
      if (!b?.blurry) { if (blurLevel(info) === 'soft') v.reasons = [...reasons, 'A little soft, but the car can be made out']; return }
      v.verdict = 'blurry'; v.suggested = 'blurry'; v.confidence = b.confidence; v.reasons = [b.reason, ...reasons]
      if (b.measuredOnly) measured.push(v)
    }

    if (!img || !img.url) { decide('missing', 1, [v.noPhotoText ? `No photo — the card says “${short(v.noPhotoText)}”` : 'No photo on the vehicle card']); continue }
    if (img.complete && img.kind === 'img' && img.nw === 0 && info && !info.ok) { decide('missing', 0.97, [`The photo link is broken (${info.error || 'did not load'})`]); continue }

    // Your rules win.
    const rule = rules.find(r => (r.hash && info?.hash && samePicture(r, info)) || (r.urlContains && img.url.toLowerCase().includes(r.urlContains.toLowerCase())))
    if (rule) { ruleHits.set(rule.id, (ruleHits.get(rule.id) || 0) + 1); decide(rule.verdict as any, 1, [`Matches your saved rule “${rule.label}”`]); continue }

    // Gemini looked at the picture itself. Confident answers decide — except when the very same picture
    // sits on 3+ different models (then it is a placeholder / stock image whatever it shows).
    const ai = info?.ok ? info.ai : undefined
    // The very same picture on several listings (exact match on both fingerprints) is never "this car's" photo,
    // whatever it shows — so a "real" from the AI does not override a reliable duplicate.
    // (an older scan's group, matched by the coarse hashes only, is not that reliable: there the AI's "real" stands)
    const reliableDup = !!cluster && cluster.exact !== false
    // Neither does it override a shared backdrop: a rendered car on a stock background can look like a photo taken at the dealership.
    if (ai && ai.c >= 0.75 && !(ai.v === 'real' && (reliableDup || v.backdropId))) {
      const aiWhy = `AI check: ${ai.v === 'real' ? 'a real photo of the car' : ai.v === 'stock' ? 'a stock / studio image' : 'not a photo of the car'}${ai.why ? ` — ${short(ai.why, 60)}` : ''}${ai.text ? ` (reads “${short(ai.text, 40)}”)` : ''}`
      decide(ai.v, Math.round(Math.max(0.75, ai.c) * 100) / 100, [aiWhy])
      continue
    }
    const file = decodeURIComponent(img.url.split('?')[0]!.split('/').slice(-3).join('/'))
    const pm = file.match(PLACEHOLDER_URL)
    if (pm) P.push([0.92, `File name says “${pm[0]}”`])
    const host = (() => { try { return new URL(img.url).hostname } catch { return '' } })()
    const sm = (host + new URL(img.url, 'https://x').pathname).match(STOCK_HOST)
    if (sm) S.push([0.85, `Image comes from a stock-image library (${sm[0]})`])
    else if (STOCK_PATH.test(img.url)) S.push([0.6, 'Image address points to a stock / OEM folder'])
    if (img.alt && PLACEHOLDER_TEXT.test(img.alt)) P.push([0.85, `Image description says “${short(img.alt)}”`])
    if (img.alt && STOCK_TEXT.test(img.alt)) S.push([0.8, `Image description says “${short(img.alt)}”`])
    if (v.noPhotoText) P.push([0.85, `The card says “${short(v.noPhotoText)}”`])
    if (info?.ok) {
      const t = `${info.text || ''} ${info.ai?.text || ''}`.replace(/\s+/g, ' ').trim()
      const pt = t.match(PLACEHOLDER_TEXT)
      if (pt) P.push([0.97, `The picture reads “${short(t, 60)}”`])
      const st = t.match(STOCK_TEXT)
      if (st) S.push([0.9, `The picture reads “${short(t, 60)}”`])
      if ((info.w || 0) < 80 || (info.h || 0) < 60) P.push([0.9, `The image is only ${info.w}×${info.h}px (a spacer, not a photo)`])
      if ((info.whiteRatio || 0) >= 0.55 && (info.colorfulness || 0) < 14 && (info.edgeDensity || 0) < 0.1) P.push([0.62, 'Mostly blank, colourless picture — typical of a generic placeholder'])
      else if ((info.grayRatio || 0) > 0.92 && (info.edgeDensity || 0) < 0.06) P.push([0.55, 'Flat grey picture with almost no detail'])
      // A grey car silhouette from a stock host (EVOX etc. "Photos Coming Soon") is a placeholder, not a stock photo.
      if (sm && (info.colorfulness || 0) < 10 && (info.grayRatio || 0) > 0.8) P.push([0.9, 'A grey car silhouette — a “photos coming soon” graphic'])
      if ((info.borderWhite || 0) >= 0.9 && (info.whiteRatio || 0) >= 0.35 && (info.colorfulness || 0) >= 14 && !P.length) S.push([0.5, 'Car on a plain white background — looks like a studio / stock render'])
    }
    else if (info && !info.ok) R.push([0.5, `Couldn’t download the photo to check it (${info.error})`])
    if (v.backdropId) S.push([0.93, `The same background stands behind ${backdropCars} different cars — a stock image placed on a generic backdrop, not a photo of this car`])
    // A plain studio background alone proves nothing (a photo booth looks like that too): it asks for a look.
    else if (!P.length && !S.length && plainStudio(info)) S.push([0.45, 'Car on a plain studio background — may be a stock render'])
    if (cluster) {
      // (a group from an older scan — coarse hashes only — is a hint, not proof: it asks for a look instead of deciding)
      const sure = cluster.exact === false ? 0.5 : 1
      if (cluster.vehicles >= 3 && cluster.models >= 2) P.push([0.9 * sure, `The same picture is used on ${cluster.vehicles} different vehicles`])
      else if (cluster.models <= 1) S.push([(cluster.vehicles >= 3 ? 0.85 : 0.75) * sure, `The same photo is used on ${cluster.vehicles} different ${short(cluster.modelNames[0] || 'vehicles', 30)}${cluster.modelNames[0] ? 's' : ''} — a real photo belongs to one car`])
      else P.push([0.7 * sure, `The same picture is used on ${cluster.vehicles} vehicles`])
    }

    const p = combine(P.map(x => x[0])), s = combine(S.map(x => x[0]))
    if (p === 0 && s === 0) {
      if (R.length) { v.verdict = 'review'; v.suggested = 'real'; v.confidence = 0.5; v.reasons = R.map(x => x[1]); continue }
      decide('real', info?.ok ? 0.9 : 0.7, [info?.ok ? 'A unique photo with normal detail and colour' : 'Photo present (not downloaded for checking)'])
      continue
    }
    const top: 'placeholder' | 'stock' = p >= s ? 'placeholder' : 'stock'
    const score = Math.max(p, s)
    const reasons = (top === 'placeholder' ? [...P, ...S] : [...S, ...P]).sort((a, b) => b[0] - a[0]).map(x => x[1])
    if (score >= 0.7) decide(top, Math.round(score * 100) / 100, reasons)
    else { v.verdict = 'review'; v.suggested = score >= 0.5 ? top : 'real'; v.confidence = Math.round(score * 100) / 100; v.reasons = reasons }
  }

  // When most of a site's photos measure as blurry it is not this car's photo that is bad: the list
  // itself shows small, soft pictures. That is not reported car by car (a person can still mark them).
  let softSite = 0
  const photos = vehicles.filter(v => v.verdict === 'real' || v.verdict === 'blurry').length
  if (measured.length >= 8 && measured.length > photos * 0.5) {
    softSite = measured.length
    for (const v of measured) { v.verdict = 'real'; v.suggested = 'real'; v.confidence = 0.7; v.reasons = ['A real photo — every picture in this list is small / soft, so blur is not judged car by car', ...v.reasons.slice(1)] }
  }

  // Cluster verdict = what its vehicles mostly got.
  for (const c of clusters) {
    const vs = vehicles.filter(v => v.clusterId === c.id)
    const counts: Record<string, number> = {}
    for (const v of vs) counts[v.verdict] = (counts[v.verdict] || 0) + 1
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    c.verdict = (top?.[0] || 'review') as PhotoVerdict
    c.reason = vs[0]?.reasons.find(r => /same (picture|photo)/i.test(r)) || vs[0]?.reasons[0] || ''
  }
  return { clusters, ruleHits, softSite, backdrops: [...onBackdrop.entries()].filter(([, n]) => n >= 4).map(([id, n]) => ({ id, vehicles: n })) }
}

/** The verdict that counts: a person's override, else the scanner's decision (best guess for "review"). */
export const finalVerdict = (v: ScanVehicle, clusters?: Map<string, ImageCluster>): Exclude<PhotoVerdict, 'review'> =>
  v.override || (v.clusterId && clusters?.get(v.clusterId)?.override) || (v.verdict === 'review' ? v.suggested : v.verdict)

export function summarize(all: ScanVehicle[], clusters: ImageCluster[], opts: { countStockAsMissing: boolean }) {
  const cmap = new Map(clusters.map(c => [c.id, c]))
  const vehicles = countable(all)
  const ads = all.length - vehicles.length
  const by = { real: 0, placeholder: 0, stock: 0, missing: 0, blurry: 0 }
  const isNew = (v: ScanVehicle) => v.condition === 'new'
  const counts = { newTotal: 0, usedTotal: 0, newMissingPhotos: 0, usedMissingPhotos: 0 }
  for (const v of vehicles) {
    const f = finalVerdict(v, cmap)
    by[f]++
    const noReal = f === 'missing' || f === 'placeholder' || (opts.countStockAsMissing && f === 'stock')
    if (isNew(v)) { counts.newTotal++; if (noReal) counts.newMissingPhotos++ }
    else { counts.usedTotal++; if (noReal) counts.usedMissingPhotos++ }
  }
  const total = vehicles.length
  const withoutReal = by.missing + by.placeholder + (opts.countStockAsMissing ? by.stock : 0)
  return {
    total, by, withoutReal, ads,
    /** Real photos that are blurry — reported on their own, never part of `withoutReal`. */
    blurry: by.blurry,
    blurryPct: total ? Math.round((by.blurry / total) * 1000) / 10 : null,
    withoutRealPct: total ? Math.round((withoutReal / total) * 1000) / 10 : null,
    review: vehicles.filter(v => v.verdict === 'review' && !v.override && !(v.clusterId && cmap.get(v.clusterId)?.override)).length,
    counts,
    newPct: counts.newTotal ? Math.round((counts.newMissingPhotos / counts.newTotal) * 1000) / 10 : null,
    usedPct: counts.usedTotal ? Math.round((counts.usedMissingPhotos / counts.usedTotal) * 1000) / 10 : null,
  }
}
