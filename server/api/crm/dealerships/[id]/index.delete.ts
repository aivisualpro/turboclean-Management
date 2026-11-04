import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { bulkDeleteDealerships } from '../../../../utils/crm-trash'
import { getUserSession } from '../../../../utils/auth'

/** DELETE /api/crm/dealerships/:id — move a dealership and everything linked to it to Trash (restorable for 30 days; not won accounts). */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const r = await bulkDeleteDealerships(await getCrmDb(), [getRouterParam(event, 'id')!], actorFromSession(session))
  if (!r.deleted.length) throw createError({ statusCode: r.skipped[0]?.reason.startsWith('Won') ? 409 : 404, statusMessage: r.skipped[0]?.reason || 'Dealership not found' })
  return { ok: true, undoToken: r.undoToken }
})
