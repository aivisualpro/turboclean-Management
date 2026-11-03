/**
 * Duplicate safeguards: dealerships (website / phone / name), contacts (email / phone / name), and merging.
 * Creating something that looks like a duplicate returns 409 with the matches; the UI shows them and
 * lets the user open the existing record or "create anyway" (allowDuplicate: true).
 */
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import { CRM_COLLECTIONS, logActivity } from './crm'
import type { SessionActor } from './crm'
import { emailKey, nameKey, personKey, phoneKey, websiteKey } from './crm-normalize'

export interface DealershipMatch { id: string, dealershipId: string, name: string, city: string, state: string, stage: string, reasons: string[], archived: boolean }

function dealershipReasons(a: any, b: any) {
  const r: string[] = []
  const wa = websiteKey(a.website), wb = websiteKey(b.website)
  if (wa && wa === wb) r.push(`Same website (${wa})`)
  const pa = phoneKey(a.phone), pb = phoneKey(b.phone)
  if (pa && pa === pb) r.push('Same phone number')
  const na = nameKey(a.name), nb = nameKey(b.name)
  if (na && na === nb && (!a.state || !b.state || a.state === b.state)) r.push('Same name')
  return r
}

/** Existing dealerships that look like `candidate` (archived ones included — they may need restoring, not re-creating). */
export async function findDealershipDuplicates(db: Db, candidate: any, excludeId?: string): Promise<DealershipMatch[]> {
  const docs = await db.collection(CRM_COLLECTIONS.dealerships).find({ mergedInto: null }, { projection: { name: 1, website: 1, phone: 1, city: 1, state: 1, stage: 1, dealershipId: 1, archivedAt: 1 } }).toArray()
  return docs.filter(d => d._id.toString() !== excludeId).map(d => ({ d, reasons: dealershipReasons(candidate, d) })).filter(x => x.reasons.length)
    .map(({ d, reasons }) => ({ id: d._id.toString(), dealershipId: d.dealershipId || '', name: d.name || '', city: d.city || '', state: d.state || '', stage: d.stage || '', reasons, archived: !!d.archivedAt }))
}

export function duplicateDealershipError(matches: DealershipMatch[]) {
  return createError({ statusCode: 409, statusMessage: `Looks like ${matches.length === 1 ? 'this dealership is' : 'these dealerships are'} already in the CRM: ${matches.map(m => m.name).join(', ')}`, data: { duplicates: matches } })
}

export interface ContactMatch { id: string, dealershipId: string, dealershipName: string, name: string, email: string, role: string, reasons: string[] }

/** Contacts that look like `c`: same email anywhere, or same name / phone at the same dealership. */
export async function findContactDuplicates(db: Db, dealershipId: string, c: any, excludeId?: string): Promise<ContactMatch[]> {
  const em = emailKey(c.email), phones = [phoneKey(c.phone), phoneKey(c.mobile)].filter(Boolean), pk = personKey(c.firstName, c.lastName)
  const or: any[] = [{ dealershipId }]
  if (em) or.push({ email: em })
  const rows = await db.collection(CRM_COLLECTIONS.contacts).find({ $or: or }).toArray()
  const out: ContactMatch[] = []
  for (const r of rows) {
    if (r._id.toString() === excludeId) continue
    const reasons: string[] = []
    if (em && emailKey(r.email) === em) reasons.push(`Same email (${em})`)
    if (r.dealershipId === dealershipId) {
      if (pk && personKey(r.firstName, r.lastName) === pk) reasons.push('Same name at this dealership')
      if (phones.length && [phoneKey(r.phone), phoneKey(r.mobile)].some(p => p && phones.includes(p))) reasons.push('Same phone at this dealership')
    }
    if (reasons.length) out.push({ id: r._id.toString(), dealershipId: r.dealershipId, dealershipName: '', name: `${r.firstName || ''} ${r.lastName || ''}`.trim(), email: r.email || '', role: r.role || '', reasons })
  }
  if (out.some(o => o.dealershipId !== dealershipId)) {
    const ids = [...new Set(out.map(o => o.dealershipId))].filter(i => ObjectId.isValid(i)).map(i => new ObjectId(i))
    const ds = await db.collection(CRM_COLLECTIONS.dealerships).find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray()
    const names = new Map(ds.map(d => [d._id.toString(), d.name || '']))
    for (const o of out) o.dealershipName = names.get(o.dealershipId) || ''
  }
  return out
}

