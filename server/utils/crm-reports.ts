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
export const REPORT_VERSION = 3

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

// Icons (lucide, MIT) inlined as SVG so the report has no outside requests.
const ICON_PATHS: Record<string, string> = {
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  pie: '<path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z"/><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  swap: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
}
const icon = (name: string, cls = 'ic') => `<span class="${cls}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg></span>`

/**
 * The dealer report (web page + PDF) in the ZRZ OPS print look: Letter-size pages with the deep-green
 * brand band, breadcrumb, big two-tone headline, then
 *   1. Inventory review — executive summary, KPI cards, why it matters
 *   2. The findings — by inventory page, then vs now, chart, what we found (only what has data)
 *   3. Listings without a real photo — grouped by page, split over as many pages as needed
 *   4. Recommended operating approach — 01 Identify · 02 Prep + Capture · 03 Verify + Maintain, next step
 *   5. How ZRZ OPS helps — pain point vs response, the 4-step flow, daily accountability, the outcome
 * Every page is exactly one sheet (fixed footer with "page / total"); nothing runs into the footer.
 */
export function buildReportHtml(o: { dealership: any, audit: any, history: any[], sender: { name: string, company: string, email: string, phone: string }, onePointPerDay?: boolean }) {
  const { dealership: d, audit: a, history, sender } = o
  const name = esc(d.name || 'Your dealership')
  const NAME = esc(String(d.name || 'Your dealership').toUpperCase())
  const base = pickBaseline(history, a)
  const prev = [...history].reverse().find(x => new Date(x.auditedAt).getTime() < new Date(a.auditedAt).getTime() - 86_400_000) || null
  const b = a.photoBreakdown || null
  const usedT = num(a.usedTotal), usedM = num(a.usedMissingPhotos)
  const usedP = a.usedMissingPhotoPct ?? pct1(usedM, usedT)
  const newP = a.newMissingPhotoPct ?? pct1(num(a.newMissingPhotos), num(a.newTotal))
  const worse = base ? usedM > num(base.usedMissingPhotos) : false
  const points = (o.onePointPerDay === false ? history : onePerDay(history)).filter(x => num(x.usedTotal) > 0).slice(-10).map(x => ({ label: dayLabel(x.auditedAt).replace(/, (\d{4})$/, " '$1").replace(/'(\d\d)(\d\d)$/, "'$2"), p: x.usedMissingPhotoPct ?? pct1(num(x.usedMissingPhotos), num(x.usedTotal)) ?? 0 }))
  const examples = (Array.isArray(a.examples) ? a.examples : []).filter((e: any) => e?.url).slice(0, 40)
  const pages = auditPages(a)
  const byPage = pages.length >= 2
  const norm = (u: string) => String(u || '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()
  const pagePct = (pg: any) => pg.withoutRealPct ?? pct1(num(pg.withoutReal), num(pg.total)) ?? 0
  const verdict = (e: any) => e.verdict === 'stock' ? ['Stock image', 'b-stock'] : e.verdict === 'placeholder' ? ['Placeholder', 'b-red'] : /stock/i.test(e.label || '') ? ['Stock image', 'b-stock'] : ['No photo', 'b-red']
  const issues = [...(a.merchandisingIssues || []), ...(a.websiteIssues || [])]
  const period = base ? periodLabel(base.auditedAt, a.auditedAt) : ''
  const cov = a.coverage && num(a.coverage.advertised) > num(a.coverage.checked) ? a.coverage : null
  const date = dayLabel(a.auditedAt)
  const DATE = dayUpper(a.auditedAt).replace(/ 0(\d),/, ' $1,')

  // ── Page frame ──
  const band = `<header class="band"><div class="brand">ZRZ <span>OPS</span></div><div class="tag">DEALERSHIP INVENTORY INTELLIGENCE</div></header><div class="rule"></div>`
  const pageHtml = (crumb: string, body: string) => `<section class="page">${band}<div class="content"><p class="crumb">${crumb}</p>${body}</div><footer class="foot"><span>ZRZ OPS &nbsp;/&nbsp; RECONDITIONING + INVENTORY OPERATIONS</span><b class="pn">__PAGE__</b></footer></section>`
  const sections: string[] = []

  // 1 ── Inventory review
  const summary = usedT
    ? `We reviewed ${name}&rsquo;s publicly listed pre-owned inventory and identified ${usedM ? 'a visible online merchandising gap' : 'how complete the online photo coverage is'}: <b>${fmt(usedM)} of ${fmt(usedT)}</b> pre-owned listings are currently missing vehicle photos.${cov ? ` <span class="muted">(The website lists ${fmt(num(cov.advertised))} vehicles; ${fmt(num(cov.checked))} could be checked${num(cov.blockedPages) ? ' &mdash; the rest sat behind pages the site would not show us' : ''}.)</span>` : ''}`
    : `We reviewed ${name}&rsquo;s publicly listed inventory: <b>${fmt(num(a.totalMissingPhotos))} of ${fmt(num(a.totalVehicles))}</b> listings are currently missing vehicle photos.`
  sections.push(pageHtml(`${NAME} &nbsp;/&nbsp; INVENTORY REVIEW &nbsp;/&nbsp; ${DATE}`, `
    <h1>Your online inventory.<br><em>A measurable opportunity.</em></h1>
    <p class="lead">Prepared for ${name} | A focused review of pre-owned vehicle photography and merchandising consistency.</p>
    <div class="card summary"><p class="eyebrow">EXECUTIVE SUMMARY</p><div class="row">${icon('file', 'ic lg')}<p>${summary}</p></div></div>
    <p class="eyebrow">YOUR INVENTORY, AT A GLANCE</p>
    <div class="kpis">
      <div class="kpi">${icon('car')}<div><b>${fmt(usedT || num(a.totalVehicles))}</b><span>VISIBLE ${usedT ? 'PRE&#8209;OWNED ' : ''}VEHICLES</span></div></div>
      <div class="kpi">${icon('camera')}<div><b class="g">${fmt(usedT ? usedM : num(a.totalMissingPhotos))}</b><span>LISTINGS FLAGGED FOR MISSING PHOTOS</span></div></div>
      <div class="kpi">${icon('pie')}<div><b class="g">${Math.round(num(usedT ? usedP : a.missingPhotoPct))}%</b><span>MISSING-PHOTO RATE</span></div></div>
    </div>
    <p class="eyebrow">WHY THIS MATTERS</p>
    <div class="why">
      <div class="card">${icon('eye')}<h4>First impression</h4><p>Listings without photos create friction before a shopper even clicks.</p></div>
      <div class="card">${icon('layers')}<h4>Merchandising consistency</h4><p>Incomplete photo coverage makes inventory look less curated and less market-ready.</p></div>
      <div class="card">${icon('chart')}<h4>Missed opportunity</h4><p>Every unphotographed unit is a vehicle that can underperform online.</p></div>
    </div>
    <div class="band-card mint">${icon('pencil', 'ic lg solid')}<p>ZRZ OPS helps dealerships close these gaps with detailing, photography, and repeatable inventory support.</p></div>`))

  // 2 ── Findings (only the parts that have data)
  // Each block has an estimated height (px) so the findings split over as many sheets as needed.
  const findings: { h: number, html: string }[] = []
  const add = (h: number, html: string) => findings.push({ h, html })
  add(100, `<div class="mini-kpis"><div><span>PRE-OWNED</span><b>${fmt(usedM)} / ${fmt(usedT)}</b><i>${usedP ?? '—'}% without a real photo</i></div><div><span>NEW</span><b>${fmt(num(a.newMissingPhotos))} / ${fmt(num(a.newTotal))}</b><i>${newP ?? '—'}% without a real photo</i></div><div><span>ALL LISTINGS</span><b>${fmt(num(a.totalMissingPhotos))} / ${fmt(num(a.totalVehicles))}</b><i>${a.missingPhotoPct ?? '—'}% without a real photo</i></div></div>`)
  if (byPage) {
    add(70 + 44 * Math.min(8, pages.length), `<p class="eyebrow">BY INVENTORY PAGE</p><table class="t"><thead><tr><th>Page</th><th class="r">Vehicles</th><th class="r">No real photo</th><th style="width:34%">Share</th></tr></thead><tbody>${pages.slice(0, 8).map((pg: any) => { const p = pagePct(pg); return `<tr><td><b>${esc(pg.label || 'Inventory')}</b><br><a href="${esc(pg.url)}" class="path">${esc(shortPath(pg.url))}</a></td><td class="r">${fmt(num(pg.total))}</td><td class="r g"><b>${fmt(num(pg.withoutReal))}</b></td><td><div class="bar"><i style="width:${Math.max(p > 0 ? 2 : 0, Math.min(100, p))}%"></i></div><small>${p}%</small></td></tr>` }).join('')}</tbody></table>`)
  }
  if (base) add(80, `<div class="callout${worse ? ' warn' : ''}"><b>Then vs now (${esc(period)}):</b> on ${dayLabel(base.auditedAt)}, ${fmt(num(base.usedMissingPhotos))} of ${fmt(num(base.usedTotal))} pre-owned listings had no real photo. On ${date} it was <b>${fmt(usedM)} of ${fmt(usedT)}</b> (${signed(usedM - num(base.usedMissingPhotos))} cars${usedP != null && (base.usedMissingPhotoPct ?? null) != null ? `, ${signed(usedP - base.usedMissingPhotoPct, ' pts')}` : ''}).</div>`)
  if (points.length >= 2) add(290, `${HISTORY_OPEN}<p class="eyebrow">PRE-OWNED LISTINGS WITHOUT A REAL PHOTO, OVER TIME</p><div class="chart">${lineChartSvg(points, worse ? '#c2453b' : '#128a5e')}</div>${HISTORY_CLOSE}`)
  if (base || prev) {
    const cmpRow = (label: string, x: any, hl = false) => x ? `<tr${hl ? ' class="hl"' : ''}><td>${label}</td><td>${dayLabel(x.auditedAt)}</td><td class="r">${fmt(num(x.usedTotal))}</td><td class="r">${fmt(num(x.usedMissingPhotos))}</td><td class="r">${x.usedMissingPhotoPct ?? pct1(num(x.usedMissingPhotos), num(x.usedTotal)) ?? '—'}%</td></tr>` : ''
    add(70 + 34 * 3, `<p class="eyebrow">REVIEW HISTORY</p><table class="t"><thead><tr><th></th><th>Date</th><th class="r">Pre-owned</th><th class="r">No real photo</th><th class="r">Share</th></tr></thead><tbody>${base ? cmpRow(`~${esc(period)} ago`, base) : ''}${prev && (!base || String(prev._id ?? prev.id) !== String(base._id ?? base.id)) ? cmpRow('Previous review', prev) : ''}${cmpRow('This review', a, true)}</tbody></table>`)
  }
  if (b) add(100, `<p class="eyebrow">WHAT WE FOUND</p><div class="chips"><span><b>${fmt(num(b.real))}</b> real photos</span>${num(b.placeholder) ? `<span><b class="r">${fmt(num(b.placeholder))}</b> &ldquo;photos coming soon&rdquo; placeholders</span>` : ''}${num(b.missing) ? `<span><b class="r">${fmt(num(b.missing))}</b> with no image at all</span>` : ''}${num(b.stock) ? `<span><b class="p">${fmt(num(b.stock))}</b> stock / catalog images${b.countStockAsMissing === false ? '' : ' (counted as no real photo)'}</span>` : ''}</div>`)
  if (issues.length) add(60 + 34 * Math.ceil(issues.length / 3), `<p class="eyebrow">MERCHANDISING &amp; WEBSITE ISSUES</p><div class="chips">${issues.map((i: string) => `<span>${esc(i)}</span>`).join('')}</div>`)
  if (cov) add(80, `<div class="callout warn"><b>Coverage:</b> we checked ${fmt(num(cov.checked))} of the ${fmt(num(cov.advertised))} vehicles the website lists${num(cov.blockedPages) ? ' &mdash; the site would not show us the rest' : ''}. The percentages are of the vehicles checked.</div>`)
  add(90, `<p class="method"><b>How we measured.</b> We reviewed every publicly listed vehicle on ${byPage ? `the ${pages.length} inventory pages above` : 'the dealership&rsquo;s website'} on ${date} and checked the main photo of each one. A listing counts as &ldquo;without a real photo&rdquo; when the image is missing, a &ldquo;photos coming soon&rdquo; placeholder${b?.countStockAsMissing === false ? '' : ', or a stock / catalog image instead of the actual car'}. Counts change as inventory is updated. Report ${esc(String(a._id ?? a.id).slice(-8).toUpperCase())} &middot; v${REPORT_VERSION}.</p>`)
  const fPages: string[][] = [[]]
  let room = 700 // first sheet: below the headline
  for (const f of findings) {
    if (f.h > room && fPages[fPages.length - 1]!.length) { fPages.push([]); room = 830 }
    fPages[fPages.length - 1]!.push(f.html)
    room -= f.h
  }
  fPages.forEach((blocks, i) => sections.push(pageHtml(`THE FINDINGS &nbsp;/&nbsp; ${NAME}${fPages.length > 1 ? ` &nbsp;/&nbsp; ${i + 1} OF ${fPages.length}` : ''}`, `${i === 0 ? `<h1 class="h1s">Where the gaps are.<br><em>${usedT ? `${fmt(usedM)} pre-owned listings to fix.` : 'Listing by listing.'}</em></h1>` : ''}${blocks.join('')}`)))

  // 3 ── Listings (grouped by crawl page, 18 rows per sheet)
  if (examples.length) {
    type Row = { kind: 'head', html: string } | { kind: 'row', e: any }
    const rows: Row[] = []
    const groups = byPage && examples.some((e: any) => e.listUrl)
      ? [...pages.map((pg: any) => ({ pg, list: examples.filter((e: any) => norm(e.listUrl) === norm(pg.url)) })), { pg: null as any, list: examples.filter((e: any) => !pages.some((pg: any) => norm(pg.url) === norm(e.listUrl))) }].filter(g => g.list.length)
      : [{ pg: null as any, list: examples }]
    for (const g of groups) {
      if (g.pg) rows.push({ kind: 'head', html: `<tr class="grp"><td colspan="4"><b>${esc(g.pg.label || 'Inventory')}</b> <span class="path">${esc(shortPath(g.pg.url))}</span></td><td class="r">${fmt(num(g.pg.withoutReal))} of ${fmt(num(g.pg.total))} &middot; ${pagePct(g.pg)}%</td></tr>` })
      for (const e of g.list) rows.push({ kind: 'row', e })
    }
    const PER = 18
    const chunks: Row[][] = []
    for (let i = 0; i < rows.length; i += PER) chunks.push(rows.slice(i, i + PER))
    chunks.forEach((chunk, ci) => {
      const body = chunk.map((r) => {
        if (r.kind === 'head') return r.html
        const e = r.e
        const [label, cls] = verdict(e)
        const title = e.title || String(e.label || '').split(' — ')[0]!.replace(/\s+#\S+$/, '')
        const stock = e.stock || (String(e.label || '').match(/#(\S+)/)?.[1] || '')
        return `<tr><td>${esc(title) || 'Vehicle'}</td><td>${esc(stock)}</td><td class="r">${esc(e.price || '')}</td><td><span class="badge ${cls}">${label}</span></td><td class="r"><a href="${esc(e.url)}" target="_blank" rel="noopener">View listing &rarr;</a></td></tr>`
      }).join('')
      const head = ci === 0
        ? `<h1 class="h1s">See it for yourself.<br><em>${examples.length < num(a.totalMissingPhotos) ? `${examples.length} of ${fmt(num(a.totalMissingPhotos))} listings` : `${examples.length} listing${examples.length === 1 ? '' : 's'}`} without a real photo.</em></h1><p class="lead">Every row links to the live listing on ${name}&rsquo;s website, as it appeared on ${date}.</p>`
        : ''
      sections.push(pageHtml(`LISTINGS WITHOUT A REAL PHOTO &nbsp;/&nbsp; ${NAME}${chunks.length > 1 ? ` &nbsp;/&nbsp; ${ci + 1} OF ${chunks.length}` : ''}`, `${head}<table class="t list"><thead><tr><th>Vehicle</th><th>Stock #</th><th class="r">Price</th><th>Issue</th><th></th></tr></thead><tbody>${body}</tbody></table>`))
    })
  }

  // 4 ── Recommended operating approach
  const step = (n: string, t: string, s: string) => `<div class="card step"><span class="num">${n}</span><div><h3>${t}</h3><p>${s}</p></div></div>`
  sections.push(pageHtml(`RECOMMENDED OPERATING APPROACH &nbsp;/&nbsp; ${NAME}`, `
    <h1>From missing photos<br><em>to a repeatable process.</em></h1>
    <p class="lead">ZRZ OPS supports dealerships with reconditioning, vehicle photography, and an accountable workflow from ready-for-sale to online presentation.</p>
    ${step('01', 'IDENTIFY', 'Review the active pre-owned inventory and flag missing-photo or incomplete listings.')}
    ${step('02', 'PREP + CAPTURE', 'Coordinate vehicle readiness and complete consistent exterior and interior photos.')}
    ${step('03', 'VERIFY + MAINTAIN', 'Track open exceptions, confirm photo publication, and repeat the check for new arrivals.')}
    <div class="band-card dark">${icon('chart', 'ic lg solid')}<div><p class="eyebrow">WHAT ${NAME} GETS</p><p>Clear exceptions &bull; consistent merchandising standards &bull; fewer units slipping through the cracks</p></div></div>
    <div class="band-card mint">${icon('pencil', 'ic lg solid')}<div><p class="eyebrow">NEXT STEP</p><p>A 15-minute walkthrough to validate the inventory data and discuss how a photo-ready workflow could fit ${name}&rsquo;s current operation.</p>${sender.name || sender.phone || sender.email ? `<p class="contact"><b>${esc(sender.name || sender.company)}</b>${sender.company && sender.name ? ` &middot; ${esc(sender.company)}` : ''}${sender.phone ? ` &middot; ${esc(sender.phone)}` : ''}${sender.email ? ` &middot; <a href="mailto:${esc(sender.email)}">${esc(sender.email)}</a>` : ''}</p>` : ''}</div></div>`))

  // 5 ── How ZRZ OPS helps
  const flow = (ic: string, n: string, t: string, s: string) => `<div class="card flow">${icon(ic)}<span class="num-s">${n}</span><h5>${t}</h5><p>${s}</p></div>`
  sections.push(pageHtml(`HOW ZRZ OPS HELPS &nbsp;/&nbsp; THE OPERATING SYSTEM BEHIND THE DETAIL`, `
    <h1>We do more than detail cars.</h1>
    <h2 class="sub">We manage the handoffs<br>that slow inventory down.</h2>
    <p class="lead">The goal is simple: when a vehicle hits the ground, every department knows where it is, what it needs, and what happens next &mdash; so the vehicle can be cleaned, photographed, merchandised, and online as quickly as possible.</p>
    <div class="duo"><div class="card pain"><p class="eyebrow">THE PAIN POINT</p><p>Detailers can be waiting for work while vehicles sit in service, on the lot, or between departments. Management may think recon is behind when the real issue is handoff and communication.</p></div><div class="card resp"><p class="eyebrow">THE ZRZ RESPONSE</p><p>ZRZ actively coordinates with service, the foreman, dispatcher, and used-car management to keep the next available vehicle moving instead of waiting in a queue.</p></div></div>
    <div class="flows">${flow('car', '01', 'VEHICLE ARRIVES', 'Used or new inventory hits the ground.')}${flow('users', '02', 'SERVICE / SAFETY', 'If service can only work on part of the queue, ZRZ pulls available units forward.')}${flow('camera', '03', 'RECON + PHOTO', 'Available units are detailed, photographed, and merchandised immediately.')}${flow('swap', '04', 'BACK TO SERVICE', 'Vehicle returns quickly for remaining service work once a bay is ready.')}</div>
    <div class="band-card dark">${icon('clock', 'ic lg solid')}<div><p class="eyebrow">DAILY ACCOUNTABILITY</p><p>ZRZ works closely with the used-car manager and provides clear daily updates on what was completed, what is waiting, and what is blocked. That visibility makes it easier to push the missing-photo percentage toward the lowest practical level.</p></div></div>
    <div class="card outcome"><p class="eyebrow">THE OUTCOME</p><p>Less idle time. Fewer lost vehicles. Faster merchandising. Better communication between departments. More inventory online while sales and service finish the rest of the decision process.</p></div>
`))

  const total = sections.length
  const html = sections.map((s, i) => s.replace('__PAGE__', `${i + 1} / ${total}`)).join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(d.name)} — Inventory review · ${date}</title>
<style>
  @page { size: Letter; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  :root { --ink: #111827; --muted: #667085; --green: #128a5e; --deep: #0f4a3e; --mint: #4ad6a0; --line: #d7ebe2; --soft: #f3faf7; --mintbg: #dcf5ea; }
  body { margin: 0; background: #e9eeec; color: var(--ink); ${FONT} }
  a { color: var(--green); text-decoration: none; }
  .actions { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; justify-content: flex-end; max-width: 8.5in; margin: 0 auto; padding: 12px 0 0; }
  .actions a { background: var(--deep); color: #fff; border-radius: 10px; padding: 9px 14px; font-size: 13px; font-weight: 600; }
  .page { position: relative; width: 8.5in; height: 11in; margin: 20px auto; background: #fff; overflow: hidden; box-shadow: 0 20px 50px -28px rgba(0,0,0,.4); border-radius: 6px; }
  @media print { body { background: #fff; } .page { margin: 0; border-radius: 0; box-shadow: none; page-break-after: always; break-after: page; } .page:last-child { page-break-after: auto; break-after: auto; } .noprint { display: none !important; } }
  .band { height: 1.15in; background: var(--deep); display: flex; align-items: center; justify-content: space-between; padding: 0 .5in; }
  .brand { color: #fff; font-size: 32px; font-weight: 800; letter-spacing: 1px; } .brand span { color: #5fd3a3; margin-left: 18px; }
  .tag { color: #fff; font-size: 12px; font-weight: 800; letter-spacing: .4px; }
  .rule { height: 3px; background: var(--mint); margin: 0 .5in; }
  .content { padding: 22px .5in 0; }
  .crumb { margin: 0 0 30px; font-size: 12px; font-weight: 800; letter-spacing: .6px; color: var(--green); }
  h1 { margin: 0; font-size: 40px; line-height: 1.18; letter-spacing: -.3px; font-weight: 800; color: var(--ink); }
  h1 em, .sub { font-style: normal; color: var(--green); }
  h1.h1s { font-size: 34px; }
  .sub { margin: 10px 0 0; font-size: 32px; line-height: 1.18; font-weight: 800; }
  .lead { margin: 20px 0 22px; font-size: 14.5px; line-height: 1.55; color: var(--muted); }
  .muted { color: var(--muted); }
  .eyebrow { margin: 22px 0 10px; font-size: 13px; font-weight: 800; letter-spacing: .4px; color: var(--green); }
  .card { border: 1.5px solid var(--line); border-radius: 12px; background: #fff; }
  .card .eyebrow { margin-top: 0; }
  .ic { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 52px; height: 52px; border-radius: 50%; background: #e2f5ec; color: var(--deep); }
  .ic svg { width: 26px; height: 26px; }
  .ic.lg { width: 56px; height: 56px; } .ic.lg svg { width: 28px; height: 28px; }
  .summary { margin-top: 34px; border-left: 9px solid var(--green); padding: 20px 26px 22px; }
  .summary .row { display: flex; align-items: center; gap: 22px; }
  .summary .row p { margin: 0; padding-left: 22px; border-left: 1.5px solid var(--line); font-size: 15px; line-height: 1.5; }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .kpi { display: flex; align-items: center; gap: 14px; background: var(--soft); border: 1.5px solid var(--line); border-radius: 12px; padding: 14px 18px; }
  .kpi > div { padding-left: 14px; border-left: 1.5px solid var(--line); }
  .kpi b { display: block; font-size: 30px; line-height: 1; letter-spacing: -.5px; }
  .kpi b.g, .g { color: var(--green); }
  .kpi > div span { display: block; margin-top: 8px; font-size: 10.5px; font-weight: 800; letter-spacing: .3px; line-height: 1.35; }
  .why { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .why .card { padding: 14px 18px 20px; position: relative; min-height: 1.3in; }
  .why .ic { width: 46px; height: 46px; position: absolute; left: 16px; top: 12px; } .why .ic svg { width: 24px; height: 24px; }
  .why h4 { margin: 4px 0 0 60px; font-size: 13.5px; line-height: 1.3; min-height: 34px; }
  .why p { margin: 12px 0 0 4px; font-size: 11.5px; line-height: 1.5; color: var(--muted); }
  .band-card { display: flex; align-items: center; gap: 24px; border-radius: 12px; padding: 22px 28px; margin-top: 16px; }
  .band-card > div, .band-card > p { border-left: 1.5px solid; padding-left: 26px; }
  .band-card p { margin: 0; font-size: 14px; line-height: 1.5; }
  .band-card .eyebrow { margin: 0 0 6px; }
  .band-card.mint { background: var(--mintbg); } .band-card.mint > div, .band-card.mint > p { border-color: #b8e6d0; }
  .band-card.mint .ic.solid { background: #8fe3bc; color: #0f3d33; }
  .band-card.dark { background: var(--deep); color: #fff; } .band-card.dark > div { border-color: #2f6f60; }
  .band-card.dark .eyebrow { color: #5fd3a3; } .band-card.dark .ic.solid { background: #138a5e; color: #0d3a30; }
  .contact { margin-top: 10px !important; font-size: 12.5px !important; color: #344054; }
  .step { display: flex; align-items: center; gap: 28px; padding: 22px 28px; margin-top: 18px; }
  .step > div { border-left: 1.5px solid var(--line); padding-left: 28px; }
  .num { flex: none; width: 56px; height: 56px; border-radius: 50%; background: #e2f5ec; color: var(--green); font-weight: 800; font-size: 19px; display: inline-flex; align-items: center; justify-content: center; }
  .step h3 { margin: 0; font-size: 17px; letter-spacing: .3px; } .step p { margin: 10px 0 0; font-size: 12.5px; color: var(--muted); }
  .duo { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .duo .card { padding: 22px 22px 46px; } .duo p { margin: 0; font-size: 13px; line-height: 1.55; }
  .pain { background: #fbe5e2; border-color: #f0c2bb; } .pain .eyebrow { color: #c2453b; }
  .resp { background: var(--soft); }
  .flows { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: -26px; position: relative; }
  .flow { text-align: center; padding: 14px 10px 14px; }
  .flow .ic { width: 46px; height: 46px; } .flow .ic svg { width: 24px; height: 24px; }
  .num-s { display: block; margin-top: 6px; font-size: 11px; font-weight: 800; color: var(--green); }
  .flow h5 { margin: 6px 0 0; font-size: 10.5px; letter-spacing: .3px; } .flow p { margin: 8px 0 0; font-size: 10px; line-height: 1.45; color: var(--muted); }
  .outcome { background: var(--mintbg); border-color: var(--mintbg); padding: 20px 26px; margin-top: 14px; } .outcome p { margin: 0; font-size: 13.5px; line-height: 1.5; }
  .ref { margin: 12px 0 0; font-size: 10px; color: #98a2b3; text-align: right; }
  .mini-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 20px; }
  .mini-kpis > div { background: var(--soft); border: 1.5px solid var(--line); border-radius: 12px; padding: 12px 16px; }
  .mini-kpis span { display: block; font-size: 10px; font-weight: 800; letter-spacing: .6px; color: var(--muted); }
  .mini-kpis b { display: block; margin-top: 4px; font-size: 22px; } .mini-kpis i { display: block; font-style: normal; font-size: 11px; color: var(--green); font-weight: 700; }
  table.t { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  table.t th { text-align: left; font-size: 9.5px; letter-spacing: .8px; text-transform: uppercase; color: var(--muted); font-weight: 800; padding: 8px 10px; background: var(--soft); border-bottom: 1.5px solid var(--line); }
  table.t td { padding: 7px 10px; border-bottom: 1px solid #edf3f0; vertical-align: middle; } table.t .r { text-align: right; }
  table.t tr.hl td { background: #ecf8f2; font-weight: 700; }
  table.t tr.grp td { background: #f0f7f4; font-size: 11.5px; padding-top: 10px; }
  table.list td { padding: 8px 10px; }
  .path { color: var(--muted); font-size: 10px; }
  .bar { height: 6px; border-radius: 3px; background: #e5ece9; overflow: hidden; margin: 2px 0 2px; } .bar i { display: block; height: 100%; background: var(--green); border-radius: 3px; }
  .callout { margin-top: 16px; border-left: 5px solid var(--green); background: var(--soft); border-radius: 0 10px 10px 0; padding: 12px 16px; font-size: 12.5px; line-height: 1.5; }
  .callout.warn { border-left-color: #f59e0b; background: #fffbeb; }
  .chart { border: 1.5px solid var(--line); border-radius: 12px; padding: 10px 10px 2px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; } .chips span { border: 1.5px solid var(--line); border-radius: 999px; padding: 5px 12px; font-size: 11.5px; background: var(--soft); }
  .chips b.r { color: #c2453b; } .chips b.p { color: #5b3cc4; }
  .badge { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 9.5px; font-weight: 800; letter-spacing: .3px; }
  .b-red { background: #fde8e8; color: #b42318; } .b-stock { background: #f1ecfe; color: #5b3cc4; }
  .method { margin-top: 18px; font-size: 10.5px; line-height: 1.55; color: var(--muted); }
  .foot { position: absolute; left: .5in; right: .5in; bottom: .32in; display: flex; justify-content: space-between; padding-top: 10px; border-top: 1px solid #e5ece9; font-size: 9.5px; letter-spacing: .3px; color: var(--muted); }
  .foot .pn { color: #344054; }
  @media screen and (max-width: 860px) {
    .page { width: auto; height: auto; min-height: 0; margin: 12px; padding-bottom: 60px; }
    .band { padding: 0 20px; height: 84px; } .brand { font-size: 24px; } .tag { display: none; } .rule { margin: 0 20px; } .content { padding: 18px 20px 0; }
    h1 { font-size: 30px; } h1.h1s { font-size: 26px; } .sub { font-size: 24px; }
    .kpis, .why, .duo, .flows, .mini-kpis { grid-template-columns: 1fr; } .flows { margin-top: 10px; }
    .foot { left: 20px; right: 20px; bottom: 16px; }
  }
</style></head>
<body>
<div class="actions noprint">__REPORT_ACTIONS__</div>
${html}
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
