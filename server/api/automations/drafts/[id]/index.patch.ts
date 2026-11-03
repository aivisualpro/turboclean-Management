import { getCrmDb } from '../../../../utils/crm'
import { updateDraft } from '../../../../utils/automation-outreach'
import { requireActor } from '../../../../utils/automation-http'

/** PATCH /api/automations/drafts/:id { subject?, body?, contactId? } — edit before approving. */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  return { draft: await updateDraft(await getCrmDb(), getRouterParam(event, 'id')!, (await readBody(event)) || {}, actor) }
})
