import { DEALERSHIP_STAGES, getCrmDb, str } from '../../../utils/crm'
import { pipelineReport } from '../../../utils/crm-stage'

/**
 * GET /api/crm/pipeline?assignedUserId=
 * Pipeline velocity: dealerships per stage now, time spent in each stage, time to close.
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const db = await getCrmDb()
  return pipelineReport(db, DEALERSHIP_STAGES, { assignedUserId: str(q.assignedUserId, 64) || undefined })
})
