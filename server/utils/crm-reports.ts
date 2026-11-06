/**
 * Dealer inventory reports + "then vs now" over time, and PDF rendering.
 *
 * - Every inventory audit gets its own analysis report, rendered once and stored exactly as it was
 *   (turboCleanCrmAuditReports) — so what a dealer was shown in March stays what they were shown.
 * - Trend: the latest audit is compared with the audit closest to ~3 months earlier (the "baseline")
 *   and with the one just before it. The numbers and a ready-made "Then vs now" block feed email
 *   merge fields ({{auditTrend}}, {{prevUsedMissingPhotos}}, {{auditPeriod}}, …) and the report.
 * - Public, signed report links ({{reportUrl}}) let a dealer open their own report without signing in.
 * - PDFs are printed by the same headless Chromium as the Inventory Scanner and cached by content hash.
 */
import { createHash, createHmac } from 'node:crypto'
import process from 'node:process'
import { Binary, ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import { CRM_COLLECTIONS } from './crm'
import { auditPages, shortPath } from './crm-email-blocks'

export const REPORTS_COLLECTION = 'turboCleanCrmAuditReports'
export const PDF_COLLECTION = 'turboCleanCrmPdfs'
const AUDITS = 'turboCleanCrmAudits'
export const REPORT_VERSION = 2

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v)) || 0
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
export const dayLabel = (iso: string) => { const d = new Date(iso); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}` }
const dayUpper = (iso: string) => { const d = new Date(iso); return `${MONTHS[d.getUTCMonth()]!.toUpperCase()} ${String(d.getUTCDate()).padStart(2, '0')}, ${d.getUTCFullYear()}` }
const pct1 = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 1000) / 10 : null
const FONT = `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;`

// ───────────────────────── Settings ─────────────────────────
/**
 * Where the "over time" chart appears (Email → Settings → Reports & emails). Stored once for the team.
 * The chart sits between markers in stored reports and email blocks, so switching it off takes effect
 * immediately — also for reports already stored.
 */
export interface ReportSettings { historyChartInReport: boolean, historyChartInEmail: boolean, onePointPerDay: boolean }
export const REPORT_SETTINGS_DEFAULTS: ReportSettings = { historyChartInReport: true, historyChartInEmail: true, onePointPerDay: true }
const SETTINGS = 'turboCleanCrmSettings'
export async function getReportSettings(db: Db): Promise<ReportSettings> {
  try {
    const d: any = await db.collection(SETTINGS).findOne({ _id: 'reports' as any })
    return { ...REPORT_SETTINGS_DEFAULTS, ...Object.fromEntries(Object.entries(d || {}).filter(([k, v]) => k in REPORT_SETTINGS_DEFAULTS && typeof v === 'boolean')) }
  } catch { return { ...REPORT_SETTINGS_DEFAULTS } }
}
export async function saveReportSettings(db: Db, body: any, actor: { id: string, name: string } | null) {
  const next = { ...(await getReportSettings(db)) }
  for (const k of Object.keys(REPORT_SETTINGS_DEFAULTS) as (keyof ReportSettings)[]) if (typeof body?.[k] === 'boolean') next[k] = body[k]
  await db.collection(SETTINGS).updateOne({ _id: 'reports' as any }, { $set: { ...next, updatedAt: new Date().toISOString(), updatedBy: actor } }, { upsert: true })
  return next
}
const HISTORY_OPEN = '<!--zrz-history-->', HISTORY_CLOSE = '<!--/zrz-history-->'
/** Remove the over-time chart (between the markers) from a report or an email block. */
export const stripHistory = (html: string) => String(html || '').replace(/<!--zrz-history-->[\s\S]*?<!--\/zrz-history-->/g, '')
/** Apply the settings to a stored report before it is shown or printed. */
export const applyReportSettings = (html: string, s: ReportSettings) => s.historyChartInReport ? html : stripHistory(html)
/** Several reviews on the same day (re-crawls) → keep the last one of each day, so the chart shows days, not attempts. */
export function onePerDay<T extends { auditedAt: string }>(history: T[]): T[] {
  const byDay = new Map<string, T>()
  for (const a of history) byDay.set(String(a.auditedAt).slice(0, 10), a)
  return [...byDay.values()].sort((a, b) => String(a.auditedAt).localeCompare(String(b.auditedAt)))
}

// ───────────────────────── Trend ─────────────────────────
/** Audits for one dealership, oldest → newest (only audits at or before `upTo`). */
export async function auditHistory(db: Db, dealershipId: string, upTo?: string) {
  const rows = await db.collection(AUDITS).find({ dealershipId }).sort({ auditedAt: -1, createdAt: -1 }).limit(60).toArray()
  return rows.filter(a => !upTo || String(a.auditedAt) <= upTo).reverse()
}

/** The earlier audit to compare with: closest to `days` before the latest (≥ 21 days apart), else the oldest earlier one. */
export function pickBaseline(history: any[], latest: any, days = 90) {
  const t = new Date(latest.auditedAt).getTime()
  const earlier = history.filter(a => String(a._id ?? a.id) !== String(latest._id ?? latest.id) && new Date(a.auditedAt).getTime() < t - 86_400_000)
  if (!earlier.length) return null
  const far = earlier.filter(a => t - new Date(a.auditedAt).getTime() >= 21 * 86_400_000)
  const pool = far.length ? far : earlier
  return pool.reduce((best, a) => Math.abs(t - new Date(a.auditedAt).getTime() - days * 86_400_000) < Math.abs(t - new Date(best.auditedAt).getTime() - days * 86_400_000) ? a : best)
}

export function periodLabel(fromIso: string, toIso: string) {
  const days = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000)
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`
  if (days < 60) return `${Math.round(days / 7)} weeks`
  const m = Math.round(days / 30.4)
  return m >= 12 && m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} months`
}
const signed = (n: number, unit = '') => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(Math.round(n * 10) / 10)}${unit}`

