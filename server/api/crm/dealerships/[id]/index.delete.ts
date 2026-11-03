import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { deleteDealership } from '../../../../utils/crm-duplicates'
import { getUserSession } from '../../../../utils/auth'

/** DELETE /api/crm/dealerships/:id — permanently delete a dealership and its linked records (not won accounts). */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  return deleteDealership(await getCrmDb(), getRouterParam(event, 'id')!, actorFromSession(session))
})
