import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { updateTemplate } from '../../../../utils/crm-email'
import { getUserSession } from '../../../../utils/auth'

/** PATCH /api/crm/email/templates/:id — name/category/description/archived; subject/body changes create a new version. */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  return { template: await updateTemplate(await getCrmDb(), getRouterParam(event, 'id')!, (await readBody(event)) || {}, actorFromSession(session)) }
})
