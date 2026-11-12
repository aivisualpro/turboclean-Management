/**
 * Dealership research / inventory audits.
 *
 * Append-only: every audit is its own immutable document, so a dealership
 * audited today and again in 30 days keeps both snapshots. Percentages are
 * computed server-side so manual, imported and (future) automated audits all
 * carry identical, comparable metrics. There is no update or delete route by
 * design — a correction is a new audit with a note.
 */
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import { CRM_COLLECTIONS, actorFromSession, logActivity, str } from './crm'

export const AUDIT_COLLECTION = 'turboCleanCrmAudits'
export const AUDIT_SOURCES = ['manual', 'automated', 'imported'] as const
export type AuditSource = typeof AUDIT_SOURCES[number]

export interface AuditMetrics {
  totalVehicles: number
  totalMissingPhotos: number
  missingPhotoPct: number | null
  newMissingPhotoPct: number | null
  usedMissingPhotoPct: number | null
}

const pct = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 1000) / 10 : null
const int = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) throw createError({ statusCode: 400, statusMessage: 'Counts must be zero or positive numbers' })
  return Math.round(n)
}

export function computeMetrics(a: { newTotal: number, usedTotal: number, newMissingPhotos: number, usedMissingPhotos: number }): AuditMetrics {
  const totalVehicles = a.newTotal + a.usedTotal
  const totalMissingPhotos = a.newMissingPhotos + a.usedMissingPhotos
  return {
    totalVehicles,
    totalMissingPhotos,
    missingPhotoPct: pct(totalMissingPhotos, totalVehicles),
    newMissingPhotoPct: pct(a.newMissingPhotos, a.newTotal),
    usedMissingPhotoPct: pct(a.usedMissingPhotos, a.usedTotal),
  }
}

