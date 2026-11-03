import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { templatePreviewContext } from '../../../../utils/crm-email'
import { getUserSession } from '../../../../utils/auth'

/** POST /api/crm/email/templates/preview-context { dealershipId?, subject? } — merge values for live template previews. */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  return templatePreviewContext(await getCrmDb(), (await readBody(event)) || {}, actorFromSession(session))
})
