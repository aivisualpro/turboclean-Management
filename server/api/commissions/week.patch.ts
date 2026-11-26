import { connectToDatabase } from '../../utils/mongodb'
import { requireCommissionAdmin } from '../../utils/commission-access'
import {
  buildCommissionWeek, commissionId, commissionPayWeek, loadCommissionContext,
  loadCommissionStatement, saveCommissionStatement,
} from '../../utils/commissions'

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const round = (n: any) => Math.round((Number(n) || 0) * 100) / 100
const day = (v: any, fallback: string) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : fallback

/** Changes allowed once a week is approved (everything else needs "Reopen" first). */
const AFTER_APPROVAL = new Set(['addPayment', 'removePayment', 'setTax', 'setNotes', 'reopen', 'markPaid'])

/**
 * PATCH /api/commissions/week  { payDate, op, ...fields }
 * One small change per call; every change is written to the week's history.
 */
export default defineEventHandler(async (event) => {
  const session = await requireCommissionAdmin(event)
  const body = await readBody(event) || {}
  const { payDate } = commissionPayWeek(String(body.payDate || ''))
  const op = String(body.op || '')
  const { db } = await connectToDatabase()
  const doc = await loadCommissionStatement(db, payDate)
  const who = session.name || session.email || 'Someone'
  const log = (action: string, detail = '') => doc.history.push({ at: new Date().toISOString(), by: who, action, detail })

  if (doc.status !== 'draft' && !AFTER_APPROVAL.has(op))
    throw createError({ statusCode: 409, statusMessage: 'This week is approved. Reopen it to change amounts.' })

  const payeeId = String(body.payeeId || '')
  const dealerId = String(body.dealerId || '')
  doc.overrides = doc.overrides || {}

  switch (op) {
    case 'setPayout': {
      if (!dealerId || !payeeId) throw createError({ statusCode: 400, statusMessage: 'Dealer and payee are required' })
      const o = doc.overrides[dealerId] = doc.overrides[dealerId] || {}
      o.payouts = o.payouts || {}
      if (body.amount === null || body.amount === '' || body.amount === undefined) {
        delete o.payouts[payeeId]
        log('Payout reset to the rule', `${body.dealerName || dealerId}`)
      }
      else {
        o.payouts[payeeId] = { amount: round(body.amount), note: String(body.note || '').slice(0, 200) }
        log('Payout set', `${body.dealerName || dealerId}: ${money(round(body.amount))}${body.note ? ` — ${body.note}` : ''}`)
      }
      break
    }
    case 'setDeposited': {
      if (!dealerId) throw createError({ statusCode: 400, statusMessage: 'Dealer is required' })
      const o = doc.overrides[dealerId] = doc.overrides[dealerId] || {}
      o.deposited = typeof body.value === 'boolean' ? body.value : null
      log(o.deposited === null ? 'Check status back to automatic' : o.deposited ? 'Check marked deposited' : 'Check marked not deposited', String(body.dealerName || dealerId))
      break
    }
    case 'addAdjustment': {
      const amount = round(body.amount)
      if (!payeeId || !amount) throw createError({ statusCode: 400, statusMessage: 'Payee and a non-zero amount are required' })
      const label = String(body.label || 'Adjustment').slice(0, 80)
      doc.adjustments.push({ id: commissionId('adj'), payeeId, label, amount, note: String(body.note || '').slice(0, 200) })
      log(amount < 0 ? 'Deduction added' : 'Addition added', `${label}: ${money(amount)}`)
      break
    }
    case 'removeAdjustment': {
      const a = doc.adjustments.find(x => x.id === body.id)
      doc.adjustments = doc.adjustments.filter(x => x.id !== body.id)
      if (a) log('Adjustment removed', `${a.label}: ${money(a.amount)}`)
      break
    }
    case 'setRecurring': {
      const id = String(body.recurringId || '')
      if (!id) throw createError({ statusCode: 400, statusMessage: 'Recurring item is required' })
      doc.recurringOverrides = doc.recurringOverrides || {}
      const cur = doc.recurringOverrides[id] || {}
      if ('skip' in body) cur.skip = !!body.skip
      if ('amount' in body) { if (body.amount === null) delete cur.amount; else cur.amount = round(body.amount) }
      doc.recurringOverrides[id] = cur
      log(cur.skip ? 'Recurring item skipped this week' : 'Recurring item changed', `${body.label || id}${cur.amount != null ? `: ${money(cur.amount)}` : ''}`)
      break
    }
    case 'addPayment': {
      const amount = round(body.amount)
      if (!payeeId || !amount) throw createError({ statusCode: 400, statusMessage: 'Payee and amount are required' })
      doc.payments.push({ id: commissionId('pay'), payeeId, date: day(body.date, new Date().toISOString().slice(0, 10)), amount, method: String(body.method || '').slice(0, 40), note: String(body.note || '').slice(0, 200) })
      log('Payment recorded', `${money(amount)}${body.method ? ` by ${body.method}` : ''}`)
      break
    }
    case 'removePayment': {
      const p = doc.payments.find(x => x.id === body.id)
      doc.payments = doc.payments.filter(x => x.id !== body.id)
      if (p) log('Payment removed', money(p.amount))
      break
    }
    case 'setTax': {
      const id = String(body.id || '')
      if (!id) throw createError({ statusCode: 400, statusMessage: 'Tax line is required' })
      doc.taxes = doc.taxes || {}
      doc.taxes[id] = { paid: !!body.paid, date: body.paid ? day(body.date, new Date().toISOString().slice(0, 10)) : null, amount: body.amount == null ? null : round(body.amount) }
      log(body.paid ? 'Tax marked paid' : 'Tax marked not paid', String(body.label || id))
      break
    }
    case 'setNotes': {
      doc.notes = String(body.notes || '').slice(0, 2000)
      log('Notes updated')
      break
    }
    case 'approve': {
      const ctx = await loadCommissionContext(db, payDate, payDate)
      ctx.statements.set(payDate, { ...doc, status: 'draft', snapshot: undefined })
      const week = buildCommissionWeek(ctx, payDate)
      const blocking = week.warnings.filter((w: any) => w.kind === 'manual')
      if (blocking.length && !body.force)
        throw createError({ statusCode: 422, statusMessage: `Type in this week's amount for ${blocking.length === 1 ? '1 dealer' : `${blocking.length} dealers`} first (see “Needs amount”)`, data: { warnings: blocking } })
      const { payDate: _p, workStart, workEnd, status, source, locked, approvedAt, approvedBy, notes, history, sheet, live, ...snapshot } = week as any
      doc.snapshot = snapshot
      doc.status = 'approved'
      doc.approvedAt = new Date().toISOString()
      doc.approvedBy = who
      log('Week approved', `Pays ${money(week.totals.paidToContractors)} to contractors`)
      break
    }
    case 'reopen': {
      if (doc.source === 'sheet' && body.useInvoices) {
        doc.source = 'system'
        doc.noRecurring = false
        log('Switched to the invoices in the system', 'Spreadsheet amounts are no longer used for this week')
      }
      doc.status = 'draft'
      delete doc.snapshot
      doc.approvedAt = undefined
      doc.approvedBy = undefined
      log('Week reopened')
      break
    }
    case 'markPaid': {
      if (doc.status === 'draft') throw createError({ statusCode: 409, statusMessage: 'Approve the week first' })
      doc.status = 'paid'
      log('Week marked paid')
      break
    }
    default:
      throw createError({ statusCode: 400, statusMessage: `Unknown change "${op}"` })
  }

  // An approved week whose balance is fully paid becomes "Paid" by itself (and back, if a payment is removed).
  if (doc.status !== 'draft' && (op === 'addPayment' || op === 'removePayment')) {
    const ctx = await loadCommissionContext(db, payDate, payDate)
    ctx.statements.set(payDate, doc)
    const w = buildCommissionWeek(ctx, payDate)
    const owed = w.payees.filter((p: any) => !p.fundedBy).some((p: any) => p.balance > 0.005)
    if (!owed && doc.status === 'approved') { doc.status = 'paid'; log('Week fully paid') }
    if (owed && doc.status === 'paid') { doc.status = 'approved'; log('Balance due again') }
  }

  await saveCommissionStatement(db, doc)
  const ctx = await loadCommissionContext(db, payDate, payDate)
  return { week: buildCommissionWeek(ctx, payDate, { withLive: true }) }
})
