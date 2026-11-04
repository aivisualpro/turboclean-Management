/**
 * Bulk delete with a safety net ("Trash").
 *
 * Deleting dealerships moves a COMPLETE snapshot — the dealership plus every linked record
 * (contacts, interactions, emails, audits, stage history, activity, time, won/lost logs, files) —
 * into `turboCleanCrmDeletions`, then removes the live records. Restore puts everything back with
 * the original ids, so links, history and reports come back exactly as they were. Won accounts
 * (they live in Dealers) are never deleted here. A full CRM backup is taken first when 10 or more
 * dealerships are deleted at once.
 */
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import { randomUUID } from 'node:crypto'
import { CRM_COLLECTIONS } from './crm'
import type { SessionActor } from './crm'

const DELETIONS = 'turboCleanCrmDeletions'
export const TRASH_KEEP_DAYS = 30
const CHILDREN = [
  CRM_COLLECTIONS.contacts, CRM_COLLECTIONS.activity, CRM_COLLECTIONS.stageHistory,
  'turboCleanCrmInteractions', 'turboCleanCrmEmails', 'turboCleanCrmAudits', 'turboCleanCrmTimeEntries',
  'turboCleanCrmLostDeals', 'turboCleanCrmWonDeals', 'turboCleanCrmFiles', 'turboCleanCrmAuditReports',
]

export async function bulkDeleteDealerships(db: Db, rawIds: unknown, actor: SessionActor | null) {
  const ids = (Array.isArray(rawIds) ? rawIds : []).map(String).filter(x => ObjectId.isValid(x))
  if (!ids.length) throw createError({ statusCode: 400, statusMessage: 'Pick at least one dealership' })
  if (ids.length > 1000) throw createError({ statusCode: 400, statusMessage: 'Delete at most 1,000 at a time' })
  const col = db.collection(CRM_COLLECTIONS.dealerships)
  const docs = await col.find({ _id: { $in: ids.map(i => new ObjectId(i)) } }).toArray()
  const skipped: { id: string, name: string, reason: string }[] = []
  const deleted: { id: string, name: string, dealershipId: string }[] = []
  const undoToken = randomUUID()
  let backupId: string | null = null
  const deletable = docs.filter((d) => {
    if (d.dealerId) { skipped.push({ id: String(d._id), name: d.name, reason: 'Won account — it lives in Dealers; delete the Dealer first' }); return false }
    return true
  })
  if (deletable.length >= 10) {
    try { const { saveBackup } = await import('./crm-dataquality'); backupId = (await saveBackup(db, 'manual', actor)).id } catch {}
  }
  const now = new Date().toISOString()
  for (const d of deletable) {
    const id = String(d._id)
    const children: Record<string, any[]> = {}
    for (const c of CHILDREN) {
      const rows = await db.collection(c).find({ dealershipId: id }).toArray()
      if (rows.length) children[c] = rows
    }
    await db.collection(DELETIONS).insertOne({
      kind: 'dealership', undoToken, dealershipId: id, dealershipCode: d.dealershipId || '', name: d.name || '', city: d.city || '', state: d.state || '',
      snapshot: { dealership: d, children }, counts: Object.fromEntries(Object.entries(children).map(([k, v]) => [k, v.length])),
      deletedAt: now, deletedBy: actor ? { id: actor.id, name: actor.name } : null, restoredAt: null, backupId,
    })
    for (const c of Object.keys(children)) await db.collection(c).deleteMany({ dealershipId: id })
    await col.deleteOne({ _id: d._id })
    deleted.push({ id, name: d.name, dealershipId: d.dealershipId || '' })
  }
  for (const id of ids) if (!docs.some(d => String(d._id) === id)) skipped.push({ id, name: '', reason: 'Not found (already deleted?)' })
  return { deleted, skipped, undoToken: deleted.length ? undoToken : null, backupId }
}

/** Put deleted dealerships back — by undo token (one bulk delete) or by deletion ids. */
export async function restoreDeleted(db: Db, body: { undoToken?: string, ids?: string[] }, actor: SessionActor | null) {
  const filter: any = { kind: 'dealership', restoredAt: null }
  if (body.undoToken) filter.undoToken = String(body.undoToken)
  else if (Array.isArray(body.ids) && body.ids.length) filter._id = { $in: body.ids.filter(x => ObjectId.isValid(x)).map(x => new ObjectId(x)) }
  else throw createError({ statusCode: 400, statusMessage: 'Nothing to restore' })
  const rows = await db.collection(DELETIONS).find(filter).toArray()
  const restored: { id: string, name: string }[] = []
  const failed: { id: string, name: string, reason: string }[] = []
  for (const r of rows) {
    const d = r.snapshot?.dealership
    if (!d) { failed.push({ id: r.dealershipId, name: r.name, reason: 'No snapshot (deleted before Trash existed)' }); continue }
    try {
      await db.collection(CRM_COLLECTIONS.dealerships).insertOne(d)
      for (const [c, docs] of Object.entries((r.snapshot.children || {}) as Record<string, any[]>)) {
        if (docs.length) await db.collection(c).insertMany(docs, { ordered: false }).catch(() => {})
      }
      // Older single deletes only kept contacts.
      if (!r.snapshot.children && Array.isArray(r.snapshot.contacts) && r.snapshot.contacts.length) await db.collection(CRM_COLLECTIONS.contacts).insertMany(r.snapshot.contacts, { ordered: false }).catch(() => {})
      await db.collection(DELETIONS).updateOne({ _id: r._id }, { $set: { restoredAt: new Date().toISOString(), restoredBy: actor ? { id: actor.id, name: actor.name } : null } })
      await db.collection(CRM_COLLECTIONS.activity).insertOne({ dealershipId: r.dealershipId, contactId: null, type: 'dealership.restored', message: 'Dealership restored from Trash', changes: null, actor: actor ? { id: actor.id, name: actor.name, email: actor.email } : { id: 'system', name: 'System', email: '' }, at: new Date().toISOString() })
      restored.push({ id: r.dealershipId, name: r.name })
    }
    catch (e: any) { failed.push({ id: r.dealershipId, name: r.name, reason: /duplicate key/i.test(e?.message) ? 'Already back in the CRM' : String(e?.message || e).slice(0, 120) }) }
  }
  return { restored, failed }
}

/** Trash: deletions from the last 30 days that were not restored. */
export async function listTrash(db: Db) {
  const since = new Date(Date.now() - TRASH_KEEP_DAYS * 86_400_000).toISOString()
  const rows = await db.collection(DELETIONS).find({ kind: 'dealership', restoredAt: null, deletedAt: { $gte: since } }, { projection: { snapshot: 0 } }).sort({ deletedAt: -1 }).limit(500).toArray()
  return rows.map(r => ({ id: String(r._id), undoToken: r.undoToken || null, dealershipId: r.dealershipId, code: r.dealershipCode, name: r.name, city: r.city || '', state: r.state || '', counts: r.counts || {}, deletedAt: r.deletedAt, deletedBy: r.deletedBy, restorable: !!r.undoToken }))
}
