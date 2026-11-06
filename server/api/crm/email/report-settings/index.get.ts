import { getCrmDb } from '../../../../utils/crm'
import { getReportSettings } from '../../../../utils/crm-reports'
import { getUserSession } from '../../../../utils/auth'

/** GET /api/crm/email/report-settings — where the over-time chart shows (report / emails), one point per day. */
export default defineEventHandler(async (event) => {
  if (!(await getUserSession(event))) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  return { settings: await getReportSettings(await getCrmDb()) }
})
