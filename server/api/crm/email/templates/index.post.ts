import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { createTemplate } from '../../../../utils/crm-email'
import { getUserSession } from '../../../../utils/auth'

/** POST /api/crm/email/templates — { name, category, description, subject, body, note } */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  return { template: await createTemplate(await getCrmDb(), await readBody(event), actorFromSession(session)) }
})
