import { getCrmDb } from '../../../../utils/crm'
import { approveDraft } from '../../../../utils/automation-outreach'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/automations/drafts/:id/approve { sendNow? } — approve; sends now inside sending hours, else queues. */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const body = (await readBody(event)) || {}
  return approveDraft(await getCrmDb(), getRouterParam(event, 'id')!, actor, { sendNow: body.sendNow === true })
})
