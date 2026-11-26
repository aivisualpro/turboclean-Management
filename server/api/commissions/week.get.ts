import { connectToDatabase } from '../../utils/mongodb'
import { requireCommissionAdmin } from '../../utils/commission-access'
import { buildCommissionWeek, commissionPayWeek, loadCommissionContext } from '../../utils/commissions'

/** GET /api/commissions/week?payDate=YYYY-MM-DD — the full statement for one pay day. */
export default defineEventHandler(async (event) => {
  await requireCommissionAdmin(event)
  const q = getQuery(event)
  const { payDate } = commissionPayWeek(String(q.payDate || ''))
  const { db } = await connectToDatabase()
  const ctx = await loadCommissionContext(db, payDate, payDate)
  const week = buildCommissionWeek(ctx, payDate, { withLive: true })
  return {
    week,
    payees: ctx.settings.payees,
    presets: ctx.settings.presets,
    configured: ctx.settings.configured,
    dealers: ctx.dealers.map(d => ({ id: d.id, name: d.name })).sort((a, b) => a.name.localeCompare(b.name)),
  }
})
