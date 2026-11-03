import { getCrmDb } from '../../../../utils/crm'
import { saveScan } from '../../../../utils/scanner-session'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/scanner/scans/:id/save — record the scan as an automated inventory audit. */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  return saveScan(await getCrmDb(), getRouterParam(event, 'id')!, actor)
})
