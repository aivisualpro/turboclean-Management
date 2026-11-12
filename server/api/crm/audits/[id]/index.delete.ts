import { getCrmDb } from '../../../../utils/crm'
import { deleteAudit } from '../../../../utils/crm-audit'
import { getUserSession } from '../../../../utils/auth'

/**
 * DELETE /api/crm/audits/:id — delete one inventory audit (a wrong crawl, a test) with its stored
 * report and its entry in the relationship history. Returns an undoToken (POST /api/crm/audits/restore).
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  return deleteAudit(await getCrmDb(), getRouterParam(event, 'id')!, session)
})
