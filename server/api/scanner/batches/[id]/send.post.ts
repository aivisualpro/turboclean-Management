import { getCrmDb } from '../../../../utils/crm'
import { sendBatchEmails } from '../../../../utils/scanner-batch'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/scanner/batches/:id/send { assignments: [{dealershipId, templateId, contactId?, mode: 'now'|'queue', allowDuplicate?}] } */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const body = (await readBody(event)) || {}
  return sendBatchEmails(await getCrmDb(), getRouterParam(event, 'id')!, Array.isArray(body.assignments) ? body.assignments : [], actor)
})
