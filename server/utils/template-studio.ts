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
  placeholderImages: 'listings showing a "photos coming soon" placeholder', noImageCount: 'listings with no image at all', stockImages: 'listings using stock images',
  inventoryUrl: 'URL of the inventory page that was reviewed', replyMailto: 'mailto: link that replies to this email (use for CTA buttons)',
  auditScreenshot: 'HTML BLOCK: inventory page screenshot (only if an audit has one) — prefer {{auditEvidence}}',
  auditEvidence: 'HTML BLOCK: "Spot-check it yourself" card listing real vehicles without photos with "View listing" links (renders nothing without data)',
  auditBreakdown: 'HTML BLOCK: "What we found" card (placeholder / no image / stock counts)',
  usedPhotoBar: 'HTML BLOCK: green/red bar "with real photos vs without" for used inventory',
  newInventoryNote: 'HTML BLOCK: one sentence about new inventory gaps (renders nothing when none)',
  prevAuditDate: 'date of the earlier review used for "then vs now" (closest to ~3 months before the latest)', prevUsedTotal: 'pre-owned listed back then', prevUsedMissingPhotos: 'pre-owned without real photo back then', prevUsedMissingPhotoPct: 'pre-owned % without real photo back then',
  prevTotalMissingPhotos: 'all listings without real photo back then', usedMissingChange: 'change in pre-owned without real photo, e.g. "+16" or "−5"', usedMissingPctChange: 'change in share, e.g. "+8.5 pts"',
  auditPeriod: 'time between the two reviews, e.g. "3 months"', trendWord: '"more" / "fewer" / "the same number of"',
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

# Data — merge fields (write them exactly; never invent other {{fields}})
${MERGE_FIELDS.map(f => `- {{${f}}}: ${FIELD_HELP[f] || f}`).join('\n')}
Fallback syntax: {{field|fallback text}} (plain text fallback only). HTML BLOCK fields output complete cards — put each alone in its own <tr><td class="px" style="padding:…40px…">…</td></tr> row; they disappear when there is no data, so never write a heading for them yourself.

# Writing
- Honest, specific, calm confidence. No hype, no emojis, no exclamation marks, no fake urgency, no invented statistics, testimonials, prices or guarantees. Only claim numbers that come from merge fields.
- Short paragraphs, scannable, one clear ask. Sound like a person who walked the lot, not a marketing department.
- Personalize with {{dealership}}, {{firstName|there}}, {{website}} where natural.

# When refining
You receive the current email. Apply the requested change and keep everything else identical unless it must change. Always return the COMPLETE email in the same format.`

/** Build the user prompt for a new design or a refinement. */
export function studioPrompt(body: any, referenceHtml: string) {
  const goal = String(body?.goal || '').slice(0, 60)
  const length = String(body?.length || '').slice(0, 20)
  const style = body?.style === 'fresh' ? 'a fresh layout (still within the house design system)' : 'the house style — closely follow the structure of the reference'
  if (body?.html && body?.instruction) {
    return `CURRENT EMAIL (name: ${String(body.name || '').slice(0, 120)}, subject: ${String(body.subject || '').slice(0, 300)}):\n${String(body.html).slice(0, 60_000)}\n\nCHANGE REQUESTED:\n${String(body.instruction).slice(0, 2000)}`
  }
  return `REFERENCE EMAIL — our best-designed template ("Missing Photos" V2). Match its quality, spacing, components and Outlook-safe techniques:\n${referenceHtml}\n\nNEW EMAIL BRIEF:\n${String(body?.brief || '').slice(0, 4000)}\n\n${goal ? `Goal / category: ${goal}\n` : ''}${length ? `Length: ${length === 'short' ? 'short — brand bar, compact hero, 1–2 short sections, CTA, signature' : length === 'rich' ? 'rich — full report-style layout' : 'standard'}\n` : ''}Design approach: ${style}.`
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
