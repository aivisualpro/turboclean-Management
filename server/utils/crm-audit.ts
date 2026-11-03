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
    ? body.examples.map((e: any) => ({ url: str(e?.url, 1000), label: str(e?.label, 200) })).filter((e: any) => e.url).slice(0, 50)
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
  return serializeAudit({ _id: res.insertedId, ...doc })
}
