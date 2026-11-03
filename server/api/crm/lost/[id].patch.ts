import { actorFromSession, getCrmDb } from '../../../utils/crm'
import { updateLossReason } from '../../../utils/crm-lost'
import { getUserSession } from '../../../utils/auth'

/** PATCH /api/crm/lost/:id — { lostReason, lostNotes, lostCompetitor } correct the reason on a logged loss. */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  return { loss: await updateLossReason(await getCrmDb(), getRouterParam(event, 'id')!, (await readBody(event)) || {}, actorFromSession(session)) }
})
