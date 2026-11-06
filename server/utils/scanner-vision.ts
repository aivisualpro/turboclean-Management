/**
 * Inventory Scanner — AI photo check (Claude or Gemini vision).
 *
 * After the photos are downloaded and measured, the AI looks at a small copy of every main photo
 * together with what the listing card says (title, price, stock #, VIN, link) and answers:
 *   - what the photo is: a real photo of the car, a placeholder ("photos coming soon", silhouettes,
 *     logos, blanks) or a stock / studio image — it reads text on the picture too;
 *   - whether the card is a vehicle at all — promo tiles mixed into the grid ("Get pre-approved",
 *     "Value your trade", specials banners) are advertisements and are left out of every count.
 *
 * Provider: Claude when ANTHROPIC_API_KEY is set (most capable model first — claude-fable-5-1, then
 * claude-opus-5-5, then claude-sonnet-5-5), else Gemini. SCANNER_VISION_PROVIDER=anthropic|gemini forces one.
 *
 * - Answers are cached by image fingerprint (turboCleanScannerVisionCache) per provider: the same
 *   picture on the next crawl — any dealership — costs nothing and takes no time.
 * - Your rules and your own corrections still win (and are cached as the answer for that picture).
 * - No key, a timeout or an outage → the built-in checks decide, nothing breaks.
 */
import type { Db } from 'mongodb'
import type { ImageInfo, ScanVehicle } from './scanner-images'

export const VISION_CACHE = 'turboCleanScannerVisionCache'
export interface VisionVerdict { v: 'real' | 'placeholder' | 'stock', c: number, why: string, text: string, model: string, ad?: boolean, adWhy?: string, cached?: boolean }

const SYSTEM = `You audit vehicle listings on US car-dealer websites for a reconditioning / photo company. Each item is one card from the dealer's inventory grid: the main image plus what the card says. For each item decide two things.

1. "ad" — is this card an advertisement / promo tile rather than a vehicle for sale? Dealers mix banners into the grid: "Get pre-approved", "Value your trade", "Shop online", specials, lease offers, financing, service coupons, "Sell us your car", dealer awards, "Can't find what you want?", "Schedule a test drive" tiles, brand / model-line promos without a specific vehicle. A real listing is ONE specific vehicle: usually a year + make + model and some of: price, stock #, VIN, mileage, a link to its detail page. When in doubt and the card has a VIN or stock #, it is NOT an ad.

2. "v" — what the image is (for ads still answer, it is ignored):
- "real": an actual photograph of the specific vehicle (on the lot, in a showroom, outdoors, in a photo booth / turntable). Dealer banners, frames, borders, logos, price stickers or watermarks over a real photo still count as real.
- "placeholder": NOT a photo of the car — "photos coming soon" / "image not available" / "more photos soon" graphics, grey or white car silhouettes or outline drawings (even with a brand logo or the model name), dealer logo or storefront only, blank / solid colour, a generic illustration.
- "stock": manufacturer or stock-library imagery — a studio render or press photo of the model on a plain white / grey / gradient background, CGI, a colour-swatch render, the car with no real surroundings (often a different colour or trim than the listing).

Be decisive and precise. "c" = confidence 0–1 in "v". "t" = text readable on the image (max 60 chars, "" if none). "why" ≤ 8 words. "adWhy" ≤ 8 words, only when ad is true.`

type Provider = 'anthropic' | 'gemini'
async function pickProvider(): Promise<Provider | null> {
  const ai = await import('./automation-ai')
  const forced = String(process.env.SCANNER_VISION_PROVIDER || '').toLowerCase()
  if (String(process.env.SCANNER_AI || '').toLowerCase() === 'off') return null
  if ((forced === 'anthropic' || forced === 'claude') && ai.claudeVisionConfigured()) return 'anthropic'
  if (forced === 'gemini' && ai.visionConfigured()) return 'gemini'
  if (ai.claudeVisionConfigured()) return 'anthropic'
  if (ai.visionConfigured()) return 'gemini'
  return null
}

