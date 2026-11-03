import { getCrmDb } from '../../../../utils/crm'
import { applyReview } from '../../../../utils/scanner-session'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/scanner/scans/:id/review { vehicles?, clusters?, countStockAsMissing?, reapplyRules? } */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  return applyReview(await getCrmDb(), getRouterParam(event, 'id')!, (await readBody(event)) || {})
})
