import { applyReview, getScannerSession } from '../../../../utils/scanner-session'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/scanner/sessions/:id/review { vehicles?: [{key, verdict}], clusters?: [{id, verdict}], countStockAsMissing?, reapplyRules? } */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  return applyReview(getScannerSession(getRouterParam(event, 'id')!, actor), (await readBody(event)) || {})
})
