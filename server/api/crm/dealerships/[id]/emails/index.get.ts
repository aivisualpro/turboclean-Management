import { getCrmDb, toObjectId } from '../../../../../utils/crm'
import { listEmails } from '../../../../../utils/crm-email'

/** GET /api/crm/dealerships/:id/emails — every CRM email to/from this dealership, newest first. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  toObjectId(id)
  return { emails: await listEmails(await getCrmDb(), { dealershipId: id, limit: 1000 }) }
})
