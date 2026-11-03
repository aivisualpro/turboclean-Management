import { actorFromSession, getCrmDb, toObjectId } from '../../../../../utils/crm'
import { updateInteraction } from '../../../../../utils/crm-interactions'
import { getUserSession } from '../../../../../utils/auth'

/**
 * PATCH /api/crm/dealerships/:id/interactions/:interactionId
 * Edit fields, mark the next action done (`nextActionDone`), or void/restore (`voided`, `voidReason`).
 * There is no DELETE — a mistaken entry is voided so the history stays honest.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const interactionId = getRouterParam(event, 'interactionId')!
  toObjectId(id)
  const session = await getUserSession(event)
  const body = await readBody(event) || {}
  const db = await getCrmDb()
  return { interaction: await updateInteraction(db, id, interactionId, body, actorFromSession(session)) }
})
