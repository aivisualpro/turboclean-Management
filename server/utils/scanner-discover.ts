/**
 * Inventory page discovery — "which pages on this dealer's site list vehicles?"
 *
 * 1. Open the website and harvest every same-site link (menus, mega menus, footers, hidden ones).
 * 2. Score each by wording + path (used / pre-owned / certified / new / inventory …), penalise
 *    specials, finance, service, single-vehicle pages. Add the well-known platform URLs
 *    (Dealer.com, DealerOn, DealerInspire, Dealer eProcess …) as guesses.
 * 3. If AI is connected, let it re-rank the shortlist (it reads odd menu wording better than rules).
 * 4. VERIFY: open the best candidates and count vehicle cards with the scanner's own extractor.
 *    Only pages that really show vehicles come back as "verified", with their counts.
 */
import type { Db } from 'mongodb'
import { str } from './crm'
import { aiConfigured, askClaudeJson } from './automation-ai'
import { EXTRACT_JS } from './scanner-page'
import { closeTab, evaluate, goto, openTab, safeUrl } from './scanner-session'

export type PageKind = 'used' | 'certified' | 'new' | 'all'
export interface DiscoveredPage { url: string, label: string, kind: PageKind, cards: number, total: number | null, verified: boolean, score: number, source: 'menu' | 'guess' | 'ai' }

const LINKS_JS = `(() => {
  var host = location.hostname.replace(/^www\\./, '')
  var out = [], seen = {}
  var as = Array.prototype.slice.call(document.querySelectorAll('a[href]'))
  for (var i = 0; i < as.length && out.length < 600; i++) {
    var a = as[i], href = a.href || ''
    if (!/^https?:/i.test(href)) continue
    try { var u = new URL(href) } catch (e) { continue }
    if (u.hostname.replace(/^www\\./, '') !== host) continue
    if (/\\.(pdf|jpe?g|png|gif|svg|webp|mp4|zip|xml)$/i.test(u.pathname)) continue
    var clean = u.origin + u.pathname.replace(/\\/+$/, '') + (u.search || '')
    if (seen[clean]) continue
    seen[clean] = 1
    var text = (a.innerText || a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
    var nav = !!a.closest('nav, header, [role="navigation"], [class*="nav"], [class*="menu"], [id*="nav"], [id*="menu"]')
    out.push({ text: text, href: clean, nav: nav })
  }
  return out
})()`

const KIND_WORDS: [RegExp, PageKind][] = [
  [/\b(certified|cpo|certified[- ]pre[- ]owned)\b/i, 'certified'],
  [/\b(used|pre[- ]?owned|preowned|second[- ]hand)\b/i, 'used'],
  [/\bnew\b(?!s)/i, 'new'],
  [/\b(all|search|view|browse|shop)\b.*\b(inventory|vehicles|cars)\b|\b(inventory|vehicles|cars|trucks|suvs)\b/i, 'all'],
]
const INVENTORY_WORDS = /\b(inventory|vehicles?|cars|trucks|suvs|search|listings?|for sale|in stock|view all|shop|browse)\b/i
const NEGATIVE = /\b(special|specials|offers?|deals?|incentives?|finance|financing|credit|lease|leasing|service|parts|accessor|about|contact|blog|news|career|jobs?|review|testimonial|directions?|hours|map|privacy|terms|sitemap|trade|value|appraise|sell us|schedule|research|compare|brochure|showroom|model|models|commercial|fleet|rental|collision|body shop|tires?|oil|coupon|rebate|warranty|protection|gallery|events?|community|staff|team|login|account|cart|wishlist|saved|print|share|apply|quote|payment|calculator|faq|sold)\b/i
const VDP = /\/(vehicle|vdp|detail|details|listing)\/|[A-HJ-NPR-Z0-9]{17}|\/\d{5,}\b|stock[=_-]|\bvin\b/i

/** Common inventory paths by dealer-website platform — tried when the menu gives nothing better. */
const GUESSES: { path: string, kind: PageKind }[] = [
  { path: '/used-inventory/index.htm', kind: 'used' }, { path: '/new-inventory/index.htm', kind: 'new' }, { path: '/certified-inventory/index.htm', kind: 'certified' },
  { path: '/searchused.aspx', kind: 'used' }, { path: '/searchnew.aspx', kind: 'new' },
  { path: '/used-vehicles/', kind: 'used' }, { path: '/new-vehicles/', kind: 'new' }, { path: '/certified-pre-owned-vehicles/', kind: 'certified' },
  { path: '/inventory/used/', kind: 'used' }, { path: '/inventory/new/', kind: 'new' }, { path: '/inventory/', kind: 'all' },
  { path: '/used-cars/', kind: 'used' }, { path: '/used-cars-for-sale/', kind: 'used' }, { path: '/cars-for-sale/', kind: 'all' }, { path: '/pre-owned/', kind: 'used' },
  { path: '/used', kind: 'used' }, { path: '/new', kind: 'new' }, { path: '/inventory?condition=used', kind: 'used' },
]

