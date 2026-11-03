/**
 * CRM sales pipeline — stage history.
 *
 * Every time a dealership changes stage we append one immutable document to
 * `turboCleanCrmStageHistory` recording the previous stage, the new stage,
 * the exact moment (plus a human date + time) and the user who did it.
 * Nothing here is ever updated or deleted, so we can always answer
 * "how long did this prospect sit in each stage?" and "how long did it take
 * to close?".
 *
 * Doc shape (schemaVersion 1)
 *  dealershipId        Mongo _id (string) of the CRM dealership
 *  dealershipCode      DLR-00001
 *  dealershipName
 *  fromStage           previous stage (null for the very first entry)
 *  toStage             new stage
 *  changedAt           ISO timestamp (source of truth)
 *  date / time         YYYY-MM-DD / HH:mm in CRM_TIMEZONE (for exports & humans)
 *  timeZone
 *  user                { id, name, email } — "System" for automated changes
 *  source              create | manual | bulk | convert | revert | backfill | migration | api
 *  previousStageEnteredAt / durationInPreviousStageMs
 */
import type { Db } from 'mongodb'
import { CRM_COLLECTIONS, DEALERSHIP_STAGES, LEGACY_STAGE_MAP, WON_STAGE, logActivity, normalizeStage } from './crm'
import type { SessionActor } from './crm'

export const CRM_TIMEZONE = process.env.CRM_TIMEZONE || 'America/New_York'
export type StageChangeSource = 'create' | 'manual' | 'bulk' | 'convert' | 'revert' | 'backfill' | 'migration' | 'api' | 'interaction' | 'email' | 'automation'

const DAY = 86_400_000

function zonedParts(d: Date, timeZone = CRM_TIMEZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(p => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

function actorOrSystem(actor: SessionActor | null | undefined) {
  return actor ? { id: actor.id, name: actor.name, email: actor.email } : { id: 'system', name: 'System', email: '' }
}

/** Appends a stage-change entry and stamps `stageChangedAt/By` on the dealership. No-op if from === to. */
export async function recordStageChange(db: Db, entry: {
  dealership: any
  fromStage: string | null
  toStage: string
  actor: SessionActor | null
  source: StageChangeSource
  at?: Date
  note?: string
  /** Skip stamping the dealership doc (used by backfills). */
  stampDealership?: boolean
}) {
  if (entry.fromStage === entry.toStage) return null
  const at = entry.at ?? new Date()
  const dealershipId = entry.dealership._id.toString()
  const col = db.collection(CRM_COLLECTIONS.stageHistory)

  const prev = await col.find({ dealershipId, changedAt: { $lte: at.toISOString() } }).sort({ changedAt: -1 }).limit(1).next()
  const enteredAt = prev?.changedAt || entry.dealership.stageChangedAt || entry.dealership.createdAt || null
  const duration = entry.fromStage && enteredAt ? Math.max(0, at.getTime() - new Date(enteredAt).getTime()) : null

  const user = actorOrSystem(entry.actor)
  const doc = {
    schemaVersion: 1,
    dealershipId,
    dealershipCode: entry.dealership.dealershipId || '',
    dealershipName: entry.dealership.name || '',
    fromStage: entry.fromStage,
    toStage: entry.toStage,
    changedAt: at.toISOString(),
    ...zonedParts(at),
    timeZone: CRM_TIMEZONE,
    user,
    source: entry.source,
    previousStageEnteredAt: entry.fromStage ? enteredAt : null,
    durationInPreviousStageMs: duration,
    note: entry.note || '',
  }
  await col.insertOne(doc)
  // Lost-deal log: every entry into Lost is recorded with its reason; reopening keeps the record.
  if (entry.source !== 'backfill' && entry.source !== 'migration') {
    const { recordLoss, markReopened } = await import('./crm-lost')
    if (entry.toStage === 'Lost') await recordLoss(db, dealershipId, entry.fromStage, entry.actor, at)
    else if (entry.fromStage === 'Lost') await markReopened(db, dealershipId, entry.actor, at)
    // Won-deal log: a win that is undone (dealer deleted, stage moved back) is kept but marked reverted.
    if (entry.fromStage === WON_STAGE && entry.toStage !== WON_STAGE) {
      const { markWinReverted } = await import('./crm-won')
      await markWinReverted(db, dealershipId, at)
    }
  }
  // Credit the email that led here (replies → conversation → meeting → proposal → won).
  if (entry.source !== 'backfill' && entry.source !== 'migration' && entry.source !== 'revert') {
    const { attributeOutcome } = await import('./crm-email')
    await attributeOutcome(db, dealershipId, { stage: entry.toStage }, at)
  }
  if (entry.stampDealership !== false) {
    await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: entry.dealership._id }, {
      $set: { stageChangedAt: doc.changedAt, stageChangedBy: user },
    })
  }
  return doc
}

