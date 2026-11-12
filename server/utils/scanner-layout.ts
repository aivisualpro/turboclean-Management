/**
 * Layout intelligence for the crawler.
 *
 * The crawler reads vehicle cards with built-in rules. Dealer websites are built on dozens of
 * platforms, and now and then the rules read only a PART of each card (a button that carries the
 * VIN, a price box) — every vehicle then comes back with no title and no photo, and "100% without a
 * photo" would be reported for a site that is fine.
 *
 * Three safeguards:
 *  1. `readingProblem()`  — recognises a reading that cannot be right (same title on every card,
 *     titles that are not vehicles, no picture element on any card).
 *  2. `learnLayout()`     — shows two listings (simplified HTML) to the AI and asks which CSS
 *     selectors make up one vehicle card; the answer is tested on the live page and only kept when
 *     it reads the cards properly. Learned once per website, reused on every later crawl.
 *  3. `unreliableResult()` — a finished crawl that still looks unreadable is never saved or emailed
 *     as if it were a finding.
 */
import type { Db } from 'mongodb'
import { LAYOUT_SAMPLE_JS, extractWith } from './scanner-page'
import type { CardLayout } from './scanner-page'

export const LAYOUTS_COLLECTION = 'turboCleanScannerLayouts'
const YEAR = /(?:^|[^\d])(19[89]\d|20[0-3]\d)(?!\d)/
type Cardish = { title?: string, image?: any, vin?: string }

/** Why this reading of a page cannot be right — or null when it looks like real vehicle cards. */
export function readingProblem(cards: Cardish[]): string | null {
  const n = cards.length
  if (n < 3) return null
  const titles = new Map<string, number>()
  for (const c of cards) { const t = String(c.title || '').trim().toLowerCase(); titles.set(t, (titles.get(t) || 0) + 1) }
  const [topTitle, top] = [...titles.entries()].sort((a, b) => b[1] - a[1])[0]!
  const vehicles = cards.filter(c => YEAR.test(String(c.title || ''))).length
  const noPicture = cards.filter(c => !c.image).length
  if (n >= 4 && top / n >= 0.6) return `${top} of ${n} cards have the same title (“${topTitle.slice(0, 40) || 'empty'}”)`
  if (vehicles / n < 0.4) return `only ${vehicles} of ${n} cards have a vehicle title`
  if (noPicture / n >= 0.8) return `${noPicture} of ${n} cards have no picture on them at all`
  return null
}

/** A finished crawl whose numbers must not be trusted (the cards were not read properly). */
export function unreliableResult(vehicles: Cardish[], sum: { total: number, withoutReal: number }): string | null {
  if (sum.total < 6 || sum.withoutReal / Math.max(1, sum.total) < 0.9) return null
  const why = readingProblem(vehicles)
  return why ? `This website's vehicle cards could not be read properly (${why}), so “${sum.withoutReal} of ${sum.total} without a photo” is not a real finding. Nothing was saved — try the crawl again; if it repeats, the site needs a layout fix.` : null
}

