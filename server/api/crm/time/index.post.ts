import { actorFromSession, getCrmDb } from '../../../utils/crm'
import { addEntry, startTimer } from '../../../utils/crm-time'
import { getUserSession } from '../../../utils/auth'

/**
 * POST /api/crm/time
 *   { action: 'start', category, dealershipId?, note?, date? }        → starts your timer (stops a running one)
 *   { action: 'add', category, minutes, date, dealershipId?, note? }   → a finished block of time
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const actor = actorFromSession(session)
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in to track time' })
  const body = (await readBody(event)) || {}
  const db = await getCrmDb()
  if (body.action === 'start') return startTimer(db, actor, body)
  return { entry: await addEntry(db, actor, body, 'manual') }
})