export function buildAuditDoc(body: any, dealershipId: string, actor: any) {
  const newTotal = int(body.newTotal) ?? 0
  const usedTotal = int(body.usedTotal) ?? 0
  const newMissingPhotos = int(body.newMissingPhotos) ?? 0
  const usedMissingPhotos = int(body.usedMissingPhotos) ?? 0
  if (newMissingPhotos > newTotal || usedMissingPhotos > usedTotal)
    throw createError({ statusCode: 400, statusMessage: 'Vehicles missing photos cannot exceed the total in that category' })

  const auditedAt = body.auditedAt ? new Date(body.auditedAt) : new Date()
  if (Number.isNaN(auditedAt.getTime())) throw createError({ statusCode: 400, statusMessage: 'Invalid audit date' })
  if (auditedAt.getTime() > Date.now() + 86_400_000) throw createError({ statusCode: 400, statusMessage: 'Audit date cannot be in the future' })

  const list = (v: unknown, max = 40) => Array.isArray(v) ? v.map(x => str(x, 200)).filter(Boolean).slice(0, max) : []
  const examples = Array.isArray(body.examples)
    ? body.examples.map((e: any) => ({
        url: str(e?.url, 1000), label: str(e?.label, 200),
        // Optional detail from the Inventory Scanner (used by the email evidence block).
        ...(e?.title ? { title: str(e.title, 160), stock: str(e?.stock, 40), price: str(e?.price, 40), condition: str(e?.condition, 20), verdict: str(e?.verdict, 20) } : {}),
        ...(e?.listUrl ? { listUrl: str(e.listUrl, 1000) } : {}),
        // The photo the listing showed when it was audited: our stored copy (emails embed it), the dealer's own address as a fallback, and its size.
        ...(/^[a-f0-9]{24}$/i.test(String(e?.imageFileId || '')) ? { imageFileId: String(e.imageFileId) } : {}),
        ...(/^https:\/\//i.test(String(e?.imageUrl || '')) ? { imageUrl: str(e.imageUrl, 1000) } : {}),
        ...(int(e?.imageW) && int(e?.imageH) ? { imageW: int(e.imageW), imageH: int(e.imageH) } : {}),
      })).filter((e: any) => e.url).slice(0, 50)
    : []
  // Photo verdict breakdown from the Inventory Scanner (real / placeholder / no image / stock).
  const pb = body.photoBreakdown && typeof body.photoBreakdown === 'object' ? body.photoBreakdown : null
  const photoBreakdown = pb
    ? { real: int(pb.real) ?? 0, placeholder: int(pb.placeholder) ?? 0, missing: int(pb.missing) ?? 0, stock: int(pb.stock) ?? 0, countStockAsMissing: pb.countStockAsMissing !== false }
    : null
  // Per crawl page (inventory list) — reports and emails group the findings by these.
  const pages = Array.isArray(body.pages)
    ? body.pages.map((p: any) => ({
        url: str(p?.url, 1000), label: str(p?.label, 80), kind: str(p?.kind, 20),
        total: int(p?.total) ?? 0, withoutReal: int(p?.withoutReal) ?? 0, withoutRealPct: typeof p?.withoutRealPct === 'number' ? p.withoutRealPct : null,
        real: int(p?.real) ?? 0, placeholder: int(p?.placeholder) ?? 0, missing: int(p?.missing) ?? 0, stock: int(p?.stock) ?? 0,
      })).filter((p: any) => p.url).slice(0, 30)
    : []

  // Coverage: how many of the vehicles the site lists were actually checked (the rest sat behind blocked pages).
  const cv = body.coverage && typeof body.coverage === 'object' ? body.coverage : null
  const coverage = cv ? { checked: int(cv.checked) ?? 0, advertised: int(cv.advertised) ?? null, blockedPages: int(cv.blockedPages) ?? 0 } : null
  // Scope: the saved scan pages the crawl read (nothing else on the site) and how each one went.
  const scope = Array.isArray(body.scope)
    ? body.scope.map((p: any) => ({ url: str(p?.url, 1000), label: str(p?.label, 80), status: str(p?.status, 20), vehicles: int(p?.vehicles) ?? 0, resultPages: int(p?.resultPages) ?? 0, advertised: int(p?.advertised) ?? null, note: str(p?.note, 200) })).filter((p: any) => p.url).slice(0, 40)
    : []
  const source: AuditSource = AUDIT_SOURCES.includes(body.source) ? body.source : 'manual'
  const counts = { newTotal, usedTotal, newMissingPhotos, usedMissingPhotos }
  return {
    dealershipId,
    auditedAt: auditedAt.toISOString(),
    source,
    inventoryUrl: str(body.inventoryUrl, 1000),
    ...counts,
    ...computeMetrics(counts),
    poorPhotoSets: int(body.poorPhotoSets),
    poorPhotoSetsNotes: str(body.poorPhotoSetsNotes, 2000),
    merchandisingIssues: list(body.merchandisingIssues),
    merchandisingNotes: str(body.merchandisingNotes, 2000),
    websiteIssues: list(body.websiteIssues),
    websiteIssuesNotes: str(body.websiteIssuesNotes, 2000),
    notes: str(body.notes, 6000),
    examples,
    photoBreakdown,
    pages,
    coverage,
    scope,
    // Evidence screenshot of the dealership's inventory page (turboCleanCrmFiles) — used by email templates as {{auditScreenshot}}.
    screenshotFileId: /^[a-f0-9]{24}$/i.test(String(body.screenshotFileId || '')) ? String(body.screenshotFileId) : null,
    // Provenance — ready for automated collectors to fill in.
    collector: source === 'manual' ? null : { name: str(body.collector?.name, 120), version: str(body.collector?.version, 40), runId: str(body.collector?.runId, 120) },
    auditedBy: actor,
    createdAt: new Date().toISOString(),
    schemaVersion: 1,
  }
}

export function serializeAudit(doc: any) {
  if (!doc) return null
  const { _id, ...rest } = doc
  return { id: _id.toString(), ...rest }
}

export async function listAudits(db: Db, dealershipId: string) {
  const docs = await db.collection(AUDIT_COLLECTION).find({ dealershipId }).sort({ auditedAt: -1, createdAt: -1 }).toArray()
  return docs.map(serializeAudit)
}

/** Latest + previous snapshot per dealership, for list views. */
export async function auditSummaries(db: Db, dealershipIds: string[]) {
  if (!dealershipIds.length) return new Map<string, any>()
  const rows = await db.collection(AUDIT_COLLECTION).aggregate([
    { $match: { dealershipId: { $in: dealershipIds } } },
    { $sort: { auditedAt: -1, createdAt: -1 } },
    { $group: { _id: '$dealershipId', count: { $sum: 1 }, audits: { $push: { auditedAt: '$auditedAt', missingPhotoPct: '$missingPhotoPct', totalVehicles: '$totalVehicles', totalMissingPhotos: '$totalMissingPhotos', source: '$source' } } } },
    { $project: { count: 1, latest: { $arrayElemAt: ['$audits', 0] }, previous: { $arrayElemAt: ['$audits', 1] } } },
  ]).toArray()
  const map = new Map<string, any>()
  for (const r of rows) map.set(r._id, { count: r.count, latest: r.latest || null, previous: r.previous || null })
  return map
}

export async function recordAudit(db: Db, dealership: any, body: any, session: any) {
  const actor = actorFromSession(session)
  const doc = buildAuditDoc(body, dealership._id.toString(), actor)
  const res = await db.collection(AUDIT_COLLECTION).insertOne({ _id: new ObjectId(), ...doc })
  const pctLabel = doc.missingPhotoPct === null ? 'no inventory found' : `${doc.missingPhotoPct}% missing photos`
  await logActivity(db, {
    dealershipId: dealership._id.toString(), type: 'audit.recorded', actor,
    message: `Inventory audit recorded — ${doc.totalVehicles} vehicles, ${pctLabel}${doc.source !== 'manual' ? ` (${doc.source})` : ''}`,
    changes: { 'New vehicles': { from: null, to: doc.newTotal }, 'Used vehicles': { from: null, to: doc.usedTotal }, 'Missing photos': { from: null, to: doc.totalMissingPhotos } },
  })
  await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: dealership._id }, { $set: { updatedAt: new Date().toISOString(), lastAuditAt: doc.auditedAt } })
  // The audit is also a touch in the relationship history.
  try {
    const { createInteraction } = await import('./crm-interactions')
    const issues = [...doc.merchandisingIssues, ...doc.websiteIssues]
    const auditDay = String(doc.auditedAt).slice(0, 10)
    const occurredAt = auditDay === new Date().toISOString().slice(0, 10) ? undefined : `${auditDay}T12:00:00.000Z`
    await createInteraction(db, dealership, {
      type: 'research_completed', occurredAt,
      notes: `Inventory audit: ${doc.totalVehicles} vehicles (${doc.newTotal} new / ${doc.usedTotal} used), ${doc.totalMissingPhotos} missing photos.${issues.length ? `\nIssues: ${issues.join(', ')}.` : ''}${doc.notes ? `\n${doc.notes}` : ''}`,
      outcome: pctLabel,
      refs: { auditId: res.insertedId.toString() },
    }, actor, 'audit')
  } catch (e) { console.error('[CRM] audit → interaction failed:', (e as Error).message) }
  // Store this audit's analysis report exactly as it reads today (then vs now, history, evidence).
  try {
    const { snapshotAuditReport } = await import('./crm-reports')
    await snapshotAuditReport(db, dealership, { _id: res.insertedId, ...doc })
  } catch (e) { console.error('[CRM] audit report snapshot failed:', (e as Error).message) }
  return serializeAudit({ _id: res.insertedId, ...doc })
}

