import { getCrmDb } from '../../../utils/crm'
import { duplicatePlan } from '../../../utils/crm-duplicates'
import { getUserSession } from '../../../utils/auth'

/**
 * GET /api/crm/data-quality/duplicates[?summary=1]
 * Dealerships that were entered more than once (same name, city and state) and which record would be
 * kept for each. `summary=1` returns only the numbers (for the button on the list).
 */
export default defineEventHandler(async (event) => {
  if (!(await getUserSession(event))) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const summary = !!getQuery(event).summary
  const plan = await duplicatePlan(await getCrmDb(), { counts: !summary })
  return summary ? { groups: plan.groups.length, records: plan.records } : plan
})