/**
 * Move a live dealership to another stage (not Won — that goes through conversion)
 * and record it everywhere: dealership doc, stage history and the activity log.
 */
export async function moveStage(db: Db, dealership: any, toStage: string, actor: SessionActor | null, source: StageChangeSource, note = '', extra: Record<string, any> = {}) {
  const to = normalizeStage(toStage)
  if (!DEALERSHIP_STAGES.includes(to as any)) throw createError({ statusCode: 400, statusMessage: 'Unknown stage' })
  if (to === WON_STAGE) throw createError({ statusCode: 400, statusMessage: 'Use the conversion flow to mark a dealership as won' })
  if (dealership.dealerId) throw createError({ statusCode: 409, statusMessage: 'This dealership is won and lives in Dealers' })
  if (dealership.stage === to) return false
  const now = new Date().toISOString()
  const { applyParkingFields } = await import('./crm-followups')
  const $set: Record<string, any> = { stage: to, updatedAt: now }
  applyParkingFields($set, extra, dealership)
  await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: dealership._id }, { $set })
  await recordStageChange(db, { dealership, fromStage: dealership.stage, toStage: to, actor, source, note })
  await logActivity(db, { dealershipId: dealership._id.toString(), type: 'dealership.updated', actor, message: `Stage moved to ${to}${note ? ` — ${note}` : ''}`, changes: { stage: { from: dealership.stage, to } } })
  return true
}

export function serializeStageEntry(doc: any) {
  const { _id, ...rest } = doc
  return { id: _id.toString(), ...rest }
}

export async function listStageHistory(db: Db, dealershipId: string) {
  const rows = await db.collection(CRM_COLLECTIONS.stageHistory).find({ dealershipId }).sort({ changedAt: 1 }).toArray()
  return rows.map(serializeStageEntry)
}

/** Total time spent in each stage for one dealership (current stint counted up to now). */
export function stageDurations(history: { toStage: string, changedAt: string }[], now = Date.now()) {
  const out: Record<string, { totalMs: number, stints: number, current: boolean }> = {}
  history.forEach((h, i) => {
    const start = new Date(h.changedAt).getTime()
    const end = i + 1 < history.length ? new Date(history[i + 1]!.changedAt).getTime() : now
    const s = (out[h.toStage] ||= { totalMs: 0, stints: 0, current: false })
    s.totalMs += Math.max(0, end - start)
    s.stints += 1
    if (i === history.length - 1) s.current = true
  })
  return out
}

function avg(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null }
function median(xs: number[]) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const days = (ms: number | null) => ms == null ? null : Math.round((ms / DAY) * 100) / 100

/**
 * Pipeline velocity report.
 *  - per stage: how many are in it now, how long they've been there, and how long
 *    completed stints lasted (avg / median / max days)
 *  - time to close: first pipeline entry → Won (and → Lost)
 */
export async function pipelineReport(db: Db, stages: readonly string[], opts: { assignedUserId?: string } = {}) {
  const now = Date.now()
  const filter: any = { archivedAt: null }
  if (opts.assignedUserId) filter.assignedUserId = opts.assignedUserId
  const dealerships = await db.collection(CRM_COLLECTIONS.dealerships)
    .find(filter, { projection: { dealershipId: 1, name: 1, stage: 1, stageChangedAt: 1, createdAt: 1, assignedUserName: 1, convertedAt: 1 } }).toArray()
  const ids = dealerships.map(d => d._id.toString())
  const history = await db.collection(CRM_COLLECTIONS.stageHistory).find({ dealershipId: { $in: ids } }).sort({ changedAt: 1 }).toArray()
  const byDealership = new Map<string, any[]>()
  for (const h of history) {
    const list = byDealership.get(h.dealershipId) || []
    list.push(h)
    byDealership.set(h.dealershipId, list)
  }

  const completed: Record<string, number[]> = {}
  const current: Record<string, number[]> = {}
  const closes: { won: any[], lost: any[] } = { won: [], lost: [] }

  for (const d of dealerships) {
    const id = d._id.toString()
    const hist = byDealership.get(id) || []
    hist.forEach((h, i) => {
      const start = new Date(h.changedAt).getTime()
      if (i + 1 < hist.length) (completed[h.toStage] ||= []).push(new Date(hist[i + 1].changedAt).getTime() - start)
    })
    const enteredAt = new Date(d.stageChangedAt || hist.at(-1)?.changedAt || d.createdAt || now).getTime()
    ;(current[d.stage] ||= []).push(now - enteredAt)

    const startAt = hist[0]?.changedAt || d.createdAt
    for (const kind of ['won', 'lost'] as const) {
      const target = kind === 'won' ? 'Won' : 'Lost'
      const hit = [...hist].reverse().find(h => h.toStage === target)
      if (hit && d.stage === target && startAt) {
        closes[kind].push({
          id, dealershipId: d.dealershipId, name: d.name, assignedUserName: d.assignedUserName || '',
          startedAt: startAt, closedAt: hit.changedAt, closedBy: hit.user?.name || '',
          days: days(new Date(hit.changedAt).getTime() - new Date(startAt).getTime()),
          stageChanges: hist.length - 1,
        })
      }
    }
  }

  const stageRows = stages.map(stage => {
    const done = completed[stage] || []
    const now_ = current[stage] || []
    return {
      stage,
      currentCount: now_.length,
      currentAvgDays: days(avg(now_)),
      currentMaxDays: days(now_.length ? Math.max(...now_) : null),
      completedCount: done.length,
      avgDays: days(avg(done)),
      medianDays: days(median(done)),
      maxDays: days(done.length ? Math.max(...done) : null),
    }
  })

  const summarize = (rows: any[]) => {
    const ds = rows.map(r => r.days as number)
    return { count: rows.length, avgDays: avg(ds) == null ? null : Math.round(avg(ds)! * 100) / 100, medianDays: median(ds), minDays: ds.length ? Math.min(...ds) : null, maxDays: ds.length ? Math.max(...ds) : null }
  }
  closes.won.sort((a, b) => b.closedAt.localeCompare(a.closedAt))
  closes.lost.sort((a, b) => b.closedAt.localeCompare(a.closedAt))

  return {
    generatedAt: new Date(now).toISOString(),
    totalDealerships: dealerships.length,
    stages: stageRows,
    timeToClose: { won: summarize(closes.won), lost: summarize(closes.lost) },
    recentWins: closes.won.slice(0, 25),
    recentLosses: closes.lost.slice(0, 25),
  }
}

