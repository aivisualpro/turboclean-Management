import { actorFromSession, getCrmDb, str } from '../../../utils/crm'
import { importProspects } from '../../../utils/crm-prospecting'
import { getUserSession } from '../../../utils/auth'

/** POST /api/crm/prospecting/import — { placeIds[], stage?, assignedUserId?, assignedUserName?, tags?, scanId? } → { created[], skipped[] } */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const b = (await readBody(event)) || {}
  return importProspects(await getCrmDb(), Array.isArray(b.placeIds) ? b.placeIds : [], {
    stage: str(b.stage, 60),
    assignedUserId: str(b.assignedUserId, 64),
    assignedUserName: str(b.assignedUserName, 120),
    tags: Array.isArray(b.tags) ? b.tags : [],
    scanId: str(b.scanId, 64),
  }, actorFromSession(session))
})
