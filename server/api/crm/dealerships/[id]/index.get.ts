import { CRM_COLLECTIONS, getCrmDb, serializeActivity, serializeContact, serializeDealership, toObjectId } from '../../../../utils/crm'
import { listAudits } from '../../../../utils/crm-audit'
import { listStageHistory, stageDurations } from '../../../../utils/crm-stage'
import { listInteractions } from '../../../../utils/crm-interactions'
import { listEmails } from '../../../../utils/crm-email'

/** GET /api/crm/dealerships/:id — full record: profile, every contact (active + historical), timeline */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const db = await getCrmDb()
  const doc = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: toObjectId(id) })
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })

  const [contacts, activity, audits, stageHistory, interactions, emails] = await Promise.all([
    db.collection(CRM_COLLECTIONS.contacts).find({ dealershipId: id }).sort({ isActive: -1, isPrimary: -1, addedAt: 1 }).toArray(),
    // Notes now live in interactions; migrated note rows are hidden from the system log.
    db.collection(CRM_COLLECTIONS.activity).find({ dealershipId: id, type: { $ne: 'note' } }).sort({ at: -1 }).limit(2000).toArray(),
    listAudits(db, id),
    listStageHistory(db, id),
    listInteractions(db, id),
    listEmails(db, { dealershipId: id, limit: 1000 }),
  ])

  return {
    dealership: serializeDealership(doc),
    contacts: contacts.map(serializeContact),
    activity: activity.map(serializeActivity),
    audits,
    stageHistory,
    interactions,
    emails,
    stageDurations: stageDurations(stageHistory),
  }
})
