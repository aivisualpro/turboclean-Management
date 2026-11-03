import { getCrmDb, str } from '../../../utils/crm'
import { actionHistory } from '../../../utils/crm-dataquality'

/** GET /api/crm/data-quality/history?userId=&type=&before=&limit= — who changed what, across the CRM. */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  return { entries: await actionHistory(await getCrmDb(), { userId: str(q.userId, 64) || undefined, type: str(q.type, 40) || undefined, before: str(q.before, 40) || undefined, limit: Number(q.limit) || 100 }) }
})
