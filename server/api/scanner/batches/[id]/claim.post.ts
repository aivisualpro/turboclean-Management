import { getCrmDb } from '../../../../utils/crm'
import { claimNext } from '../../../../utils/scanner-batch'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/scanner/batches/:id/claim — take the next queued dealership (atomic). */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  return claimNext(await getCrmDb(), getRouterParam(event, 'id')!)
})
