import { getCrmDb, toObjectId } from '../../../../utils/crm'
import { listStageHistory, stageDurations } from '../../../../utils/crm-stage'

/** GET /api/crm/dealerships/:id/stage-history — every stage change, oldest first, plus time spent per stage. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  toObjectId(id)
  const db = await getCrmDb()
  const history = await listStageHistory(db, id)
  return { history, durations: stageDurations(history) }
})
