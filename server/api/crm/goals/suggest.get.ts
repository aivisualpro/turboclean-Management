import { getCrmDb, str } from '../../../utils/crm'
import { suggestGoals } from '../../../utils/crm-goals'

/**
 * GET /api/crm/goals/suggest?weekStart=YYYY-MM-DD&weekStartTs=ISO&userId=&weeks=8
 * weekStart is this week's Monday in the user's calendar; weekStartTs the same moment as an instant.
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const weekStart = str(q.weekStart, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw createError({ statusCode: 400, statusMessage: 'weekStart is required' })
  const offsetMs = (Date.parse(`${weekStart}T00:00:00.000Z`) - Date.parse(str(q.weekStartTs, 40))) || 0
  return suggestGoals(await getCrmDb(), { thisWeekStart: weekStart, offsetMs, userId: str(q.userId, 64) || null, weeks: Number(q.weeks) || 8 })
})