interface Candidate { href: string, text: string, kind: PageKind, score: number, source: 'menu' | 'guess' | 'ai', nav: boolean }

function kindOf(s: string): PageKind | null {
  for (const [re, k] of KIND_WORDS) if (re.test(s)) return k
  return null
}
function scoreLink(l: { text: string, href: string, nav: boolean }): Candidate | null {
  let path = ''
  try { path = decodeURIComponent(new URL(l.href).pathname + new URL(l.href).search) } catch { return null }
  const words = `${l.text} ${path.replace(/[-_/+.?=&]+/g, ' ')}`
  let score = 0
  const kind = kindOf(l.text) || kindOf(path.replace(/[-_/+.?=&]+/g, ' '))
  if (kind) score += kind === 'all' ? 3 : 5
  if (INVENTORY_WORDS.test(words)) score += 4
  if (l.nav) score += 2
  if (NEGATIVE.test(words)) score -= 7
  if (VDP.test(path)) score -= 9
  const depth = path.split('/').filter(Boolean).length
  if (depth > 3) score -= 3
  if (path === '/' || path === '') score -= 10
  if (score <= 0) return null
  return { href: l.href, text: l.text, kind: kind || 'all', score, source: 'menu', nav: l.nav }
}

const LABELS: Record<PageKind, string> = { used: 'Used inventory', certified: 'Certified pre-owned', new: 'New inventory', all: 'All inventory' }
const niceLabel = (c: Candidate) => c.text && c.text.length <= 40 && !/^https?:/.test(c.text) ? c.text.replace(/\s+/g, ' ') : LABELS[c.kind]

export interface DiscoverResult { website: string, pages: DiscoveredPage[], candidates: DiscoveredPage[], tried: number, aiUsed: boolean, log: string[], ms: number }

