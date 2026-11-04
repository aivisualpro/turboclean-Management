import { getCrmDb } from '../../../../utils/crm'
import { pauseBatch } from '../../../../utils/scanner-batch'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/scanner/batches/:id/pause — running scans save where they are and stop; Resume continues from there. */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  return { batch: await pauseBatch(await getCrmDb(), getRouterParam(event, 'id')!) }
})
