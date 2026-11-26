/**
 * Commissions engine — turns the invoices already in the system into the weekly payout the
 * owner used to build by hand in the "DEALER COMISSIONS 2026" Google Sheet.
 *
 * How the sheet works (and therefore how this works):
 *  - One statement per pay day (a Friday). It pays for the work week that ended the Sunday
 *    before: Fri Nov 20 pays for Mon Nov 9 – Sun Nov 15 (= the Weekly invoices dated Nov 15).
 *  - Per dealer: Billed incl. sales tax (sheet "BEFORE TAX") → sales tax → Net (sheet "AFTER TAX").
 *  - Payout to the contractor (Carlos) = 75 % of Net by default, with per-dealer exceptions
 *    (80 %, 70 %, a fixed weekly amount, or an amount typed in each week). Exceptions change over
 *    time, so every rule has an "applies from" pay day and history is kept.
 *  - Then the contractor's weekly deductions / additions (insurance, helper, donation, jeep…),
 *    minus advances already paid (sheet "1ST CHECK MINUS") = the balance still to pay.
 *  - The company side: Net − paid to contractors − overhead − income-tax set-aside = net profit.
 *    Sales tax collected is tracked separately because it is owed to the state.
 *
 * Data: turboCleanInvoices (Weekly rollups, Daily invoices not rolled up yet, Monthly invoices
 * spread over the weeks of their month), turboCleanDealers (names), and two own collections:
 *  - turboCleanCommissionSettings  (_id 'settings') — payees, rules, recurring items, overhead…
 *  - turboCleanCommissionStatements (_id = pay day 'YYYY-MM-DD') — what was changed or recorded
 *    for that week, plus a frozen snapshot once the week is approved.
 */
import { ObjectId } from 'mongodb'
import sheetHistory from '../data/commission-sheet-2026.json'

export const COMMISSION_SETTINGS_COLLECTION = 'turboCleanCommissionSettings'
export const COMMISSION_STATEMENTS_COLLECTION = 'turboCleanCommissionStatements'

// ─── Types ──────────────────────────────────────────────────────────────────
export type CommissionRuleKind = 'percent' | 'fixed' | 'manual' | 'none'
export type CommissionBase = 'net' | 'billed'

export interface CommissionPayee {
  id: string
  name: string
  /** % of the base for dealers without their own rule. */
  defaultPct: number
  base: CommissionBase
  active: boolean
  /** 'all' = every dealer with revenue gets the default %; 'listed' = only dealers with a rule. */
  scope: 'all' | 'listed'
  /** Paid out of another payee's share (e.g. Juan out of Carlos's) — shown, not a company cost. */
  fundedBy?: string | null
}

export interface CommissionRule {
  id: string
  payeeId: string
  dealerId?: string | null
  /** Name from the spreadsheet, used until the rule is linked to a dealer. */
  dealerName?: string | null
  kind: CommissionRuleKind
  /** % for percent, $ for fixed, last/suggested $ for manual. */
  value: number
  base?: CommissionBase
  /** First pay day (YYYY-MM-DD) this rule applies to. */
  from: string
  note?: string
}

export interface CommissionRecurring {
  id: string
  payeeId: string
  label: string
  /** Signed: negative is taken off the payout, positive is added. */
  amount: number
  every: 'week' | 'month'
  from: string
  to?: string | null
  active: boolean
}

export interface CommissionOverhead { id: string, label: string, amount: number, per: 'week' | 'month' | 'year', from?: string | null, to?: string | null, active: boolean }
export interface CommissionSetAside { id: string, label: string, pct: number, base: 'billed' | 'net' | 'profit', kind: 'incomeTax' | 'other', from?: string | null, to?: string | null, active: boolean }
export interface CommissionPreset { id: string, label: string, amount: number }

export interface CommissionSettings {
  _id?: string
  configured: boolean
  monthlyAllocation: 'spread' | 'lump'
  payees: CommissionPayee[]
  rules: CommissionRule[]
  recurring: CommissionRecurring[]
  presets: CommissionPreset[]
  overhead: CommissionOverhead[]
  setAsides: CommissionSetAside[]
  /** Spreadsheet dealer name → dealer id ('__ignore' = not a dealer). */
  nameMap: Record<string, string>
  updatedAt?: string
  updatedBy?: string
}

export interface CommissionDealer { id: string, name: string, taxPercentage: number }

// ─── Small helpers ──────────────────────────────────────────────────────────
const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const DAY = 86400000

function utc(day: string) { return new Date(`${day}T00:00:00Z`) }
function dayStr(d: Date) { return d.toISOString().slice(0, 10) }
function addDays(day: string, n: number) { return dayStr(new Date(utc(day).getTime() + n * DAY)) }

