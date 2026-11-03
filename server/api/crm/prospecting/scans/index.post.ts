import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { startScan } from '../../../../utils/crm-prospecting'
import { getUserSession } from '../../../../utils/auth'

/** POST /api/crm/prospecting/scans — { radiusMiles?, queries? } starts a scan (or returns the one already running). Drive it with /:id/step. */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  return { scan: await startScan(await getCrmDb(), (await readBody(event)) || {}, actorFromSession(session)) }
})
