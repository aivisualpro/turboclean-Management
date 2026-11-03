import { getUserSession } from './auth'
import { actorFromSession } from './crm'

/** Automation endpoints are for signed-in users only. Returns the session actor. */
export async function requireActor(event: any) {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  return actorFromSession(session)!
}
