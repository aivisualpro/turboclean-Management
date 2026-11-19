import { browserAvailability } from '../../utils/scanner-cdp'
import { requireActor } from '../../utils/automation-http'
import { photoCheckStatus } from '../../utils/scanner-vision'

/** GET /api/scanner/status — can this server run the Inventory Scanner, and is the AI photo check on? */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  return { ...browserAvailability(), photoCheck: await photoCheckStatus().catch(() => null) }
})
