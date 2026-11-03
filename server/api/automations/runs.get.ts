import { getCrmDb, str } from '../../utils/crm'
import { listRuns } from '../../utils/automation'
import { requireActor } from '../../utils/automation-http'

/** GET /api/automations/runs?key=&limit= — run log, newest first. */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  const q = getQuery(event)
  return { runs: await listRuns(await getCrmDb(), { key: str(q.key, 60) || undefined, limit: Number(q.limit) || 50 }) }
})
