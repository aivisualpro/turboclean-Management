/**
 * Inventory Scanner — AI photo check (Gemini vision).
 *
 * After the photos are downloaded and measured, Gemini looks at a small copy of every main photo
 * (16 per request, 4 requests at a time) and says what it is: a real photo of the car, a placeholder
 * ("photos coming soon", silhouettes, logos, blanks) or a stock / studio image. It reads text on the
 * picture too, so OCR-less servers still catch "Photos Coming Soon".
 *
 * - Answers are cached by image fingerprint (turboCleanScannerVisionCache): the same picture on the
 *   next crawl — any dealership — costs nothing and takes no time.
 * - Your rules and your own corrections still win; the AI is the strongest automatic signal.
 * - No GOOGLE_GEMINI_API_KEY, a timeout or an outage → the built-in checks decide, nothing breaks.
 */
import type { Db } from 'mongodb'
import type { ImageInfo } from './scanner-images'

export const VISION_CACHE = 'turboCleanScannerVisionCache'
export interface VisionVerdict { v: 'real' | 'placeholder' | 'stock', c: number, why: string, text: string, model: string, cached?: boolean }

const SYSTEM = `You review the main photo of vehicle listings on car-dealer websites. For each image decide:
- "real": an actual photograph of the specific vehicle (on the lot, in a showroom, outdoors, in a photo booth). Dealer banners, frames, borders, logos, price stickers or watermarks over a real photo still count as real.
- "placeholder": NOT a photo of the car — "photos coming soon" / "image not available" / "more photos soon" graphics, grey or white car silhouettes or outline drawings (even with a brand logo), dealer logo or storefront only, blank / solid colour, a generic illustration.
- "stock": manufacturer or stock-library imagery — a studio render or press photo of the model on a plain white / grey / gradient background, CGI, a colour-swatch render; the car with no real surroundings.
Be decisive. "c" is your confidence 0–1. "t" is any text readable on the image (max 60 chars, "" if none). "why" is at most 8 words.`

const cacheKey = (i: ImageInfo) => (i.hash2 ? `${i.hash}:${i.hash2}` : '') || ''

async function readCache(db: Db | null, imgs: ImageInfo[]) {
  const out = new Map<string, VisionVerdict>()
  if (!db) return out
  const keys = [...new Set(imgs.map(cacheKey).filter(Boolean))]
  if (!keys.length) return out
  try {
    const rows = await db.collection(VISION_CACHE).find({ _id: { $in: keys } as any }).toArray()
    for (const r of rows) if (['real', 'placeholder', 'stock'].includes(r.v)) out.set(String(r._id), { v: r.v, c: Number(r.c) || 0.8, why: r.why || '', text: r.text || '', model: r.model || '', cached: true })
  } catch {}
  return out
}
async function writeCache(db: Db | null, img: ImageInfo, v: VisionVerdict) {
  const k = cacheKey(img)
  if (!db || !k) return
  await db.collection(VISION_CACHE).updateOne({ _id: k as any }, { $set: { v: v.v, c: v.c, why: v.why, text: v.text, model: v.model, url: img.url, at: new Date().toISOString() } }, { upsert: true }).catch(() => {})
}

/**
 * Give every image with a thumbnail an `ai` verdict. Returns how many were checked by AI / cache.
 * `deadline` (epoch ms) bounds the whole step; whatever isn't answered by then keeps the built-in verdict.
 */
export async function visionCheck(db: Db | null, images: ImageInfo[], o: { log: (s: string) => void, deadline: number, onProgress?: (done: number, total: number) => void }) {
  const { visionConfigured, askGeminiVision } = await import('./automation-ai')
  const todo = images.filter(i => i.ok && !(i as any).ai && ((i as any).thumb || cacheKey(i)))
  if (!todo.length) return { checked: 0, cached: 0, failed: 0 }
  const cache = await readCache(db, todo)
  let cached = 0
  for (const i of todo) { const hit = cache.get(cacheKey(i)); if (hit) { (i as any).ai = hit; cached++ } }
  const ask = todo.filter(i => !(i as any).ai && (i as any).thumb)
  if (!ask.length || !visionConfigured()) {
    if (ask.length) o.log('AI photo check is off (no GOOGLE_GEMINI_API_KEY) — using the built-in checks')
    return { checked: 0, cached, failed: 0 }
  }
  o.log(`AI photo check: Gemini is looking at ${ask.length} photo${ask.length === 1 ? '' : 's'}${cached ? ` (${cached} already known)` : ''}…`)
  const BATCH = 16
  const batches: ImageInfo[][] = []
  for (let k = 0; k < ask.length; k += BATCH) batches.push(ask.slice(k, k + BATCH))
  let done = 0, failed = 0, firstError = ''
  const worker = async () => {
    while (batches.length) {
      const batch = batches.shift()!
      const left = o.deadline - Date.now()
      if (left < 8_000) { failed += batch.length; continue }
      try {
        const r = await askGeminiVision({
          system: SYSTEM,
          prompt: `There are ${batch.length} images, labelled "Image 1" to "Image ${batch.length}". Answer as JSON: {"items":[{"i":1,"v":"real|placeholder|stock","c":0.95,"t":"","why":""}, …]} with one entry per image, in order.`,
          images: batch.map((im, k) => ({ label: `Image ${k + 1}:`, mime: 'image/jpeg', b64: (im as any).thumb })),
          maxTokens: 120 * batch.length + 400,
          timeoutMs: Math.min(45_000, left - 2_000),
          purpose: 'scanner-photos',
        })
        const items: any[] = Array.isArray(r.data?.items) ? r.data.items : []
        for (const it of items) {
          const im = batch[(Number(it?.i) || 0) - 1]
          const v = String(it?.v || '').toLowerCase()
          if (!im || !['real', 'placeholder', 'stock'].includes(v)) continue
          const verdict: VisionVerdict = { v: v as any, c: Math.max(0, Math.min(1, Number(it?.c) || 0.7)), why: String(it?.why || '').slice(0, 80), text: String(it?.t || '').slice(0, 80), model: r.model }
          ;(im as any).ai = verdict
          await writeCache(db, im, verdict)
        }
        failed += batch.filter(im => !(im as any).ai).length
      }
      catch (e: any) { failed += batch.length; firstError ||= String(e?.message || e).slice(0, 140) }
      done += batch.length
      o.onProgress?.(done, ask.length)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  const ok = ask.length - failed
  o.log(`AI photo check: ${ok} of ${ask.length} judged by Gemini${failed ? ` · ${failed} kept the built-in verdict${firstError ? ` (${firstError})` : ''}` : ''}`)
  return { checked: ok, cached, failed }
}

/** A person corrected a photo: remember it for the AI cache too, so the next crawl agrees right away. */
export async function teachVision(db: Db, img: ImageInfo, verdict: 'real' | 'placeholder' | 'stock' | 'missing') {
  const v = verdict === 'missing' ? 'placeholder' : verdict
  await writeCache(db, img, { v, c: 1, why: 'Corrected by you', text: '', model: 'you' })
}
