import { CRM_COLLECTIONS, actorFromSession, getCrmDb, logActivity, str } from '../../../utils/crm'
import { normalizeCity, normalizeRoute } from '../../../utils/crm-normalize'
import { getUserSession } from '../../../utils/auth'

/** Fields whose value is shared by many dealerships — renaming one usually means renaming all of them. */
export const CASCADE_FIELDS = ['dealerGroup', 'route', 'territory', 'city'] as const
export type CascadeField = typeof CASCADE_FIELDS[number]
const LABEL: Record<CascadeField, string> = { dealerGroup: 'Dealer group', route: 'Route', territory: 'Territory', city: 'City' }

/**
 * POST /api/crm/dealerships/bulk-field — { field, from, to, excludeIds?: string[] }
 * Changes `field` from `from` to `to` on every active dealership that still has `from`
 * ("Hoffman" → "Hoffman Auto Group" everywhere). Returns the ids it touched.
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const body = (await readBody(event)) || {}
  const field = String(body.field || '') as CascadeField
  if (!CASCADE_FIELDS.includes(field)) throw createError({ statusCode: 400, statusMessage: 'That field cannot be changed in bulk' })
  const from = str(body.from, 300)
  const to = field === 'city' ? normalizeCity(body.to) : field === 'route' ? normalizeRoute(body.to) : str(body.to, 300)
  if (!from) throw createError({ statusCode: 400, statusMessage: 'Nothing to change from' })
  if (from === to) return { updated: 0, ids: [] as string[] }
  const exclude = new Set<string>(Array.isArray(body.excludeIds) ? body.excludeIds.map(String) : [])

  const db = await getCrmDb()
  const col = db.collection(CRM_COLLECTIONS.dealerships)
  const docs = await col.find({ [field]: from, mergedInto: null, archivedAt: null }, { projection: { _id: 1, dealershipId: 1 } }).toArray()
  const targets = docs.filter(d => !exclude.has(d._id.toString()))
  if (!targets.length) return { updated: 0, ids: [] as string[] }

  const now = new Date().toISOString()
  const actor = actorFromSession(session)
  await col.updateMany({ _id: { $in: targets.map(d => d._id) } }, { $set: { [field]: to, updatedAt: now } })
  await Promise.all(targets.map(d => logActivity(db, {
    dealershipId: d._id.toString(), type: 'dealership.updated',
    message: `${LABEL[field]} changed from "${from}" to "${to || '—'}" (applied to all ${targets.length} with the same ${LABEL[field].toLowerCase()})`,
    changes: { [field]: { from, to } }, actor,
  })))
  return { updated: targets.length, ids: targets.map(d => d._id.toString()) }
})
