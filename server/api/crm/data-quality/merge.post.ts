import { actorFromSession, getCrmDb, str } from '../../../utils/crm'
import { mergeContacts, mergeDealerships } from '../../../utils/crm-duplicates'
import { getUserSession } from '../../../utils/auth'

/** POST /api/crm/data-quality/merge — { kind: 'dealership' | 'contact', keepId, mergeId } */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const b = (await readBody(event)) || {}
  const db = await getCrmDb()
  const keepId = str(b.keepId, 64), mergeId = str(b.mergeId, 64)
  return b.kind === 'contact' ? mergeContacts(db, keepId, mergeId, actorFromSession(session)) : mergeDealerships(db, keepId, mergeId, actorFromSession(session))
})
