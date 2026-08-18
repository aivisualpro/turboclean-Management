/**
 * Reliable AppSheet sync with a MongoDB-backed outbox.
 *
 * Why: pushes to AppSheet used to be fire-and-forget — if AppSheet was slow,
 * down, or the row was missing there, the change was lost with only a console
 * log. This module makes every sync at-least-once AND last-write-wins:
 *
 *   1. One outbox entry is written PER ROW to `turboCleanSyncOutbox` BEFORE
 *      pushing (write-ahead), so even a server restart mid-push can't lose it.
 *   2. Enqueueing a new change for a row SUPERSEDES older pending entries for
 *      the same row, and the drainer re-checks before every replay — a stale
 *      retry can never overwrite newer data or resurrect a deleted row.
 *   3. An immediate push is attempted with a short timeout so API responses
 *      stay fast. On success the entries are marked done.
 *   4. If the push fails, entries stay `pending` and the background retrier
 *      (server/plugins/appsheet-outbox.ts) retries with exponential backoff
 *      until they land (or go `dead` after MAX_ATTEMPTS / a permanent error).
 *
 * Replays are safe: every AppSheet table keys on `_id`, so Add/Edit/Delete
 * are idempotent, and Edits are replayed as Upserts (Edit + Add-if-missing).
 */

import type { Db } from 'mongodb'
import { appSheetUpsert, callAppSheetDetailed } from './appsheet'

export const OUTBOX_COLLECTION = 'turboCleanSyncOutbox'

export type OutboxAction = 'Add' | 'Edit' | 'Delete' | 'Upsert'

export interface SyncOutcome {
  /** true = the change is in AppSheet right now */
  ok: boolean
  /** true = not synced yet, but safely queued for automatic background retry */
  queued: boolean
  error?: string
}

const MAX_ATTEMPTS = 10
/** New entries only become visible to the retrier after this grace period,
 *  so the background drain never races the in-flight immediate push. */
const FIRST_RETRY_GRACE_MS = 90_000
const DEFAULT_PROPERTIES = { Locale: 'en-US', Timezone: 'UTC' }

function backoffMs(attempts: number): number {
  // 1m, 2m, 4m, 8m ... capped at 1h
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 60 * 60_000)
}

/**
 * Execute one push against AppSheet. `addRows` (aligned with `rows` for
 * Upsert) supplies the complete row to use when a missing row must be Added —
 * this lets callers Edit only the changed columns without ever clobbering
 * other columns, while still self-healing rows AppSheet doesn't have.
 * Never throws.
 */
export async function attemptOutboxPush(
  table: string,
  action: OutboxAction,
  rows: Record<string, any>[],
  opts: { maxRetries?: number, timeoutMs?: number } = {},
  addRows?: (Record<string, any> | null | undefined)[],
): Promise<{ ok: boolean, error?: string, retriable: boolean }> {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true, retriable: false }

  try {
    if (action === 'Edit' || action === 'Upsert') {
      const addRowsById: Record<string, Record<string, any>> = {}
      if (Array.isArray(addRows)) {
        rows.forEach((r, i) => {
          const key = String(r?._id ?? '')
          if (key && addRows[i]) addRowsById[key] = addRows[i] as Record<string, any>
        })
      }
      // Replay edits as upserts so rows that never made it to AppSheet get created
      const res = await appSheetUpsert(table, rows, opts, addRowsById)
      return { ok: res.ok, error: res.error, retriable: res.retriable }
    }

    if (action === 'Add') {
      const res = await callAppSheetDetailed(table, {
        Action: 'Add',
        Properties: DEFAULT_PROPERTIES,
        Rows: rows,
      }, opts)
      // Keyed add of a row that's already there = the data IS in AppSheet
      if (!res.ok && !res.retriable && /already\s*exists|duplicate/i.test(res.error || '')) {
        return { ok: true, retriable: false }
      }
      return { ok: res.ok, error: res.error, retriable: res.retriable }
    }

    // Delete
    const res = await callAppSheetDetailed(table, {
      Action: 'Delete',
      Properties: DEFAULT_PROPERTIES,
      Rows: rows,
    }, opts)
    // Already gone = deletion achieved
    if (!res.ok && (res.status === 404 || (!res.retriable && /not\s*found|does not exist/i.test(res.error || '')))) {
      return { ok: true, retriable: false }
    }
    return { ok: res.ok, error: res.error, retriable: res.retriable }
  }
  catch (err: any) {
    return { ok: false, error: err?.message || String(err), retriable: true }
  }
}

