import { getCrmDb } from '../../../../utils/crm'
import { getScan, scanPayload } from '../../../../utils/scanner-session'
import { requireActor } from '../../../../utils/automation-http'

/** GET /api/scanner/scans/:id — progress (while running) and results (when finished). */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  return scanPayload(await getScan(await getCrmDb(), getRouterParam(event, 'id')!))
})
