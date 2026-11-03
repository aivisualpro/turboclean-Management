import { getScannerSession, stopScan } from '../../../../utils/scanner-session'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/scanner/sessions/:id/stop — stop collecting; the photos found so far are still checked. */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  return { stopping: stopScan(getScannerSession(getRouterParam(event, 'id')!, actor)) }
})
