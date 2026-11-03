import { getCrmDb } from '../../../utils/crm'
import { deleteRule } from '../../../utils/scanner-images'
import { requireActor } from '../../../utils/automation-http'

/** DELETE /api/scanner/rules/:id */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  await deleteRule(await getCrmDb(), getRouterParam(event, 'id')!)
  return { ok: true }
})
