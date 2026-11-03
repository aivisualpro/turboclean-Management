import { CRM_COLLECTIONS, getCrmDb, toObjectId } from '../../../../../utils/crm'
import { recordAudit } from '../../../../../utils/crm-audit'
import { getUserSession } from '../../../../../utils/auth'

/**
 * POST /api/crm/dealerships/:id/audits — record a new audit snapshot.
 * Append-only: previous audits are never modified. Automated collectors
 * post the same shape with `source: 'automated'` and a `collector` block.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await getUserSession(event)
  const body = await readBody(event) || {}
  const db = await getCrmDb()
  const dealership = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: toObjectId(id) })
  if (!dealership) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  const audit = await recordAudit(db, dealership, body, session)
  return { audit }
})
