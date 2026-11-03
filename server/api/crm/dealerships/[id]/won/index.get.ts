import { getCrmDb } from '../../../../../utils/crm'
import { getWin, wonAttribution } from '../../../../../utils/crm-won'

/** GET /api/crm/dealerships/:id/won — the recorded win (if any) + what the history says (touches, first touch, credited template). */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const db = await getCrmDb()
  const win = await getWin(db, id)
  return { win, preview: await wonAttribution(db, id, win?.wonAt || new Date().toISOString()) }
})
