import { connectToDatabase } from '../../utils/mongodb'
import { requireCommissionAdmin } from '../../utils/commission-access'
import { buildCommissionWeek, commissionPayDays, commissionPayWeek, loadCommissionContext } from '../../utils/commissions'

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * GET /api/commissions/overview?year=2026
 * One row per pay day (up to the coming one), plus year-to-date totals per dealer and per payee.
 */
export default defineEventHandler(async (event) => {
  await requireCommissionAdmin(event)
  const year = Number(getQuery(event).year) || new Date().getUTCFullYear()
  const current = commissionPayWeek(new Date().toISOString().slice(0, 10)).payDate
  const days = commissionPayDays(year).filter(d => d <= current)
  if (!days.length) return { year, current, weeks: [], dealers: [], payees: [], totals: null }
  const { db } = await connectToDatabase()
  const ctx = await loadCommissionContext(db, days[0]!, days[days.length - 1]!)

  const dealers = new Map<string, any>()
  const payees = new Map<string, any>()
  const weeks = days.map((payDate) => {
    const w = buildCommissionWeek(ctx, payDate, { withLive: true })
    for (const l of w.lines) {
      const d = dealers.get(l.dealerId) || { dealerId: l.dealerId, dealerName: l.dealerName, billed: 0, net: 0, payout: 0, margin: 0, weeks: 0, series: {} as Record<string, number> }
      d.billed += l.billed; d.net += l.net; d.payout += l.payout; d.margin += l.margin
      if (l.net || l.billed) d.weeks++
      d.series[payDate] = r2(l.net)
      dealers.set(l.dealerId, d)
    }
    for (const p of w.payees) {
      const c = payees.get(p.id) || { id: p.id, name: p.name, fundedBy: p.fundedBy, commission: 0, adjustments: 0, netPayable: 0, paid: 0, balance: 0 }
      c.commission += p.commission; c.adjustments += p.adjustmentsTotal; c.netPayable += p.netPayable; c.paid += p.paid; c.balance += p.balance
      payees.set(p.id, c)
    }
    const t = w.totals
    return {
      payDate, workStart: w.workStart, workEnd: w.workEnd, status: w.status, source: w.source,
      billed: t.billed, tax: t.tax, net: t.net, commission: t.commission, adjustments: t.adjustments,
      paidToContractors: t.paidToContractors, grossMargin: t.grossMargin, overhead: t.overhead, setAsideTotal: t.setAsideTotal,
      netProfit: t.netProfit, marginPct: t.marginPct, balance: t.balance, dealers: t.dealers,
      warnings: w.warnings.length,
      /** Net revenue from the invoices in the system (differs from net when the week uses spreadsheet or frozen amounts). */
      invoicesNet: w.live ? w.live.net : t.net,
      sheet: w.sheet ? { billed: w.sheet.totals.billed, net: w.sheet.totals.net, payout: w.sheet.totals.payout } : null,
    }
  })

  const sum = (k: string) => r2(weeks.reduce((s, w: any) => s + (w[k] || 0), 0))
  const active = weeks.filter(w => w.net > 0)
  const totals = {
    billed: sum('billed'), tax: sum('tax'), net: sum('net'), commission: sum('commission'), adjustments: sum('adjustments'),
    paidToContractors: sum('paidToContractors'), overhead: sum('overhead'), setAsideTotal: sum('setAsideTotal'), netProfit: sum('netProfit'),
    balance: sum('balance'), weeks: active.length,
    avgWeeklyNet: active.length ? r2(sum('net') / active.length) : 0,
    marginPct: sum('net') ? Math.round(sum('netProfit') / sum('net') * 1000) / 10 : 0,
    effectivePct: sum('net') ? Math.round(sum('commission') / sum('net') * 1000) / 10 : 0,
  }
  return {
    year, current, weeks, totals,
    dealers: [...dealers.values()].map(d => ({ ...d, billed: r2(d.billed), net: r2(d.net), payout: r2(d.payout), margin: r2(d.margin), effectivePct: d.net ? Math.round(d.payout / d.net * 1000) / 10 : 0 })).sort((a, b) => b.net - a.net),
    payees: [...payees.values()].map(p => ({ ...p, commission: r2(p.commission), adjustments: r2(p.adjustments), netPayable: r2(p.netPayable), paid: r2(p.paid), balance: r2(p.balance) })),
  }
})
