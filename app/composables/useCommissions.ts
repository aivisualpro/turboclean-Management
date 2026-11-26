import { toast } from 'vue-sonner'

/** Shared helpers for /sales/commissions (data comes from /api/commissions/*). */

export const usd = (n: number | null | undefined, digits = 2) =>
  n == null || Number.isNaN(n) ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits })

/** $12.4k style for tight places (chart axis, tiles' secondary lines). */
export const usdShort = (n: number | null | undefined) => {
  if (n == null) return '—'
  const a = Math.abs(n)
  if (a >= 1e6) return `${n < 0 ? '−' : ''}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`
  if (a >= 1e3) return `${n < 0 ? '−' : ''}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`
  return `${n < 0 ? '−' : ''}$${a.toFixed(0)}`
}

export const pctText = (n: number | null | undefined, digits = 1) => n == null ? '—' : `${n.toFixed(digits).replace(/\.0$/, '')}%`

/** Signed money for adjustments: −$500.00 / +$138.00 */
export const signedUsd = (n: number) => `${n < 0 ? '−' : '+'}${usd(Math.abs(n))}`

const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions) => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts }) : ''
export const dayShort = (d: string) => fmtDay(d, { month: 'short', day: 'numeric' })
export const dayLong = (d: string) => fmtDay(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
export const dayMed = (d: string) => fmtDay(d, { weekday: 'short', month: 'short', day: 'numeric' })

export const RULE_LABEL: Record<string, string> = { percent: 'Percent', fixed: 'Fixed', manual: 'Typed in weekly', none: 'Not paid' }

export function ruleText(rule: any) {
  if (!rule) return '—'
  if (rule.source === 'sheet') return 'Sheet'
  if (rule.kind === 'percent') return `${rule.value}%${rule.base === 'billed' ? ' of billed' : ''}`
  if (rule.kind === 'fixed') return usd(rule.value, 0)
  if (rule.kind === 'manual') return 'Weekly'
  return 'None'
}

export const STATUS_META: Record<string, { label: string, cls: string, dot: string }> = {
  draft: { label: 'Draft', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30', dot: 'bg-amber-500' },
  approved: { label: 'Approved', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30', dot: 'bg-sky-500' },
  paid: { label: 'Paid', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30', dot: 'bg-emerald-500' },
}

export const DEPOSIT_META: Record<string, { label: string, cls: string }> = {
  paid: { label: 'Deposited', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' },
  partial: { label: 'Part paid', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30' },
  unpaid: { label: 'Waiting', cls: 'bg-muted text-muted-foreground border-border' },
  none: { label: '—', cls: 'bg-transparent text-muted-foreground border-transparent' },
}

/** The Friday on or after a date (UTC, YYYY-MM-DD). */
export function payDayFor(d = new Date()) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  x.setUTCDate(x.getUTCDate() + ((5 - x.getUTCDay() + 7) % 7))
  return x.toISOString().slice(0, 10)
}
export function shiftDay(day: string, days: number) {
  const x = new Date(`${day}T00:00:00Z`)
  x.setUTCDate(x.getUTCDate() + days)
  return x.toISOString().slice(0, 10)
}

export function commissionError(e: any, fallback: string) {
  return e?.data?.statusMessage || e?.data?.message || e?.statusMessage || fallback
}

/** One change to a week; returns the recalculated week. */
export async function patchCommissionWeek(payDate: string, op: string, fields: Record<string, any> = {}, success?: string) {
  try {
    const res = await $fetch<{ week: any }>('/api/commissions/week', { method: 'PATCH', body: { payDate, op, ...fields } })
    if (success) toast.success(success)
    return res.week
  }
  catch (e: any) {
    toast.error(commissionError(e, 'Could not save the change'))
    throw e
  }
}

/** CSV download in the browser. */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const blob = new Blob([rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
