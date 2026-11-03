import { getCrmDb, str } from '../../../utils/crm'
import { wonReport } from '../../../utils/crm-won'

/** GET /api/crm/won?from=&to=&ownerId=&includeReverted=1 — financial return from prospecting. */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  return wonReport(await getCrmDb(), {
    from: str(q.from, 10) || undefined, to: str(q.to, 10) || undefined, ownerId: str(q.ownerId, 64) || undefined, includeReverted: q.includeReverted === '1',
  })
})