export function duplicateContactError(matches: ContactMatch[]) {
  const m = matches[0]!
  return createError({ statusCode: 409, statusMessage: `Possible duplicate: ${m.name}${m.dealershipName ? ` at ${m.dealershipName}` : ''} — ${m.reasons.join(', ').toLowerCase()}`, data: { contactDuplicates: matches } })
}

/** Whole-database scan: groups of dealerships / contacts that look like the same thing. */
export async function duplicateScan(db: Db) {
  const ds = await db.collection(CRM_COLLECTIONS.dealerships).find({ archivedAt: null, mergedInto: null }, { projection: { name: 1, website: 1, phone: 1, city: 1, state: 1, stage: 1, dealershipId: 1, dealerId: 1, createdAt: 1 } }).toArray()
  // Union-find over shared keys.
  const parent = new Map<string, string>()
  const find = (x: string): string => { const p = parent.get(x) || x; if (p === x) return x; const r = find(p); parent.set(x, r); return r }
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
  const byKey = new Map<string, string>()
  for (const d of ds) {
    const id = d._id.toString()
    parent.set(id, id)
    const keys = [websiteKey(d.website) && `w:${websiteKey(d.website)}`, phoneKey(d.phone) && `p:${phoneKey(d.phone)}`, nameKey(d.name) && `n:${nameKey(d.name)}|${d.state || ''}`].filter(Boolean) as string[]
    for (const k of keys) { const other = byKey.get(k); if (other) union(id, other); else byKey.set(k, id) }
  }
  const groups = new Map<string, any[]>()
  for (const d of ds) { const r = find(d._id.toString()); groups.set(r, [...(groups.get(r) || []), d]) }
  const dealershipGroups = [...groups.values()].filter(g => g.length > 1).map(g => g.map((d, i) => ({
    id: d._id.toString(), dealershipId: d.dealershipId || '', name: d.name || '', city: d.city || '', state: d.state || '', stage: d.stage || '',
    website: d.website || '', phone: d.phone || '', won: !!d.dealerId, createdAt: d.createdAt || null,
    reasons: i === 0 ? [] : dealershipReasons(g[0], d),
  })))

  const cs = await db.collection(CRM_COLLECTIONS.contacts).find({}, { projection: { firstName: 1, lastName: 1, email: 1, phone: 1, mobile: 1, role: 1, dealershipId: 1, isActive: 1 } }).toArray()
  const live = new Set(ds.map(d => d._id.toString()))
  const names = new Map(ds.map(d => [d._id.toString(), d.name || '']))
  const cg = new Map<string, any[]>()
  for (const c of cs) {
    if (!live.has(c.dealershipId)) continue
    const keys = [emailKey(c.email) && `e:${emailKey(c.email)}`, personKey(c.firstName, c.lastName) && `n:${c.dealershipId}:${personKey(c.firstName, c.lastName)}`].filter(Boolean) as string[]
    for (const k of keys) cg.set(k, [...(cg.get(k) || []), c])
  }
  const seen = new Set<string>()
  const contactGroups: any[] = []
  for (const [k, list] of cg) {
    if (list.length < 2) continue
    const sig = list.map(c => c._id.toString()).sort().join(',')
    if (seen.has(sig)) continue
    seen.add(sig)
    contactGroups.push({ reason: k.startsWith('e:') ? 'Same email' : 'Same name at the same dealership', contacts: list.map(c => ({
      id: c._id.toString(), name: `${c.firstName || ''} ${c.lastName || ''}`.trim(), email: c.email || '', role: c.role || '', isActive: c.isActive !== false,
      dealershipId: c.dealershipId, dealershipName: names.get(c.dealershipId) || '',
    })) })
  }
  return { dealershipGroups, contactGroups }
}

