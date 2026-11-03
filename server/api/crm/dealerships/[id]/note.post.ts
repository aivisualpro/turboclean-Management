import { CRM_COLLECTIONS, actorFromSession, getCrmDb, str, toObjectId } from '../../../../utils/crm'
import { createInteraction } from '../../../../utils/crm-interactions'
import { getUserSession } from '../../../../utils/auth'

/** POST /api/crm/dealerships/:id/note — quick note (kept for API clients); stored as a `note` interaction. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await getUserSession(event)
  const body = await readBody(event)
  const text = str(body?.text, 4000)
  if (!text) throw createError({ statusCode: 400, statusMessage: 'Note text is required' })
  const db = await getCrmDb()
  const dealership = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: toObjectId(id) })
  if (!dealership) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  const interaction = await createInteraction(db, dealership, { type: 'note', notes: text }, actorFromSession(session))
  return { ok: true, interaction }
})