const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' } }
const okSel = (v: any) => typeof v === 'string' && v.trim().length > 0 && v.length <= 220 && !/[{}<>]|:has\(|javascript:/i.test(v)

/** The layout learned earlier for this website, if any. */
export async function savedLayout(db: Db | null, url: string): Promise<CardLayout | null> {
  const host = hostOf(url)
  if (!db || !host) return null
  const d = await db.collection(LAYOUTS_COLLECTION).findOne({ _id: host as any }).catch(() => null)
  return d?.layout?.card ? d.layout as CardLayout : null
}
/** A saved layout stopped working (the site was rebuilt): forget it. */
export async function forgetLayout(db: Db | null, url: string) {
  const host = hostOf(url)
  if (db && host) await db.collection(LAYOUTS_COLLECTION).deleteOne({ _id: host as any }).catch(() => {})
}

const SYSTEM = `You read the HTML of car-dealer inventory pages. You are given the simplified HTML of two vehicle listings from one results page, and the chain of elements above the first one. Work out the CSS selectors that describe ONE vehicle listing on this website.

Return JSON:
{ "card": "selector that matches the container of each vehicle listing exactly once (the whole listing: photo, title, price, buttons)",
  "title": "selector, relative to the card, of the element whose text is the vehicle name (year make model); \\"\\" if there is none",
  "image": "selector, relative to the card, of the main vehicle photo <img> (the large one, not a logo, badge or icon); \\"\\" if the listing has no photo element",
  "link": "selector, relative to the card, of the <a> that opens the vehicle's own page; \\"\\" if unsure",
  "confidence": 0 to 1 }

Rules:
- Use class names or data-attribute NAMES that repeat on every listing. Never use values that belong to one vehicle (a VIN, a stock number, an id with digits), and never :nth-child, :has() or positional selectors.
- "card" must not match a part of a listing (a button, a price box) and must not match a wrapper that holds several listings.
- Selectors must be plain CSS that document.querySelectorAll accepts.`

export interface LearnedLayout { layout: CardLayout, result: any, model: string }

/**
 * Ask the AI for this page's card layout and prove it on the page. `evalJs` runs JavaScript in the
 * open page. Returns the layout with the cards it read — or null (no AI key, no vehicles on the page,
 * or no answer that reads the page better than the built-in rules).
 */
export async function learnLayout(db: Db | null, url: string, evalJs: <T = any>(expression: string, timeoutMs?: number) => Promise<T>, log: (s: string) => void, before: Cardish[] = []): Promise<LearnedLayout | null> {
  if (String(process.env.SCANNER_AI || '').toLowerCase() === 'off') return null
  const { aiConfigured, askClaudeJson } = await import('./automation-ai')
  if (!aiConfigured()) return null
  const sample = await evalJs<any>(LAYOUT_SAMPLE_JS, 20_000).catch(() => null)
  if (!sample?.html?.[0]) return null
  log(`The vehicle cards on this site are built in an unfamiliar way — asking the AI to read the layout (${sample.count} vehicles on the page)`)
  let feedback = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const ai = await askClaudeJson<any>({
      system: SYSTEM,
      prompt: `Website: ${hostOf(url)}\nVehicles on this page (counted by ${sample.by === 'vin' ? 'VIN' : 'links to vehicle pages'}): ${sample.count}\n\nElements above the first listing (innermost first):\n${(sample.path || []).join('\n')}\n\nListing A:\n${sample.html[0]}\n\nListing B:\n${sample.html[1] || ''}${feedback}`,
      maxTokens: 600, temperature: 0, timeoutMs: 45_000, purpose: 'scanner_layout', prefer: 'anthropic',
    } as any)
    const a = ai?.data
    if (!a || !okSel(a.card)) { feedback = '\n\nYour last answer had no usable "card" selector. Answer again.'; continue }
    const layout: CardLayout = { card: a.card.trim(), title: okSel(a.title) ? a.title.trim() : '', image: okSel(a.image) ? a.image.trim() : '', link: okSel(a.link) ? a.link.trim() : '' }
    const result = await evalJs<any>(extractWith(layout), 45_000).catch(() => null)
    const cards: Cardish[] = result?.strategy === 'learned' ? (result.cards || []) : []
    const n = cards.length
    const problem = n ? readingProblem(cards) : 'the card selector matched nothing'
    const countOk = n >= Math.max(3, Math.floor(sample.count * 0.6)) && n <= Math.ceil(sample.count * 1.5) + 2
    // Kept only when it reads real cards — and at least as many as the page shows.
    if (countOk && !problem) {
      const host = hostOf(url)
      if (db && host) await db.collection(LAYOUTS_COLLECTION).updateOne({ _id: host as any }, { $set: { layout, model: ai!.model, learnedAt: new Date().toISOString(), cards: n, replaced: before.length ? readingProblem(before) : 'nothing was found' } }, { upsert: true }).catch(() => {})
      log(`Layout learned (${ai!.model}): ${n} vehicle cards read with their titles and photos — remembered for this website`)
      return { layout, result, model: ai!.model }
    }
    feedback = `\n\nYour last answer was tested on the page and is not right: card = ${JSON.stringify(layout.card)} matched ${n} elements (the page shows ${sample.count} vehicles)${problem ? `; ${problem}` : ''}. Give corrected selectors.`
  }
  log('The AI could not find a layout that reads this page better — keeping the built-in reading')
  return null
}
