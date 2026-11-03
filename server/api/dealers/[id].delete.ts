import { ObjectId } from 'mongodb'
import { connectToDatabase } from '../../utils/mongodb'
import { getUserSession } from '../../utils/auth'
import { getDealerUsage } from '../../utils/dealer-usage'
import { syncToAppSheet } from '../../utils/appsheet-sync'
import { CRM_COLLECTIONS, WON_STAGE, actorFromSession, logActivity, normalizeStage } from '../../utils/crm'
import { recordStageChange } from '../../utils/crm-stage'

/**
 * DELETE /api/dealers/:id
 * Refused (409) while the dealer still has services, work orders or invoices.
 * If the dealer was won through CRM, the CRM dealership is returned to the
 * stage it held before conversion so the pipeline stays truthful.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  if (!ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid dealer id' })
  const session = await getUserSession(event)
  const { db } = await connectToDatabase()
  const dealers = db.collection('turboCleanDealers')
  const dealer = await dealers.findOne({ _id: new ObjectId(id) })
  if (!dealer) throw createError({ statusCode: 404, statusMessage: 'Dealer not found' })

  const usage = await getDealerUsage(db, id, dealer)
  if (usage.total > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Dealer has linked records and cannot be deleted',
      data: { usage },
    })
  }

  await dealers.deleteOne({ _id: dealer._id })
  await db.collection('turboCleanAppUsers').updateMany({ registerDealers: id }, { $pull: { registerDealers: id } } as any).catch(() => {})
  await syncToAppSheet(db, 'Dealers', 'Delete', [{ _id: id }]).catch(e => console.error('[DEALER DELETE] AppSheet delete failed:', e?.message))

  // Revert the CRM pipeline record, if this dealer came from CRM.
  let crm: { dealershipId: string, stage: string } | null = null
  if (dealer.crmDealershipId && ObjectId.isValid(dealer.crmDealershipId)) {
    const crmCol = db.collection(CRM_COLLECTIONS.dealerships)
    const dealership = await crmCol.findOne({ _id: new ObjectId(dealer.crmDealershipId) })
    if (dealership && dealership.dealerId === id) {
      // Prefer the stage stamped at conversion; fall back to the timeline's "won" entry; then Negotiating.
      let previous: string = normalizeStage(dealership.stageBeforeConversion || '')
      if (!previous || previous === WON_STAGE) {
        const won = await db.collection(CRM_COLLECTIONS.activity)
          .find({ dealershipId: dealership._id.toString(), type: 'dealership.converted' }).sort({ at: -1 }).limit(1).next()
        previous = normalizeStage(won?.changes?.stage?.from || '')
      }
      if (!previous || previous === WON_STAGE) previous = 'Negotiating'
      const now = new Date().toISOString()
      await crmCol.updateOne({ _id: dealership._id }, {
        $set: { stage: previous, updatedAt: now, lastDealerDeletedAt: now },
        $unset: { dealerId: '', convertedAt: '', convertedBy: '', stageBeforeConversion: '' },
      })
      await logActivity(db, {
        dealershipId: dealership._id.toString(), type: 'dealership.reverted', actor: actorFromSession(session),
        message: `Dealer record deleted — returned to pipeline as ${previous}`,
        changes: { stage: { from: dealership.stage, to: previous }, dealer: { from: dealer.dealer, to: null } },
      })
      await recordStageChange(db, { dealership, fromStage: dealership.stage, toStage: previous, actor: actorFromSession(session), source: 'revert', note: `Dealer "${dealer.dealer}" deleted` })
      crm = { dealershipId: dealership._id.toString(), stage: previous }
    }
  }

  return { success: true, id, crm }
})
