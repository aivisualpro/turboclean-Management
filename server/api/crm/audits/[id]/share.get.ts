import { getUserSession } from '../../../../utils/auth'
import { reportUrl } from '../../../../utils/crm-reports'

/** GET /api/crm/audits/:id/share — the public, signed link to this report (to send to the dealer). */
export default defineEventHandler(async (event) => {
  if (!(await getUserSession(event))) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  return { url: reportUrl(getRouterParam(event, 'id') || '') }
})
