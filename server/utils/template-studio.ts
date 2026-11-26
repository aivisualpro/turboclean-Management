/**
 * Template Studio — designs HTML email templates with Claude, in the ZRZ OPS house style.
 *
 * The design guide + the "Missing Photos" V2 reference email go in a cached system prompt, the
 * team's design playbook comes from the brain ('design' area), and the email streams back so the
 * Studio can show it building live. Output is sanitised (no scripts, handlers or forms) and checked
 * for unknown {{fields}}.
 */
import { MERGE_FIELDS } from './crm-email'
import { RAW_HTML_FIELDS } from './crm-email-blocks'

const FIELD_HELP: Record<string, string> = {
  firstName: 'contact first name (use {{firstName|there}} for a safe fallback)', lastName: 'contact last name', fullName: 'contact full name', contactTitle: 'contact job title',
  dealership: 'dealership name', dealerGroup: 'dealer group', city: 'dealership city', state: 'dealership state', website: 'dealership website (no https://)',
  senderName: 'sender full name', senderFirstName: 'sender first name', senderInitials: 'sender initials (avatar)', senderTitle: 'sender title (use {{senderTitle|Owner}})', senderCompany: 'sender company',
  senderPhone: 'sender phone', senderEmail: 'sender email', senderTagline: 'sender tagline', senderRegion: 'sender service region',
  auditDate: 'audit date "Oct 9, 2026"', auditDateUpper: 'audit date "OCT 09, 2026"',
  usedTotal: 'used vehicles listed', usedMissingPhotos: 'used vehicles without a real photo', usedMissingPhotoPct: 'used % without real photo, e.g. "20.5%"', usedWithPhotos: 'used vehicles with real photos',
  newTotal: 'new vehicles listed', newMissingPhotos: 'new vehicles without real photo', newMissingPhotoPct: 'new % without photo',
  totalVehicles: 'all vehicles', totalMissingPhotos: 'all vehicles without real photo', missingPhotoPct: 'all % without photo',
  placeholderImages: 'listings showing a "photos coming soon" placeholder', noImageCount: 'listings with no image at all', stockImages: 'listings using stock images', blurryPhotos: 'listings whose real photo is blurry (not counted as missing)',
  inventoryUrl: 'URL of the inventory page that was reviewed', replyMailto: 'mailto: link that replies to this email (use for CTA buttons)',
  auditScreenshot: 'HTML BLOCK: inventory page screenshot (only if an audit has one) — prefer {{auditEvidence}}',
  auditGallery: 'HTML BLOCK: "EVIDENCE / DEALERSHIP WEBSITE REVIEW" box — up to six flagged listings pictured the way the dealer\'s website shows them (photo, title, price, issue tag, each linked) inside a browser-style frame, with an "Audit finding" caption (renders nothing without data). The strongest proof — use it once, alone in its row.',
  usedMissingHeadline: 'headline phrase, e.g. "23 pre-owned vehicles" (singular handled)', usedMissingTitle: 'the same in Title Case for subject lines, e.g. "23 Pre-Owned Vehicles"',
  auditEvidence: 'HTML BLOCK: "Spot-check it yourself" card listing real vehicles without photos with "View listing" links (renders nothing without data)',
  auditBreakdown: 'HTML BLOCK: "What we found" card (placeholder / no image / stock counts)',
  usedPhotoBar: 'HTML BLOCK: green/red bar "with real photos vs without" for used inventory',
  newInventoryNote: 'HTML BLOCK: one sentence about new inventory gaps (renders nothing when none)',
  inventoryByPage: 'HTML BLOCK: "Page by page" card — one row per inventory page (URL) we crawled with its vehicles, how many lack a real photo and a share bar (renders nothing when only one page was crawled). {{auditEvidence}} is automatically grouped by page too.',
  inventoryPageCount: 'number of inventory pages crawled, e.g. "3" (empty for single-page reviews)', inventoryPageList: 'plain list "Pre-owned inventory (29 of 139), New inventory (12 of 334)"',
  prevAuditDate: 'date of the earlier review used for "then vs now" (closest to ~3 months before the latest)', prevUsedTotal: 'pre-owned listed back then', prevUsedMissingPhotos: 'pre-owned without real photo back then', prevUsedMissingPhotoPct: 'pre-owned % without real photo back then',
  prevTotalMissingPhotos: 'all listings without real photo back then', usedMissingChange: 'change in pre-owned without real photo, e.g. "+16" or "−5"', usedMissingPctChange: 'change in share, e.g. "+8.5 pts"',
  auditPeriod: 'time between the two reviews, e.g. "3 months"', trendWord: '"more" / "fewer" / "the same number of"',
  auditHistoryChart: 'HTML BLOCK: "Over time" column chart — share of pre-owned listings without a real photo at each review (one per day, up to 8). Renders nothing with fewer than two reviews or when switched off in Email → Settings.',
  auditTrend: 'HTML BLOCK: "Then vs now" card (then → now numbers, mini history bars, one sentence) — renders nothing when there is only one review',
  reportUrl: 'link to the dealer\'s own full inventory report (public, signed) — great for a "See your full report" button',
}

