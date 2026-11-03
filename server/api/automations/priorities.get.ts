import { getCrmDb, str } from '../../utils/crm'
import { prioritiesReport } from '../../utils/automation-scoring'
import { requireActor } from '../../utils/automation-http'

/** GET /api/automations/priorities?tier=Hot|Warm|Cool|all&owner=<userId>|mine */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const q = getQuery(event)
  const owner = str(q.owner, 64)
  return prioritiesReport(await getCrmDb(), { tier: str(q.tier, 10) || 'all', ownerId: owner === 'mine' ? actor.id : (owner || undefined) })
})
