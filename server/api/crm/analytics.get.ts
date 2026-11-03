import { getCrmDb, str } from '../../utils/crm'
import { performance } from '../../utils/crm-analytics'
import { getUserSession } from '../../utils/auth'

/** GET /api/crm/analytics?from=&to=&scope=&dimension=&emailDimension= — performance compared by dimension. */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const session = await getUserSession(event)
  const scope = str(q.scope, 64) || 'all'
  return performance(await getCrmDb(), {
    from: str(q.from, 10) || undefined, to: str(q.to, 10) || undefined,
    userId: scope === 'all' ? undefined : scope === 'mine' ? (session?.id || '__none') : scope,
    dimension: str(q.dimension, 40) || undefined, emailDimension: str(q.emailDimension, 40) || undefined,
  })
})
