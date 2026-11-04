import { actorFromSession, getCrmDb } from '../../../utils/crm'
import { bulkDeleteDealerships } from '../../../utils/crm-trash'
import { getUserSession } from '../../../utils/auth'

/** POST /api/crm/dealerships/bulk-delete { ids[] } — move dealerships (and everything linked) to Trash. Won accounts are skipped. */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const body = (await readBody(event)) || {}
  return bulkDeleteDealerships(await getCrmDb(), body.ids, actorFromSession(session))
})
