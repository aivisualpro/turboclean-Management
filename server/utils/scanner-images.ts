/**
 * Inventory Scanner — photo verdicts.
 *
 * Every vehicle's main photo gets one verdict:
 *   real         a live photo of that vehicle
 *   placeholder  "Photos coming soon" / "Vehicle photos unavailable" / blank / spacer images
 *   stock        manufacturer or stock-library images (EVOX, Chrome Data, izmo…), or one photo reused
 *                across several different vehicles of the same model
 *   missing      no photo at all, or the photo link is broken
 *   review       signals disagree — the scanner's best guess is kept in `suggested`
 *
 * Evidence (each with a plain-English reason shown in the UI):
 *  - duplicates: perceptual hash (dHash) clusters — a real photo belongs to one VIN, so the same
 *    picture on many cars is a placeholder (different models) or a stock image (same model)
 *  - what the image says: on-image text read with the browser's Shape Detection API (OCR)
 *  - file name / image host (coming-soon.jpg, evox, chromedata…), alt text, card wording
 *  - how it looks: mostly blank & colourless, or a car on a pure white studio background
 *  - your saved rules: "always treat this image as …" (learned across every dealership)
 */
import type { Db } from 'mongodb'
import { ObjectId } from 'mongodb'
import type { SessionActor } from './crm'

export type PhotoVerdict = 'real' | 'placeholder' | 'stock' | 'missing' | 'review'
/** A placeholder image ("Vehicle photos unavailable", "coming soon") means the car has no photo — same label. */
export const VERDICT_LABEL: Record<PhotoVerdict, string> = { real: 'Real photo', placeholder: 'No photo', stock: 'Stock image', missing: 'No photo', review: 'Needs review' }

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
  whiteRatio?: number
  grayRatio?: number
  colorfulness?: number
  edgeDensity?: number
  borderWhite?: number
  uniqueColors?: number
  text?: string
  ocr?: boolean
  /** Gemini's look at the photo (cached by fingerprint). */
  ai?: { v: 'real' | 'placeholder' | 'stock', c: number, why: string, text: string, model: string, ad?: boolean, adWhy?: string, cached?: boolean }
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
}
/** Is this card an advertisement (not part of the inventory)? A person's call wins. */
export const isAd = (v: ScanVehicle) => v.listing ? v.listing === 'ad' : !!v.adReason
/** The vehicles that count (ads left out). */
export const countable = (vs: ScanVehicle[]) => vs.filter(v => !isAd(v))
const AD_TEXT = /pre-?approv|value your trade|trade[- ]in value|get approved|apply (now|online)|financ|special offers?|lease (special|offer|deal)|sell (us )?your (car|vehicle)|we buy cars|schedule (a )?(test drive|service)|service (special|coupon)|coupon|rebate|shop online|can.t find|not finding|sign up|subscribe|gift card|award|why buy|learn more|explore (the|our)|build (&|and) price|view (all )?specials/i
/** Built-in ad check: no VIN, no stock #, no year and no price — or promo wording without a VIN / stock #. */
export function adSignal(v: ScanVehicle): string | null {
  if (v.vin || v.stock) return null
  // Promo wording in the card's TITLE (button text like "Get financing" sits on real cards too, so the body is not used).
  const m = (v.title || '').match(AD_TEXT) || (v.title || '').match(/\b(lease|special|event|offer|sale|deal)s?\b/i)
  if (m) return `Promo tile (“${short(v.title, 50)}”) — no VIN or stock #`
  if (!v.year && !v.price) return 'No year, price, VIN or stock # — looks like a banner, not a vehicle'
  return null
}
export interface ImageCluster { id: string, imageIds: string[], hash: string, hash2?: string, vehicles: number, models: number, modelNames: string[], thumb: string, url: string, verdict: PhotoVerdict, reason: string, override: Exclude<PhotoVerdict, 'review'> | null }

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
/** Same picture even if resized/re-encoded. */
export const SAME_IMAGE_DISTANCE = 5
/** Detail-hash distance (of 256 bits) below which two pictures are the same photo. Different cars in the same frame are ~80–130 apart. */
export const SAME_DETAIL_DISTANCE = 40
/**
 * Same picture? The coarse 64-bit hash must match AND — when both images have one — the 256-bit
 * detail hash of the centre too. The coarse hash alone confuses different cars shot in the same
 * spot with the same dealer banner (e.g. HomeNet frames), which made real photos look like placeholders.
 */
