import { CRM_COLLECTIONS, getCrmDb, toObjectId } from '../../../../../utils/crm'
import { listAudits } from '../../../../../utils/crm-audit'

/** GET /api/crm/dealerships/:id/audits — full audit history, newest first */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const db = await getCrmDb()
  const exists = await db.collection(CRM_COLLECTIONS.dealerships).countDocuments({ _id: toObjectId(id) })
  if (!exists) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  const audits = await listAudits(db, id)
  return { audits, meta: { total: audits.length } }
})
