import { actorFromSession, getCrmDb } from '../../../utils/crm'
import { saveProspectingConfig } from '../../../utils/crm-prospecting'
import { getUserSession } from '../../../utils/auth'

/** PUT /api/crm/prospecting/config — saved under settings{type:'general'}.prospecting (Settings › General). */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const config = await saveProspectingConfig(await getCrmDb(), (await readBody(event)) || {}, actorFromSession(session))
  return { config }
})