const CHILD_COLLECTIONS = [
  CRM_COLLECTIONS.contacts, CRM_COLLECTIONS.activity, CRM_COLLECTIONS.stageHistory,
  'turboCleanCrmInteractions', 'turboCleanCrmEmails', 'turboCleanCrmAudits', 'turboCleanCrmTimeEntries',
  'turboCleanCrmLostDeals', 'turboCleanCrmWonDeals', 'turboCleanCrmFiles',
]
const FILLABLE = ['dealerGroup', 'website', 'address', 'city', 'state', 'zip', 'phone', 'territory', 'assignedUserId', 'assignedUserName', 'leadSourceDetail', 'estMonthlyValue']

/**
 * Merge `mergeId` into `keepId`: every contact, activity, email, audit, time entry… moves to the kept record,
 * blank fields on the kept record are filled from the duplicate, and the duplicate is archived with `mergedInto`.
 */
export async function mergeDealerships(db: Db, keepId: string, mergeId: string, actor: SessionActor | null) {
  if (keepId === mergeId || !ObjectId.isValid(keepId) || !ObjectId.isValid(mergeId)) throw createError({ statusCode: 400, statusMessage: 'Pick two different dealerships' })
  const col = db.collection(CRM_COLLECTIONS.dealerships)
  const [keep, dup] = await Promise.all([col.findOne({ _id: new ObjectId(keepId) }), col.findOne({ _id: new ObjectId(mergeId) })])
  if (!keep || !dup) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  if (dup.dealerId) throw createError({ statusCode: 409, statusMessage: `${dup.name} is a won account (it lives in Dealers) — keep that one and merge the other into it` })
  const moved: Record<string, number> = {}
  for (const c of CHILD_COLLECTIONS) {
    const r = await db.collection(c).updateMany({ dealershipId: mergeId }, { $set: { dealershipId: keepId, mergedFrom: mergeId } })
    if (r.modifiedCount) moved[c] = r.modifiedCount
  }
  const now = new Date().toISOString()
  const fill: Record<string, any> = {}
  for (const k of FILLABLE) if ((keep[k] == null || keep[k] === '') && dup[k] != null && dup[k] !== '') fill[k] = dup[k]
  const brands = [...new Set([...(keep.brands || []), ...(dup.brands || [])])]
  const tags = [...new Set([...(keep.tags || []), ...(dup.tags || [])])]
  const notes = [keep.notes, dup.notes && dup.notes !== keep.notes ? `— merged from ${dup.dealershipId} —\n${dup.notes}` : ''].filter(Boolean).join('\n\n')
  // One primary contact only.
  const primaries = await db.collection(CRM_COLLECTIONS.contacts).find({ dealershipId: keepId, isPrimary: true }).sort({ addedAt: 1 }).toArray()
  if (primaries.length > 1) await db.collection(CRM_COLLECTIONS.contacts).updateMany({ _id: { $in: primaries.slice(1).map(p => p._id) } }, { $set: { isPrimary: false } })
  await col.updateOne({ _id: keep._id }, { $set: { ...fill, brands, tags, notes, updatedAt: now } })
  await col.updateOne({ _id: dup._id }, { $set: { archivedAt: now, mergedInto: keepId, mergedAt: now, mergedBy: actor, updatedAt: now } })
  const total = Object.values(moved).reduce((a, b) => a + b, 0)
  await logActivity(db, { dealershipId: keepId, type: 'dealership.updated', actor, message: `Merged duplicate ${dup.dealershipId} (${dup.name}) into this record — ${total} linked records moved${Object.keys(fill).length ? `, filled ${Object.keys(fill).join(', ')}` : ''}` })
  await logActivity(db, { dealershipId: mergeId, type: 'dealership.archived', actor, message: `Merged into ${keep.dealershipId} (${keep.name}) as a duplicate` })
  return { moved, filled: Object.keys(fill) }
}

