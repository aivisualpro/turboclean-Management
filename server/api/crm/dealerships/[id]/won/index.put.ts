import { actorFromSession, getCrmDb } from '../../../../../utils/crm'
import { saveWin } from '../../../../../utils/crm-won'
import { getUserSession } from '../../../../../utils/auth'

/** PUT /api/crm/dealerships/:id/won — record or correct the won-deal details (services, contract, revenue, profit, attribution). */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const db = await getCrmDb()
  return { win: await saveWin(db, getRouterParam(event, 'id')!, (await readBody(event)) || {}, actorFromSession(session)) }
})
