import { getCrmDb } from '../../../utils/crm'
import { createBatch } from '../../../utils/scanner-batch'
import { requireActor } from '../../../utils/automation-http'

/** POST /api/scanner/batches { dealershipIds[], pages?: {id: urls[]}, concurrency?, name? } — start a batch scan. */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  return { batch: await createBatch(await getCrmDb(), (await readBody(event)) || {}, actor) }
})