const cacheKey = (i: ImageInfo) => (i.hash2 ? `${i.hash}:${i.hash2}` : '') || ''
/** Cache entries are per provider (+ "you" corrections, which always count). */
const docId = (k: string, p: Provider | 'you') => `${p}|${k}`

async function readCache(db: Db | null, imgs: ImageInfo[], provider: Provider | null) {
  const out = new Map<string, VisionVerdict>()
  if (!db) return out
  const keys = [...new Set(imgs.map(cacheKey).filter(Boolean))]
  if (!keys.length) return out
  try {
    const ids = keys.flatMap(k => [docId(k, 'you'), ...(provider ? [docId(k, provider)] : [])])
    const rows = await db.collection(VISION_CACHE).find({ _id: { $in: ids } as any }).toArray()
    // "you" first so a person's correction beats the AI's earlier answer.
    rows.sort((a: any, b: any) => (String(a._id).startsWith('you|') ? 0 : 1) - (String(b._id).startsWith('you|') ? 0 : 1))
    for (const r of rows as any[]) {
      const k = String(r._id).split('|').slice(1).join('|')
      if (out.has(k) || !['real', 'placeholder', 'stock'].includes(r.v)) continue
      out.set(k, { v: r.v, c: Number(r.c) || 0.8, why: r.why || '', text: r.text || '', model: r.model || '', ad: typeof r.ad === 'boolean' ? r.ad : undefined, adWhy: r.adWhy || '', cached: true })
    }
  } catch {}
  return out
}
async function writeCache(db: Db | null, img: ImageInfo, v: VisionVerdict, p: Provider | 'you') {
  const k = cacheKey(img)
  if (!db || !k) return
  const set: any = { v: v.v, c: v.c, why: v.why, text: v.text, model: v.model, url: img.url, at: new Date().toISOString() }
  if (typeof v.ad === 'boolean') { set.ad = v.ad; set.adWhy = v.adWhy || '' }
  await db.collection(VISION_CACHE).updateOne({ _id: docId(k, p) as any }, { $set: set }, { upsert: true }).catch(() => {})
}

/** What the card says, as the AI sees it next to the picture. */
function cardLine(v: ScanVehicle | undefined) {
  if (!v) return 'card: (no text)'
  const bits = [v.title && `title "${v.title.slice(0, 90)}"`, v.price && `price ${v.price}`, v.stock && `stock #${v.stock}`, v.vin && `VIN ${v.vin}`, v.condition, v.url && `link ${v.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 80)}`, v.cardText && `text "${v.cardText.slice(0, 160)}"`].filter(Boolean)
  return `card: ${bits.join(' · ') || '(no text)'}`
}

/**
 * Give every image with a thumbnail an `ai` verdict (photo kind + ad or not). Returns counts.
 * `deadline` (epoch ms) bounds the whole step; whatever isn't answered keeps the built-in verdict.
 */
