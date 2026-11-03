import { getCrmDb, str } from '../../../../utils/crm'
import { setJobEnabled } from '../../../../utils/automation'
import { requireActor } from '../../../../utils/automation-http'

/** PATCH /api/automations/jobs/:key { enabled } — switch one automation on or off. */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const body = (await readBody(event)) || {}
  if (typeof body.enabled !== 'boolean') throw createError({ statusCode: 400, statusMessage: '`enabled` must be true or false' })
  return setJobEnabled(await getCrmDb(), str(getRouterParam(event, 'key'), 60), body.enabled, actor)
})
