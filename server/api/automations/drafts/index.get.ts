import { getCrmDb, str } from '../../../utils/crm'
import { listDrafts } from '../../../utils/automation-outreach'
import { requireActor } from '../../../utils/automation-http'

/** GET /api/automations/drafts?status=pending|approved|failed|sent|rejected|cancelled|open|all&dealershipId= */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  const q = getQuery(event)
  return listDrafts(await getCrmDb(), { status: str(q.status, 20) || 'pending', dealershipId: str(q.dealershipId, 64) || undefined, limit: Number(q.limit) || 200 })
})