export async function discoverInventoryPages(db: Db, dealershipId: string, urlInput?: string, opts: { maxVerify?: number, budgetMs?: number } = {}): Promise<DiscoverResult> {
  const { loadDealership } = await import('./scanner-session')
  const d = await loadDealership(db, dealershipId)
  const raw = str(urlInput, 2000) || d.website
  if (!raw) throw createError({ statusCode: 400, statusMessage: 'This dealership has no website — add one first' })
  const website = safeUrl(raw)
  const origin = new URL(website).origin
  const t0 = Date.now()
  const budget = opts.budgetMs ?? 150_000
  const log: string[] = []
  const say = (m: string) => log.push(m)
  const t = await openTab()
  try {
    say(`Opening ${website.replace(/^https?:\/\//, '')}`)
    await goto(t, website, 30_000, say)
    // Hover nothing — hidden menu links are still in the DOM; just read every anchor.
    for (let y = 0; y < 2400; y += 800) { await evaluate(t, `window.scrollTo(0, ${y})`).catch(() => {}); await new Promise(r => setTimeout(r, 150)) }
    const links = await evaluate<{ text: string, href: string, nav: boolean }[]>(t, LINKS_JS, 20_000).catch(() => [])
    say(`${links.length} links on the site`)

    // ── Rank ──
    const byHref = new Map<string, Candidate>()
    for (const l of links) { const c = scoreLink(l); if (c && (!byHref.has(c.href) || byHref.get(c.href)!.score < c.score)) byHref.set(c.href, c) }
    for (const g of GUESSES) {
      const href = origin + g.path
      const key = href.replace(/\/+$/, '')
      if (![...byHref.keys()].some(k => k.replace(/\/+$/, '') === key)) byHref.set(href, { href, text: '', kind: g.kind, score: 2, source: 'guess', nav: false })
    }
    let ranked = [...byHref.values()].sort((a, b) => b.score - a.score)
    say(`${ranked.filter(c => c.source === 'menu').length} look like inventory links`)

    // ── AI re-rank (optional) ──
    let aiUsed = false
    if (aiConfigured() && ranked.some(c => c.source === 'menu')) {
      const shortlist = ranked.filter(c => c.source === 'menu').slice(0, 40).map(c => ({ href: c.href.replace(origin, ''), text: c.text }))
      try {
        const r = await askClaudeJson<{ pages: { href: string, kind: string, confidence: number }[] }>({
          purpose: 'scanner.discover', brain: 'research', maxTokens: 700, timeoutMs: 25_000, temperature: 0,
          system: 'You pick the vehicle INVENTORY LISTING pages of a car dealership website from a list of its links: pages that show many vehicles for sale (used / pre-owned, certified, new, or all inventory). Exclude single-vehicle pages, specials/offers, finance, service, parts, research/model pages, blog, about, contact.',
          prompt: `Website: ${website}\nLinks (href | menu text):\n${shortlist.map(s => `${s.href} | ${s.text}`).join('\n')}\n\nReturn {"pages":[{"href":"…","kind":"used|certified|new|all","confidence":0-1}]} with at most 8 pages, best first. Use the href exactly as given.`,
        })
        const picks = Array.isArray(r?.data?.pages) ? r!.data.pages : []
        for (const p of picks) {
          const href = /^https?:/i.test(p.href) ? p.href : origin + (p.href.startsWith('/') ? '' : '/') + p.href
          const c = ranked.find(x => x.href.replace(/\/+$/, '') === href.replace(/\/+$/, ''))
          const conf = Math.max(0, Math.min(1, Number(p.confidence) || 0.6))
          if (c) { c.score += Math.round(conf * 8); if (['used', 'certified', 'new', 'all'].includes(p.kind)) c.kind = p.kind as PageKind }
          else ranked.push({ href, text: '', kind: (['used', 'certified', 'new', 'all'].includes(p.kind) ? p.kind : 'all') as PageKind, score: Math.round(conf * 8), source: 'ai', nav: false })
        }
        aiUsed = picks.length > 0
        ranked = ranked.sort((a, b) => b.score - a.score)
        if (aiUsed) say(`AI shortlisted ${picks.length} page${picks.length === 1 ? '' : 's'}`)
      }
      catch (e: any) { say(`AI skipped (${String(e?.message || e).slice(0, 80)})`) }
    }

    // ── Verify by counting vehicle cards ──
    const maxVerify = opts.maxVerify ?? 7
    const verified: DiscoveredPage[] = []
    const rejected: DiscoveredPage[] = []
    const coveredKinds = new Set<PageKind>()
    let tried = 0
    let guessesTried = 0
    for (const c of ranked) {
      if (tried >= maxVerify || Date.now() - t0 > budget) break
      // Don't spend time on a third "used" page once two are verified; platform guesses only a few, and not once the menu delivered two.
      if (c.source === 'guess' && (verified.length >= 2 || guessesTried >= (verified.length ? 2 : 4))) continue
      if (c.source === 'guess') guessesTried++
      if (c.kind !== 'all' && coveredKinds.has(c.kind) && verified.filter(v => v.kind === c.kind).length >= 2) continue
      tried++
      try {
        await goto(t, c.href, 25_000, say)
        if (t.status && t.status >= 400) { rejected.push({ url: c.href, label: niceLabel(c), kind: c.kind, cards: 0, total: null, verified: false, score: c.score, source: c.source }); say(`✗ ${c.href.replace(origin, '')} — HTTP ${t.status}`); continue }
        for (let y = 0; y < 2400; y += 800) { await evaluate(t, `window.scrollTo(0, ${y})`).catch(() => {}); await new Promise(r => setTimeout(r, 250)) }
        await new Promise(r => setTimeout(r, 600))
        const r = await evaluate<any>(t, EXTRACT_JS, 30_000).catch(() => null)
        const cards = r?.cards?.length || 0
        const total = r?.total ? Number(r.total) : null
        const finalUrl = String(r?.url || t.url || c.href)
        const page: DiscoveredPage = { url: finalUrl.split('#')[0]!, label: niceLabel(c), kind: c.kind, cards, total, verified: cards >= 3 || (total || 0) >= 3, score: c.score, source: c.source }
        if (page.verified) {
          // Kind from what the page actually shows, when the cards say so.
          const conds = (r.cards as any[]).map(x => x.condition).filter(Boolean)
          if (conds.length >= 3) { const n: Record<string, number> = {}; for (const x of conds) n[x] = (n[x] || 0) + 1; const top = Object.entries(n).sort((a, b) => b[1] - a[1])[0]!; if (top[1] / conds.length >= 0.8 && ['used', 'new', 'certified'].includes(top[0])) page.kind = top[0] as PageKind; else if (Object.keys(n).length > 1) page.kind = 'all' }
          if (!verified.some(v => v.url.replace(/\/+$/, '') === page.url.replace(/\/+$/, ''))) { verified.push(page); coveredKinds.add(page.kind) }
          say(`✓ ${page.url.replace(origin, '') || '/'} — ${cards} vehicles on screen${total ? ` (${total} advertised)` : ''}`)
        }
        else { rejected.push(page); say(`✗ ${page.url.replace(origin, '') || '/'} — no vehicle listings`) }
      }
      catch (e: any) { say(`✗ ${c.href.replace(origin, '')} — ${String(e?.message || e).slice(0, 80)}`) }
    }
    const candidates = ranked.filter(c => !verified.some(v => v.url.replace(/\/+$/, '') === c.href.replace(/\/+$/, '')) && !rejected.some(v => v.url.replace(/\/+$/, '') === c.href.replace(/\/+$/, '')) && c.source !== 'guess').slice(0, 12)
      .map(c => ({ url: c.href, label: niceLabel(c), kind: c.kind, cards: 0, total: null, verified: false, score: c.score, source: c.source }))
    verified.sort((a, b) => ({ used: 0, certified: 1, all: 2, new: 3 }[a.kind] - { used: 0, certified: 1, all: 2, new: 3 }[b.kind]) || (b.total || b.cards) - (a.total || a.cards))
    return { website, pages: verified, candidates, tried, aiUsed, log, ms: Date.now() - t0 }
  }
  finally { await closeTab(t).catch(() => {}) }
}
