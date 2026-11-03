/**
 * Lost deal tracking — "after hundreds of dealerships, see exactly why we lose".
 *
 * Every move into Lost requires a standard reason (+ optional notes; competitor name for "Competitor").
 * Each loss is also appended to `turboCleanCrmLostDeals` — an immutable log with the context needed
 * for analysis (stage it was lost at, owner, lead source, region, days in pipeline, last email template…).
 * If the dealership is later reopened the record is kept and stamped `reopenedAt`.
 */
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import { CRM_COLLECTIONS, OPEN_STAGE_ORDER, str } from './crm'
import type { SessionActor } from './crm'

export const LOST_COLLECTION = 'turboCleanCrmLostDeals'
export const LOST_REASONS = [
  'Happy with current vendor',
  'Doing it in-house',
  'Price',
  'No current need',
  'Bad timing',
  'Corporate/group decision',
  'Existing vendor relationship',
  'Competitor',
  'No response',
  'Service-area issue',
  'Quality concern',
  'Other',
] as const
export const UNRECORDED = 'Not recorded'
/** Reasons typed before the standard list existed. */
const LEGACY: Record<string, string> = {
  'went with competitor': 'Competitor', 'in-house team': 'Doing it in-house', 'no decision / went dark': 'No response',
  'not a fit': 'Other', 'price': 'Price', 'bad timing': 'Bad timing',
}
export function normalizeLostReason(v: unknown): string {
  const s = str(v, 120)
  if (!s) return ''
  const hit = LOST_REASONS.find(r => r.toLowerCase() === s.toLowerCase())
  return hit || LEGACY[s.toLowerCase()] || ''
}

/** Validates the lost fields in a request body. Returns what to store, or throws a 400. */
export function parseLostInput(body: any, opts: { required: boolean }) {
  const raw = body?.lostReason
  const reason = normalizeLostReason(raw)
  if (raw && !reason) throw createError({ statusCode: 400, statusMessage: `Unknown lost reason "${raw}"` })
  if (opts.required && !reason) throw createError({ statusCode: 400, statusMessage: 'Choose why this dealership was lost' })
  const notes = str(body?.lostNotes ?? '', 2000)
  if (reason === 'Other' && !notes) throw createError({ statusCode: 400, statusMessage: 'Add a note explaining the “Other” reason' })
  return { reason, notes, competitor: reason === 'Competitor' ? str(body?.lostCompetitor, 120) : '' }
}

const daysBetween = (a?: string | null, b?: string | null) => (a && b) ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)) : null

/** Append the loss to the log (called from recordStageChange when a dealership enters Lost). */
export async function recordLoss(db: Db, dealershipId: string, fromStage: string | null, actor: SessionActor | null, at: Date) {
  if (!ObjectId.isValid(dealershipId)) return
  const d = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: new ObjectId(dealershipId) })
  if (!d) return
  const [history, lastEmail, meetings] = await Promise.all([
    db.collection(CRM_COLLECTIONS.stageHistory).find({ dealershipId }).sort({ changedAt: 1 }).toArray(),
    db.collection('turboCleanCrmEmails').find({ dealershipId, direction: 'outbound', status: { $ne: 'failed' } }).sort({ sentAt: -1 }).limit(1).next(),
    db.collection('turboCleanCrmInteractions').countDocuments({ dealershipId, voidedAt: null, type: { $in: ['meeting_scheduled', 'meeting_completed'] } }),
  ])
  const furthest = history.reduce((m, h) => Math.max(m, OPEN_STAGE_ORDER.indexOf(h.toStage)), -1)
  const start = history[0]?.changedAt || d.createdAt
  const lostAt = at.toISOString()
  await db.collection(LOST_COLLECTION).insertOne({
    schemaVersion: 1,
    dealershipId, dealershipCode: d.dealershipId || '', dealershipName: d.name || '',
    reason: d.lostReason || UNRECORDED, notes: d.lostNotes || '', competitor: d.lostCompetitor || '',
    fromStage: fromStage || '', furthestStage: furthest >= 0 ? OPEN_STAGE_ORDER[furthest] : (fromStage || ''),
    hadMeeting: meetings > 0 || furthest >= OPEN_STAGE_ORDER.indexOf('Meeting Scheduled'),
    lostAt, lostBy: actor ? { id: actor.id, name: actor.name, email: actor.email } : { id: 'system', name: 'System', email: '' },
    ownerId: d.assignedUserId || '', ownerName: d.assignedUserName || '',
    leadSource: d.leadSource || '', dealerGroup: d.dealerGroup || '', brands: d.brands || [], state: d.state || '', city: d.city || '', territory: d.territory || '',
    daysInPipeline: daysBetween(start, lostAt),
    lastEmail: lastEmail ? { templateId: lastEmail.templateId || null, templateName: lastEmail.templateName || '', version: lastEmail.templateVersionLabel || '', campaignName: lastEmail.campaignName || '' } : null,
    revisitDate: d.revisitDate || null,
    reopenedAt: null as string | null, reopenedBy: null as any,
    createdAt: new Date().toISOString(),
  })
}