/**
 * Re-save an automated audit after its crawl results were reviewed (photos re-labelled, rules
 * applied): same audit, same date, corrected numbers. The stored report is rebuilt so emails,
 * {{reportUrl}} and PDFs show the corrected findings. The original numbers stay in the activity log.
 */
export async function reviseAudit(db: Db, dealership: any, auditId: string, body: any, session: any) {
  const actor = actorFromSession(session)
  const before = ObjectId.isValid(auditId) ? await db.collection(AUDIT_COLLECTION).findOne({ _id: new ObjectId(auditId) }) : null
  if (!before) return recordAudit(db, dealership, body, session)
  const next = buildAuditDoc({ ...body, auditedAt: before.auditedAt }, dealership._id.toString(), before.auditedBy || actor)
  const { createdAt: _c, auditedBy: _b, ...fields } = next
  const revision = { at: new Date().toISOString(), by: actor, from: { totalVehicles: before.totalVehicles, totalMissingPhotos: before.totalMissingPhotos, usedMissingPhotos: before.usedMissingPhotos } }
  await db.collection(AUDIT_COLLECTION).updateOne({ _id: before._id }, { $set: { ...fields, revisedAt: revision.at, revisedBy: actor }, $push: { revisions: revision } as any })
  if (before.totalMissingPhotos !== next.totalMissingPhotos || before.totalVehicles !== next.totalVehicles) {
    await logActivity(db, {
      dealershipId: dealership._id.toString(), type: 'audit.recorded', actor,
      message: `Inventory audit corrected after review — ${next.totalVehicles} vehicles, ${next.totalMissingPhotos} without a real photo (was ${before.totalMissingPhotos})`,
      changes: { 'Missing photos': { from: before.totalMissingPhotos, to: next.totalMissingPhotos } },
    })
  }
  try {
    const { REPORTS_COLLECTION, snapshotAuditReport } = await import('./crm-reports')
    await db.collection(REPORTS_COLLECTION).deleteOne({ auditId })
    await snapshotAuditReport(db, dealership, { ...before, ...fields })
  } catch (e) { console.error('[CRM] audit report rebuild failed:', (e as Error).message) }
  return serializeAudit({ ...before, ...fields, revisedAt: revision.at })
}

