import { actorFromSession, getCrmDb } from '../../../utils/crm'
import { saveBackup } from '../../../utils/crm-dataquality'
import { getUserSession } from '../../../utils/auth'

/** POST /api/crm/backups — take a snapshot now. */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  return { backup: await saveBackup(await getCrmDb(), 'manual', actorFromSession(session)) }
})