/**
 * One-time move from the original 4 stages to the 14-stage pipeline, and a
 * backfill of stage history from the activity log for dealerships that pre-date it.
 * Guarded by `turboCleanCounters._id = 'crmPipelineV2'`.
 */
export async function migrateToPipeline(db: Db) {
  const counters = db.collection(CRM_COLLECTIONS.counters)
  const flag = await counters.findOne({ _id: 'crmPipelineV2' as any })
  if (flag?.done) return
  // Claim the migration so concurrent workers don't double-run it.
  const claim = await counters.updateOne({ _id: 'crmPipelineV2' as any, startedAt: { $exists: false } }, { $set: { startedAt: new Date().toISOString() } }, { upsert: true }).catch(() => null)
  if (!claim || (!claim.upsertedCount && !claim.modifiedCount)) return

  const dealerships = db.collection(CRM_COLLECTIONS.dealerships)
  const activity = db.collection(CRM_COLLECTIONS.activity)
  const historyCol = db.collection(CRM_COLLECTIONS.stageHistory)
  let migrated = 0, backfilled = 0

  for await (const d of dealerships.find({})) {
    const id = d._id.toString()
    const newStage = normalizeStage(d.stage)
    const $set: any = {}
    if (newStage !== d.stage) $set.stage = newStage
    if (d.stageBeforeConversion && LEGACY_STAGE_MAP[d.stageBeforeConversion]) $set.stageBeforeConversion = LEGACY_STAGE_MAP[d.stageBeforeConversion]

    if (!(await historyCol.findOne({ dealershipId: id }))) {
      // Rebuild the path from the activity timeline's stage diffs.
      const changes = await activity.find({ dealershipId: id, 'changes.stage': { $exists: true } }).sort({ at: 1 }).toArray()
      const firstStage = normalizeStage(changes[0]?.changes?.stage?.from ?? d.stage)
      const base = { dealership: { ...d, stage: newStage }, stampDealership: false }
      await recordStageChange(db, { ...base, fromStage: null, toStage: firstStage, actor: d.createdBy || null, source: 'backfill', at: new Date(d.createdAt || Date.now()), note: 'Backfilled from record creation' })
      let last = firstStage
      for (const c of changes) {
        const to = normalizeStage(c.changes.stage.to)
        if (to === last) continue
        await recordStageChange(db, { ...base, fromStage: last, toStage: to, actor: c.actor?.id === 'system' ? null : c.actor, source: 'backfill', at: new Date(c.at), note: 'Backfilled from activity log' })
        last = to
      }
      if (last !== newStage) {
        await recordStageChange(db, { ...base, fromStage: last, toStage: newStage, actor: null, source: 'migration', note: 'Pipeline upgrade' })
      }
      const tail = await historyCol.find({ dealershipId: id }).sort({ changedAt: -1 }).limit(1).next()
      $set.stageChangedAt = tail?.changedAt || d.createdAt
      $set.stageChangedBy = tail?.user || null
      backfilled++
    }
    if (Object.keys($set).length) { await dealerships.updateOne({ _id: d._id }, { $set }); migrated++ }
  }
  await counters.updateOne({ _id: 'crmPipelineV2' as any }, { $set: { done: true, finishedAt: new Date().toISOString(), migrated, backfilled } })
  console.log(`[CRM] pipeline migration: ${migrated} dealerships updated, ${backfilled} histories backfilled`)
}
