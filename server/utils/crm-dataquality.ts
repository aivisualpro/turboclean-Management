/**
 * Data quality: health scan, user/action history, CSV export/import, backups.
 */
import { gzipSync } from 'node:zlib'
import { BSON, ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import { CRM_COLLECTIONS, DEFAULT_STAGE, LEAD_SOURCES, logActivity, nextDealershipId, normalizeUrl, str, CONTACT_ROLES } from './crm'
import type { SessionActor } from './crm'
import { duplicateScan, findDealershipDuplicates } from './crm-duplicates'
import { isKnownBrand, isStateCode, nameKey, normalizeBrands, normalizeCity, normalizePhone, normalizeState, phoneKey, websiteKey } from './crm-normalize'
import { buildFacts } from './crm-facts'

// ───────────────────────── Health scan ─────────────────────────
export async function qualityReport(db: Db) {
  const [dups, ds, cs, wonNoDetails, bounced] = await Promise.all([
    duplicateScan(db),
    db.collection(CRM_COLLECTIONS.dealerships).find({ archivedAt: null, mergedInto: null }, { projection: { name: 1, dealershipId: 1, state: 1, city: 1, website: 1, phone: 1, assignedUserId: 1, brands: 1, stage: 1, lostReason: 1, leadSource: 1 } }).toArray(),
    db.collection(CRM_COLLECTIONS.contacts).find({ isActive: { $ne: false } }, { projection: { firstName: 1, lastName: 1, email: 1, phone: 1, mobile: 1, role: 1, dealershipId: 1, isPrimary: 1 } }).toArray(),
    db.collection('turboCleanCrmWonDeals').find({ revertedAt: null }, { projection: { dealershipId: 1 } }).toArray().then(r => r.map(w => w.dealershipId)),
    db.collection(CRM_COLLECTIONS.contacts).find({ emailBouncedAt: { $ne: null } }, { projection: { firstName: 1, lastName: 1, email: 1, dealershipId: 1 } }).toArray(),
  ])
  const name = new Map(ds.map(d => [d._id.toString(), d.name || '']))
  const live = new Set(name.keys())
  const ref = (d: any) => ({ id: d._id.toString(), code: d.dealershipId || '', name: d.name || '' })
  const cref = (c: any) => ({ id: c._id.toString(), dealershipId: c.dealershipId, dealershipName: name.get(c.dealershipId) || '', name: `${c.firstName || ''} ${c.lastName || ''}`.trim(), email: c.email || '', role: c.role || '' })
  const liveContacts = cs.filter(c => live.has(c.dealershipId))
  const withContacts = new Set(liveContacts.map(c => c.dealershipId))
  const wonSet = new Set((wonNoDetails as any[]).map(String))
  const badBrands = new Map<string, number>()
  for (const d of ds) for (const b of d.brands || []) if (!isKnownBrand(b)) badBrands.set(b, (badBrands.get(b) || 0) + 1)
  const check = (key: string, label: string, hint: string, items: any[], severity: 'high' | 'medium' | 'low' = 'medium') => ({ key, label, hint, severity, count: items.length, items: items.slice(0, 200) })
  const checks = [
    check('noState', 'Dealerships without a state', 'State drives market and territory reports.', ds.filter(d => !d.state).map(ref), 'high'),
    check('badState', 'State not a 2-letter code', 'Fixed automatically when the record is next saved.', ds.filter(d => d.state && !isStateCode(d.state)).map(d => ({ ...ref(d), value: d.state })), 'medium'),
    check('noCity', 'Dealerships without a city', 'Needed for city / market comparisons.', ds.filter(d => !d.city).map(ref)),
    check('noWebsite', 'Dealerships without a website', 'Needed for inventory audits and duplicate detection.', ds.filter(d => !d.website).map(ref)),
    check('noPhone', 'Dealerships without a phone number', '', ds.filter(d => !d.phone).map(ref), 'low'),
    check('noOwner', 'Dealerships with no owner', 'Unassigned prospects fall through the cracks.', ds.filter(d => !d.assignedUserId).map(ref), 'high'),
    check('noContacts', 'Dealerships with no contacts', 'Someone to email or call.', ds.filter(d => !withContacts.has(d._id.toString())).map(ref)),
    check('noPrimary', 'Dealerships with contacts but no primary contact', '', ds.filter(d => withContacts.has(d._id.toString()) && !liveContacts.some(c => c.dealershipId === d._id.toString() && c.isPrimary)).map(ref), 'low'),
    check('contactNoReach', 'Contacts with no email and no phone', 'Cannot be reached.', liveContacts.filter(c => !c.email && !c.phone && !c.mobile).map(cref), 'high'),
    check('contactBadEmail', 'Contacts with an invalid email', '', liveContacts.filter(c => c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)).map(cref), 'high'),
    check('contactBounced', 'Contacts whose email bounced', 'Find a new address before emailing again.', bounced.filter(c => live.has(c.dealershipId)).map(cref), 'high'),
    check('contactRoleOther', 'Contacts with job title "Other"', 'Role drives the GM vs used-car-manager comparisons.', liveContacts.filter(c => !c.role || c.role === 'Other').map(cref), 'low'),
    check('unknownBrand', 'Brands not in the standard list', 'Usually a typo — fix on the dealership.', [...badBrands.entries()].map(([b, n]) => ({ id: b, name: b, count: n })), 'low'),
    check('lostNoReason', 'Lost without a reason', 'Fix on the Lost deals page.', ds.filter(d => d.stage === 'Lost' && !d.lostReason).map(ref)),
    check('wonNoDetails', 'Won without deal details', 'Record the services sold and revenue on the dealership.', ds.filter(d => d.stage === 'Won' && !wonSet.has(d._id.toString())).map(ref)),
  ]
  const issues = checks.reduce((a, c) => a + c.count, 0) + dups.dealershipGroups.length + dups.contactGroups.length
  return { totals: { dealerships: ds.length, contacts: liveContacts.length, issues }, duplicates: dups, checks }
}

