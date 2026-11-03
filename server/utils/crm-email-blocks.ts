/**
 * Ready-made, email-safe HTML blocks built from the latest inventory audit. Templates drop them in
 * with a single merge field (e.g. {{auditEvidence}}); when there is no data the block renders as
 * nothing, so a template never shows an empty section.
 *
 * Rules for every block: tables only, inline styles, no images, no web fonts, works in Outlook,
 * Gmail and Apple Mail, 520px content width (inside a 600px email with 40px side padding).
 */

/** Merge fields whose value is HTML and must not be escaped. */
export const RAW_HTML_FIELDS = new Set(['auditScreenshot', 'auditEvidence', 'auditBreakdown', 'usedPhotoBar', 'newInventoryNote', 'auditTrend'])

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

/**
 * Evidence: a short, clickable list of real listings without a real photo so the dealer can check
 * for themselves. Falls back to the uploaded audit screenshot; renders nothing when neither exists.
 */
export function auditEvidence(audit: any, opts: { max?: number, screenshot?: string } = {}) {
  const max = opts.max ?? 6
  const list = (Array.isArray(audit?.examples) ? audit.examples : []).filter((e: any) => e?.url).slice(0, max)
  if (!list.length) {
    if (!opts.screenshot) return ''
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #eaecf0;border-radius:12px;">
  <tr><td style="padding:16px 18px 10px;${FONT}font-size:11px;font-weight:700;letter-spacing:1.6px;color:#15803d;">EVIDENCE / YOUR WEBSITE ON ${esc(String(audit?.auditDateUpper || '').trim()) || 'THE REVIEW DATE'}</td></tr>
  <tr><td style="padding:0 18px 18px;">${opts.screenshot}</td></tr>
</table>`
  }
  const total = num(audit?.totalMissingPhotos) || list.length
  const rows = list.map((e: any, i: number) => {
    const p = e.title ? { title: e.title, stock: e.stock || '', verdict: e.verdict || 'missing' } : parseLabel(e.label)
    const badge = VERDICT_BADGE[p.verdict] || VERDICT_BADGE.missing!
    const meta = [p.stock ? `Stock #${esc(p.stock)}` : '', e.price ? esc(e.price) : '', e.condition === 'new' ? 'New' : e.condition ? 'Pre-owned' : ''].filter(Boolean).join(' &middot; ')
    return `<tr><td style="padding:14px 18px;${i ? 'border-top:1px solid #eaecf0;' : ''}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle" style="${FONT}">
          <div style="font-size:15px;line-height:20px;font-weight:600;color:#101828;">${esc(p.title) || 'Vehicle listing'}</div>
          <div style="margin-top:4px;font-size:12px;line-height:16px;color:#667085;"><span style="display:inline-block;padding:2px 7px;border-radius:999px;background:${badge.bg};color:${badge.fg};font-size:10px;font-weight:700;letter-spacing:.6px;">${badge.label}</span>${meta ? `&nbsp; ${meta}` : ''}</div>
        </td>
        <td width="110" align="right" valign="middle" style="${FONT}"><a href="${esc(e.url)}" style="font-size:13px;font-weight:600;color:#15803d;text-decoration:none;white-space:nowrap;">View listing &rarr;</a></td>
      </tr></table>
    </td></tr>`
  }).join('')
  const more = total > list.length ? `<tr><td style="padding:12px 18px;border-top:1px solid #eaecf0;background:#f9fafb;border-radius:0 0 12px 12px;${FONT}font-size:12px;line-height:18px;color:#667085;">+ ${fmt(total - list.length)} more listing${total - list.length === 1 ? '' : 's'} like these — happy to send the full list.</td></tr>` : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #eaecf0;border-radius:12px;border-collapse:separate;">
  <tr><td style="padding:16px 18px 4px;${FONT}font-size:11px;font-weight:700;letter-spacing:1.6px;color:#15803d;">SPOT-CHECK IT YOURSELF</td></tr>
  <tr><td style="padding:0 18px 6px;${FONT}font-size:13px;line-height:19px;color:#667085;">A few of the listings from our review — click any one to see it on your site.</td></tr>
  ${rows}${more}
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
  examples: [
    { url: 'https://www.bleakleykia.com/used/2019-kia-soul', title: 'Used 2019 Kia Soul LX', stock: 'K24518A', price: '$15,995', condition: 'used', verdict: 'placeholder' },
    { url: 'https://www.bleakleykia.com/used/2021-honda-crv', title: 'Used 2021 Honda CR-V EX AWD', stock: 'K24602B', price: '$26,480', condition: 'used', verdict: 'placeholder' },
    { url: 'https://www.bleakleykia.com/used/2018-ford-f150', title: 'Used 2018 Ford F-150 XLT', stock: 'K24477C', price: '$27,900', condition: 'used', verdict: 'missing' },
    { url: 'https://www.bleakleykia.com/used/2022-kia-telluride', title: 'Certified 2022 Kia Telluride EX', stock: 'K24631', price: '$38,750', condition: 'certified', verdict: 'stock' },
    { url: 'https://www.bleakleykia.com/used/2017-toyota-camry', title: 'Used 2017 Toyota Camry SE', stock: 'K24390B', price: '$16,250', condition: 'used', verdict: 'placeholder' },
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
