/**
 * Ready-made, email-safe HTML blocks built from the latest inventory audit. Templates drop them in
 * with a single merge field (e.g. {{auditEvidence}}); when there is no data the block renders as
 * nothing, so a template never shows an empty section.
 *
 * Rules for every block: tables only, inline styles, no images, no web fonts, works in Outlook,
 * Gmail and Apple Mail, 520px content width (inside a 600px email with 40px side padding).
 */

/** Merge fields whose value is HTML and must not be escaped. */
export const RAW_HTML_FIELDS = new Set(['auditScreenshot', 'auditEvidence', 'auditBreakdown', 'usedPhotoBar', 'newInventoryNote', 'auditTrend', 'inventoryByPage'])

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const FONT = `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;`
const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v)) || 0
const fmt = (n: number) => n.toLocaleString('en-US')

const VERDICT_BADGE: Record<string, { label: string, bg: string, fg: string }> = {
  placeholder: { label: 'PLACEHOLDER', bg: '#fde8e8', fg: '#b42318' },
  missing: { label: 'NO PHOTO', bg: '#fde8e8', fg: '#b42318' },
  stock: { label: 'STOCK IMAGE', bg: '#f1ecfe', fg: '#5b3cc4' },
}

/** Split an older "2019 Kia Soul #S0020 — No photo" label into parts. */
function parseLabel(label: string) {
  const [left, right] = String(label || '').split(' — ')
  const m = String(left || '').match(/^(.*?)(?:\s+#(\S+))?$/)
  const verdict = /stock/i.test(right || '') ? 'stock' : 'missing'
  return { title: (m?.[1] || left || '').trim(), stock: m?.[2] || '', verdict }
}

/** "Without a real photo" share bar (used inventory). */
export function usedPhotoBar(audit: any) {
  const total = num(audit?.usedTotal)
  const missing = num(audit?.usedMissingPhotos)
  if (!total || !missing) return ''
  const pct = Math.round((missing / total) * 1000) / 10
  const w = Math.max(3, Math.min(97, Math.round(pct)))
  const ok = total - missing
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;">
  <tr><td style="padding:0 0 8px;${FONT}font-size:12px;line-height:16px;color:#475467;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="${FONT}font-size:12px;color:#475467;"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#16a34a;"></span>&nbsp; With real photos &nbsp;<strong style="color:#101828;">${fmt(ok)}</strong></td>
      <td align="right" style="${FONT}font-size:12px;color:#475467;"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#e5484d;"></span>&nbsp; Without &nbsp;<strong style="color:#101828;">${fmt(missing)}</strong></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr>
      <td width="${100 - w}%" height="12" style="height:12px;line-height:12px;font-size:0;background:#16a34a;border-radius:6px 0 0 6px;">&nbsp;</td>
      <td width="${w}%" height="12" style="height:12px;line-height:12px;font-size:0;background:#e5484d;border-radius:0 6px 6px 0;">&nbsp;</td>
    </tr></table>
  </td></tr>
</table>`
}

/** Chips: how the gap breaks down (placeholder images / no image / stock images). */
export function auditBreakdown(audit: any) {
  const b = audit?.photoBreakdown
  if (!b) return ''
  const items: { n: number, label: string, dot: string }[] = []
  if (num(b.placeholder)) items.push({ n: num(b.placeholder), label: `show a &ldquo;photos coming soon&rdquo; placeholder`, dot: '#e5484d' })
  if (num(b.missing)) items.push({ n: num(b.missing), label: 'have no image at all', dot: '#e5484d' })
  if (num(b.stock)) items.push({ n: num(b.stock), label: b.countStockAsMissing === false ? 'use stock / catalog images' : 'use stock images instead of the actual car', dot: '#7c5cff' })
  if (!items.length) return ''
  const rows = items.map(i => `<tr><td width="18" valign="top" style="padding:5px 0 0;"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${i.dot};"></span></td><td style="padding:2px 0;${FONT}font-size:14px;line-height:21px;color:#344054;"><strong style="color:#101828;">${fmt(i.n)}</strong> ${i.label}</td></tr>`).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;background:#f9fafb;border:1px solid #eaecf0;border-radius:10px;">
  <tr><td style="padding:16px 18px 6px;${FONT}font-size:11px;font-weight:700;letter-spacing:1.6px;color:#667085;">WHAT WE FOUND ON THOSE LISTINGS</td></tr>
  <tr><td style="padding:2px 18px 14px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>
</table>`
}

/** One line about new inventory, only when it also has gaps. */
export function newInventoryNote(audit: any) {
  const total = num(audit?.newTotal), missing = num(audit?.newMissingPhotos)
  if (!total || !missing) return ''
  const pct = Math.round((missing / total) * 1000) / 10
  return `<p style="margin:0;${FONT}font-size:13px;line-height:20px;color:#475467;">Also on the new-car side: <strong style="color:#101828;">${fmt(missing)} of ${fmt(total)}</strong> new vehicles (${pct}%) were listed without a real photo.</p>`
}

/** Crawl pages from the audit (2+ means results can be grouped by URL). */
export function auditPages(audit: any): any[] {
  return (Array.isArray(audit?.pages) ? audit.pages : []).filter((p: any) => p?.url && num(p.total) > 0)
}
const normUrl = (u: string) => String(u || '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()
/** "www.site.com/used-inventory/index.htm" → "/used-inventory/index.htm" (short, readable). */
export function shortPath(url: string) {
  try { const u = new URL(url); const p = decodeURIComponent(u.pathname).replace(/\/$/, '') || '/'; return p.length > 46 ? `${p.slice(0, 43)}…` : p }
  catch { return String(url || '').slice(0, 46) }
}
/** Labels made unique: two "Pre-owned inventory" pages become "… (1)" / "… (2)". */
function pageLabels(pages: any[]) {
  const count = new Map<string, number>()
  for (const p of pages) count.set(p.label || 'Inventory', (count.get(p.label || 'Inventory') || 0) + 1)
  const seen = new Map<string, number>()
  return pages.map((p) => {
    const l = p.label || 'Inventory'
    if ((count.get(l) || 0) < 2) return l
    const i = (seen.get(l) || 0) + 1; seen.set(l, i)
    return `${l} (${i})`
  })
}
function pctColor(pct: number) { return pct >= 15 ? '#b42318' : pct >= 5 ? '#b54708' : '#15803d' }
function miniBar(pct: number) {
  const w = Math.max(pct > 0 ? 4 : 0, Math.min(100, Math.round(pct)))
  const fill = pct >= 15 ? '#e5484d' : pct >= 5 ? '#f59e0b' : '#16a34a'
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr>${w ? `<td width="${w}%" height="6" style="height:6px;line-height:6px;font-size:0;background:${fill};border-radius:3px 0 0 3px;">&nbsp;</td>` : ''}<td width="${100 - w}%" height="6" style="height:6px;line-height:6px;font-size:0;background:#eaecf0;border-radius:${w ? '0 3px 3px 0' : '3px'};">&nbsp;</td></tr></table>`
}

/**
 * Results grouped by crawl page (URL): one row per inventory page we reviewed with its vehicle count,
 * how many have no real photo and a share bar. Renders nothing for single-page audits.
 */
export function inventoryByPage(audit: any) {
  const pages = auditPages(audit)
  if (pages.length < 2) return ''
  const labels = pageLabels(pages)
  const rows = pages.map((p: any, i: number) => {
    const total = num(p.total), w = num(p.withoutReal)
    const pct = p.withoutRealPct != null ? num(p.withoutRealPct) : total ? Math.round((w / total) * 1000) / 10 : 0
    return `<tr><td style="padding:14px 18px;border-top:1px solid #eaecf0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="top" style="${FONT}">
          <div style="font-size:14px;line-height:20px;font-weight:600;color:#101828;">${esc(labels[i])}</div>
          <div style="margin-top:2px;font-size:12px;line-height:16px;"><a href="${esc(p.url)}" style="color:#667085;text-decoration:none;">${esc(shortPath(p.url))}</a></div>
        </td>
        <td width="180" align="right" valign="top" style="${FONT}">
          <div style="font-size:14px;line-height:20px;color:#101828;"><strong style="color:${pctColor(pct)};">${fmt(w)}</strong><span style="color:#667085;"> of ${fmt(total)}</span></div>
          <div style="margin-top:2px;font-size:12px;line-height:16px;color:${pctColor(pct)};font-weight:600;">${pct}% no real photo</div>
        </td>
      </tr><tr><td colspan="2" style="padding:8px 0 0;">${miniBar(pct)}</td></tr></table>
    </td></tr>`
  }).join('')
  const totalV = pages.reduce((a: number, p: any) => a + num(p.total), 0)
  const totalW = pages.reduce((a: number, p: any) => a + num(p.withoutReal), 0)
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #eaecf0;border-radius:12px;border-collapse:separate;">
  <tr><td style="padding:16px 18px 4px;${FONT}font-size:11px;font-weight:700;letter-spacing:1.6px;color:#15803d;">PAGE BY PAGE</td></tr>
  <tr><td style="padding:0 18px 12px;${FONT}font-size:13px;line-height:19px;color:#667085;">We reviewed ${pages.length} inventory pages on your site &mdash; ${fmt(totalW)} of ${fmt(totalV)} vehicles had no real photo.</td></tr>
  ${rows}
</table>`
}

function evidenceRow(e: any, first: boolean) {
  const p = e.title ? { title: e.title, stock: e.stock || '', verdict: e.verdict || 'missing' } : parseLabel(e.label)
  const badge = VERDICT_BADGE[p.verdict] || VERDICT_BADGE.missing!
  const meta = [p.stock ? `Stock #${esc(p.stock)}` : '', e.price ? esc(e.price) : '', e.condition === 'new' ? 'New' : e.condition ? 'Pre-owned' : ''].filter(Boolean).join(' &middot; ')
  return `<tr><td style="padding:14px 18px;${first ? '' : 'border-top:1px solid #eaecf0;'}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle" style="${FONT}">
          <div style="font-size:15px;line-height:20px;font-weight:600;color:#101828;">${esc(p.title) || 'Vehicle listing'}</div>
          <div style="margin-top:4px;font-size:12px;line-height:16px;color:#667085;"><span style="display:inline-block;padding:2px 7px;border-radius:999px;background:${badge.bg};color:${badge.fg};font-size:10px;font-weight:700;letter-spacing:.6px;">${badge.label}</span>${meta ? `&nbsp; ${meta}` : ''}</div>
        </td>
        <td width="110" align="right" valign="middle" style="${FONT}"><a href="${esc(e.url)}" style="font-size:13px;font-weight:600;color:#15803d;text-decoration:none;white-space:nowrap;">View listing &rarr;</a></td>
      </tr></table>
    </td></tr>`
}

/**
 * Evidence: a short, clickable list of real listings without a real photo so the dealer can check
 * for themselves. When the audit covered 2+ crawl pages the list is grouped by page (URL), each with
 * its own header and counts. Falls back to the uploaded audit screenshot; renders nothing when neither exists.
 */
export function auditEvidence(audit: any, opts: { max?: number, screenshot?: string } = {}) {
  const all = (Array.isArray(audit?.examples) ? audit.examples : []).filter((e: any) => e?.url)
  const pages = auditPages(audit)
  const grouped = pages.length >= 2 && all.some((e: any) => e.listUrl)
  const max = opts.max ?? (grouped ? Math.min(12, Math.max(6, pages.length * 3)) : 6)
  if (!all.length) {
    if (!opts.screenshot) return ''
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #eaecf0;border-radius:12px;">
  <tr><td style="padding:16px 18px 10px;${FONT}font-size:11px;font-weight:700;letter-spacing:1.6px;color:#15803d;">EVIDENCE / YOUR WEBSITE ON ${esc(String(audit?.auditDateUpper || '').trim()) || 'THE REVIEW DATE'}</td></tr>
  <tr><td style="padding:0 18px 18px;">${opts.screenshot}</td></tr>
</table>`
  }
  const total = num(audit?.totalMissingPhotos) || all.length
  let body = ''
  let shown = 0
  if (grouped) {
    const labels = pageLabels(pages)
    const per = Math.max(2, Math.floor(max / pages.length))
    const sections: string[] = []
    pages.forEach((pg: any, i: number) => {
      const items = all.filter((e: any) => normUrl(e.listUrl) === normUrl(pg.url)).slice(0, per)
      if (!items.length) return
      shown += items.length
      const pct = pg.withoutRealPct != null ? num(pg.withoutRealPct) : 0
      sections.push(`<tr><td style="padding:12px 18px 10px;background:#f9fafb;border-top:1px solid #eaecf0;border-bottom:1px solid #eaecf0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle" style="${FONT}"><div style="font-size:13px;line-height:18px;font-weight:700;color:#101828;">${esc(labels[i])}</div><div style="font-size:11px;line-height:15px;"><a href="${esc(pg.url)}" style="color:#667085;text-decoration:none;">${esc(shortPath(pg.url))}</a></div></td>
        <td align="right" valign="middle" style="${FONT}font-size:12px;line-height:16px;color:#475467;white-space:nowrap;"><strong style="color:${pctColor(pct)};">${fmt(num(pg.withoutReal))}</strong> of ${fmt(num(pg.total))} &middot; ${pct}%</td>
      </tr></table>
    </td></tr>${items.map((e: any, j: number) => evidenceRow(e, j === 0)).join('')}`)
    })
    // Examples whose page wasn't in the list (older crawl) still show, under "Other pages".
    const known = new Set(pages.map((p: any) => normUrl(p.url)))
    const rest = all.filter((e: any) => !known.has(normUrl(e.listUrl))).slice(0, Math.max(0, max - shown))
    if (rest.length) { shown += rest.length; sections.push(rest.map((e: any) => evidenceRow(e, false)).join('')) }
    body = sections.join('')
  }
  else {
    const list = all.slice(0, max)
    shown = list.length
    body = list.map((e: any, i: number) => evidenceRow(e, i === 0)).join('')
  }
  const more = total > shown ? `<tr><td style="padding:12px 18px;border-top:1px solid #eaecf0;background:#f9fafb;border-radius:0 0 12px 12px;${FONT}font-size:12px;line-height:18px;color:#667085;">+ ${fmt(total - shown)} more listing${total - shown === 1 ? '' : 's'} like these${grouped ? ` across these ${pages.length} pages` : ''} — happy to send the full list.</td></tr>` : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #eaecf0;border-radius:12px;border-collapse:separate;">
  <tr><td style="padding:16px 18px 4px;${FONT}font-size:11px;font-weight:700;letter-spacing:1.6px;color:#15803d;">SPOT-CHECK IT YOURSELF</td></tr>
  <tr><td style="padding:0 18px ${grouped ? 12 : 6}px;${FONT}font-size:13px;line-height:19px;color:#667085;">${grouped ? 'Listings from our review, grouped by the page they appear on — click any one to see it on your site.' : 'A few of the listings from our review — click any one to see it on your site.'}</td></tr>
  ${body}${more}
</table>`
}

/** Sample audit used for template previews (when no real dealership is picked). */
export const SAMPLE_AUDIT = {
  _id: 'sample-3',
  auditedAt: '2026-10-09T15:00:00.000Z',
  source: 'automated',
  inventoryUrl: 'https://www.bleakleykia.com/used-inventory',
  newTotal: 334, usedTotal: 171, newMissingPhotos: 12, usedMissingPhotos: 35,
  totalVehicles: 505, totalMissingPhotos: 47, missingPhotoPct: 9.3, newMissingPhotoPct: 3.6, usedMissingPhotoPct: 20.5,
  photoBreakdown: { real: 458, placeholder: 21, missing: 9, stock: 17, countStockAsMissing: true },
  pages: [
    { url: 'https://www.bleakleykia.com/used-inventory', label: 'Pre-owned inventory', kind: 'used', total: 139, withoutReal: 29, withoutRealPct: 20.9 },
    { url: 'https://www.bleakleykia.com/certified-inventory', label: 'Certified pre-owned', kind: 'certified', total: 32, withoutReal: 6, withoutRealPct: 18.8 },
    { url: 'https://www.bleakleykia.com/new-inventory', label: 'New inventory', kind: 'new', total: 334, withoutReal: 12, withoutRealPct: 3.6 },
  ],
  examples: [
    { url: 'https://www.bleakleykia.com/used/2019-kia-soul', listUrl: 'https://www.bleakleykia.com/used-inventory', title: 'Used 2019 Kia Soul LX', stock: 'K24518A', price: '$15,995', condition: 'used', verdict: 'placeholder' },
    { url: 'https://www.bleakleykia.com/used/2021-honda-crv', listUrl: 'https://www.bleakleykia.com/used-inventory', title: 'Used 2021 Honda CR-V EX AWD', stock: 'K24602B', price: '$26,480', condition: 'used', verdict: 'placeholder' },
    { url: 'https://www.bleakleykia.com/used/2018-ford-f150', listUrl: 'https://www.bleakleykia.com/used-inventory', title: 'Used 2018 Ford F-150 XLT', stock: 'K24477C', price: '$27,900', condition: 'used', verdict: 'missing' },
    { url: 'https://www.bleakleykia.com/used/2022-kia-telluride', listUrl: 'https://www.bleakleykia.com/certified-inventory', title: 'Certified 2022 Kia Telluride EX', stock: 'K24631', price: '$38,750', condition: 'certified', verdict: 'stock' },
    { url: 'https://www.bleakleykia.com/used/2017-toyota-camry', listUrl: 'https://www.bleakleykia.com/certified-inventory', title: 'Used 2017 Toyota Camry SE', stock: 'K24390B', price: '$16,250', condition: 'used', verdict: 'placeholder' },
    { url: 'https://www.bleakleykia.com/new/2026-kia-sportage', listUrl: 'https://www.bleakleykia.com/new-inventory', title: 'New 2026 Kia Sportage LX', stock: 'K26114', price: '$29,415', condition: 'new', verdict: 'placeholder' },
    { url: 'https://www.bleakleykia.com/new/2026-kia-k5', listUrl: 'https://www.bleakleykia.com/new-inventory', title: 'New 2026 Kia K5 GT-Line', stock: 'K26087', price: '$31,990', condition: 'new', verdict: 'missing' },
  ],
  screenshotFileId: null,
}
/** Earlier sample audits (≈3 months and ≈7 weeks before) so previews show "then vs now". */
export const SAMPLE_HISTORY = [
  { _id: 'sample-1', auditedAt: '2026-07-08T15:00:00.000Z', newTotal: 318, usedTotal: 158, newMissingPhotos: 9, usedMissingPhotos: 19, totalVehicles: 476, totalMissingPhotos: 28, missingPhotoPct: 5.9, newMissingPhotoPct: 2.8, usedMissingPhotoPct: 12 },
  { _id: 'sample-2', auditedAt: '2026-08-20T15:00:00.000Z', newTotal: 327, usedTotal: 164, newMissingPhotos: 10, usedMissingPhotos: 27, totalVehicles: 491, totalMissingPhotos: 37, missingPhotoPct: 7.5, newMissingPhotoPct: 3.1, usedMissingPhotoPct: 16.5 },
] as any[]
SAMPLE_HISTORY.push(SAMPLE_AUDIT)
export const SAMPLE_DEALERSHIP = { _id: null, name: 'Bleakley Kia', dealerGroup: 'Bleakley Auto Group', city: 'Hartford', state: 'CT', website: 'https://www.bleakleykia.com' }
export const SAMPLE_CONTACT = { firstName: 'Mike', lastName: 'Rivera', jobTitle: 'General Manager', email: 'mike@bleakleykia.com' }
export const SAMPLE_SENDER = { displayName: 'Shams Zia', title: 'Owner', company: 'ZRZ OPS LLC', phone: '(203) 535-7655', email: 'szia@turbocleanusa.com', tagline: '', region: 'Connecticut & Massachusetts' }