/** Merge values + the "Then vs now" email block. Everything is blank when there is no earlier audit. */
export function trendVars(latest: any | null, history: any[], opts: { onePerDay?: boolean } = {}) {
  const blank = { prevAuditDate: '', prevUsedTotal: '', prevUsedMissingPhotos: '', prevUsedMissingPhotoPct: '', prevTotalMissingPhotos: '', usedMissingChange: '', usedMissingPctChange: '', auditPeriod: '', trendWord: '', auditTrend: '', auditHistoryChart: '' }
  if (!latest) return blank
  const base = pickBaseline(history, latest)
  if (!base) return blank
  const nowM = num(latest.usedMissingPhotos), thenM = num(base.usedMissingPhotos)
  const nowP = latest.usedMissingPhotoPct ?? pct1(nowM, num(latest.usedTotal)), thenP = base.usedMissingPhotoPct ?? pct1(thenM, num(base.usedTotal))
  const change = nowM - thenM
  const pctChange = nowP != null && thenP != null ? nowP - thenP : null
  const period = periodLabel(base.auditedAt, latest.auditedAt)
  return {
    prevAuditDate: dayLabel(base.auditedAt),
    prevUsedTotal: String(num(base.usedTotal)),
    prevUsedMissingPhotos: String(thenM),
    prevUsedMissingPhotoPct: thenP == null ? '' : `${thenP}%`,
    prevTotalMissingPhotos: String(num(base.totalMissingPhotos)),
    usedMissingChange: signed(change),
    usedMissingPctChange: pctChange == null ? '' : signed(pctChange, ' pts'),
    auditPeriod: period,
    trendWord: change > 0 ? 'more' : change < 0 ? 'fewer' : 'the same number of',
    auditTrend: trendBlock(base, latest, opts.onePerDay === false ? history : onePerDay(history), { period, change, nowP, thenP }),
    auditHistoryChart: historyChartEmail(latest, opts.onePerDay === false ? history : onePerDay(history)),
  }
}