// ───────────────────────── Delete / restore an audit ─────────────────────────
const DELETIONS = 'turboCleanCrmDeletions'
const INTERACTIONS = 'turboCleanCrmInteractions'
const AUDIT_REPORTS = 'turboCleanCrmAuditReports'
const dayOf = (iso: unknown) => { const d = new Date(String(iso || '')); return Number.isNaN(d.getTime()) ? 'unknown date' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) }
/** The dealership's "last audit" date follows the audits that are left. */
async function refreshLastAudit(db: Db, dealershipId: string) {
  if (!ObjectId.isValid(dealershipId)) return
  const left = await db.collection(AUDIT_COLLECTION).find({ dealershipId }, { projection: { auditedAt: 1 } }).sort({ auditedAt: -1 }).limit(1).toArray()
  await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: new ObjectId(dealershipId) }, { $set: { lastAuditAt: left[0]?.auditedAt || null, updatedAt: new Date().toISOString() } })
}

/**
 * Delete one audit (a wrong crawl, a test). Goes with it: its stored report and the "research
 * completed" entry it left in the relationship history; the crawl it came from is no longer marked
 * as saved. Emails already sent stay. A copy is kept for 30 days — `restoreAudit` puts it all back.
 */
export async function deleteAudit(db: Db, auditId: string, session: any) {
  if (!ObjectId.isValid(auditId)) throw createError({ statusCode: 400, statusMessage: 'Invalid audit' })
  const col = db.collection(AUDIT_COLLECTION)
  const audit = await col.findOne({ _id: new ObjectId(auditId) })
  if (!audit) throw createError({ statusCode: 404, statusMessage: 'Audit not found — it may already be deleted' })
  const actor = actorFromSession(session)
  const dealershipId = String(audit.dealershipId)
  const [report, interactions] = await Promise.all([
    db.collection(AUDIT_REPORTS).findOne({ auditId }),
    db.collection(INTERACTIONS).find({ 'refs.auditId': auditId }).toArray(),
  ])
  const undoToken = new ObjectId().toString()
  const now = new Date().toISOString()
  await db.collection(DELETIONS).insertOne({ kind: 'audit', undoToken, auditId, dealershipId, name: `Audit of ${dayOf(audit.auditedAt)}`, snapshot: { audit, report, interactions }, deletedAt: now, deletedBy: actor, restoredAt: null })
  await col.deleteOne({ _id: audit._id })
  await db.collection(AUDIT_REPORTS).deleteOne({ auditId })
  if (interactions.length) await db.collection(INTERACTIONS).deleteMany({ 'refs.auditId': auditId })
  // The crawl behind it can be reviewed and saved again.
  await db.collection('turboCleanScannerScans').updateMany({ auditId }, { $set: { auditId: null, status: 'done' } }).catch(() => {})
  await refreshLastAudit(db, dealershipId)
  await logActivity(db, {
    dealershipId, type: 'audit.recorded', actor,
    message: `Inventory audit of ${dayOf(audit.auditedAt)} deleted — it showed ${audit.totalMissingPhotos ?? 0} of ${audit.totalVehicles ?? 0} vehicles without a photo`,
    changes: { 'Missing photos': { from: audit.totalMissingPhotos ?? null, to: null } },
  }).catch(() => {})
  return { ok: true, undoToken, auditedAt: audit.auditedAt, remaining: await col.countDocuments({ dealershipId }) }
}

/** Put a deleted audit back (with its report and history entry). */
export async function restoreAudit(db: Db, undoToken: string, session: any) {
  const del = await db.collection(DELETIONS).findOne({ kind: 'audit', undoToken: String(undoToken || ''), restoredAt: null })
  if (!del?.snapshot?.audit) throw createError({ statusCode: 404, statusMessage: 'Nothing to restore' })
  const { audit, report, interactions } = del.snapshot
  const col = db.collection(AUDIT_COLLECTION)
  if (!(await col.findOne({ _id: audit._id }))) await col.insertOne(audit)
  if (report && !(await db.collection(AUDIT_REPORTS).findOne({ auditId: del.auditId }))) await db.collection(AUDIT_REPORTS).insertOne(report)
  for (const i of interactions || []) if (!(await db.collection(INTERACTIONS).findOne({ _id: i._id }))) await db.collection(INTERACTIONS).insertOne(i)
  await db.collection(DELETIONS).updateOne({ _id: del._id }, { $set: { restoredAt: new Date().toISOString(), restoredBy: actorFromSession(session) } })
  await refreshLastAudit(db, String(del.dealershipId))
  await logActivity(db, { dealershipId: String(del.dealershipId), type: 'audit.recorded', actor: actorFromSession(session), message: `Inventory audit of ${dayOf(audit.auditedAt)} restored` }).catch(() => {})
  return { ok: true, audit: serializeAudit(audit) }
}
