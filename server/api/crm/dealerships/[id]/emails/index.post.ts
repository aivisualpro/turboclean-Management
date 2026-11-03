import { CRM_COLLECTIONS, actorFromSession, getCrmDb, toObjectId } from '../../../../../utils/crm'
import { sendCrmEmail } from '../../../../../utils/crm-email'
import { getUserSession } from '../../../../../utils/auth'

/**
 * POST /api/crm/dealerships/:id/emails — send an acquisition email through Resend.
 * Body: { contactId?, to?, subject, body (plain text, {{merge}} fields allowed), templateId?, templateVersion?,
 *         campaignId?, followUpOf? (id of an email in the sequence this follows up) }
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await getUserSession(event)
  const db = await getCrmDb()
  const dealership = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: toObjectId(id) })
  if (!dealership) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  if (dealership.archivedAt) throw createError({ statusCode: 409, statusMessage: 'Restore the dealership before emailing it' })
  return { email: await sendCrmEmail(db, dealership, (await readBody(event)) || {}, actorFromSession(session)) }
})
