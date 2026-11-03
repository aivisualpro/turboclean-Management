import { getCrmDb } from '../../../../utils/crm'
import { getBatch } from '../../../../utils/scanner-batch'
import { requireActor } from '../../../../utils/automation-http'

/** GET /api/scanner/batches/:id */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  return { batch: await getBatch(await getCrmDb(), getRouterParam(event, 'id')!) }
})