/** Called when a dealership leaves Lost: keep the record, mark it reopened. */
export async function markReopened(db: Db, dealershipId: string, actor: SessionActor | null, at: Date) {
  await db.collection(LOST_COLLECTION).updateMany({ dealershipId, reopenedAt: null }, { $set: {
    reopenedAt: at.toISOString(), reopenedBy: actor ? { id: actor.id, name: actor.name, email: actor.email } : { id: 'system', name: 'System', email: '' },
  } })
}

/** Correct the reason on an existing loss (e.g. legacy "Not recorded" ones). Keeps dealership + log in sync. */
export async function updateLossReason(db: Db, lossId: string, body: any, actor: SessionActor | null) {
  if (!ObjectId.isValid(lossId)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  const loss = await db.collection(LOST_COLLECTION).findOne({ _id: new ObjectId(lossId) })
  if (!loss) throw createError({ statusCode: 404, statusMessage: 'Lost deal not found' })
  const p = parseLostInput(body, { required: true })
  const now = new Date().toISOString()
  await db.collection(LOST_COLLECTION).updateOne({ _id: loss._id }, { $set: { reason: p.reason, notes: p.notes, competitor: p.competitor, editedAt: now, editedBy: actor ? { id: actor.id, name: actor.name } : null } })
  if (!loss.reopenedAt && ObjectId.isValid(loss.dealershipId))
    await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: new ObjectId(loss.dealershipId), stage: 'Lost' }, { $set: { lostReason: p.reason, lostNotes: p.notes, lostCompetitor: p.competitor, updatedAt: now } })
  return { ...loss, id: loss._id.toString(), _id: undefined, reason: p.reason, notes: p.notes, competitor: p.competitor }
}

/** Reason edited on a dealership that is already Lost: mirror it onto its open loss record (if it has one). */
export async function syncOpenLoss(db: Db, dealershipId: string, d: any, actor: SessionActor | null) {
  const col = db.collection(LOST_COLLECTION)
  const open = await col.find({ dealershipId, reopenedAt: null }).sort({ lostAt: -1 }).limit(1).next()
  if (!open) return
  await col.updateOne({ _id: open._id }, { $set: {
    reason: normalizeLostReason(d.lostReason) || UNRECORDED, notes: d.lostNotes || '', competitor: d.lostCompetitor || '',
    editedAt: new Date().toISOString(), editedBy: actor ? { id: actor.id, name: actor.name } : null,
  } })
}

/**
 * Lost-deal analysis. Includes dealerships sitting in Lost from before the log existed
 * (reason "Not recorded" when they never got one) so nothing is hidden.
 */