export function commissionId(prefix = 'c') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`
}

/** The pay day (Friday) for any date, and the work week it pays for (Mon–Sun ending the Sunday before). */
export function commissionPayWeek(anyDay: string) {
  const d = utc(/^\d{4}-\d{2}-\d{2}$/.test(anyDay) ? anyDay : dayStr(new Date()))
  const offset = (5 - d.getUTCDay() + 7) % 7
  const payDate = dayStr(new Date(d.getTime() + offset * DAY))
  return { payDate, workStart: addDays(payDate, -11), workEnd: addDays(payDate, -5) }
}

/** Every Friday of a year. */
export function commissionPayDays(year: number) {
  const out: string[] = []
  const d = new Date(Date.UTC(year, 0, 1))
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1)
  while (d.getUTCFullYear() === year) { out.push(dayStr(d)); d.setUTCDate(d.getUTCDate() + 7) }
  return out
}

const inRange = (day: string, from?: string | null, to?: string | null) => (!from || day >= from) && (!to || day <= to)

// ─── Dealer name matching (spreadsheet names → dealers) ─────────────────────
export function commissionNormName(s: any) {
  return String(s || '').toLowerCase()
    .replace(/mithcell/g, 'mitchell').replace(/landrover/g, 'land rover').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Finds a dealer for a spreadsheet name: saved mapping → exact name → a unique dealer containing every word. */
export function commissionDealerResolver(dealers: CommissionDealer[], nameMap: Record<string, string> = {}) {
  const byNorm = new Map<string, CommissionDealer[]>()
  for (const d of dealers) {
    const k = commissionNormName(d.name)
    byNorm.set(k, [...(byNorm.get(k) || []), d])
  }
  const ids = new Set(dealers.map(d => d.id))
  const cache = new Map<string, string | null>()
  function find(name: string): string | null {
    const n = commissionNormName(name)
    if (!n) return null
    const exact = byNorm.get(n)
    if (exact?.length === 1) return exact[0]!.id
    const words = n.split(' ')
    const hits = dealers.filter(d => { const dn = ` ${commissionNormName(d.name)} `; return words.every(w => dn.includes(` ${w} `)) })
    if (hits.length === 1) return hits[0]!.id
    return null
  }
  return (name: string | null | undefined): string | null => {
    if (!name) return null
    const mapped = nameMap[name]
    if (mapped === '__ignore') return null
    if (mapped && ids.has(mapped)) return mapped
    if (cache.has(name)) return cache.get(name)!
    let id = find(name)
    if (!id && name.includes('/')) id = find(name.split('/')[0]!)
    cache.set(name, id)
    return id
  }
}

// ─── Default plan (taken from the spreadsheet) ──────────────────────────────
export function defaultCommissionSettings(): CommissionSettings {
  const Y = '2026-01-01'
  const rule = (dealerName: string, kind: CommissionRuleKind, value: number, from = Y, payeeId = 'carlos', note = ''): CommissionRule =>
    ({ id: commissionId('r'), payeeId, dealerName, dealerId: null, kind, value, base: 'net', from, note })
  const mitchell = ['MITCHELL FORD', 'MITCHELL AUTO BODY', 'MITHCELL VOLVO', 'MITCHELL CDJR', 'MITCHELL SUBARU', 'MITCHELL VW']
  return {
    _id: 'settings',
    configured: false,
    monthlyAllocation: 'spread',
    payees: [
      { id: 'carlos', name: 'Carlos', defaultPct: 75, base: 'net', active: true, scope: 'all', fundedBy: null },
      { id: 'juan', name: 'Juan', defaultPct: 65, base: 'net', active: false, scope: 'listed', fundedBy: 'carlos' },
    ],
    rules: [
      rule('BMW', 'percent', 75), rule('BMW', 'percent', 80, '2026-09-04'),
      rule('GEORGE HARTE NISSAN', 'percent', 73), rule('GEORGE HARTE NISSAN', 'percent', 80, '2026-05-29'),
      rule('EH Collision', 'percent', 85), rule('EH Collision', 'percent', 80, '2026-10-30'),
      rule('Porsche', 'percent', 85), rule('Porsche', 'percent', 80, '2026-11-06'),
      rule('Porsche Wash', 'percent', 85),
      rule('NORTHAMPTON FORD', 'percent', 80),
      rule('GENGRAS FAIRFIELD', 'percent', 70),
      rule('KIA CLEANING', 'fixed', 650), rule('KIA CLEANING', 'fixed', 1625, '2026-08-14'), rule('KIA CLEANING', 'fixed', 1575, '2026-08-28'), rule('KIA CLEANING', 'fixed', 1625, '2026-10-30'),
      rule('TERRYVILLE CHEVY', 'manual', 1540, Y, 'carlos', 'Amount changes every week — type it in'),
      rule('MONACO FORD', 'percent', 75), rule('MONACO FORD', 'manual', 1702.5, '2026-08-28', 'carlos', 'Amount changes every week — type it in'),
      ...mitchell.map(n => rule(n, 'percent', 65, Y, 'juan')),
    ],
    recurring: [
      { id: 'rc_ins', payeeId: 'carlos', label: 'Dealer insurance', amount: -500, every: 'week', from: '2026-03-27', to: null, active: true },
      { id: 'rc_ins_old', payeeId: 'carlos', label: 'Dealer insurance', amount: -525, every: 'week', from: Y, to: '2026-03-20', active: true },
      { id: 'rc_girl', payeeId: 'carlos', label: 'Girl', amount: 138, every: 'week', from: '2026-04-03', to: null, active: true },
      { id: 'rc_girl_old', payeeId: 'carlos', label: 'Girl', amount: -138, every: 'week', from: Y, to: '2026-03-20', active: true },
      { id: 'rc_don', payeeId: 'carlos', label: 'Donation', amount: -100, every: 'week', from: Y, to: null, active: true },
    ],
    presets: [
      { id: 'p_jeep', label: 'Jeep', amount: -1251 },
      { id: 'p_sup', label: 'Supplies', amount: 0 },
      { id: 'p_owed', label: 'Money owed to me', amount: 0 },
      { id: 'p_over', label: 'Check over', amount: 0 },
    ],
    overhead: [
      { id: 'oh_web', label: 'Website', amount: 179, per: 'month', active: true },
      { id: 'oh_acc', label: 'Accountant', amount: 694, per: 'month', active: true },
      { id: 'oh_book', label: 'Bookkeeper', amount: 138, per: 'week', active: true },
      { id: 'oh_ins', label: 'Insurance', amount: 335.46, per: 'week', from: '2026-03-27', active: true },
      { id: 'oh_ins_old', label: 'Insurance', amount: 360.46, per: 'week', to: '2026-03-20', active: true },
    ],
    setAsides: [
      { id: 'sa_tax7', label: 'Income tax', pct: 7, base: 'billed', kind: 'incomeTax', to: '2026-02-20', active: true },
      { id: 'sa_tax', label: 'Income tax', pct: 10, base: 'billed', kind: 'incomeTax', from: '2026-02-27', active: true },
      { id: 'sa_zakat', label: 'Zakat', pct: 2.5, base: 'profit', kind: 'other', active: true },
    ],
    nameMap: {},
  }
}

export async function loadCommissionSettings(db: any): Promise<CommissionSettings> {
  const doc = await db.collection(COMMISSION_SETTINGS_COLLECTION).findOne({ _id: 'settings' })
  const base = defaultCommissionSettings()
  if (!doc) return base
  return { ...base, ...doc, nameMap: doc.nameMap || {} }
}

export function cleanCommissionSettings(body: any): CommissionSettings {
  const s = defaultCommissionSettings()
  const arr = (v: any) => Array.isArray(v) ? v : []
  const day = (v: any) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : null
  const str = (v: any, max = 80) => String(v ?? '').trim().slice(0, max)
  const payees = arr(body.payees).map((p: any) => ({
    id: str(p.id, 40) || commissionId('p'), name: str(p.name) || 'Payee', defaultPct: Math.max(0, Math.min(100, num(p.defaultPct))),
    base: p.base === 'billed' ? 'billed' : 'net', active: p.active !== false, scope: p.scope === 'listed' ? 'listed' : 'all', fundedBy: p.fundedBy ? str(p.fundedBy, 40) : null,
  })) as CommissionPayee[]
  const payeeIds = new Set(payees.map(p => p.id))
  return {
    _id: 'settings',
    configured: true,
    monthlyAllocation: body.monthlyAllocation === 'lump' ? 'lump' : 'spread',
    payees: payees.length ? payees : s.payees,
    rules: arr(body.rules).filter((r: any) => payeeIds.has(r.payeeId) && (r.dealerId || r.dealerName)).map((r: any) => ({
      id: str(r.id, 40) || commissionId('r'), payeeId: r.payeeId, dealerId: r.dealerId ? str(r.dealerId, 40) : null, dealerName: r.dealerName ? str(r.dealerName, 120) : null,
      kind: (['percent', 'fixed', 'manual', 'none'].includes(r.kind) ? r.kind : 'percent') as CommissionRuleKind,
      value: r2(r.value), base: r.base === 'billed' ? 'billed' : 'net', from: day(r.from) || '2000-01-01', note: str(r.note, 200),
    })),
    recurring: arr(body.recurring).filter((r: any) => payeeIds.has(r.payeeId)).map((r: any) => ({
      id: str(r.id, 40) || commissionId('rc'), payeeId: r.payeeId, label: str(r.label) || 'Adjustment', amount: r2(r.amount),
      every: r.every === 'month' ? 'month' : 'week', from: day(r.from) || '2000-01-01', to: day(r.to), active: r.active !== false,
    })),
    presets: arr(body.presets).map((p: any) => ({ id: str(p.id, 40) || commissionId('pr'), label: str(p.label) || 'Item', amount: r2(p.amount) })),
    overhead: arr(body.overhead).map((o: any) => ({
      id: str(o.id, 40) || commissionId('oh'), label: str(o.label) || 'Expense', amount: r2(o.amount),
      per: (['week', 'month', 'year'].includes(o.per) ? o.per : 'month') as 'week' | 'month' | 'year', from: day(o.from), to: day(o.to), active: o.active !== false,
    })),
    setAsides: arr(body.setAsides).map((a: any) => ({
      id: str(a.id, 40) || commissionId('sa'), label: str(a.label) || 'Set-aside', pct: Math.max(0, Math.min(100, num(a.pct))),
      base: (['billed', 'net', 'profit'].includes(a.base) ? a.base : 'billed') as 'billed' | 'net' | 'profit', kind: a.kind === 'incomeTax' ? 'incomeTax' : 'other',
      from: day(a.from), to: day(a.to), active: a.active !== false,
    })),
    nameMap: Object.fromEntries(Object.entries(body.nameMap || {}).filter(([k, v]) => k && typeof v === 'string').map(([k, v]) => [String(k).slice(0, 120), String(v).slice(0, 40)])),
  }
}

/** Which rule applies to a payee + dealer on a pay day. */
export function commissionRuleFor(settings: CommissionSettings, payee: CommissionPayee, dealerId: string, payDate: string, resolve: (n?: string | null) => string | null) {
  const candidates = settings.rules
    .filter(r => r.payeeId === payee.id && (r.dealerId ? r.dealerId === dealerId : resolve(r.dealerName) === dealerId) && r.from <= payDate)
    .sort((a, b) => b.from.localeCompare(a.from))
  const hit = candidates[0]
  if (hit) return { kind: hit.kind, value: hit.value, base: hit.base || payee.base, from: hit.from, ruleId: hit.id, note: hit.note || '', source: 'rule' as const }
  if (payee.scope === 'all') return { kind: 'percent' as CommissionRuleKind, value: payee.defaultPct, base: payee.base, from: '', ruleId: null, note: '', source: 'default' as const }
  return null
}

// ─── Statement documents ────────────────────────────────────────────────────
export interface CommissionStatementDoc {
  _id: string // pay day
  status: 'draft' | 'approved' | 'paid'
  source: 'system' | 'sheet'
  /** dealerId → payeeId → manual payout / note; plus deposited override. */
  overrides: Record<string, { payouts?: Record<string, { amount: number, note?: string }>, deposited?: boolean | null }>
  adjustments: { id: string, payeeId: string, label: string, amount: number, note?: string }[]
  recurringOverrides: Record<string, { skip?: boolean, amount?: number }>
  payments: { id: string, payeeId: string, date: string, amount: number, method?: string, note?: string }[]
  taxes: Record<string, { paid: boolean, date?: string | null, amount?: number | null }>
  noRecurring?: boolean
  notes?: string
  snapshot?: any
  sheetTab?: string
  approvedAt?: string
  approvedBy?: string
  history: { at: string, by: string, action: string, detail?: string }[]
  updatedAt?: string
}

export function emptyCommissionStatement(payDate: string): CommissionStatementDoc {
  return { _id: payDate, status: 'draft', source: 'system', overrides: {}, adjustments: [], recurringOverrides: {}, payments: [], taxes: {}, history: [] }
}

// ─── Loading everything a range of weeks needs ──────────────────────────────
export interface CommissionContext {
  settings: CommissionSettings
  dealers: CommissionDealer[]
  dealerById: Map<string, CommissionDealer>
  resolve: (n?: string | null) => string | null
  invoices: any[]
  statements: Map<string, CommissionStatementDoc>
  sheetWeeks: Map<string, any>
}

export function commissionSheetWeeks(): Map<string, any> {
  const m = new Map<string, any>()
  for (const w of (sheetHistory as any).weeks || []) m.set(w.payDate, w)
  return m
}

export async function loadCommissionContext(db: any, firstPayDate: string, lastPayDate: string): Promise<CommissionContext> {
  const settings = await loadCommissionSettings(db)
  const start = addDays(firstPayDate, -11)
  const end = addDays(lastPayDate, -5)
  const monthFrom = start.slice(0, 7)
  const monthTo = end.slice(0, 7)
  const [dealerDocs, invoices, statementDocs] = await Promise.all([
    db.collection('turboCleanDealers').find({}).project({ _id: 1, dealer: 1, taxPercentage: 1 }).toArray(),
    db.collection('turboCleanInvoices').find({
      $or: [
        { type: { $in: ['Weekly', 'Daily', null] }, date: { $gte: start, $lte: end } },
        { type: { $exists: false }, date: { $gte: start, $lte: end } },
        { type: 'Monthly', monthKey: { $gte: monthFrom, $lte: monthTo } },
      ],
    }).project({ number: 1, type: 1, dealerId: 1, dealerName: 1, date: 1, status: 1, subtotal: 1, taxTotal: 1, total: 1, paidAmount: 1, monthKey: 1, isWeeklyBilled: 1 }).toArray(),
    // statements from the start of the year (manual amounts carry forward as suggestions)
    db.collection(COMMISSION_STATEMENTS_COLLECTION).find({ _id: { $gte: `${firstPayDate.slice(0, 4)}-01-01`, $lte: lastPayDate } }).toArray(),
  ])
  const dealers: CommissionDealer[] = dealerDocs.map((d: any) => ({ id: d._id.toString(), name: d.dealer || 'Dealer', taxPercentage: num(d.taxPercentage) }))
  return {
    settings,
    dealers,
    dealerById: new Map(dealers.map(d => [d.id, d])),
    resolve: commissionDealerResolver(dealers, settings.nameMap),
    invoices,
    statements: new Map(statementDocs.map((s: any) => [s._id, s])),
    sheetWeeks: commissionSheetWeeks(),
  }
}

// ─── Building one week ──────────────────────────────────────────────────────
interface RawLine {
  dealerId: string
  dealerName: string
  billed: number
  tax: number
  net: number
  invoices: { id: string, number: string, type: string, date: string, status: string, total: number, paid: number, share?: number }[]
  sources: { weekly: number, daily: number, monthly: number }
  /** Spreadsheet payout per payee, for weeks imported from the sheet. */
  fixedPayouts?: Record<string, number>
  sheetDeposited?: boolean
}

function invTotals(inv: any, share = 1) {
  return { billed: num(inv.total) * share, tax: num(inv.taxTotal) * share, net: num(inv.subtotal) * share }
}

/** Revenue per dealer for the work week: Weekly invoices; Daily ones if no Weekly yet; a share of Monthly ones. */
function buildRawLines(ctx: CommissionContext, payDate: string): RawLine[] {
  const { workStart, workEnd } = commissionPayWeek(payDate)
  const byDealer = new Map<string, { weekly: any[], daily: any[], monthly: { inv: any, share: number }[] }>()
  const slot = (id: string) => { if (!byDealer.has(id)) byDealer.set(id, { weekly: [], daily: [], monthly: [] }); return byDealer.get(id)! }
  for (const inv of ctx.invoices) {
    const dealerId = String(inv.dealerId || '')
    if (!dealerId) continue
    const type = inv.type || 'Weekly'
    if (type === 'Monthly') {
      if (!inv.monthKey) continue
      const [y, m] = String(inv.monthKey).split('-').map(Number)
      const mStart = `${inv.monthKey}-01`
      const dim = new Date(Date.UTC(y!, m!, 0)).getUTCDate()
      const mEnd = `${inv.monthKey}-${String(dim).padStart(2, '0')}`
      let share = 0
      if (ctx.settings.monthlyAllocation === 'lump') share = (mEnd >= workStart && mEnd <= workEnd) ? 1 : 0
      else {
        const a = workStart > mStart ? workStart : mStart
        const b = workEnd < mEnd ? workEnd : mEnd
        if (a <= b) share = (Math.round((utc(b).getTime() - utc(a).getTime()) / DAY) + 1) / dim
      }
      if (share > 0) slot(dealerId).monthly.push({ inv, share })
      continue
    }
    const date = String(inv.date || '').slice(0, 10)
    if (date < workStart || date > workEnd) continue
    if (type === 'Weekly') slot(dealerId).weekly.push(inv)
    else if (type === 'Daily') slot(dealerId).daily.push(inv)
  }
  const lines: RawLine[] = []
  for (const [dealerId, g] of byDealer) {
    const used = g.weekly.length ? g.weekly : g.daily
    const line: RawLine = {
      dealerId, dealerName: ctx.dealerById.get(dealerId)?.name || used[0]?.dealerName || g.monthly[0]?.inv.dealerName || 'Dealer',
      billed: 0, tax: 0, net: 0, invoices: [], sources: { weekly: 0, daily: 0, monthly: 0 },
    }
    for (const inv of used) {
      const t = invTotals(inv)
      line.billed += t.billed; line.tax += t.tax; line.net += t.net
      line.sources[g.weekly.length ? 'weekly' : 'daily'] += t.billed
      line.invoices.push({ id: inv._id.toString(), number: inv.number || '', type: inv.type || 'Weekly', date: inv.date || '', status: inv.status || 'Draft', total: r2(inv.total), paid: r2(inv.paidAmount) })
    }
    for (const { inv, share } of g.monthly) {
      const t = invTotals(inv, share)
      line.billed += t.billed; line.tax += t.tax; line.net += t.net
      line.sources.monthly += t.billed
      line.invoices.push({ id: inv._id.toString(), number: inv.number || '', type: 'Monthly', date: inv.date || '', status: inv.status || 'Draft', total: r2(inv.total), paid: r2(inv.paidAmount), share: Math.round(share * 10000) / 10000 })
    }
    line.billed = r2(line.billed); line.tax = r2(line.tax); line.net = r2(line.net)
    if (line.billed || line.net || line.invoices.length) lines.push(line)
  }
  return lines.sort((a, b) => a.dealerName.localeCompare(b.dealerName))
}

/** Lines for a week imported from the spreadsheet (what was really paid). */
function sheetRawLines(ctx: CommissionContext, sheetWeek: any): RawLine[] {
  return (sheetWeek.lines || []).filter((l: any) => l.billed || l.net || l.payout).map((l: any) => {
    const id = ctx.resolve(l.name)
    const billed = r2(l.billed ?? l.net)
    const net = r2(l.net ?? l.billed)
    return {
      dealerId: id || `sheet:${l.name}`, dealerName: id ? (ctx.dealerById.get(id)?.name || l.name) : l.name,
      billed, net, tax: r2(billed - net), invoices: [], sources: { weekly: 0, daily: 0, monthly: 0 },
      fixedPayouts: { carlos: r2(l.payout) }, sheetDeposited: !!l.deposited,
    }
  })
}

function lastManualAmount(ctx: CommissionContext, payDate: string, dealerId: string, payeeId: string) {
  const prev = [...ctx.statements.values()].filter(s => s._id < payDate).sort((a, b) => b._id.localeCompare(a._id))
  for (const s of prev) {
    const v = s.overrides?.[dealerId]?.payouts?.[payeeId]?.amount
    if (v != null) return num(v)
    const snap = s.snapshot?.lines?.find((l: any) => l.dealerId === dealerId)?.payouts?.[payeeId]?.amount
    if (snap != null) return num(snap)
  }
  return null
}

function overheadPerWeek(o: CommissionOverhead) {
  if (o.per === 'week') return o.amount
  if (o.per === 'year') return o.amount / 52
  return o.amount * 12 / 52
}

/** Turn revenue lines + the plan + what was recorded for the week into the full statement. */
function summarizeCommissionWeek(ctx: CommissionContext, payDate: string, raw: RawLine[], doc: CommissionStatementDoc) {
  const { settings } = ctx
  const payees = settings.payees.filter(p => p.active || raw.some(l => l.fixedPayouts?.[p.id] != null))
  const warnings: { kind: string, message: string, dealerId?: string }[] = []

  const lines = raw.map((l) => {
    const ov = doc.overrides?.[l.dealerId] || {}
    const payouts: Record<string, any> = {}
    for (const p of payees) {
      if (l.fixedPayouts) {
        if (l.fixedPayouts[p.id] != null) payouts[p.id] = { amount: r2(l.fixedPayouts[p.id]), rule: { kind: 'fixed', value: r2(l.fixedPayouts[p.id]), base: 'net', from: '', source: 'sheet' }, overridden: false, needsAmount: false }
        continue
      }
      const rule = commissionRuleFor(settings, p, l.dealerId, payDate, ctx.resolve)
      if (!rule) continue
      const manual = ov.payouts?.[p.id]
      const baseAmt = rule.base === 'billed' ? l.billed : l.net
      let amount = 0
      let needsAmount = false
      let suggested: number | null = null
      if (rule.kind === 'percent') amount = baseAmt * rule.value / 100
      else if (rule.kind === 'fixed') amount = l.net || l.billed ? rule.value : 0
      else if (rule.kind === 'manual') {
        suggested = lastManualAmount(ctx, payDate, l.dealerId, p.id) ?? (rule.value || r2(baseAmt * p.defaultPct / 100))
        amount = suggested
        needsAmount = !manual
      }
      if (manual) amount = num(manual.amount)
      payouts[p.id] = { amount: r2(amount), rule, overridden: !!manual && rule.kind !== 'manual', manual: !!manual, note: manual?.note || '', needsAmount, suggested: suggested == null ? null : r2(suggested) }
      if (needsAmount && (l.net || l.billed)) warnings.push({ kind: 'manual', dealerId: l.dealerId, message: `${l.dealerName}: type in ${p.name}'s amount (suggested ${r2(amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })})` })
    }
    // Was the dealer's check deposited? From invoice payments, unless someone ticked it by hand.
    const billedInv = l.invoices.filter(i => i.type !== 'Daily')
    let deposit: 'paid' | 'partial' | 'unpaid' | 'none' = 'none'
    if (l.sheetDeposited != null) deposit = l.sheetDeposited ? 'paid' : 'unpaid'
    else if (billedInv.length) {
      const paidAll = billedInv.every(i => i.status === 'Paid' || (i.total > 0 && i.paid >= i.total - 0.01))
      const paidAny = billedInv.some(i => i.status === 'Paid' || i.paid > 0)
      deposit = paidAll ? 'paid' : paidAny ? 'partial' : 'unpaid'
    }
    else if (l.invoices.length) deposit = 'unpaid'
    const depositOverride = typeof ov.deposited === 'boolean' ? ov.deposited : null
    const companyPayout = r2(Object.entries(payouts).filter(([pid]) => !settings.payees.find(p => p.id === pid)?.fundedBy).reduce((s, [, v]) => s + v.amount, 0))
    const notWeeklyYet = l.sources.daily > 0
    if (notWeeklyYet) warnings.push({ kind: 'daily', dealerId: l.dealerId, message: `${l.dealerName}: no Weekly invoice yet — using its Daily invoices` })
    if (l.dealerId.startsWith('sheet:')) warnings.push({ kind: 'unmapped', dealerId: l.dealerId, message: `"${l.dealerName}" from the spreadsheet is not linked to a dealer yet` })
    return {
      dealerId: l.dealerId, dealerName: l.dealerName, billed: l.billed, tax: l.tax, net: l.net,
      invoices: l.invoices, sources: { weekly: r2(l.sources.weekly), daily: r2(l.sources.daily), monthly: r2(l.sources.monthly) },
      payouts, payout: companyPayout, margin: r2(l.net - companyPayout),
      deposit, depositOverride, deposited: depositOverride ?? deposit === 'paid',
    }
  })

  // Payees: commission → adjustments → net payable → payments → balance
  const payeeRows = payees.map((p) => {
    const commission = r2(lines.reduce((s, l) => s + (l.payouts[p.id]?.amount || 0), 0))
    const adjustments: any[] = []
    if (!doc.noRecurring) {
      for (const rc of settings.recurring) {
        if (rc.payeeId !== p.id || !rc.active || !inRange(payDate, rc.from, rc.to)) continue
        if (rc.every === 'month' && Number(payDate.slice(8, 10)) > 7) continue
        const o = doc.recurringOverrides?.[rc.id]
        adjustments.push({ id: rc.id, recurringId: rc.id, kind: 'recurring', label: rc.label, amount: r2(o?.amount ?? rc.amount), defaultAmount: rc.amount, skipped: !!o?.skip, every: rc.every })
      }
    }
    for (const a of doc.adjustments || []) if (a.payeeId === p.id) adjustments.push({ ...a, kind: 'oneoff', amount: r2(a.amount) })
    const adjustmentsTotal = r2(adjustments.filter(a => !a.skipped).reduce((s, a) => s + a.amount, 0))
    const netPayable = r2(commission + adjustmentsTotal)
    const payments = (doc.payments || []).filter(x => x.payeeId === p.id)
    const paid = r2(payments.reduce((s, x) => s + num(x.amount), 0))
    return { id: p.id, name: p.name, fundedBy: p.fundedBy || null, fundedByName: p.fundedBy ? settings.payees.find(x => x.id === p.fundedBy)?.name || '' : '', commission, adjustments, adjustmentsTotal, netPayable, payments, paid, balance: r2(netPayable - paid) }
  })

  const company = payeeRows.filter(p => !p.fundedBy)
  const billed = r2(lines.reduce((s, l) => s + l.billed, 0))
  const tax = r2(lines.reduce((s, l) => s + l.tax, 0))
  const net = r2(lines.reduce((s, l) => s + l.net, 0))
  const commission = r2(company.reduce((s, p) => s + p.commission, 0))
  const adjustments = r2(company.reduce((s, p) => s + p.adjustmentsTotal, 0))
  const paidToContractors = r2(commission + adjustments)
  const grossMargin = r2(net - paidToContractors)
  const overheadItems = settings.overhead.filter(o => o.active && inRange(payDate, o.from, o.to)).map(o => ({ id: o.id, label: o.label, amount: r2(overheadPerWeek(o)), source: `${o.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} / ${o.per}` }))
  const overhead = r2(overheadItems.reduce((s, o) => s + o.amount, 0))
  const activeSA = settings.setAsides.filter(a => a.active && inRange(payDate, a.from, a.to))
  const beforeProfit = activeSA.filter(a => a.base !== 'profit').map(a => ({ id: a.id, label: a.label, pct: a.pct, base: a.base, kind: a.kind, amount: r2((a.base === 'billed' ? billed : net) * a.pct / 100) }))
  const setAsideTotal = r2(beforeProfit.reduce((s, a) => s + a.amount, 0))
  const netProfit = r2(grossMargin - overhead - setAsideTotal)
  const fromProfit = activeSA.filter(a => a.base === 'profit').map(a => ({ id: a.id, label: a.label, pct: a.pct, base: a.base, kind: a.kind, amount: r2(Math.max(0, netProfit) * a.pct / 100) }))
  const reserved = r2(fromProfit.reduce((s, a) => s + a.amount, 0))

  const taxes = [
    { id: 'salesTax', label: 'Sales tax collected', hint: 'Sales tax on this week’s invoices — owed to the state.', due: tax, ...(doc.taxes?.salesTax || { paid: false }) },
    ...beforeProfit.filter(a => a.kind === 'incomeTax').map(a => ({ id: a.id, label: `${a.label} set-aside (${a.pct}% of ${a.base === 'billed' ? 'billed' : 'net'})`, hint: 'Put aside for income tax.', due: a.amount, ...(doc.taxes?.[a.id] || doc.taxes?.incomeTax || { paid: false }) })),
  ]

  return {
    lines,
    payees: payeeRows,
    totals: {
      billed, tax, net, commission, adjustments, paidToContractors, grossMargin, overhead, overheadItems,
      setAsides: beforeProfit, setAsideTotal, netProfit, marginPct: net ? Math.round(netProfit / net * 1000) / 10 : 0,
      reserves: fromProfit, reserved, retained: r2(netProfit - reserved),
      effectivePct: net ? Math.round(commission / net * 1000) / 10 : 0,
      balance: r2(company.reduce((s, p) => s + p.balance, 0)),
      paid: r2(company.reduce((s, p) => s + p.paid, 0)),
      depositedBilled: r2(lines.filter(l => l.deposited).reduce((s, l) => s + l.billed, 0)),
      dealers: lines.filter(l => l.billed || l.net).length,
    },
    taxes,
    warnings,
  }
}

