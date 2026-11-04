import { getCrmDb } from '../../../../utils/crm'
import { batchLive } from '../../../../utils/scanner-batch'
import { requireActor } from '../../../../utils/automation-http'
import { requestOrigin } from '../../../../utils/request-origin'

/** GET /api/scanner/batches/:id/live?frames=0 — batch + progress / log / latest frame of every running scan. */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return batchLive(await getCrmDb(), getRouterParam(event, 'id')!, requestOrigin(event), getQuery(event).frames !== '0')
})