export async function visionCheck(db: Db | null, images: ImageInfo[], vehicles: ScanVehicle[], o: { log: (s: string) => void, deadline: number, onProgress?: (done: number, total: number) => void }) {
  const ai = await import('./automation-ai')
  const provider = await pickProvider()
  const todo = images.filter(i => i.ok && !i.ai && ((i as any).thumb || cacheKey(i)))
  if (!todo.length) return { checked: 0, cached: 0, failed: 0 }
  const cache = await readCache(db, todo, provider)
  let cached = 0
  for (const i of todo) { const hit = cache.get(cacheKey(i)); if (hit) { i.ai = hit; cached++ } }
  const ask = todo.filter(i => !i.ai && (i as any).thumb)
  if (!ask.length || !provider) {
    if (ask.length) o.log('AI photo check is off (no ANTHROPIC_API_KEY or GOOGLE_GEMINI_API_KEY) — using the built-in checks')
    else if (cached) o.log(`AI photo check: all ${cached} photos already known — no AI call needed`)
    return { checked: 0, cached, failed: 0 }
  }
  const byImage = new Map<string, ScanVehicle>()
  for (const v of vehicles) if (v.imageId && !byImage.has(v.imageId)) byImage.set(v.imageId, v)
  const name = provider === 'anthropic' ? `Claude (${ai.claudeVisionModels()[0]})` : `Gemini (${ai.visionModel()})`
  o.log(`AI photo check: ${name} is looking at ${ask.length} listing${ask.length === 1 ? '' : 's'}${cached ? ` (${cached} already known)` : ''}…`)
  const BATCH = provider === 'anthropic' ? 10 : 16
  const PARALLEL = provider === 'anthropic' ? 6 : 4
  const batches: ImageInfo[][] = []
  for (let k = 0; k < ask.length; k += BATCH) batches.push(ask.slice(k, k + BATCH))
  let done = 0, failed = 0, firstError = '', model = ''
  const worker = async () => {
    while (batches.length) {
      const batch = batches.shift()!
      const left = o.deadline - Date.now()
      if (left < 10_000) { failed += batch.length; continue }
      try {
        const req = {
          system: SYSTEM,
          prompt: `There are ${batch.length} items, labelled "Item 1" to "Item ${batch.length}", each followed by its image. Answer ONLY with JSON: {"items":[{"i":1,"ad":false,"adWhy":"","v":"real|placeholder|stock","c":0.95,"t":"","why":""}, …]} — one entry per item, in order.`,
          images: batch.map((im, k) => ({ label: `Item ${k + 1} — ${cardLine(byImage.get(im.id))}`, mime: 'image/jpeg', b64: (im as any).thumb as string })),
          maxTokens: provider === 'anthropic' ? 6000 + 150 * batch.length : 150 * batch.length + 400,
          timeoutMs: Math.min(provider === 'anthropic' ? 120_000 : 45_000, left - 2_000),
          purpose: 'scanner-photos',
        }
        const r = provider === 'anthropic' ? await ai.askClaudeVision(req) : await ai.askGeminiVision(req)
        model ||= r.model
        const items: any[] = Array.isArray(r.data?.items) ? r.data.items : []
        for (const it of items) {
          const im = batch[(Number(it?.i) || 0) - 1]
          const v = String(it?.v || '').toLowerCase()
          if (!im || !['real', 'placeholder', 'stock'].includes(v)) continue
          const verdict: VisionVerdict = { v: v as any, c: Math.max(0, Math.min(1, Number(it?.c) || 0.7)), why: String(it?.why || '').slice(0, 80), text: String(it?.t || '').slice(0, 80), model: r.model, ad: it?.ad === true, adWhy: String(it?.adWhy || '').slice(0, 80) }
          im.ai = verdict
          await writeCache(db, im, verdict, provider)
        }
        failed += batch.filter(im => !im.ai).length
      }
      catch (e: any) { failed += batch.length; firstError ||= String(e?.message || e).slice(0, 160) }
      done += batch.length
      o.onProgress?.(done, ask.length)
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, () => worker()))
  const ok = ask.length - failed
  const ads = ask.filter(i => i.ai?.ad).length
  o.log(`AI photo check: ${ok} of ${ask.length} judged by ${model || name}${ads ? ` · ${ads} advertisement${ads === 1 ? '' : 's'} found in the grid` : ''}${failed ? ` · ${failed} kept the built-in verdict${firstError ? ` (${firstError})` : ''}` : ''}`)
  return { checked: ok, cached, failed }
}

/** A person corrected a photo (or said "this is / isn't an ad"): cached as the answer for that picture on every future crawl. */
export async function teachVision(db: Db, img: ImageInfo, verdict: 'real' | 'placeholder' | 'stock' | 'missing' | null, ad?: boolean) {
  const prev = img.ai
  const v = verdict ? (verdict === 'missing' ? 'placeholder' : verdict) : (prev?.v || 'real')
  await writeCache(db, img, { v, c: 1, why: 'Corrected by you', text: prev?.text || '', model: 'you', ad: typeof ad === 'boolean' ? ad : prev?.ad, adWhy: ad ? 'Marked as an ad by you' : '' }, 'you')
}
