import { getCrmDb, str } from '../../../utils/crm'
import { lostReport } from '../../../utils/crm-lost'

/** GET /api/crm/lost?from=&to=&ownerId=&stage=&includeReopened=1 — why we lose, sliced every useful way. */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  return lostReport(await getCrmDb(), {
    from: str(q.from, 10) || undefined, to: str(q.to, 10) || undefined, ownerId: str(q.ownerId, 64) || undefined,
    stage: str(q.stage, 60) || undefined, includeReopened: q.includeReopened === '1',
  })
})
