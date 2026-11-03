import { getCrmDb } from '../../utils/crm'
import { saveSettings } from '../../utils/automation'
import { requireActor } from '../../utils/automation-http'

/** PUT /api/automations/settings — sending hours, daily limit, follow-up days, draft style… */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  return { settings: await saveSettings(await getCrmDb(), (await readBody(event)) || {}, actor) }
})