// ───────────────────────── User / action history ─────────────────────────
export async function actionHistory(db: Db, q: { userId?: string, type?: string, before?: string, limit?: number }) {
  const match: any = {}
  if (q.userId) match['actor.id'] = q.userId
  if (q.type) match.type = { $regex: `^${q.type.replace(/[^a-z_.]/gi, '')}` }
  if (q.before) match.at = { $lt: q.before }
  const rows = await db.collection(CRM_COLLECTIONS.activity).find(match).sort({ at: -1 }).limit(Math.min(q.limit || 100, 500)).toArray()
  const ids = [...new Set(rows.map(r => r.dealershipId))].filter(i => ObjectId.isValid(i)).map(i => new ObjectId(i))
  const ds = await db.collection(CRM_COLLECTIONS.dealerships).find({ _id: { $in: ids } }, { projection: { name: 1, dealershipId: 1 } }).toArray()
  const nm = new Map(ds.map(d => [d._id.toString(), d]))
  return rows.map(r => ({ id: r._id.toString(), at: r.at, type: r.type, message: r.message, actor: r.actor, dealershipId: r.dealershipId, dealershipName: nm.get(r.dealershipId)?.name || '', dealershipCode: nm.get(r.dealershipId)?.dealershipId || '', changes: r.changes || null }))
}

