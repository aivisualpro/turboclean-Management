import { getCrmDb, str } from '../../../../utils/crm'
import { requeueItem } from '../../../../utils/scanner-batch'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/scanner/batches/:id/requeue { dealershipId, urls? } — retry one dealership. */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  const body = (await readBody(event)) || {}
  return { batch: await requeueItem(await getCrmDb(), getRouterParam(event, 'id')!, str(body.dealershipId, 40), Array.isArray(body.urls) ? body.urls : undefined) }
})
