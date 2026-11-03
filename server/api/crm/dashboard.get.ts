import { getCrmDb, str } from '../../utils/crm'
import { dashboard } from '../../utils/crm-dashboard'
import { getUserSession } from '../../utils/auth'

/** GET /api/crm/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&fromTs=ISO&toTs=ISO&scope=all|mine|<userId> */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const session = await getUserSession(event)
  const from = str(q.from, 10), to = str(q.to, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw createError({ statusCode: 400, statusMessage: 'from and to dates are required' })
  const scope = str(q.scope, 64) || 'all'
  return dashboard(await getCrmDb(), {
    from, to, fromTs: str(q.fromTs, 40) || `${from}T00:00:00.000Z`, toTs: str(q.toTs, 40) || `${to}T23:59:59.999Z`,
    userId: scope === 'all' ? undefined : scope === 'mine' ? (session?.id || '__none') : scope,
  })
})
