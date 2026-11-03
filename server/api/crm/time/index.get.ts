import { getCrmDb, str } from '../../../utils/crm'
import { listEntries, runningTimer } from '../../../utils/crm-time'
import { getUserSession } from '../../../utils/auth'

/** GET /api/crm/time?from=&to=&scope=mine|all|<userId> — time entries (+ your running timer). */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const session = await getUserSession(event)
  const db = await getCrmDb()
  const scope = str(q.scope, 64) || 'mine'
  const userId = scope === 'all' ? undefined : scope === 'mine' ? (session?.id || '__none') : scope
  return {
    entries: await listEntries(db, { from: str(q.from, 10) || undefined, to: str(q.to, 10) || undefined, userId }),
    running: session ? await runningTimer(db, session.id) : null,
  }
})
