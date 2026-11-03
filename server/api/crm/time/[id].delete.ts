import { getCrmDb } from '../../../utils/crm'
import { deleteEntry } from '../../../utils/crm-time'
import { getUserSession } from '../../../utils/auth'

/** DELETE /api/crm/time/:id — remove one of your time entries. */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  return deleteEntry(await getCrmDb(), getRouterParam(event, 'id')!, session)
})
