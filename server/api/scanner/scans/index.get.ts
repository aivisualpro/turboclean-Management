import { getCrmDb, str } from '../../../utils/crm'
import { latestScan } from '../../../utils/scanner-session'
import { requireActor } from '../../../utils/automation-http'

/** GET /api/scanner/scans?dealershipId= — the latest scan of a dealership (with results when finished). */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  return latestScan(await getCrmDb(), str(getQuery(event).dealershipId, 40))
})
