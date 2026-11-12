import { getCrmDb, str } from '../../../utils/crm'
import { restoreAudit } from '../../../utils/crm-audit'
import { getUserSession } from '../../../utils/auth'

/** POST /api/crm/audits/restore { undoToken } — put a deleted audit back, with its report and history entry. */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const b = (await readBody(event)) || {}
  return restoreAudit(await getCrmDb(), str(b.undoToken, 64), session)
})
