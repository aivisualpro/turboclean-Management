import { getCrmDb, str } from '../../../utils/crm'
import { timeReport } from '../../../utils/crm-time'
import { getUserSession } from '../../../utils/auth'

/** GET /api/crm/time/report?from=&to=&scope=mine|all|<userId> — hours by category/week and what they produced. */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const session = await getUserSession(event)
  const scope = str(q.scope, 64) || 'all'
  const userId = scope === 'all' ? undefined : scope === 'mine' ? (session?.id || '__none') : scope
  return timeReport(await getCrmDb(), { from: str(q.from, 10) || undefined, to: str(q.to, 10) || undefined, userId })
})