function sheetCompare(ctx: CommissionContext, sheetWeek: any, lines: any[]) {
  if (!sheetWeek) return null
  const byDealer = new Map<string, { billed: number, net: number, payout: number, names: string[] }>()
  for (const l of sheetWeek.lines || []) {
    const id = ctx.resolve(l.name) || `sheet:${l.name}`
    const cur = byDealer.get(id) || { billed: 0, net: 0, payout: 0, names: [] }
    cur.billed += num(l.billed ?? l.net); cur.net += num(l.net ?? l.billed); cur.payout += num(l.payout); cur.names.push(l.name)
    byDealer.set(id, cur)
  }
  const perDealer: Record<string, any> = {}
  for (const [id, v] of byDealer) perDealer[id] = { billed: r2(v.billed), net: r2(v.net), payout: r2(v.payout), names: v.names }
  const sum = (k: 'billed' | 'net' | 'payout') => r2([...byDealer.values()].reduce((s, v) => s + v[k], 0))
  const missing = [...byDealer.entries()].filter(([id, v]) => (v.billed || v.payout) && !lines.some(l => l.dealerId === id)).map(([id, v]) => ({ dealerId: id, names: v.names, ...perDealer[id] }))
  return {
    tab: sheetWeek.tab,
    totals: { billed: sum('billed'), net: sum('net'), payout: sum('payout') },
    sheetTotalsRow: sheetWeek.totals,
    payoutTotal: sheetWeek.payoutTotal,
    netAfterAdjustments: sheetWeek.netAfterAdjustments,
    perDealer,
    missing,
  }
}