export const STUDIO_SYSTEM = `You are the senior email designer at ZRZ OPS, a vehicle reconditioning, photo merchandising and inventory monitoring company that sells to car dealerships (GMs, used-car managers, dealer principals) in Connecticut and Massachusetts. You design B2B sales emails that look like they came from a premium design team and read like a sharp, honest operator wrote them.

# Output format (exactly this, nothing before or after)
NAME: <short template name, e.g. "Recon Introduction">
CATEGORY: <one of: First touch, Follow-up, Meeting, Proposal, Re-engage, Other>
SUBJECT: <subject line, may use {{fields}}>
NOTES: <one sentence: what you made or changed>
---HTML---
<!doctype html>
...the complete email...
</html>

# Email engineering (non-negotiable — it must render in Outlook, Gmail, Apple Mail, iOS, Android)
- Table-based layout, role="presentation", cellpadding/cellspacing/border 0. 600px container, centered, max-width:600px.
- ALL styling inline. A single <style> block in <head> is allowed only for resets and @media (max-width:620px) mobile rules using classes (.px, .stack, .stack-gap, .hero-h1, .h2, .kpi-num, .hide-sm, .btn) — copy the reference.
- Font stack: -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif. No web fonts, no external CSS, no JavaScript, no forms, no iframes, no video, no SVG, no background images.
- No images unless the user asks; never invent image URLs. Never use base64 images.
- Hidden preheader div right after <body> (see reference). <meta name="color-scheme" content="light only">.
- Buttons: bulletproof (padded <a> inside a colored <td>) with the MSO VML fallback from the reference. CTA links use {{replyMailto}} unless the user gives a URL.
- Keep the HTML under 35 KB. Escape & as &amp; in text. Use HTML entities for typographic quotes and dashes.

# House design system
- Ink #0e1714 (dark sections, brand bar, footer), brand green #16a34a / #15803d, mint #4ade80 and #86efac on dark, accent bar #22c55e, alert red #e5484d / #c62a2f (only for problems), stock purple #7c5cff.
- Text #101828 headings, #344054/#475467 body, #667085 muted, borders #eaecf0, soft fills #f6f8f7 / #effaf3 / #f9fafb.
- Rounded containers 12–16px, generous spacing (40px side padding desktop, 22px mobile), uppercase letter-spaced eyebrow labels (11px, 2.2px tracking), bold tight headlines (letter-spacing -0.4 to -1px).
- Structure that works: brand bar → dark hero (eyebrow pill, 3-line punchy headline, one-paragraph personal intro) → proof (numbers / evidence) → why it matters → what ZRZ OPS does (numbered 01/02/03 on dark card) → single CTA → signature with initials avatar → dark footer with an honest one-line opt-out ("Reply “no thanks” and we won’t follow up").
- Mobile: KPI cards stack (class "stack" + "stack-gap" spacer cells), hero headline shrinks.

# Art direction (what separates a senior design team from a template)
- One dominant idea per email. The hero states it in 6–12 words; every section below proves or advances it. Cut anything that does not.
- Type scale: hero 34–40px / line-height 1.08 / weight 800 / letter-spacing -1px; section heads 22–24px / 700; body 15–16px / 1.6; captions 12–13px. Never more than three sizes in one section.
- 8px spacing rhythm (8, 16, 24, 32, 40, 56). Sections breathe: 40–56px vertical padding on hero and CTA, 28–36px elsewhere.
- Colour discipline: neutral canvas + ink + ONE accent (+ red only for the problem number). Body text contrast at least 4.5:1.
- Numbers are the visual: big, tabular, with a short label underneath — never buried in a sentence.
- Rhythm: alternate light and dark/tinted blocks so the eye moves; never two identical cards in a row.
- The CTA is one sentence of value + one button + one plain-text fallback line. A short P.S. that restates the single ask is welcome.

# Component library (build these with tables; mix and match)
- Eyebrow pill: small uppercase label in a rounded tinted cell above the hero headline.
- KPI trio: three cards (number, label, one-line meaning); stack on mobile with "stack" / "stack-gap".
- "What a shopper sees" listing mock: a text-only vehicle card — a grey 4:3 cell (#e4e7ec) with centered muted text "Photo coming soon", then year/make/model, price line and a red "No real photo" tag. Use it to make the problem visible without any image. Never invent a specific vehicle — label it "Example listing" or use {{auditEvidence}} for real ones.
- Side-by-side contrast: two columns "With real photos" vs "Without" (what the shopper does in each case), stack on mobile.
- Date strip: a row of 3–5 small day cells (e.g. Thu / Fri / Sat / Sun / Mon) with the key days highlighted — for calendar-driven campaigns.
- Pull-quote bar: 4px accent left border, 18px italic line, used once.
- Method card 01 / 02 / 03 on dark, How it works steps, CTA card, signature with initials avatar, dark footer with the opt-out.

# Campaign & seasonal emails (Black Friday, Thanksgiving, holiday, year-end, tax season, spring sales…)
- Use a campaign art direction: near-black hero (#0b0f0d / #111827) with ONE seasonal accent — Black Friday / Cyber Monday: gold #fbbf24 / amber #f59e0b; Thanksgiving: warm amber #d97706 / rust #c2410c; Holiday: deep green #14532d with a restrained red #b91c1c; Year-end: deep navy #0f172a with gold. Brand green stays for the ZRZ OPS bar, buttons and signature.
- The urgency comes from the real calendar (dates you are given), never from fake scarcity ("only 3 spots left") or countdown gimmicks.
- Tell the opportunity-cost story as plain logic, with their own numbers: the dealership is paying for ads and listings that send shoppers to vehicle pages; on the biggest shopping days families browse from the couch on their phones; a page without real photos is the moment that shopper scrolls to the next dealer — so every one of {{usedMissingPhotos}} listings is ad money working against them. No dollar amounts, conversion rates or percentages that do not come from merge fields.
- Offer something concrete and time-bound that ZRZ OPS can actually do (e.g. "we can photograph these {{usedMissingPhotos}} cars before the weekend traffic"), and keep it honest if the date has passed ("before the Cyber Monday traffic" / "before the December rush").

# Data — merge fields (write them exactly; never invent other {{fields}})
${MERGE_FIELDS.map(f => `- {{${f}}}: ${FIELD_HELP[f] || f}`).join('\n')}
Fallback syntax: {{field|fallback text}} (plain text fallback only). HTML BLOCK fields output complete cards — put each alone in its own <tr><td class="px" style="padding:…40px…">…</td></tr> row; they disappear when there is no data, so never write a heading for them yourself. Whenever the email presents inventory results, place {{inventoryByPage}} right after the headline numbers and before {{auditEvidence}} — dealers crawled on several pages (pre-owned, certified, new) then see results grouped by URL; for single-page reviews it simply disappears.

# Writing
- Honest, specific, calm confidence. No hype, no emojis, no exclamation marks, no fake urgency, no invented statistics, testimonials, prices or guarantees. Only claim numbers that come from merge fields.
- Short paragraphs, scannable, one clear ask. Sound like a person who walked the lot, not a marketing department.
- Personalize with {{dealership}}, {{firstName|there}}, {{website}} where natural.
- Subject: under 60 characters, specific, no spam triggers (free, guarantee, act now, $$$, ALL CAPS). Preheader 60–100 characters that adds to the subject instead of repeating it.
- Write it in proper sentence case even when the brief is typed in capitals or has typos — fix spelling silently.

# Before you answer, check silently
Every table closes; the preheader exists; the button has the VML fallback; mobile @media rules exist; only listed {{fields}}; no invented numbers; under 35 KB; the document ends with </html>.

# When refining
You receive the current email. Apply the requested change and keep everything else identical unless it must change. Always return the COMPLETE email in the same format.`

