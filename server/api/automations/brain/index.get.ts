import { getCrmDb } from '../../../utils/crm'
import { brainOverview } from '../../../utils/brain'
import { requireActor } from '../../../utils/automation-http'

/** GET /api/automations/brain — playbook, lessons, recent signals, reflections and AI usage. */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  return brainOverview(await getCrmDb())
})
