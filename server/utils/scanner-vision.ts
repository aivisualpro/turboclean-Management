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
export interface VisionVerdict { v: 'real' | 'placeholder' | 'stock', c: number, why: string, text: string, model: string, ad?: boolean, adWhy?: string, cached?: boolean, /** A real photo that is out of focus / smeared. */ blur?: boolean }

const SYSTEM = `You audit vehicle listings on US car-dealer websites for a company that sells dealerships real photography of their inventory. Each item is one card from the dealer's inventory grid: the main image plus what the card says. The question behind every item: did the dealer photograph THIS vehicle, or is the listing still waiting for real photos? Decide three things.

1. "ad" — is this card an advertisement / promo tile rather than a vehicle for sale? Dealers mix banners into the grid: "Get pre-approved", "Value your trade", "Shop online", specials, lease offers, financing, service coupons, "Sell us your car", dealer awards, "Can't find what you want?", "Schedule a test drive" tiles, brand / model-line promos without a specific vehicle. A real listing is ONE specific vehicle: usually a year + make + model and some of: price, stock #, VIN, mileage, a link to its detail page. When in doubt and the card has a VIN or stock #, it is NOT an ad.

2. "v" — what the image is (for ads still answer, it is ignored):
- "real": a photograph the dealer took of this specific vehicle. Signs: the dealer's lot, service lane, showroom or photo booth around it; other inventory, light poles, kerbs, buildings behind it; a dealer plate insert or plate frame; a window sticker, stock tag or hang tag; ordinary daylight, reflections of the surroundings in the paint, imperfect framing. Dealer banners, frames, borders, logos, price stickers or watermarks over a real photo still count as real.
- "stock": NOT a photo of this vehicle — manufacturer or stock-library imagery standing in for it:
  · a studio render or press shot on a plain white / grey / gradient background (often a soft shadow or a turntable ring under the car, flawless even lighting, no surroundings);
  · a rendered car placed on a generic background — a brand showroom or dealership façade under a perfect sky, an empty lot — especially when the note says the same background is behind many other listings;
  · a manufacturer press photo: a scenic or staged location (coast, mountain road, city street, desert, studio set), cinematic light, motion blur, no dealer context, a blank or brand-name plate, often another colour or trim than the listing;
  · a brochure-style interior shot used as the main image (spotless, studio-lit, no wear, no dealer tags).
  A used car from years ago shown in a flawless brochure picture is stock.
- "placeholder": not a picture of a car at all — "photos coming soon" / "image not available" graphics, grey or white car silhouettes or outline drawings (even with a brand logo or the model name), a dealer logo or storefront only, blank / solid colour, a generic illustration.

3. "blur" — only for "real": true when the photograph itself is clearly out of focus, motion-blurred, smeared, or a tiny picture blown up, so the vehicle's details cannot be made out. false for a normally sharp photo. A soft background, reflections, rain, a night shot, a dealer banner or ordinary image compression are NOT blur.

Use the note after each card when there is one: it states facts measured across the whole inventory (for example how many other listings show the very same background). Be decisive and precise. "c" = confidence 0–1 in "v" (use ≥ 0.85 only when the signs are clear; 0.5–0.7 when it could be either). "t" = text readable on the image (max 60 chars, "" if none). "why" ≤ 8 words. "adWhy" ≤ 8 words, only when ad is true.`

type Provider = 'anthropic' | 'gemini'
// The AI photo check is part of the scanner: it runs whenever an AI key is on the server. (An old
// SCANNER_AI=off setting used to switch it off silently and left every verdict to the built-in checks —
// it is no longer read.)
async function pickProvider(): Promise<Provider | null> {
  const ai = await import('./automation-ai')
  const forced = String(process.env.SCANNER_VISION_PROVIDER || '').toLowerCase()
  if ((forced === 'anthropic' || forced === 'claude') && ai.claudeVisionConfigured()) return 'anthropic'
  if (forced === 'gemini' && ai.visionConfigured()) return 'gemini'
  if (ai.claudeVisionConfigured()) return 'anthropic'
  if (ai.visionConfigured()) return 'gemini'
  return null
}

/**
 * Is the AI photo check running on this server — and if not, why (shown in the scanner, so a switched-off
 * check is never a silent reason for weaker verdicts)? No secret is read out: only which setting is missing.
 */
