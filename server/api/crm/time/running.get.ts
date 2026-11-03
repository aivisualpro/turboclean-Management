import { getCrmDb } from '../../../utils/crm'
import { runningTimer } from '../../../utils/crm-time'
import { getUserSession } from '../../../utils/auth'

/** GET /api/crm/time/running — the signed-in user's running timer, or null. */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) return { running: null }
  return { running: await runningTimer(await getCrmDb(), session.id) }
})