// ── Opportunistic drain: piggyback on traffic so queued entries also get
//    retried in environments where long-lived timers don't fire reliably ──
let _lastKickAt = 0
let _kickRunning = false
function maybeKickDrain(db: Db) {
  const now = Date.now()
  if (_kickRunning || now - _lastKickAt < 60_000) return
  _lastKickAt = now
  _kickRunning = true
  drainOutbox(db)
    .catch(() => {})
    .finally(() => { _kickRunning = false })
}

/**
 * Sync rows to AppSheet reliably. Returns what actually happened so API
 * handlers can tell the UI (synced now vs queued for retry vs failed).
 *
 * `opts.addRows` (only for Upsert): full rows, aligned by index with `rows`,
 * used when a row is missing in AppSheet and must be Added.
 */
export async function syncToAppSheet(
  db: Db,
  table: string,
  action: OutboxAction,
  rows: Record<string, any>[],
  opts: { immediate?: boolean, addRows?: (Record<string, any> | null | undefined)[] } = {},
): Promise<SyncOutcome> {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true, queued: false }

  const outbox = db.collection(OUTBOX_COLLECTION)
  const now = new Date()

  // 1. Write-ahead: one entry per row, recorded before trying
  const docs = rows.map((row, i) => ({
    table,
    action,
    rowKey: String(row?._id ?? ''),
    row,
    addRow: (opts.addRows && opts.addRows[i]) || null,
    status: 'pending',
    attempts: 0,
    lastError: null as string | null,
    createdAt: now,
    nextAttemptAt: new Date(now.getTime() + FIRST_RETRY_GRACE_MS),
  }))

  let entryIds: any[] = []
  try {
    const ins = await outbox.insertMany(docs as any[])
    entryIds = Object.values(ins.insertedIds)
  }
  catch (e: any) {
    console.error('[Sync] Could not write outbox entries (will still push directly):', e?.message)
  }

  // 2. Last-write-wins: a newer change for the same row supersedes any older
  //    pending entry, so a delayed retry can never overwrite fresher data.
  //    (createdAt < now keeps two concurrent enqueues from superseding each other.)
  const rowKeys = docs.map(d => d.rowKey).filter(Boolean)
  if (entryIds.length > 0 && rowKeys.length > 0) {
    try {
      await outbox.updateMany(
        {
          table,
          status: 'pending',
          rowKey: { $in: rowKeys },
          createdAt: { $lt: now },
          _id: { $nin: entryIds },
        },
        { $set: { status: 'superseded', supersededAt: new Date() } },
      )
    }
    catch (e: any) {
      console.error('[Sync] Failed to supersede older outbox entries:', e?.message)
    }
  }

  // Retry anything that's already due (non-blocking)
  maybeKickDrain(db)

  if (opts.immediate === false) {
    return { ok: false, queued: entryIds.length > 0 }
  }

  // 3. Immediate attempt — single pass with a short timeout to keep saves snappy
  const result = await attemptOutboxPush(table, action, rows, { maxRetries: 1, timeoutMs: 15_000 }, opts.addRows)

  if (result.ok) {
    if (entryIds.length > 0) {
      await outbox.updateMany(
        { _id: { $in: entryIds } },
        { $set: { status: 'done', doneAt: new Date(), attempts: 1 } },
      ).catch(() => {})
    }
    return { ok: true, queued: false }
  }

  // 4. Failed now → leave it for the background retrier
  console.error(`[Sync] Immediate ${action} → AppSheet/${table} failed: ${result.error}. ${entryIds.length > 0 ? 'Queued for background retry.' : 'WARNING: outbox write also failed — this change will NOT be retried.'}`)

  if (entryIds.length > 0) {
    await outbox.updateMany(
      { _id: { $in: entryIds }, status: 'pending' },
      {
        $set: {
          attempts: 1,
          lastError: result.error || 'unknown error',
          nextAttemptAt: new Date(Date.now() + backoffMs(1)),
          ...(result.retriable ? {} : { status: 'dead' }),
        },
      },
    ).catch(() => {})
  }

  return {
    ok: false,
    queued: entryIds.length > 0 && result.retriable,
    error: result.error,
  }
}

/**
 * Combine several sync outcomes into one summary for API responses.
 */
