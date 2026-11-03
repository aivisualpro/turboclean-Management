import { getCrmDb } from '../../../../utils/crm'
import { getScannerSession, saveScan } from '../../../../utils/scanner-session'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/scanner/sessions/:id/save — record the scan as an automated inventory audit. */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  return saveScan(await getCrmDb(), getScannerSession(getRouterParam(event, 'id')!, actor), actor)
})
