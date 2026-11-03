import { getCrmDb } from '../../../../utils/crm'
import { confirmReply } from '../../../../utils/automation-replies'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/automations/replies/:id/confirm { category, nextAction? } */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  return confirmReply(await getCrmDb(), getRouterParam(event, 'id')!, (await readBody(event)) || {}, actor)
})
