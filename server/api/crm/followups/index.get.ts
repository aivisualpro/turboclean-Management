import { getCrmDb, str } from '../../../utils/crm'
import { followUpBoard } from '../../../utils/crm-followups'
import { getUserSession } from '../../../utils/auth'

/**
 * GET /api/crm/followups?today=YYYY-MM-DD&scope=all|mine|<userId>
 * The follow-up board: today (follow-ups, meetings, calls, revisits, research / contact queues),
 * overdue & at-risk (overdue follow-ups, no recent activity, stale opportunities, no next step), coverage.
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const session = await getUserSession(event)
  return followUpBoard(await getCrmDb(), { today: str(q.today, 10) || undefined, scope: str(q.scope, 64) || 'all', userId: session?.id || null })
})
