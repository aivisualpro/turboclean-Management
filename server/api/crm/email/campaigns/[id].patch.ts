import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { saveCampaign } from '../../../../utils/crm-email'
import { getUserSession } from '../../../../utils/auth'

/** PATCH /api/crm/email/campaigns/:id */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  return { campaign: await saveCampaign(await getCrmDb(), getRouterParam(event, 'id')!, (await readBody(event)) || {}, actorFromSession(session)) }
})