/** US retail calendar for the current season — lets the model write real dates instead of guessing. */
export function retailCalendar(now = new Date()) {
  const y = now.getFullYear()
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const nov1 = new Date(y, 10, 1)
  const thanksgiving = new Date(y, 10, 1 + ((4 - nov1.getDay() + 7) % 7) + 21)
  const add = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  return [
    `Today is ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.`,
    `Thanksgiving ${fmt(thanksgiving)} · Black Friday ${fmt(add(thanksgiving, 1))} · Small Business Saturday ${fmt(add(thanksgiving, 2))} · Cyber Monday ${fmt(add(thanksgiving, 4))} · Christmas Fri Dec 25 · New Year's Day ${fmt(new Date(y + 1, 0, 1))}.`,
  ].join(' ')
}

const CAMPAIGN_WORDS = /black\s*friday|cyber\s*monday|thanks\s*giving|holiday|christmas|new\s*year|year[-\s]*end|memorial\s*day|labor\s*day|4th of july|independence day|presidents?\s*day|tax\s*(season|refund)|spring\s*(sale|event)|summer\s*(sale|event)/i
/** Does the brief describe a seasonal / calendar campaign? */
export const isCampaignBrief = (brief: string) => CAMPAIGN_WORDS.test(brief || '')

const AUDIENCE: Record<string, string> = {
  gm: 'General Manager — cares about gross, turn and how the store looks to the owner; wants the bottom line in one screen.',
  ucm: 'Used-car manager — lives in the inventory; cares about days-to-front-line, aging units and VDP traffic.',
  principal: 'Dealer principal / owner — cares about ad spend wasted, brand reputation and a partner they can trust.',
  marketing: 'Marketing / internet manager — owns the ad budget and the website; cares about VDP engagement and lead volume.',
}

