import { actorFromSession, getCrmDb, str } from '../../../utils/crm'
import { dismissProspects } from '../../../utils/crm-prospecting'
import { getUserSession } from '../../../utils/auth'

/** POST /api/crm/prospecting/dismiss — { placeIds[], reason?, undo? } — dismissed places stay hidden in future scans. */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const b = (await readBody(event)) || {}
  return dismissProspects(await getCrmDb(), Array.isArray(b.placeIds) ? b.placeIds : [], str(b.reason, 200), !!b.undo, actorFromSession(session))
})
