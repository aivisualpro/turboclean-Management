import { getCrmDb } from '../../../../utils/crm'
import { cancelBatch } from '../../../../utils/scanner-batch'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/scanner/batches/:id/cancel — cancel queued dealerships, stop running scans. */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  return { batch: await cancelBatch(await getCrmDb(), getRouterParam(event, 'id')!) }
})