/** Build the user prompt for a new design or a refinement. */
export function studioPrompt(body: any, referenceHtml: string) {
  const goal = String(body?.goal || '').slice(0, 60)
  const length = String(body?.length || '').slice(0, 20)
  const style = body?.style === 'fresh' ? 'a fresh layout (still within the house design system and component library — surprise us)' : 'the house style — closely follow the structure of the reference'
  const brief = String(body?.brief || '').slice(0, 4000)
  const campaign = body?.campaign === true || (body?.campaign !== false && isCampaignBrief(`${brief} ${body?.instruction || ''}`))
  const audience = AUDIENCE[String(body?.audience || '')] || ''
  const context = `\n\nCONTEXT: ${retailCalendar()}${campaign ? '\nThis is a seasonal / calendar campaign — apply the "Campaign & seasonal emails" art direction.' : ''}`
  if (body?.html && body?.instruction) {
    return `CURRENT EMAIL (name: ${String(body.name || '').slice(0, 120)}, subject: ${String(body.subject || '').slice(0, 300)}):\n${String(body.html).slice(0, 60_000)}\n\nCHANGE REQUESTED:\n${String(body.instruction).slice(0, 2000)}${context}`
  }
  return `REFERENCE EMAIL — our best-designed template ("Missing Photos" V2). Match its quality, spacing, components and Outlook-safe techniques:\n${referenceHtml}\n\nNEW EMAIL BRIEF:\n${brief}\n\n${goal ? `Goal / category: ${goal}\n` : ''}${audience ? `Reader: ${audience}\n` : ''}${length ? `Length: ${length === 'short' ? 'short — brand bar, compact hero, 1–2 short sections, CTA, signature' : length === 'rich' ? 'rich — full report-style layout' : 'standard'}\n` : ''}Design approach: ${style}.${context}`
}

