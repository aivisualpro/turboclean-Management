import { CRM_COLLECTIONS, actorFromSession, getCrmDb, toObjectId } from '../../../../../utils/crm'
import { previewCrmEmail } from '../../../../../utils/crm-email'
import { getUserSession } from '../../../../../utils/auth'

/** POST /api/crm/dealerships/:id/emails/preview — same input as send; returns the merged subject + HTML without sending. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const db = await getCrmDb()
  const dealership = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: toObjectId(id) })
  if (!dealership) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  return previewCrmEmail(db, dealership, (await readBody(event)) || {}, actorFromSession(await getUserSession(event)))
})