export function samePicture(a: { hash?: string, hash2?: string } | undefined, b: { hash?: string, hash2?: string } | undefined) {
  if (!a?.hash || !b?.hash) return false
  if (hamming(a.hash, b.hash) > SAME_IMAGE_DISTANCE) return false
  if (a.hash2 && b.hash2 && a.hash2.length === b.hash2.length) return hamming(a.hash2, b.hash2) <= SAME_DETAIL_DISTANCE
  return true
}

export interface ImageRule { id: string, hash: string, hash2?: string, urlContains: string, verdict: Exclude<PhotoVerdict, 'review'>, label: string, thumb: string, hits: number, createdAt: string, createdBy: { id: string, name: string } | null }
export async function listRules(db: Db): Promise<ImageRule[]> {
  const rows = await db.collection(RULES_COLLECTION).find({}).sort({ createdAt: -1 }).limit(500).toArray()
  return rows.map(({ _id, ...r }) => ({ id: _id.toString(), ...r } as any))
}
export async function saveRule(db: Db, body: { hash?: string, hash2?: string, urlContains?: string, verdict: string, label?: string, thumb?: string }, actor: SessionActor | null) {
  const verdict = (['real', 'placeholder', 'stock', 'missing'].includes(body.verdict) ? body.verdict : null) as ImageRule['verdict'] | null
  if (!verdict) throw createError({ statusCode: 400, statusMessage: 'Pick what this image is' })
  const hash = /^[0-9a-f]{16}$/i.test(String(body.hash || '')) ? String(body.hash).toLowerCase() : ''
  const hash2 = hash && /^[0-9a-f]{64}$/i.test(String(body.hash2 || '')) ? String(body.hash2).toLowerCase() : ''
  const urlContains = String(body.urlContains || '').trim().slice(0, 200)
  if (!hash && !urlContains) throw createError({ statusCode: 400, statusMessage: 'A rule needs an image or a piece of the image address' })
  const col = db.collection(RULES_COLLECTION)
  const existing = hash ? await col.findOne(hash2 ? { hash, hash2 } : { hash, hash2: { $in: ['', null] } }) : await col.findOne({ urlContains })
  const doc = { hash, hash2, urlContains, verdict, label: String(body.label || '').slice(0, 120) || (verdict === 'real' ? 'Real photo' : verdict === 'stock' ? 'Stock image' : 'Placeholder image'), thumb: /^https?:\/\//i.test(String(body.thumb || '')) ? String(body.thumb).slice(0, 2000) : '', updatedAt: new Date().toISOString() }
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

/** Group images that are the same picture (exact URL or perceptual-hash match). */
export function buildClusters(vehicles: ScanVehicle[], images: Map<string, ImageInfo>): ImageCluster[] {
  const ids = [...images.keys()]
  const parent = new Map(ids.map(id => [id, id]))
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r }
  // Spacers and flat blanks all hash alike — they are judged on their own, not grouped.
  const bits = (h: string) => [...h].reduce((n, c) => n + Number.parseInt(c, 16).toString(2).replace(/0/g, '').length, 0)
  const hashed = ids.filter((id) => {
    const i = images.get(id)
    if (!i?.hash || (i.w || 0) < 80 || (i.h || 0) < 60) return false
    const b = bits(i.hash)
    return b >= 4 && b <= 60
  })
  for (let i = 0; i < hashed.length; i++) {
    for (let j = i + 1; j < hashed.length; j++) {
      const a = images.get(hashed[i]!)!, b = images.get(hashed[j]!)!
      if (samePicture(a, b)) parent.set(find(hashed[i]!), find(hashed[j]!))
    }
  }
  const groups = new Map<string, string[]>()
  for (const id of ids) { const r = find(id); groups.set(r, [...(groups.get(r) || []), id]) }
  const clusters: ImageCluster[] = []
  let n = 0
  for (const imgIds of groups.values()) {
    const vs = vehicles.filter(v => v.imageId && imgIds.includes(v.imageId))
    if (vs.length < 2) continue
    const models = [...new Set(vs.map(modelKey).filter(Boolean))]
    const first = images.get(imgIds[0]!)!
    clusters.push({ id: `c${++n}`, imageIds: imgIds, hash: first.hash || '', hash2: first.hash2 || '', vehicles: vs.length, models: models.length, modelNames: [...new Set(vs.map(v => `${v.make} ${v.model}`.trim() || modelKey(v)))].slice(0, 6), thumb: first.url, url: first.url, verdict: 'review', reason: '', override: null })
  }
  return clusters.sort((a, b) => b.vehicles - a.vehicles)
}

/** Noisy-OR: independent pieces of evidence add up without exceeding 1. */
const combine = (xs: number[]) => 1 - xs.reduce((p, x) => p * (1 - x), 1)

export function classify(vehicles: ScanVehicle[], images: Map<string, ImageInfo>, rules: ImageRule[]) {
  const clusters = buildClusters(vehicles, images)
  const clusterOf = new Map<string, ImageCluster>()
  for (const c of clusters) for (const id of c.imageIds) clusterOf.set(id, c)
  const ruleHits = new Map<string, number>()

  for (const v of vehicles) {
    const P: [number, string][] = []
    const S: [number, string][] = []
    const R: [number, string][] = []
    const img = v.image
    const info = v.imageId ? images.get(v.imageId) : undefined
    const cluster = v.imageId ? clusterOf.get(v.imageId) : undefined
    v.clusterId = cluster?.id || null
    v.reasons = []
    // Advertisement / promo tile in the grid? The AI's call (it sees picture + card) first, else the built-in check.
    const aiAd = info?.ok && typeof info.ai?.ad === 'boolean' ? info.ai : null
    v.adReason = aiAd ? (aiAd.ad && !(v.vin && v.stock) ? `AI check: advertisement, not a vehicle${aiAd.adWhy ? ` — ${short(aiAd.adWhy, 60)}` : ''}` : null) : adSignal(v)
    const decide = (verdict: Exclude<PhotoVerdict, 'review'>, confidence: number, reasons: string[]) => { v.verdict = verdict; v.suggested = verdict; v.confidence = confidence; v.reasons = reasons }

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
    const reliableDup = !!cluster && (!!info?.hash2 || (cluster.vehicles >= 3 && cluster.models >= 2))
    if (ai && ai.c >= 0.75 && !(ai.v === 'real' && reliableDup)) {
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
    if (cluster) {
      if (cluster.vehicles >= 3 && cluster.models >= 2) P.push([0.9, `The same picture is used on ${cluster.vehicles} different vehicles`])
      else if (cluster.models <= 1) S.push([cluster.vehicles >= 3 ? 0.85 : 0.75, `The same photo is used on ${cluster.vehicles} different ${short(cluster.modelNames[0] || 'vehicles', 30)}${cluster.modelNames[0] ? 's' : ''} — a real photo belongs to one car`])
      else P.push([0.7, `The same picture is used on ${cluster.vehicles} vehicles`])
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

  // Cluster verdict = what its vehicles mostly got.
  for (const c of clusters) {
    const vs = vehicles.filter(v => v.clusterId === c.id)
    const counts: Record<string, number> = {}
    for (const v of vs) counts[v.verdict] = (counts[v.verdict] || 0) + 1
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    c.verdict = (top?.[0] || 'review') as PhotoVerdict
    c.reason = vs[0]?.reasons.find(r => /same (picture|photo)/i.test(r)) || vs[0]?.reasons[0] || ''
  }
  return { clusters, ruleHits }
}

/** The verdict that counts: a person's override, else the scanner's decision (best guess for "review"). */
export const finalVerdict = (v: ScanVehicle, clusters?: Map<string, ImageCluster>): Exclude<PhotoVerdict, 'review'> =>
  v.override || (v.clusterId && clusters?.get(v.clusterId)?.override) || (v.verdict === 'review' ? v.suggested : v.verdict)

export function summarize(all: ScanVehicle[], clusters: ImageCluster[], opts: { countStockAsMissing: boolean }) {
  const cmap = new Map(clusters.map(c => [c.id, c]))
  const vehicles = countable(all)
  const ads = all.length - vehicles.length
  const by = { real: 0, placeholder: 0, stock: 0, missing: 0 }
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
    withoutRealPct: total ? Math.round((withoutReal / total) * 1000) / 10 : null,
    review: vehicles.filter(v => v.verdict === 'review' && !v.override && !(v.clusterId && cmap.get(v.clusterId)?.override)).length,
    counts,
    newPct: counts.newTotal ? Math.round((counts.newMissingPhotos / counts.newTotal) * 1000) / 10 : null,
    usedPct: counts.usedTotal ? Math.round((counts.usedMissingPhotos / counts.usedTotal) * 1000) / 10 : null,
  }
}