/** Email-safe "Then vs now" card (tables + inline styles, no images). */
function trendBlock(base: any, latest: any, history: any[], t: { period: string, change: number, nowP: number | null, thenP: number | null }) {
  const worse = t.change > 0
  const better = t.change < 0
  const accent = worse ? '#c62a2f' : better ? '#15803d' : '#344054'
  const arrow = worse ? '&uarr;' : better ? '&darr;' : '&rarr;'
  const sentence = worse
    ? `In ${t.period}, pre-owned cars without a real photo went from <strong style="color:#101828;">${fmt(num(base.usedMissingPhotos))}</strong> to <strong style="color:#c62a2f;">${fmt(num(latest.usedMissingPhotos))}</strong>. The gap is growing, not closing.`
    : better
      ? `In ${t.period}, pre-owned cars without a real photo went from <strong style="color:#101828;">${fmt(num(base.usedMissingPhotos))}</strong> down to <strong style="color:#15803d;">${fmt(num(latest.usedMissingPhotos))}</strong> &mdash; real progress, with ${fmt(num(latest.usedMissingPhotos))} still to close.`
      : `${t.period} later, the same <strong style="color:#101828;">${fmt(num(latest.usedMissingPhotos))}</strong> pre-owned cars are still online without a real photo.`
  const col = (a: any, label: string, color: string, p: number | null) => `<td class="stack" width="44%" valign="top" style="background:#ffffff;border:1px solid #eaecf0;border-radius:12px;padding:16px;">
      <div style="${FONT}font-size:11px;font-weight:700;letter-spacing:1.4px;color:#667085;">${label} &middot; ${dayUpper(a.auditedAt)}</div>
      <div style="${FONT}margin-top:6px;font-size:36px;line-height:40px;font-weight:800;letter-spacing:-1px;color:${color};">${fmt(num(a.usedMissingPhotos))}</div>
      <div style="${FONT}margin-top:4px;font-size:12px;line-height:17px;color:#667085;">of ${fmt(num(a.usedTotal))} pre-owned listings${p != null ? ` &middot; ${p}%` : ''}</div>
    </td>`
  // Mini history (up to 6 audits): one bar per audit, share of pre-owned without a real photo.
  const points = history.filter(a => num(a.usedTotal) > 0).slice(-6)
  const maxP = Math.max(1, ...points.map(a => a.usedMissingPhotoPct ?? pct1(num(a.usedMissingPhotos), num(a.usedTotal)) ?? 0))
  const bars = points.length >= 3
    ? `${HISTORY_OPEN}<tr><td colspan="3" style="padding:16px 0 0;">
        <div style="${FONT}font-size:11px;font-weight:700;letter-spacing:1.4px;color:#667085;padding-bottom:6px;">EVERY REVIEW SO FAR</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${points.map((a) => {
          const p = a.usedMissingPhotoPct ?? pct1(num(a.usedMissingPhotos), num(a.usedTotal)) ?? 0
          const w = Math.max(2, Math.round((p / maxP) * 100))
          const isNow = String(a._id ?? a.id) === String(latest._id ?? latest.id)
          return `<tr><td width="92" style="${FONT}padding:3px 8px 3px 0;font-size:11px;color:#667085;white-space:nowrap;">${dayLabel(a.auditedAt).replace(/, \d{4}$/, '')}</td>
            <td style="padding:3px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="${w}%" height="10" style="height:10px;line-height:10px;font-size:0;background:${isNow ? accent : '#cbd5e1'};border-radius:5px;">&nbsp;</td><td style="font-size:0;">&nbsp;</td></tr></table></td>
            <td width="54" align="right" style="${FONT}padding:3px 0 3px 8px;font-size:11px;font-weight:700;color:${isNow ? accent : '#475467'};">${p}%</td></tr>`
        }).join('')}</table>
      </td></tr>${HISTORY_CLOSE}`
    : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8f7;border:1px solid #e4e9e6;border-radius:14px;border-collapse:separate;">
  <tr><td style="padding:18px 18px 4px;${FONT}font-size:11px;font-weight:700;letter-spacing:1.8px;color:#15803d;">THEN VS NOW &middot; ${esc(t.period.toUpperCase())}</td></tr>
  <tr><td style="padding:10px 18px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${col(base, 'THEN', '#344054', t.thenP)}
      <td class="stack-gap" width="12%" align="center" valign="middle" style="${FONT}font-size:26px;font-weight:800;color:${accent};">${arrow}</td>
      ${col(latest, 'NOW', accent, t.nowP)}
    </tr>${bars}</table>
  </td></tr>
  <tr><td style="padding:14px 18px 18px;${FONT}font-size:14px;line-height:22px;color:#475467;">${sentence}</td></tr>
</table>`
}

/**
 * Email-safe "over time" column chart ({{auditHistoryChart}}): share of pre-owned listings without a
 * real photo at each review (up to 8, one per day). Tables only — works in Outlook / Gmail / Apple Mail.
 */
export function historyChartEmail(latest: any, history: any[]) {
  const pts = history.filter(a => num(a.usedTotal) > 0).slice(-8).map(a => ({ a, p: a.usedMissingPhotoPct ?? pct1(num(a.usedMissingPhotos), num(a.usedTotal)) ?? 0 }))
  if (pts.length < 2) return ''
  const maxP = Math.max(10, ...pts.map(x => x.p))
  const H = 110
  const first = pts[0]!.p, last = pts[pts.length - 1]!.p
  const accent = last > first ? '#c62a2f' : last < first ? '#15803d' : '#344054'
  const cols = pts.map(({ a, p }) => {
    const isNow = String(a._id ?? a.id) === String(latest?._id ?? latest?.id)
    const h = Math.max(4, Math.round((p / maxP) * H))
    return `<td valign="bottom" align="center" style="padding:0 4px;">
      <div style="${FONT}font-size:11px;font-weight:700;color:${isNow ? accent : '#475467'};padding-bottom:4px;">${p}%</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="${h}" style="height:${h}px;line-height:${h}px;font-size:0;background:${isNow ? accent : '#cbd5e1'};border-radius:6px 6px 0 0;">&nbsp;</td></tr></table>
      <div style="${FONT}font-size:10px;color:#667085;padding-top:5px;white-space:nowrap;">${dayLabel(a.auditedAt).replace(/, \d{4}$/, '')}</div>
    </td>`
  }).join('')
  return `${HISTORY_OPEN}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #eaecf0;border-radius:12px;border-collapse:separate;">
  <tr><td style="padding:16px 18px 2px;${FONT}font-size:11px;font-weight:700;letter-spacing:1.6px;color:#15803d;">PRE-OWNED WITHOUT A REAL PHOTO &middot; OVER TIME</td></tr>
  <tr><td style="padding:12px 14px 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cols}</tr></table></td></tr>
</table>${HISTORY_CLOSE}`
}

// ───────────────────────── Public report links ─────────────────────────
const PUBLIC_URL = () => (process.env.CRM_PUBLIC_URL || process.env.NUXT_PUBLIC_SITE_URL || 'https://zrzops.com').replace(/\/$/, '')
const secret = () => process.env.CRM_REPORT_SECRET || process.env.CRM_UNSUBSCRIBE_SECRET || process.env.RESEND_WEBHOOK_SECRET || process.env.RESEND_API_KEY || 'zrz-report'
export const reportToken = (auditId: string) => createHmac('sha256', secret()).update(`report:${auditId}`).digest('hex').slice(0, 32)
export const reportUrl = (auditId: string) => `${PUBLIC_URL()}/api/crm/audits/${auditId}/report?t=${reportToken(auditId)}`

// ───────────────────────── The report document ─────────────────────────
function lineChartSvg(points: { label: string, p: number }[], accent: string) {
  if (points.length < 2) return ''
  const W = 640, H = 170, padL = 40, padR = 34, padT = 18, padB = 28
  // Head-room above the highest point so its value label never sits on the top grid label.
  const max = Math.max(10, Math.ceil((Math.max(...points.map(p => p.p)) + 8) / 10) * 10)
  const x = (i: number) => padL + (i * (W - padL - padR)) / (points.length - 1)
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB)
  const grid = [0, max / 2, max].map(v => `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="#eaecf0"/><text x="${padL - 6}" y="${y(v) + 4}" font-size="10" text-anchor="end" fill="#98a2b3">${v}%</text>`).join('')
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join(' ')
  const area = `${path} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`
  const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.p)}" r="${i === points.length - 1 ? 5 : 3.5}" fill="${i === points.length - 1 ? accent : '#ffffff'}" stroke="${accent}" stroke-width="2"/><text x="${x(i)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#667085">${esc(p.label)}</text><text x="${x(i)}" y="${y(p.p) - 9}" font-size="10" font-weight="700" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}" fill="#344054">${p.p}%</text>`).join('')
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Share of pre-owned listings without a real photo over time" style="display:block">${grid}<path d="${area}" fill="${accent}" opacity="0.08"/><path d="${path}" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}</svg>`
}

