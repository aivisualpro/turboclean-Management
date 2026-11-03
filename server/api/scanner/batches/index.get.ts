import { getCrmDb } from '../../../utils/crm'
import { listBatches } from '../../../utils/scanner-batch'
import { requireActor } from '../../../utils/automation-http'

/** GET /api/scanner/batches — recent batches (to resume or review). */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  return { batches: await listBatches(await getCrmDb(), Math.min(50, Number(getQuery(event).limit) || 12)) }
})
