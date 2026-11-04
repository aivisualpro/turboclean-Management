import { getCrmDb } from '../../../utils/crm'
import { createBatch, startBatch } from '../../../utils/scanner-batch'
import { requireActor } from '../../../utils/automation-http'
import { requestOrigin } from '../../../utils/request-origin'

/**
 * POST /api/scanner/batches { dealershipIds[], pages?: {id: urls[]}, concurrency?, name?, start? }
 * Creates a batch; with `start: true` autopilot starts scanning on the server right away.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const body = (await readBody(event)) || {}
  const db = await getCrmDb()
  const origin = requestOrigin(event)
  const batch = await createBatch(db, { ...body, origin }, actor)
  return { batch: body.start ? (await startBatch(db, batch!.id, origin)) || batch : batch }
})