// ───────────────────────── CSV export ─────────────────────────
const esc = (v: unknown) => { const s = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const toCsv = (cols: [string, (r: any) => unknown][], rows: any[]) => [cols.map(c => esc(c[0])).join(','), ...rows.map(r => cols.map(c => esc(c[1](r))).join(','))].join('\r\n')

export async function exportCsv(db: Db, kind: 'dealerships' | 'contacts' | 'activities') {
  if (kind === 'dealerships') {
    const [ds, facts] = await Promise.all([db.collection(CRM_COLLECTIONS.dealerships).find({ mergedInto: null }).sort({ dealershipId: 1 }).toArray(), buildFacts(db, { includeArchived: true })])
    const f = new Map(facts.map(x => [x.id, x]))
    return toCsv([
      ['Dealership ID', d => d.dealershipId], ['Name', d => d.name], ['Dealer group', d => d.dealerGroup], ['Brands', d => d.brands], ['Website', d => d.website],
      ['Address', d => d.address], ['City', d => d.city], ['State', d => d.state], ['ZIP', d => d.zip], ['Phone', d => d.phone], ['Territory', d => d.territory],
      ['Stage', d => d.stage], ['Owner', d => d.assignedUserName], ['Lead source', d => d.leadSource], ['Lead source detail', d => d.leadSourceDetail],
      ['Est. monthly value', d => d.estMonthlyValue ?? ''], ['Lost reason', d => d.lostReason || ''], ['Revisit date', d => d.revisitDate || ''],
      ['Missing photo %', d => f.get(d._id.toString())?.missingPhotoPct ?? ''], ['Vehicles', d => f.get(d._id.toString())?.totalVehicles ?? ''],
      ['Emails sent', d => f.get(d._id.toString())?.counts.emails ?? 0], ['Calls', d => f.get(d._id.toString())?.counts.calls ?? 0], ['Walk-ins', d => f.get(d._id.toString())?.counts.visits ?? 0],
      ['Replied', d => f.get(d._id.toString())?.steps.replied ? 'Yes' : 'No'], ['Meeting', d => f.get(d._id.toString())?.steps.meeting ? 'Yes' : 'No'],
      ['First contact', d => f.get(d._id.toString())?.firstContactAt?.slice(0, 10) || ''], ['Last activity', d => f.get(d._id.toString())?.lastActivityAt?.slice(0, 10) || ''],
      ['Annual revenue won', d => f.get(d._id.toString())?.annualRevenue || ''], ['Tags', d => d.tags], ['Notes', d => d.notes],
      ['Created', d => d.createdAt], ['Updated', d => d.updatedAt], ['Archived', d => d.archivedAt || ''],
    ], ds)
  }
  if (kind === 'contacts') {
    const [cs, ds] = await Promise.all([db.collection(CRM_COLLECTIONS.contacts).find({}).toArray(), db.collection(CRM_COLLECTIONS.dealerships).find({}, { projection: { name: 1, dealershipId: 1 } }).toArray()])
    const d = new Map(ds.map(x => [x._id.toString(), x]))
    return toCsv([
      ['Dealership ID', c => d.get(c.dealershipId)?.dealershipId], ['Dealership', c => d.get(c.dealershipId)?.name], ['First name', c => c.firstName], ['Last name', c => c.lastName],
      ['Role', c => c.role], ['Job title', c => c.jobTitle], ['Email', c => c.email], ['Phone', c => c.phone], ['Mobile', c => c.mobile], ['Preferred contact', c => c.preferredContactMethod],
      ['Primary', c => c.isPrimary ? 'Yes' : 'No'], ['Active', c => c.isActive === false ? 'No' : 'Yes'], ['Email bounced', c => c.emailBouncedAt || ''], ['Last verified', c => c.lastVerifiedAt || ''], ['Added', c => c.addedAt], ['Notes', c => c.notes],
    ], cs)
  }
  const ix = await db.collection('turboCleanCrmInteractions').find({}).sort({ occurredAt: -1 }).toArray()
  return toCsv([
    ['Date', i => i.occurredAt], ['Dealership ID', i => i.dealershipCode], ['Dealership', i => i.dealershipName], ['Type', i => i.type], ['Contact', i => i.contactName || ''],
    ['User', i => i.user?.name], ['Outcome', i => i.outcome], ['Notes', i => i.notes], ['Next action', i => i.nextAction], ['Next action date', i => i.nextActionDate || ''],
    ['Next action done', i => i.nextActionDone ? 'Yes' : 'No'], ['Source', i => i.source], ['Voided', i => i.voidedAt || ''], ['Logged', i => i.createdAt],
  ], ix)
}

// ───────────────────────── CSV import (dealerships + optional primary contact) ─────────────────────────
export const IMPORT_FIELDS = ['name', 'dealerGroup', 'brands', 'website', 'address', 'city', 'state', 'zip', 'phone', 'territory', 'leadSource', 'notes', 'contactFirstName', 'contactLastName', 'contactRole', 'contactJobTitle', 'contactEmail', 'contactPhone'] as const

export async function importDealerships(db: Db, rows: any[], opts: { dryRun?: boolean, ownerId?: string, ownerName?: string }, actor: SessionActor | null) {
  if (!Array.isArray(rows) || !rows.length) throw createError({ statusCode: 400, statusMessage: 'No rows to import' })
  if (rows.length > 2000) throw createError({ statusCode: 400, statusMessage: 'Import at most 2,000 rows at a time' })
  const results: { row: number, status: 'created' | 'duplicate' | 'invalid' | 'ready', message: string, id?: string, duplicateOf?: any[] }[] = []
  const seen: any[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {}
    const name = str(r.name, 200)
    const state = normalizeState(r.state)
    if (!name) { results.push({ row: i + 1, status: 'invalid', message: 'Name is missing' }); continue }
    if (!state) { results.push({ row: i + 1, status: 'invalid', message: 'State is missing' }); continue }
    const candidate = { name, website: normalizeUrl(r.website), phone: normalizePhone(r.phone), state, city: normalizeCity(r.city) }
    const dups = await findDealershipDuplicates(db, candidate)
    const inFile = seen.find(s => findSame(s, candidate))
    if (dups.length || inFile) { results.push({ row: i + 1, status: 'duplicate', message: dups.length ? `Already in CRM: ${dups.map(d => d.name).join(', ')}` : `Same as row ${inFile.row} in this file`, duplicateOf: dups }); continue }
    seen.push({ ...candidate, row: i + 1 })
    if (opts.dryRun) { results.push({ row: i + 1, status: 'ready', message: 'Will be created' }); continue }
    const now = new Date().toISOString()
    const leadSource = (LEAD_SOURCES as readonly string[]).find(s => s.toLowerCase() === String(r.leadSource || '').trim().toLowerCase()) || 'Manual research'
    const doc = {
      dealershipId: await nextDealershipId(db), name, dealerGroup: str(r.dealerGroup, 200), brands: normalizeBrands(r.brands), website: candidate.website,
      address: str(r.address, 300), city: candidate.city, state, zip: str(r.zip, 20), phone: candidate.phone, territory: str(r.territory, 120),
      assignedUserId: str(opts.ownerId, 64), assignedUserName: str(opts.ownerName, 120), leadSource, leadSourceDetail: 'CSV import',
      stage: DEFAULT_STAGE, stageChangedAt: now, stageChangedBy: actor, notes: str(r.notes, 5000), tags: [], estMonthlyValue: null,
      createdAt: now, createdBy: actor, updatedAt: now, archivedAt: null as string | null,
    }
    const res = await db.collection(CRM_COLLECTIONS.dealerships).insertOne(doc)
    const id = res.insertedId.toString()
    await logActivity(db, { dealershipId: id, type: 'dealership.created', message: `Dealership record ${doc.dealershipId} created (CSV import)`, actor })
    const { recordStageChange } = await import('./crm-stage')
    await recordStageChange(db, { dealership: { _id: res.insertedId, ...doc }, fromStage: null, toStage: DEFAULT_STAGE, actor, source: 'api', at: new Date(now) })
    if (r.contactFirstName || r.contactLastName || r.contactEmail) {
      const role = (CONTACT_ROLES as readonly string[]).find(x => x.toLowerCase() === String(r.contactRole || '').trim().toLowerCase()) || 'Other'
      const email = String(r.contactEmail || '').trim().toLowerCase()
      await db.collection(CRM_COLLECTIONS.contacts).insertOne({
        dealershipId: id, firstName: str(r.contactFirstName, 80), lastName: str(r.contactLastName, 80), role, jobTitle: str(r.contactJobTitle, 120) || (role !== 'Other' ? role : ''),
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '', phone: normalizePhone(r.contactPhone), mobile: '', preferredContactMethod: 'email',
        isPrimary: true, isActive: true, inactiveAt: null, inactiveReason: '', succeededById: null, precededById: null, addedAt: now, lastVerifiedAt: null, notes: '', createdBy: actor, updatedAt: now,
      })
    }
    results.push({ row: i + 1, status: 'created', message: `Created ${doc.dealershipId}`, id })
  }
  const tally = (s: string) => results.filter(r => r.status === s).length
  return { results, created: tally('created'), ready: tally('ready'), duplicates: tally('duplicate'), invalid: tally('invalid') }
}
function findSame(a: any, b: any) {
  return (websiteKey(a.website) && websiteKey(a.website) === websiteKey(b.website)) || (phoneKey(a.phone) && phoneKey(a.phone) === phoneKey(b.phone)) || (nameKey(a.name) === nameKey(b.name) && a.state === b.state)
}

// ───────────────────────── Backups ─────────────────────────
export const BACKUP_COLLECTIONS = [
  CRM_COLLECTIONS.dealerships, CRM_COLLECTIONS.contacts, CRM_COLLECTIONS.activity, CRM_COLLECTIONS.stageHistory,
  'turboCleanCrmInteractions', 'turboCleanCrmEmails', 'turboCleanCrmEmailTemplates', 'turboCleanCrmEmailCampaigns', 'turboCleanCrmSenderProfiles',
  'turboCleanCrmAudits', 'turboCleanCrmLostDeals', 'turboCleanCrmWonDeals', 'turboCleanCrmTimeEntries',
]
const BACKUPS = 'turboCleanCrmBackups'
const CHUNKS = 'turboCleanCrmBackupChunks'
const CHUNK = 8 * 1024 * 1024
export const BACKUP_KEEP_DAYS = 30

/** Every CRM collection as Extended JSON (ObjectIds / dates preserved), gzipped. Files are excluded (images). */
export async function buildBackup(db: Db) {
  const data: Record<string, any[]> = {}
  const counts: Record<string, number> = {}
  for (const c of BACKUP_COLLECTIONS) { data[c] = await db.collection(c).find({}).toArray(); counts[c] = data[c]!.length }
  const json = BSON.EJSON.stringify({ app: 'ZRZ Turbo Clean CRM', version: 1, createdAt: new Date().toISOString(), collections: data }, { relaxed: false })
  return { gz: gzipSync(Buffer.from(json)), counts, rawBytes: Buffer.byteLength(json) }
}

export async function saveBackup(db: Db, kind: 'auto' | 'manual', actor: SessionActor | null) {
  const { gz, counts, rawBytes } = await buildBackup(db)
  const now = new Date()
  const meta = { kind, createdAt: now.toISOString(), day: now.toISOString().slice(0, 10), bytes: gz.length, rawBytes, counts, chunks: Math.ceil(gz.length / CHUNK), createdBy: actor ? { id: actor.id, name: actor.name } : { id: 'system', name: 'System' } }
  const res = await db.collection(BACKUPS).insertOne(meta)
  for (let i = 0; i * CHUNK < gz.length; i++) await db.collection(CHUNKS).insertOne({ backupId: res.insertedId.toString(), n: i, data: gz.subarray(i * CHUNK, (i + 1) * CHUNK) })
  await pruneBackups(db)
  return { id: res.insertedId.toString(), ...meta }
}

export async function pruneBackups(db: Db) {
  const cutoff = new Date(Date.now() - BACKUP_KEEP_DAYS * 86_400_000).toISOString()
  const old = await db.collection(BACKUPS).find({ createdAt: { $lt: cutoff } }, { projection: { _id: 1 } }).toArray()
  if (!old.length) return
  await db.collection(CHUNKS).deleteMany({ backupId: { $in: old.map(o => o._id.toString()) } })
  await db.collection(BACKUPS).deleteMany({ _id: { $in: old.map(o => o._id) } })
}

export async function listBackups(db: Db) {
  return (await db.collection(BACKUPS).find({}).sort({ createdAt: -1 }).limit(60).toArray()).map(b => ({ id: b._id.toString(), kind: b.kind, createdAt: b.createdAt, bytes: b.bytes, rawBytes: b.rawBytes, counts: b.counts, createdBy: b.createdBy }))
}

export async function readBackup(db: Db, id: string) {
  if (!ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid backup id' })
  const meta = await db.collection(BACKUPS).findOne({ _id: new ObjectId(id) })
  if (!meta) throw createError({ statusCode: 404, statusMessage: 'Backup not found' })
  const chunks = await db.collection(CHUNKS).find({ backupId: id }).sort({ n: 1 }).toArray()
  return { meta, gz: Buffer.concat(chunks.map(c => Buffer.from(c.data.buffer ?? c.data))) }
}

/** Once a day (first tick after midnight UTC): automatic snapshot. Safe to call often. */
export async function runDailyBackup(db: Db) {
  const day = new Date().toISOString().slice(0, 10)
  const exists = await db.collection(BACKUPS).findOne({ kind: 'auto', day })
  if (exists) return null
  // Claim the day first so two ticks / servers don't both run it.
  const claim = await db.collection('turboCleanCrmBackupClaims').updateOne({ _id: day as any }, { $setOnInsert: { at: new Date().toISOString() } }, { upsert: true })
  if (!claim.upsertedCount) return null
  return saveBackup(db, 'auto', null)
}
