import { actorFromSession, getCrmDb, str } from '../../../utils/crm'
import { clearDuplicates, undoClearDuplicates } from '../../../utils/crm-duplicates'
import { getUserSession } from '../../../utils/auth'

/**
 * POST /api/crm/data-quality/duplicates
 *   { keys: string[] }   merge the chosen duplicate groups (keys come from GET …/duplicates)
 *   { undo: batchId }    take that run back
 * Nothing is deleted: linked records move to the kept dealership, the duplicate is archived as merged.
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const b = (await readBody(event)) || {}
  const db = await getCrmDb()
  const actor = actorFromSession(session)
  if (b.undo) return undoClearDuplicates(db, str(b.undo, 64), actor)
  return clearDuplicates(db, b.keys, actor)
})