export function buildReportHtml(o: { dealership: any, audit: any, history: any[], sender: { name: string, company: string, email: string, phone: string }, onePointPerDay?: boolean }) {
  const { dealership: d, audit: a, history, sender } = o
  const base = pickBaseline(history, a)
  const prev = [...history].reverse().find(x => new Date(x.auditedAt).getTime() < new Date(a.auditedAt).getTime() - 86_400_000) || null
  const b = a.photoBreakdown || null
  const usedP = a.usedMissingPhotoPct ?? pct1(num(a.usedMissingPhotos), num(a.usedTotal))
  const newP = a.newMissingPhotoPct ?? pct1(num(a.newMissingPhotos), num(a.newTotal))
  const worse = base ? num(a.usedMissingPhotos) > num(base.usedMissingPhotos) : false
  const accent = '#16a34a'
  const kpi = (label: string, value: string, sub: string, tone = '#101828') => `<div class="kpi"><div class="kpi-l">${label}</div><div class="kpi-v" style="color:${tone}">${value}</div><div class="kpi-s">${sub}</div></div>`
  const cmpRow = (label: string, x: any, highlight = false) => x ? `<tr${highlight ? ' class="hl"' : ''}><td>${label}</td><td>${dayLabel(x.auditedAt)}</td><td class="r">${fmt(num(x.usedTotal))}</td><td class="r">${fmt(num(x.usedMissingPhotos))}</td><td class="r">${x.usedMissingPhotoPct ?? pct1(num(x.usedMissingPhotos), num(x.usedTotal)) ?? '—'}%</td><td class="r">${fmt(num(x.totalVehicles))}</td><td class="r">${fmt(num(x.totalMissingPhotos))}</td></tr>` : ''
  const points = (o.onePointPerDay === false ? history : onePerDay(history)).filter(x => num(x.usedTotal) > 0).slice(-10).map(x => ({ label: dayLabel(x.auditedAt).replace(/, (\d{4})$/, " '$1").replace(/'(\d\d)(\d\d)$/, "'$2"), p: x.usedMissingPhotoPct ?? pct1(num(x.usedMissingPhotos), num(x.usedTotal)) ?? 0 }))
  const examples = (Array.isArray(a.examples) ? a.examples : []).filter((e: any) => e?.url).slice(0, 40)
  const pages = auditPages(a)
  const byPage = pages.length >= 2
  const norm = (u: string) => String(u || '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()
  const toneOf = (p: number) => p >= 15 ? '#c62a2f' : p >= 5 ? '#b54708' : '#15803d'
  const pagePct = (pg: any) => pg.withoutRealPct ?? pct1(num(pg.withoutReal), num(pg.total)) ?? 0
  const verdict = (e: any) => e.verdict === 'stock' ? ['Stock image', 'b-stock'] : e.verdict === 'placeholder' ? ['Placeholder', 'b-red'] : /stock/i.test(e.label || '') ? ['Stock image', 'b-stock'] : ['No photo', 'b-red']
  const exampleTable = (list: any[]) => `<table class="t"><thead><tr><th>Vehicle</th><th>Stock #</th><th class="r">Price</th><th>Issue</th><th></th></tr></thead><tbody>
      ${list.map((e: any) => { const [label, cls] = verdict(e); const title = e.title || String(e.label || '').split(' — ')[0]!.replace(/\s+#\S+$/, ''); const stock = e.stock || (String(e.label || '').match(/#(\S+)/)?.[1] || ''); return `<tr><td>${esc(title) || 'Vehicle'}</td><td>${esc(stock)}</td><td class="r">${esc(e.price || '')}</td><td><span class="badge ${cls}">${label}</span></td><td class="r"><a href="${esc(e.url)}" target="_blank" rel="noopener">View &rarr;</a></td></tr>` }).join('')}
    </tbody></table>`
  const issues = [...(a.merchandisingIssues || []), ...(a.websiteIssues || [])]
  const period = base ? periodLabel(base.auditedAt, a.auditedAt) : ''
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(d.name)} — Inventory photo report · ${dayLabel(a.auditedAt)}</title>
<style>
  @page { size: Letter; margin: 0.45in; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; background: #eef1ef; color: #101828; ${FONT} }
  .sheet { max-width: 860px; margin: 24px auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 24px 60px -30px rgba(0,0,0,.35); }
  @media print { body { background: #fff; } .sheet { margin: 0; max-width: none; border-radius: 0; box-shadow: none; } .noprint { display: none !important; } }
  .hero { background: #0e1714; color: #fff; padding: 32px 40px 30px; border-bottom: 3px solid #22c55e; }
  .brand { font-weight: 800; letter-spacing: 4px; font-size: 16px; } .brand span { color: #4ade80; }
  .eyebrow { margin-top: 22px; font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #86efac; text-transform: uppercase; }
  h1 { margin: 8px 0 0; font-size: 32px; line-height: 38px; letter-spacing: -.6px; }
  .hero p { margin: 10px 0 0; color: #c9d6d0; font-size: 14px; line-height: 21px; }
  .body { padding: 28px 40px 34px; }
  h2 { margin: 30px 0 12px; font-size: 18px; letter-spacing: -.2px; } h2:first-child { margin-top: 0; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .kpi { border: 1px solid #eaecf0; border-radius: 12px; padding: 14px; background: #f9fafb; }
  .kpi-l { font-size: 10px; font-weight: 700; letter-spacing: 1px; color: #667085; text-transform: uppercase; }
  .kpi-v { margin-top: 4px; font-size: 28px; font-weight: 800; letter-spacing: -.6px; }
  .kpi-s { font-size: 11px; color: #667085; margin-top: 2px; }
  .callout { margin-top: 14px; border-left: 4px solid ${worse ? '#e5484d' : accent}; background: ${worse ? '#fff7f7' : '#effaf3'}; border-radius: 0 10px 10px 0; padding: 12px 16px; font-size: 14px; line-height: 21px; color: #344054; }
  table.t { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.t th { text-align: left; font-size: 10px; letter-spacing: .8px; text-transform: uppercase; color: #667085; font-weight: 700; padding: 8px 10px; background: #f6f8f7; border-bottom: 1px solid #eaecf0; }
  table.t td { padding: 8px 10px; border-bottom: 1px solid #f0f2f4; } table.t .r { text-align: right; font-variant-numeric: tabular-nums; }
  table.t tr.hl td { background: #effaf3; font-weight: 700; }
  .bar { height: 6px; border-radius: 3px; background: #eaecf0; overflow: hidden; margin: 2px 0 3px; } .bar i { display: block; height: 100%; border-radius: 3px; }
  .grp { border: 1px solid #eaecf0; border-radius: 12px; overflow: hidden; margin-top: 12px; break-inside: avoid; } .grp .t td:first-child, .grp .t th:first-child { padding-left: 14px; }
  .grp-h { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 14px; background: #f6f8f7; border-bottom: 1px solid #eaecf0; font-size: 13px; } .grp-h a { color: #667085; font-size: 11px; margin-left: 6px; }
  .chart { border: 1px solid #eaecf0; border-radius: 12px; padding: 12px 12px 4px; }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; } .chip { border: 1px solid #eaecf0; border-radius: 999px; padding: 6px 12px; font-size: 12px; background: #f9fafb; } .chip b { font-size: 14px; }
  .badge { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 10px; font-weight: 700; letter-spacing: .4px; }
  .b-red { background: #fde8e8; color: #b42318; } .b-stock { background: #f1ecfe; color: #5b3cc4; }
  a { color: #15803d; text-decoration: none; }
  .foot { margin-top: 30px; padding-top: 16px; border-top: 1px solid #eaecf0; font-size: 11px; line-height: 17px; color: #667085; display: flex; gap: 20px; justify-content: space-between; flex-wrap: wrap; }
  .actions { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; justify-content: flex-end; max-width: 860px; margin: 0 auto; padding: 12px 0 0; }
  .actions a { background: #0e1714; color: #fff; border-radius: 10px; padding: 9px 14px; font-size: 13px; font-weight: 600; }
  @media (max-width: 640px) { .kpis { grid-template-columns: repeat(2, 1fr); } .hero, .body { padding-left: 20px; padding-right: 20px; } h1 { font-size: 26px; line-height: 31px; } }
</style></head>
<body>
<div class="actions noprint">__REPORT_ACTIONS__</div>
<div class="sheet">
  <div class="hero">
    <div class="brand">ZRZ<span>&nbsp;OPS</span></div>
    <div class="eyebrow">Inventory photo report &middot; ${dayUpper(a.auditedAt)}</div>
    <h1>${esc(d.name)}</h1>
    <p>${[d.city, d.state].filter(Boolean).map(esc).join(', ')}${byPage ? ` &middot; reviewed ${pages.length} inventory pages` : ''}${!byPage && a.inventoryUrl ? ` &middot; reviewed <a href="${esc(a.inventoryUrl)}" style="color:#86efac">${esc(String(a.inventoryUrl).replace(/^https?:\/\/(www\.)?/, '').slice(0, 70))}</a>` : ''}</p>
  </div>
  <div class="body">
    <h2>At a glance</h2>
    <div class="kpis">
      ${kpi('Vehicles listed', fmt(num(a.totalVehicles)), `${fmt(num(a.newTotal))} new · ${fmt(num(a.usedTotal))} pre-owned`)}
      ${kpi('Without a real photo', fmt(num(a.totalMissingPhotos)), `${a.missingPhotoPct ?? '—'}% of all listings`, '#c62a2f')}
      ${kpi('Pre-owned gap', usedP == null ? '—' : `${usedP}%`, `${fmt(num(a.usedMissingPhotos))} of ${fmt(num(a.usedTotal))} cars`, '#c62a2f')}
      ${kpi('New-car gap', newP == null ? '—' : `${newP}%`, `${fmt(num(a.newMissingPhotos))} of ${fmt(num(a.newTotal))} cars`)}
    </div>
    ${a.coverage?.advertised && num(a.coverage.advertised) > num(a.coverage.checked) ? `<div class="callout" style="border-left-color:#f59e0b;background:#fffbeb"><strong>Coverage:</strong> we checked ${fmt(num(a.coverage.checked))} of the ${fmt(num(a.coverage.advertised))} vehicles the website lists${num(a.coverage.blockedPages) ? ' &mdash; the site would not show us the rest' : ''}. The percentages above are of the ${fmt(num(a.coverage.checked))} vehicles checked.</div>` : ''}
    ${base ? `<div class="callout"><strong>Then vs now (${esc(period)}):</strong> on ${dayLabel(base.auditedAt)}, ${fmt(num(base.usedMissingPhotos))} of ${fmt(num(base.usedTotal))} pre-owned listings had no real photo. On ${dayLabel(a.auditedAt)} it was <strong>${fmt(num(a.usedMissingPhotos))} of ${fmt(num(a.usedTotal))}</strong> (${signed(num(a.usedMissingPhotos) - num(base.usedMissingPhotos))} cars${usedP != null && (base.usedMissingPhotoPct ?? null) != null ? `, ${signed(usedP - base.usedMissingPhotoPct, ' pts')}` : ''}).</div>` : `<div class="callout"><strong>Baseline review.</strong> This is the first review on record &mdash; future reviews will show how the gap changes over time.</div>`}

    ${points.length >= 2 ? `${HISTORY_OPEN}<h2>Pre-owned listings without a real photo, over time</h2><div class="chart">${lineChartSvg(points, worse ? '#e5484d' : accent)}</div>${HISTORY_CLOSE}` : ''}

    ${base || prev ? `<h2>Review history</h2><table class="t"><thead><tr><th></th><th>Date</th><th class="r">Pre-owned</th><th class="r">No real photo</th><th class="r">Share</th><th class="r">All listings</th><th class="r">All without</th></tr></thead><tbody>
      ${base ? cmpRow(`~${esc(period)} ago`, base) : ''}${prev && (!base || String(prev._id ?? prev.id) !== String(base._id ?? base.id)) ? cmpRow('Previous review', prev) : ''}${cmpRow('This review', a, true)}
    </tbody></table>` : ''}

    ${b ? `<h2>What we found</h2><div class="chips">
      <span class="chip"><b>${fmt(num(b.real))}</b> real photos</span>
      ${num(b.placeholder) ? `<span class="chip"><b style="color:#c62a2f">${fmt(num(b.placeholder))}</b> &ldquo;photos coming soon&rdquo; placeholders</span>` : ''}
      ${num(b.missing) ? `<span class="chip"><b style="color:#c62a2f">${fmt(num(b.missing))}</b> with no image at all</span>` : ''}
      ${num(b.stock) ? `<span class="chip"><b style="color:#5b3cc4">${fmt(num(b.stock))}</b> stock / catalog images${b.countStockAsMissing === false ? '' : ' (counted as no real photo)'}</span>` : ''}
    </div>` : ''}

    ${issues.length ? `<h2>Merchandising &amp; website issues</h2><div class="chips">${issues.map((i: string) => `<span class="chip">${esc(i)}</span>`).join('')}</div>` : ''}

    ${byPage ? `<h2>By inventory page</h2>
    <table class="t pages"><thead><tr><th>Page</th><th class="r">Vehicles</th><th class="r">No real photo</th><th style="width:34%">Share</th></tr></thead><tbody>
      ${pages.map((pg: any) => { const p = pagePct(pg); return `<tr><td><div style="font-weight:700;color:#101828">${esc(pg.label || 'Inventory')}</div><a href="${esc(pg.url)}" target="_blank" rel="noopener" style="color:#667085;font-size:11px">${esc(shortPath(pg.url))}</a></td><td class="r">${fmt(num(pg.total))}</td><td class="r" style="color:${toneOf(p)};font-weight:700">${fmt(num(pg.withoutReal))}</td><td><div class="bar"><i style="width:${Math.max(p > 0 ? 2 : 0, Math.min(100, p))}%;background:${toneOf(p)}"></i></div><span style="font-size:11px;color:${toneOf(p)};font-weight:700">${p}%</span>${num(pg.placeholder) || num(pg.missing) || num(pg.stock) ? `<span style="font-size:11px;color:#667085"> &middot; ${[num(pg.placeholder) ? `${fmt(num(pg.placeholder))} placeholder` : '', num(pg.missing) ? `${fmt(num(pg.missing))} no image` : '', num(pg.stock) ? `${fmt(num(pg.stock))} stock` : ''].filter(Boolean).join(', ')}</span>` : ''}</td></tr>` }).join('')}
    </tbody></table>` : ''}

    ${examples.length ? `<h2>Listings without a real photo${num(a.totalMissingPhotos) > examples.length ? ` <span style="font-weight:400;color:#667085;font-size:13px">(${examples.length} of ${fmt(num(a.totalMissingPhotos))})</span>` : ''}</h2>
    ${byPage && examples.some((e: any) => e.listUrl)
      ? [...pages.map((pg: any) => ({ pg, list: examples.filter((e: any) => norm(e.listUrl) === norm(pg.url)) })), { pg: null as any, list: examples.filter((e: any) => !pages.some((pg: any) => norm(pg.url) === norm(e.listUrl))) }]
          .filter(g => g.list.length)
          .map(g => `<div class="grp"><div class="grp-h"><div><b>${esc(g.pg ? g.pg.label || 'Inventory' : 'Other pages')}</b>${g.pg ? ` <a href="${esc(g.pg.url)}" target="_blank" rel="noopener">${esc(shortPath(g.pg.url))}</a>` : ''}</div>${g.pg ? `<span style="color:${toneOf(pagePct(g.pg))}"><b>${fmt(num(g.pg.withoutReal))}</b> of ${fmt(num(g.pg.total))} &middot; ${pagePct(g.pg)}%</span>` : ''}</div>${exampleTable(g.list)}</div>`).join('')
      : exampleTable(examples)}` : ''}

    <div class="foot">
      <div style="max-width:520px"><strong style="color:#344054">How we measured.</strong> We reviewed every publicly listed vehicle on ${byPage ? `the ${pages.length} inventory pages above` : 'the dealership&rsquo;s website'} on ${dayLabel(a.auditedAt)} and checked the main photo of each one. A listing counts as &ldquo;without a real photo&rdquo; when the image is missing, a &ldquo;photos coming soon&rdquo; placeholder${b?.countStockAsMissing === false ? '' : ', or a stock / catalog image instead of the actual car'}. Counts change as inventory is updated.</div>
      <div><strong style="color:#344054">${esc(sender.name || sender.company)}</strong><br>${esc(sender.company)}${sender.phone ? `<br>${esc(sender.phone)}` : ''}${sender.email ? `<br><a href="mailto:${esc(sender.email)}">${esc(sender.email)}</a>` : ''}<br><span style="color:#98a2b3">Report ${esc(String(a._id ?? a.id).slice(-8).toUpperCase())} &middot; v${REPORT_VERSION}</span></div>
    </div>
  </div>
</div>
</body></html>`
}

// ───────────────────────── Stored snapshots ─────────────────────────
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

async function senderFor(db: Db, audit: any) {
  try {
    const { getSenderProfile } = await import('./crm-email')
    const by = audit?.auditedBy?.id && audit.auditedBy.id !== 'automation' ? { id: audit.auditedBy.id, name: audit.auditedBy.name || '', email: audit.auditedBy.email || '' } : null
    const p = await getSenderProfile(db, by)
    return { name: p.displayName, company: p.company || 'ZRZ OPS', email: p.email || process.env.CRM_FROM_EMAIL || '', phone: p.phone }
  } catch { return { name: '', company: 'ZRZ OPS', email: process.env.CRM_FROM_EMAIL || '', phone: '' } }
}

/** Render + store the report for an audit (once). Called when an audit is recorded. */
export async function snapshotAuditReport(db: Db, dealership: any, audit: any) {
  const col = db.collection(REPORTS_COLLECTION)
  const auditId = String(audit._id ?? audit.id)
  const existing = await col.findOne({ auditId })
  if (existing) return existing
  const history = await auditHistory(db, String(dealership._id), audit.auditedAt)
  if (!history.some(h => String(h._id) === auditId)) history.push(audit)
  const html = buildReportHtml({ dealership, audit, history, sender: await senderFor(db, audit), onePointPerDay: (await getReportSettings(db)).onePointPerDay })
  const base = pickBaseline(history, audit)
  const doc = {
    auditId, dealershipId: String(dealership._id), dealershipName: dealership.name || '', auditedAt: audit.auditedAt,
    version: REPORT_VERSION, html, sha256: sha(html), createdAt: new Date().toISOString(),
    data: { totalVehicles: audit.totalVehicles, totalMissingPhotos: audit.totalMissingPhotos, usedTotal: audit.usedTotal, usedMissingPhotos: audit.usedMissingPhotos, usedMissingPhotoPct: audit.usedMissingPhotoPct, baselineAuditId: base ? String(base._id ?? base.id) : null, baselineDate: base?.auditedAt || null, auditsInHistory: history.length },
  }
  await col.updateOne({ auditId }, { $setOnInsert: doc }, { upsert: true })
  return col.findOne({ auditId })
}

export async function getAuditReport(db: Db, auditId: string) {
  if (!ObjectId.isValid(auditId)) throw createError({ statusCode: 400, statusMessage: 'Invalid report' })
  const found = await db.collection(REPORTS_COLLECTION).findOne({ auditId })
  if (found) return found
  const audit = await db.collection(AUDITS).findOne({ _id: new ObjectId(auditId) })
  if (!audit) throw createError({ statusCode: 404, statusMessage: 'Report not found' })
  const dealership = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: new ObjectId(audit.dealershipId) })
  if (!dealership) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  return snapshotAuditReport(db, dealership, audit)
}

// ───────────────────────── PDF ─────────────────────────
/** Print HTML to PDF with headless Chromium (same browser as the Inventory Scanner). */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const { openBrowser } = await import('./scanner-cdp')
  const browser = await openBrowser({ proxy: false })
  try {
    const { conn } = browser
    const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId: sid } = await conn.send('Target.attachToTarget', { targetId, flatten: true })
    await conn.send('Page.enable', {}, sid)
    await conn.send('Emulation.setEmulatedMedia', { media: 'print' }, sid).catch(() => {})
    const tree = await conn.send('Page.getFrameTree', {}, sid)
    await conn.send('Page.setDocumentContent', { frameId: tree.frameTree.frame.id, html }, sid)
    // Wait for images / fonts (max ~6 s).
    for (let i = 0; i < 30; i++) {
      const r = await conn.send('Runtime.evaluate', { expression: 'document.readyState === "complete" && Array.from(document.images).every(i => i.complete)', returnByValue: true }, sid).catch(() => null)
      if (r?.result?.value) break
      await new Promise(res => setTimeout(res, 200))
    }
    const pdf = await conn.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, paperWidth: 8.5, paperHeight: 11, marginTop: 0.35, marginBottom: 0.35, marginLeft: 0.35, marginRight: 0.35 }, sid, 60_000)
    return Buffer.from(pdf.data, 'base64')
  }
  finally { await browser.close().catch(() => {}) }
}

/** PDF for a piece of stored HTML, cached by content hash so the same document is printed once. */
export async function cachedPdf(db: Db, key: string, html: string) {
  const col = db.collection<any>(PDF_COLLECTION)
  const id = `${key}:${sha(html).slice(0, 16)}`
  const hit = await col.findOne({ _id: id })
  if (hit?.data) return Buffer.from(hit.data.buffer ?? hit.data)
  const buf = await htmlToPdf(html)
  if (buf.length < 12_000_000) await col.updateOne({ _id: id }, { $set: { data: new Binary(buf), bytes: buf.length, key, createdAt: new Date().toISOString() } }, { upsert: true }).catch(() => {})
  return buf
}
