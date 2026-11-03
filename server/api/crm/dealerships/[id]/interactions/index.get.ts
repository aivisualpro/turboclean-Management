import { getCrmDb, toObjectId } from '../../../../../utils/crm'
import { listInteractions } from '../../../../../utils/crm-interactions'

/** GET /api/crm/dealerships/:id/interactions — every interaction (voided included, flagged), newest first. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  toObjectId(id)
  const db = await getCrmDb()
  return { interactions: await listInteractions(db, id) }
})
