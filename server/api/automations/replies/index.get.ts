import { getCrmDb } from '../../../utils/crm'
import { REPLY_CATEGORIES, repliesToConfirm, suggestionAccuracy } from '../../../utils/automation-replies'
import { requireActor } from '../../../utils/automation-http'

/** GET /api/automations/replies — replies waiting for confirmation, with the suggested classification. */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  const db = await getCrmDb()
  return { replies: await repliesToConfirm(db), categories: REPLY_CATEGORIES, accuracy: await suggestionAccuracy(db) }
})