export function combineSyncOutcomes(outcomes: SyncOutcome[]): SyncOutcome {
  if (!outcomes.length) return { ok: true, queued: false }
  return {
    ok: outcomes.every(o => o.ok),
    queued: outcomes.some(o => o.queued),
    error: outcomes.find(o => o.error)?.error,
  }
}

/**
 * Process due outbox entries. Called by the background retrier plugin and
 * safe to call concurrently (entries are claimed before sending, and every
 * status write is guarded so it can't clobber a concurrent outcome).
 */
export async function drainOutbox(db: Db, opts: { limit?: number } = {}): Promise<{ processed: number, succeeded: number }> {
  const outbox = db.collection(OUTBOX_COLLECTION)
  const now = new Date()
  const staleProcessing = new Date(Date.now() - 10 * 60_000)

  const batch = await outbox
    .find({
      $or: [
        { status: 'pending', nextAttemptAt: { $lte: now } },
        // Recover entries stuck in 'processing' (server restarted mid-push)
        { status: 'processing', processingAt: { $lte: staleProcessing } },
      ],
    })
    .sort({ createdAt: 1 })
    .limit(opts.limit ?? 25)
    .toArray()

  let succeeded = 0

  for (const entry of batch) {
    // Skip if a newer change to the same row exists — it carries fresher data
    // (or a delete). Replaying this one could regress AppSheet.
    if (entry.rowKey) {
      const newer = await outbox.findOne({
        table: entry.table,
        rowKey: entry.rowKey,
        createdAt: { $gt: entry.createdAt },
        status: { $in: ['pending', 'processing', 'done', 'dead'] },
      }, { projection: { _id: 1 } })
      if (newer) {
        await outbox.updateOne(
          { _id: entry._id, status: entry.status },
          { $set: { status: 'superseded', supersededAt: new Date() } },
        )
        continue
      }
    }

    // Claim the entry so overlapping drains never double-send
    // (processingAt in the filter makes the claim single-winner even for
    // stale 'processing' entries being recovered)
    const claim = await outbox.updateOne(
      { _id: entry._id, status: entry.status, processingAt: entry.processingAt ?? null },
      { $set: { status: 'processing', processingAt: new Date() } },
    )
    if (claim.modifiedCount === 0) continue

    const result = await attemptOutboxPush(
      entry.table,
      entry.action,
      entry.row ? [entry.row] : [],
      { maxRetries: 2, timeoutMs: 20_000 },
      entry.addRow ? [entry.addRow] : undefined,
    )
    const attempts = (entry.attempts || 0) + 1

    // All outcome writes are guarded on status:'processing' so they can't
    // overwrite a terminal state written by anyone else meanwhile.
    if (result.ok) {
      succeeded++
      await outbox.updateOne(
        { _id: entry._id, status: 'processing' },
        { $set: { status: 'done', doneAt: new Date(), attempts } },
      )

      // If a FRESHER change for this row synced while our replay was in
      // flight, our (older) values may have landed last in AppSheet.
      // Requeue the newest entry so the fresh data is re-sent.
      if (entry.rowKey) {
        const newest = await outbox.findOne(
          {
            table: entry.table,
            rowKey: entry.rowKey,
            createdAt: { $gt: entry.createdAt },
            status: 'done',
          },
          { sort: { createdAt: -1 } },
        )
        if (newest) {
          console.log(`[SyncOutbox] Fresher entry for ${entry.table}/${entry.rowKey} synced during replay — requeueing it so the newest data wins`)
          await outbox.updateOne(
            { _id: newest._id, status: 'done' },
            { $set: { status: 'pending', nextAttemptAt: new Date() }, $unset: { doneAt: '' } },
          )
        }
      }
    }
    else if (!result.retriable || attempts >= MAX_ATTEMPTS) {
      console.error(`[SyncOutbox] Giving up on ${entry.action} → ${entry.table}/${entry.rowKey} after ${attempts} attempt(s): ${result.error}`)
      await outbox.updateOne(
        { _id: entry._id, status: 'processing' },
        { $set: { status: 'dead', attempts, lastError: result.error || 'unknown error' } },
      )
    }
    else {
      await outbox.updateOne(
        { _id: entry._id, status: 'processing' },
        {
          $set: {
            status: 'pending',
            attempts,
            lastError: result.error || 'unknown error',
            nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
          },
        },
      )
    }
  }

  return { processed: batch.length, succeeded }
}
