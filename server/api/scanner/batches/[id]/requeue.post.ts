import { getCrmDb, str } from '../../../../utils/crm'
import { requeueItem } from '../../../../utils/scanner-batch'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/scanner/batches/:id/requeue { dealershipId, urls?, resume? } — retry one dealership (`resume` keeps what the last scan found). */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  const body = (await readBody(event)) || {}
  return { batch: await requeueItem(await getCrmDb(), getRouterParam(event, 'id')!, str(body.dealershipId, 40), Array.isArray(body.urls) ? body.urls : undefined, { resume: !!body.resume }) }
})
