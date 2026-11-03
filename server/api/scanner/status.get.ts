import { browserAvailability } from '../../utils/scanner-cdp'
import { requireActor } from '../../utils/automation-http'

/** GET /api/scanner/status — can this server run the Inventory Scanner? */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  return browserAvailability()
})
