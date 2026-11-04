import { getCrmDb } from '../../../../utils/crm'
import { getBatch, startBatch } from '../../../../utils/scanner-batch'
import { requireActor } from '../../../../utils/automation-http'
import { requestOrigin } from '../../../../utils/request-origin'

/** POST /api/scanner/batches/:id/start — start or resume autopilot (paused dealerships continue where they stopped). */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  const db = await getCrmDb()
  const id = getRouterParam(event, 'id')!
  return { batch: (await startBatch(db, id, requestOrigin(event))) || (await getBatch(db, id)) }
})
