import { getCrmDb } from '../../../utils/crm'
import { deliverabilityReport } from '../../../utils/crm-email'
import { getUserSession } from '../../../utils/auth'

/** GET /api/crm/email/deliverability — SPF / DKIM / DMARC / bounce / unsubscribe / volume health. */
export default defineEventHandler(async (event) => {
  if (!(await getUserSession(event))) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  return deliverabilityReport(await getCrmDb())
})
