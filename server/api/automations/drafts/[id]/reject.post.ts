import { getCrmDb, str } from '../../../../utils/crm'
import { rejectDraft } from '../../../../utils/automation-outreach'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/automations/drafts/:id/reject { reason } — skip a draft (a skipped follow-up ends that sequence). */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const body = (await readBody(event)) || {}
  return { draft: await rejectDraft(await getCrmDb(), getRouterParam(event, 'id')!, str(body.reason, 300), actor) }
})
