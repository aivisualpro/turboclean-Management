import { getScannerSession, publicState, resultsOf } from '../../../../utils/scanner-session'
import { requireActor } from '../../../../utils/automation-http'

/** GET /api/scanner/sessions/:id — state (+ results when a scan has finished). */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const s = getScannerSession(getRouterParam(event, 'id')!, actor)
  return { state: publicState(s), log: s.log.slice(-40), results: s.vehicles.length && !s.scanning ? await resultsOf(s) : null }
})