export async function lostReport(db: Db, q: { from?: string, to?: string, ownerId?: string, stage?: string, includeReopened?: boolean }) {
  const col = db.collection(LOST_COLLECTION)
  const match: any = {}
  if (q.from || q.to) match.lostAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: `${q.to}T23:59:59.999Z` } : {}) }
  if (q.ownerId) match.ownerId = q.ownerId
  if (q.stage) match.fromStage = q.stage
  if (!q.includeReopened) match.reopenedAt = null
  const logged = await col.find(match).sort({ lostAt: -1 }).toArray()

  // Legacy: currently Lost, no log entry.
  const loggedIds = new Set((await col.find({ reopenedAt: null }, { projection: { dealershipId: 1 } }).toArray()).map(l => String(l.dealershipId)))
  const legacyDocs = await db.collection(CRM_COLLECTIONS.dealerships).find({ stage: 'Lost', archivedAt: null }).toArray()
  const legacy = legacyDocs.filter(d => !loggedIds.has(d._id.toString())).map(d => ({
    _id: null, legacy: true, dealershipId: d._id.toString(), dealershipCode: d.dealershipId || '', dealershipName: d.name || '',
    reason: normalizeLostReason(d.lostReason) || UNRECORDED, notes: d.lostNotes || d.parkedNote || '', competitor: d.lostCompetitor || '',
    fromStage: '', furthestStage: '', hadMeeting: false, lostAt: d.parkedAt || d.stageChangedAt || d.updatedAt, lostBy: null,
    ownerId: d.assignedUserId || '', ownerName: d.assignedUserName || '', leadSource: d.leadSource || '', dealerGroup: d.dealerGroup || '', brands: d.brands || [],
    state: d.state || '', city: d.city || '', territory: d.territory || '', daysInPipeline: null, lastEmail: null, revisitDate: d.revisitDate || null, reopenedAt: null,
  })).filter(l => (!q.ownerId || l.ownerId === q.ownerId) && !q.stage && (!q.from || (l.lostAt || '') >= q.from) && (!q.to || (l.lostAt || '') <= `${q.to}T23:59:59.999Z`))

  const all = [...logged, ...legacy] as any[]
  const total = all.length
  const pct = (n: number) => total ? Math.round((n / total) * 1000) / 10 : 0
  const group = (key: (l: any) => string) => {
    const m = new Map<string, any[]>()
    for (const l of all) { const k = key(l) || '—'; m.set(k, [...(m.get(k) || []), l]) }
    return m
  }
  const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null

  const byReason = [...LOST_REASONS, UNRECORDED].map((reason) => {
    const list = all.filter(l => l.reason === reason)
    return { reason, count: list.length, pct: pct(list.length), afterMeeting: list.filter(l => l.hadMeeting).length, avgDaysInPipeline: avg(list.map(l => l.daysInPipeline).filter((x: any) => x != null)) }
  }).filter(r => r.count || r.reason !== UNRECORDED).sort((a, b) => b.count - a.count)

  const reasonCounts = (list: any[]): Record<string, number> => Object.fromEntries([...LOST_REASONS, UNRECORDED].map(r => [r, list.filter(l => l.reason === r).length]).filter(([, n]) => n))
  const breakdown = (key: (l: any) => string, order?: readonly string[]) => {
    const m = group(key)
    const rows = [...m.entries()].map(([k, list]) => ({ key: k, count: list.length, pct: pct(list.length), reasons: reasonCounts(list), top: Object.entries(reasonCounts(list)).sort((a, b) => (b[1] as number) - (a[1] as number))[0]?.[0] || '' }))
    return order ? rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : rows.sort((a, b) => b.count - a.count)
  }
  const competitors = [...group(l => l.reason === 'Competitor' ? (l.competitor || 'Unnamed competitor') : '').entries()]
    .filter(([k]) => k !== '—').map(([name, list]) => ({ name, count: list.length })).sort((a, b) => b.count - a.count)
  const byMonth = breakdown(l => (l.lostAt || '').slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key))

  return {
    total, reasons: LOST_REASONS, unrecorded: all.filter(l => l.reason === UNRECORDED).length,
    afterMeeting: all.filter(l => l.hadMeeting).length,
    reopened: q.includeReopened ? logged.filter(l => l.reopenedAt).length : await col.countDocuments({ ...match, reopenedAt: { $ne: null } }),
    byReason,
    byStage: breakdown(l => l.fromStage || (l.legacy ? 'Unknown (before tracking)' : '—'), [...OPEN_STAGE_ORDER, 'Nurture / Follow Up Later', 'Unknown (before tracking)', '—']),
    byOwner: breakdown(l => l.ownerName || 'Unassigned'),
    byLeadSource: breakdown(l => l.leadSource || '—'),
    byState: breakdown(l => l.state || '—'),
    byGroup: breakdown(l => l.dealerGroup || 'Independent'),
    byMonth,
    competitors,
    deals: all.slice(0, 1000).map(l => ({ ...l, id: l._id ? l._id.toString() : null, _id: undefined })),
  }
}