/** Everything the page shows for one pay day. */
export function buildCommissionWeek(ctx: CommissionContext, anyDay: string, opts: { withLive?: boolean } = {}) {
  const { payDate, workStart, workEnd } = commissionPayWeek(anyDay)
  const doc = ctx.statements.get(payDate) || emptyCommissionStatement(payDate)
  const sheetWeek = ctx.sheetWeeks.get(payDate) || null
  const locked = doc.status !== 'draft' && !!doc.snapshot
  const liveRaw = buildRawLines(ctx, payDate)
  let body: ReturnType<typeof summarizeCommissionWeek>
  if (locked) {
    body = doc.snapshot
    // payments can still be recorded on an approved week → refresh the payee balances
    body = { ...body, payees: body.payees.map((p: any) => {
      const payments = (doc.payments || []).filter(x => x.payeeId === p.id)
      const paid = r2(payments.reduce((s, x) => s + num(x.amount), 0))
      return { ...p, payments, paid, balance: r2(p.netPayable - paid) }
    }) }
    const company = body.payees.filter((p: any) => !p.fundedBy)
    body.totals = { ...body.totals, paid: r2(company.reduce((s: number, p: any) => s + p.paid, 0)), balance: r2(company.reduce((s: number, p: any) => s + p.balance, 0)) }
    body.taxes = body.taxes.map((t: any) => ({ ...t, ...(doc.taxes?.[t.id] || {}) }))
  }
  else {
    body = summarizeCommissionWeek(ctx, payDate, doc.source === 'sheet' && sheetWeek ? sheetRawLines(ctx, sheetWeek) : liveRaw, doc)
  }
  let live: any = null
  if (opts.withLive && (locked || doc.source === 'sheet')) {
    const l = summarizeCommissionWeek(ctx, payDate, liveRaw, { ...doc, status: 'draft' })
    live = { billed: l.totals.billed, net: l.totals.net, commission: l.totals.commission, dealers: l.totals.dealers, lines: l.lines.map(x => ({ dealerId: x.dealerId, dealerName: x.dealerName, billed: x.billed, tax: x.tax, net: x.net, payout: x.payout, invoices: x.invoices, sources: x.sources })) }
  }
  return {
    payDate, workStart, workEnd,
    status: doc.status, source: doc.source, locked,
    approvedAt: doc.approvedAt || null, approvedBy: doc.approvedBy || null,
    notes: doc.notes || '',
    history: (doc.history || []).slice(-50).reverse(),
    ...body,
    sheet: sheetCompare(ctx, sheetWeek, body.lines),
    live,
  }
}

export function commissionPayeeSummary(week: any) {
  return Object.fromEntries((week.payees || []).map((p: any) => [p.id, { commission: p.commission, netPayable: p.netPayable, paid: p.paid, balance: p.balance }]))
}

// ─── Saving changes to a week ───────────────────────────────────────────────
export async function loadCommissionStatement(db: any, payDate: string): Promise<CommissionStatementDoc> {
  const doc = await db.collection(COMMISSION_STATEMENTS_COLLECTION).findOne({ _id: payDate })
  return doc ? { ...emptyCommissionStatement(payDate), ...doc } : emptyCommissionStatement(payDate)
}

export async function saveCommissionStatement(db: any, doc: CommissionStatementDoc) {
  doc.updatedAt = new Date().toISOString()
  doc.history = (doc.history || []).slice(-200)
  await db.collection(COMMISSION_STATEMENTS_COLLECTION).replaceOne({ _id: doc._id }, doc, { upsert: true })
}

export function isCommissionDealerId(id: any) {
  if (typeof id !== 'string' || !id) return false
  if (id.startsWith('sheet:')) return true
  try { return ObjectId.isValid(id) || id.length < 60 } catch { return false }
}