export async function photoCheckStatus(): Promise<{ on: boolean, provider: Provider | null, label: string, reason: string, fix: string }> {
  const ai = await import('./automation-ai')
  const provider = await pickProvider()
  if (provider) return { on: true, provider, label: provider === 'anthropic' ? `Claude (${ai.claudeVisionModels()[0]})` : `Gemini (${ai.visionModel()})`, reason: '', fix: '' }
  return { on: false, provider: null, label: 'Off', reason: 'The AI photo check has no AI key on this server.', fix: 'Add ANTHROPIC_API_KEY (Claude) or GOOGLE_GEMINI_API_KEY to the server environment (Vercel → Settings → Environment Variables), then redeploy.' }
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
      out.set(k, { v: r.v, c: Number(r.c) || 0.8, why: r.why || '', text: r.text || '', model: r.model || '', ad: typeof r.ad === 'boolean' ? r.ad : undefined, adWhy: r.adWhy || '', blur: typeof r.blur === 'boolean' ? r.blur : undefined, cached: true })
    }
  } catch {}
  return out
}
async function writeCache(db: Db | null, img: ImageInfo, v: VisionVerdict, p: Provider | 'you') {
  const k = cacheKey(img)
  if (!db || !k) return
  const set: any = { v: v.v, c: v.c, why: v.why, text: v.text, model: v.model, url: img.url, at: new Date().toISOString() }
  if (typeof v.ad === 'boolean') { set.ad = v.ad; set.adWhy = v.adWhy || '' }
  if (typeof v.blur === 'boolean') set.blur = v.blur
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
export async function visionCheck(db: Db | null, images: ImageInfo[], vehicles: ScanVehicle[], o: { log: (s: string) => void, deadline: number, onProgress?: (done: number, total: number) => void, /** Facts measured across the inventory, per image id — shown to the AI next to the card. */ notes?: Map<string, string> }) {
  const ai = await import('./automation-ai')
  const provider = await pickProvider()
  const todo = images.filter(i => i.ok && !i.ai && ((i as any).thumb || cacheKey(i)))
  const state = (extra: { checked: number, cached: number, failed: number }) => ({ ...extra, provider, off: provider ? '' : 'no-key' })
  if (!todo.length) return state({ checked: 0, cached: 0, failed: 0 })
  const cache = await readCache(db, todo, provider)
  let cached = 0
  for (const i of todo) { const hit = cache.get(cacheKey(i)); if (hit) { i.ai = hit; cached++ } }
  const ask = todo.filter(i => !i.ai && (i as any).thumb)
  if (!ask.length || !provider) {
    if (ask.length) o.log('AI photo check is off (no ANTHROPIC_API_KEY or GOOGLE_GEMINI_API_KEY on this server) — photos are judged by the built-in checks only')
    else if (cached) o.log(`AI photo check: all ${cached} photos already known — no AI call needed`)
    return state({ checked: 0, cached, failed: ask.length && !provider ? ask.length : 0 })
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
          prompt: `There are ${batch.length} items, labelled "Item 1" to "Item ${batch.length}", each followed by its image. Answer ONLY with JSON: {"items":[{"i":1,"ad":false,"adWhy":"","v":"real|placeholder|stock","blur":false,"c":0.95,"t":"","why":""}, …]} — one entry per item, in order.`,
          images: batch.map((im, k) => ({ label: `Item ${k + 1} — ${cardLine(byImage.get(im.id))}${o.notes?.get(im.id) ? ` · note: ${o.notes.get(im.id)}` : ''}`, mime: 'image/jpeg', b64: (im as any).thumb as string })),
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
          const verdict: VisionVerdict = { v: v as any, c: Math.max(0, Math.min(1, Number(it?.c) || 0.7)), why: String(it?.why || '').slice(0, 80), text: String(it?.t || '').slice(0, 80), model: r.model, ad: it?.ad === true, adWhy: String(it?.adWhy || '').slice(0, 80), blur: v === 'real' ? it?.blur === true : undefined }
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
  return state({ checked: ok, cached, failed })
}

/** A person corrected a photo (or said "this is / isn't an ad"): cached as the answer for that picture on every future crawl. */
export async function teachVision(db: Db, img: ImageInfo, verdict: 'real' | 'placeholder' | 'stock' | 'missing' | 'blurry' | null, ad?: boolean) {
  const prev = img.ai
  // "Blurry" is a real photo that is blurry; "Real" says it is sharp enough.
  const v = verdict ? (verdict === 'missing' ? 'placeholder' : verdict === 'blurry' ? 'real' : verdict) : (prev?.v || 'real')
  const blur = verdict === 'blurry' ? true : verdict === 'real' ? false : (verdict ? undefined : prev?.blur)
  await writeCache(db, img, { v, c: 1, why: 'Corrected by you', text: prev?.text || '', model: 'you', ad: typeof ad === 'boolean' ? ad : prev?.ad, adWhy: ad ? 'Marked as an ad by you' : '', blur }, 'you')
}

/** A person took a correction back: the remembered answer for those pictures goes too (the scanner judges them itself again). */
export async function forgetTeaching(db: Db, imgs: ImageInfo[]) {
  const ids = [...new Set(imgs.map(cacheKey).filter(Boolean))].map(k => docId(k, 'you'))
  if (ids.length) await db.collection(VISION_CACHE).deleteMany({ _id: { $in: ids } as any }).catch(() => {})
}
