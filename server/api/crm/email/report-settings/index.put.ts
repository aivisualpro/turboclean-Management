import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { saveReportSettings } from '../../../../utils/crm-reports'
import { getUserSession } from '../../../../utils/auth'

/** PUT /api/crm/email/report-settings — { historyChartInReport?, historyChartInEmail?, onePointPerDay? } */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const actor = actorFromSession(session)
  return { settings: await saveReportSettings(await getCrmDb(), (await readBody(event)) || {}, actor ? { id: actor.id, name: actor.name } : null) }
})
