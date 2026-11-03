import { getCrmDb, str } from '../../../../utils/crm'
import { runJob } from '../../../../utils/automation'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/automations/jobs/:key/run — "Run now" (works even when the automation is switched off). */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  return runJob(await getCrmDb(), str(getRouterParam(event, 'key'), 60), { trigger: 'manual', actor, force: true })
})
