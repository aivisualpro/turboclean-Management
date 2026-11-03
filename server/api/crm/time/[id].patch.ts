import { getCrmDb } from '../../../utils/crm'
import { updateEntry } from '../../../utils/crm-time'
import { getUserSession } from '../../../utils/auth'

/** PATCH /api/crm/time/:id — { stop: true } or edit { category, minutes, date, note, dealershipId }. */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  return { entry: await updateEntry(await getCrmDb(), getRouterParam(event, 'id')!, (await readBody(event)) || {}, session) }
})
