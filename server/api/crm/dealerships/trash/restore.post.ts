import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { restoreDeleted } from '../../../../utils/crm-trash'
import { getUserSession } from '../../../../utils/auth'

/** POST /api/crm/dealerships/trash/restore { undoToken } | { ids[] } — bring deleted dealerships back with all their history. */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  return restoreDeleted(await getCrmDb(), (await readBody(event)) || {}, actorFromSession(session))
})
