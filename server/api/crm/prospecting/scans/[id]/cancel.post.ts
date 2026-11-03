import { actorFromSession, getCrmDb } from '../../../../../utils/crm'
import { cancelScan } from '../../../../../utils/crm-prospecting'
import { getUserSession } from '../../../../../utils/auth'

/** POST /api/crm/prospecting/scans/:id/cancel */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  return { scan: await cancelScan(await getCrmDb(), getRouterParam(event, 'id') || '', actorFromSession(session)) }
})
