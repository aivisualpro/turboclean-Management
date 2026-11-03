import { CRM_COLLECTIONS, getCrmDb, serializeContact, serializeDealership } from '../../../utils/crm'
import { auditSummaries } from '../../../utils/crm-audit'
import { interactionSummaries } from '../../../utils/crm-interactions'

/**
 * GET /api/crm/dealerships
 * Returns every (non-archived unless ?archived=1) dealership with a contact
 * roster summary so the list view never needs a second round-trip.
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const db = await getCrmDb()
  const includeArchived = q.archived === '1' || q.archived === 'true'

  const filter: any = includeArchived ? {} : { archivedAt: null }
  const docs = await db.collection(CRM_COLLECTIONS.dealerships)
    .find(filter)
    .sort({ updatedAt: -1 })
    .toArray()

  const ids = docs.map(d => d._id.toString())
  const contacts = ids.length
    ? await db.collection(CRM_COLLECTIONS.contacts).find({ dealershipId: { $in: ids } }).toArray()
    : []

  const [audits, touches] = await Promise.all([auditSummaries(db, ids), interactionSummaries(db, ids)])

  const byDealership = new Map<string, any[]>()
  for (const c of contacts) {
    const arr = byDealership.get(c.dealershipId) || []
    arr.push(serializeContact(c))
    byDealership.set(c.dealershipId, arr)
  }

  const dealerships = docs.map((d) => {
    const roster = byDealership.get(d._id.toString()) || []
    const active = roster.filter(c => c.isActive)
    const primary = active.find(c => c.isPrimary) || active[0] || null
    const verifiedDates = active.map(c => c.lastVerifiedAt).filter(Boolean).sort()
    return {
      ...serializeDealership(d),
      auditSummary: audits.get(d._id.toString()) || { count: 0, latest: null, previous: null },
      interactionSummary: touches.get(d._id.toString()) || { count: 0, last: null, nextAction: null, openNextActions: 0 },
      contactSummary: {
        total: roster.length,
        active: active.length,
        inactive: roster.length - active.length,
        primary,
        oldestVerification: verifiedDates[0] || null,
      },
    }
  })

  return { dealerships, meta: { total: dealerships.length } }
})
