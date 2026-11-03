import { getCrmDb } from '../../../utils/crm'
import { listRules } from '../../../utils/scanner-images'
import { requireActor } from '../../../utils/automation-http'

/** GET /api/scanner/rules — saved "treat this image as …" rules (shared across every dealership). */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  return { rules: await listRules(await getCrmDb()) }
})
