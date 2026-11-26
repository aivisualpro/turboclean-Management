import { connectToDatabase } from '../../utils/mongodb'
import { requireCommissionAdmin } from '../../utils/commission-access'
import {
  COMMISSION_SETTINGS_COLLECTION, COMMISSION_STATEMENTS_COLLECTION, buildCommissionWeek, commissionId,
  emptyCommissionStatement, loadCommissionContext,
} from '../../utils/commissions'

/**
 * POST /api/commissions/import-sheet  { dryRun?: boolean, overwrite?: boolean }
 * Brings the 2026 Google Sheet history in as paid weeks: what Carlos was paid per dealer, his
 * deductions and advances, and the tax payments. Weeks that already have a statement are kept
 * unless overwrite is set. The system's own invoice totals stay visible next to them for comparison.
 */
export default defineEventHandler(async (event) => {
  const session = await requireCommissionAdmin(event)
  const body = await readBody(event) || {}
  const { db } = await connectToDatabase()
  const ctx = await loadCommissionContext(db, '2026-01-02', '2026-12-25')
  const who = session.name || session.email || 'Someone'

  if (!ctx.settings.configured && !body.dryRun) {
    // First import also saves the plan read from the sheet, so later weeks use the same rules.
    await db.collection<any>(COMMISSION_SETTINGS_COLLECTION).replaceOne({ _id: 'settings' }, { ...ctx.settings, configured: true, updatedAt: new Date().toISOString(), updatedBy: who } as any, { upsert: true })
    ctx.settings.configured = true
  }

  const results: any[] = []
  for (const [payDate, w] of [...ctx.sheetWeeks.entries()].sort()) {
    const existing = ctx.statements.get(payDate)
    if (existing && !body.overwrite) { results.push({ payDate, tab: w.tab, action: 'kept', reason: existing.source === 'sheet' ? 'already imported' : 'has its own statement' }); continue }
    const doc = emptyCommissionStatement(payDate)
    doc.source = 'sheet'
    doc.sheetTab = w.tab
    doc.noRecurring = true
    doc.adjustments = (w.adjustments || []).map((a: any) => ({ id: commissionId('adj'), payeeId: 'carlos', label: a.label, amount: a.amount, note: 'From the spreadsheet' }))
    doc.payments = (w.payments || []).map((p: any) => ({ id: commissionId('pay'), payeeId: 'carlos', date: payDate, amount: p.amount, method: '', note: p.label }))
    if (w.salesTax) doc.taxes.salesTax = { paid: !!w.salesTax.paid, date: w.salesTax.date || null, amount: w.salesTax.amount ?? null }
    if (w.incomeTax) doc.taxes.incomeTax = { paid: !!w.incomeTax.paid, date: w.incomeTax.date || null, amount: w.incomeTax.amount ?? null }
    doc.history.push({ at: new Date().toISOString(), by: who, action: 'Imported from the spreadsheet', detail: `Tab "${w.tab}"` })
    ctx.statements.set(payDate, doc)
    // The rest was paid as the second check ("TOTAL AFTER EXPENSES"). Use the exact balance so the week closes at $0
    // (the sheet can differ by a few cents because it rounds the dealer lines differently).
    const before = buildCommissionWeek(ctx, payDate).payees.find((p: any) => p.id === 'carlos')
    if (before && before.balance > 0.005) doc.payments.push({ id: commissionId('pay'), payeeId: 'carlos', date: payDate, amount: before.balance, method: '', note: `Balance paid (spreadsheet: ${Number(w.netAfterAdjustments || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })})` })
    const week = buildCommissionWeek(ctx, payDate)
    const { payDate: _p, workStart, workEnd, status, source, locked, approvedAt, approvedBy, notes, history, sheet, live, ...snapshot } = week as any
    doc.snapshot = snapshot
    doc.status = 'paid'
    doc.approvedAt = new Date().toISOString()
    doc.approvedBy = who
    const unmapped = week.lines.filter((l: any) => String(l.dealerId).startsWith('sheet:')).map((l: any) => l.dealerName)
    results.push({ payDate, tab: w.tab, action: existing ? 'replaced' : 'imported', payout: week.totals.commission, net: week.totals.net, unmapped })
    if (!body.dryRun) await db.collection<any>(COMMISSION_STATEMENTS_COLLECTION).replaceOne({ _id: payDate }, doc as any, { upsert: true })
  }
  const unmapped = [...new Set(results.flatMap(r => r.unmapped || []))].sort()
  return {
    dryRun: !!body.dryRun,
    imported: results.filter(r => r.action !== 'kept').length,
    kept: results.filter(r => r.action === 'kept').length,
    unmapped,
    results,
  }
})
