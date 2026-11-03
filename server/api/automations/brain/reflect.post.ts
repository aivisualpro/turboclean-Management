import { getCrmDb } from '../../../utils/crm'
import { reflect } from '../../../utils/brain'
import { requireActor } from '../../../utils/automation-http'

/** POST /api/automations/brain/reflect — learn from new signals and results now. */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  return reflect(await getCrmDb(), { trigger: 'manual', actor })
})