/** Merge contact `mergeId` into `keepId` (same dealership): activities and emails are re-pointed, blanks filled, duplicate removed. */
export async function mergeContacts(db: Db, keepId: string, mergeId: string, actor: SessionActor | null) {
  if (keepId === mergeId || !ObjectId.isValid(keepId) || !ObjectId.isValid(mergeId)) throw createError({ statusCode: 400, statusMessage: 'Pick two different contacts' })
  const col = db.collection(CRM_COLLECTIONS.contacts)
  const [keep, dup] = await Promise.all([col.findOne({ _id: new ObjectId(keepId) }), col.findOne({ _id: new ObjectId(mergeId) })])
  if (!keep || !dup) throw createError({ statusCode: 404, statusMessage: 'Contact not found' })
  if (keep.dealershipId !== dup.dealershipId) throw createError({ statusCode: 409, statusMessage: 'These contacts are at different dealerships — merge the dealerships first, or edit one of the contacts' })
  const name = `${dup.firstName || ''} ${dup.lastName || ''}`.trim()
  const keepName = `${keep.firstName || ''} ${keep.lastName || ''}`.trim()
  await db.collection('turboCleanCrmInteractions').updateMany({ contactId: mergeId }, { $set: { contactId: keepId, contactName: keepName } })
  await db.collection('turboCleanCrmEmails').updateMany({ contactId: mergeId }, { $set: { contactId: keepId } })
  await db.collection(CRM_COLLECTIONS.activity).updateMany({ contactId: mergeId }, { $set: { contactId: keepId } })
  const fill: Record<string, any> = {}
  for (const k of ['email', 'phone', 'mobile', 'jobTitle', 'notes']) if (!keep[k] && dup[k]) fill[k] = dup[k]
  if (keep.role === 'Other' && dup.role && dup.role !== 'Other') fill.role = dup.role
  if (dup.isPrimary && !keep.isPrimary) fill.isPrimary = true
  await col.updateOne({ _id: keep._id }, { $set: { ...fill, updatedAt: new Date().toISOString() } })
  await col.deleteOne({ _id: dup._id })
  await logActivity(db, { dealershipId: keep.dealershipId, contactId: keepId, type: 'contact.updated', actor,
    message: `Merged duplicate contact ${name}${dup.email ? ` <${dup.email}>` : ''} into ${keepName}`, changes: { mergedContact: { from: { id: mergeId, name, email: dup.email || '', phone: dup.phone || '', role: dup.role || '' }, to: null } } })
  return { filled: Object.keys(fill) }
}

/**
 * Permanently delete a dealership and everything linked to it (contacts, activities, emails, audits,
 * stage history, time, won/lost logs, files). Won accounts that live in Dealers are refused — delete the
 * Dealer first (that returns the record to the pipeline). A snapshot is kept in `turboCleanCrmDeletions`.
 */
export async function deleteDealership(db: Db, id: string, actor: SessionActor | null) {
  if (!ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid dealership' })
  const col = db.collection(CRM_COLLECTIONS.dealerships)
  const d = await col.findOne({ _id: new ObjectId(id) })
  if (!d) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  if (d.dealerId) throw createError({ statusCode: 409, statusMessage: `${d.name} is a won account in Dealers — delete the Dealer first, then delete it here` })
  const removed: Record<string, number> = {}
  const contacts = await db.collection(CRM_COLLECTIONS.contacts).find({ dealershipId: id }).toArray()
  for (const c of CHILD_COLLECTIONS) {
    const r = await db.collection(c).deleteMany({ dealershipId: id })
    if (r.deletedCount) removed[c] = r.deletedCount
  }
  await db.collection('turboCleanCrmDeletions').insertOne({
    kind: 'dealership', dealershipId: id, dealershipCode: d.dealershipId || '', name: d.name || '',
    snapshot: { dealership: d, contacts }, removed, deletedAt: new Date().toISOString(), deletedBy: actor,
  })
  await col.deleteOne({ _id: d._id })
  return { ok: true, removed }
}
