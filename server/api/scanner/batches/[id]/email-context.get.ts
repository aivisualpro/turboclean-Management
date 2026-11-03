import { getCrmDb } from '../../../../utils/crm'
import { batchEmailContext } from '../../../../utils/scanner-batch'
import { requireActor } from '../../../../utils/automation-http'

/** GET /api/scanner/batches/:id/email-context — contacts, last email and audit numbers per dealership. */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  return batchEmailContext(await getCrmDb(), getRouterParam(event, 'id')!)
})
