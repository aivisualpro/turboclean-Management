import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { saveCampaign } from '../../../../utils/crm-email'
import { getUserSession } from '../../../../utils/auth'

/** POST /api/crm/email/campaigns — { name, description, status, startDate, endDate } */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  return { campaign: await saveCampaign(await getCrmDb(), null, await readBody(event), actorFromSession(session)) }
})