/** Split Studio output into meta + HTML (works on partial output while streaming). */
export function parseStudio(text: string) {
  const i = text.indexOf('---HTML---')
  const head = i === -1 ? text : text.slice(0, i)
  let html = i === -1 ? '' : text.slice(i + '---HTML---'.length).trim()
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim()
  const field = (k: string) => (head.match(new RegExp(`^${k}:\\s*(.+)$`, 'mi'))?.[1] || '').trim()
  return { name: field('NAME'), category: field('CATEGORY'), subject: field('SUBJECT'), notes: field('NOTES'), html }
}

/** Remove anything executable or unsafe; keep email markup and MSO conditional comments. */
export function sanitizeEmailHtml(html: string) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<(iframe|object|embed|form|input|button|textarea|select|link|base|meta\s+http-equiv="refresh")[^>]*>[\s\S]*?(<\/\1>)?/gi, (m) => /^<meta/i.test(m) ? '' : '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"')
    .slice(0, 200_000)
}

/** {{fields}} the template uses that do not exist. */
export function unknownFields(html: string, subject = '') {
  const known = new Set<string>(MERGE_FIELDS as readonly string[])
  const used = [...`${subject} ${html}`.matchAll(/\{\{\s*(\w+)\s*(?:\|[^}]*)?\}\}/g)].map(m => m[1]!)
  return [...new Set(used.filter(f => !known.has(f)))]
}

export const RAW_FIELDS = [...RAW_HTML_FIELDS]

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
/**
 * When the model runs out of room mid-email, close what it left open so the design still renders
 * (it keeps everything already written). Returns null when there is nothing usable.
 */
export function repairEmailHtml(html: string): { html: string, repaired: boolean } | null {
  let h = String(html || '').trim()
  if (!/<html[\s>]/i.test(h) || !/<body[\s>]/i.test(h)) return null
  if (/<\/html>\s*$/i.test(h)) return { html: h, repaired: false }
  // Drop a half-written tag / comment at the very end, then cut back to the last finished table row.
  h = h.replace(/<[^>]*$/, '').replace(/<!--(?![\s\S]*-->)[\s\S]*$/, '')
  const lastRow = h.toLowerCase().lastIndexOf('</tr>')
  if (lastRow > h.toLowerCase().indexOf('<body')) h = h.slice(0, lastRow + 5)
  const scan = h.replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
  const stack: string[] = []
  for (const m of scan.matchAll(/<(\/?)([a-z][a-z0-9:]*)\b[^>]*?(\/?)>/gi)) {
    const tag = m[2]!.toLowerCase()
    if (VOID_TAGS.has(tag) || m[3] === '/') continue
    if (m[1]) { const i = stack.lastIndexOf(tag); if (i !== -1) stack.length = i }
    else stack.push(tag)
  }
  const closers = stack.reverse().filter(t => t !== 'html' && t !== 'body').map(t => `</${t}>`).join('')
  return { html: `${h}${closers}\n</body>\n</html>`, repaired: true }
}
