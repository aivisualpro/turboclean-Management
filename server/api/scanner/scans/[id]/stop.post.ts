import { getCrmDb } from '../../../../utils/crm'
import { requestStop } from '../../../../utils/scanner-session'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/scanner/scans/:id/stop — stop collecting; the photos found so far are still checked. */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  return requestStop(await getCrmDb(), getRouterParam(event, 'id')!)
})
