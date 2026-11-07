/**
 * POST /api/sync/missing-from-appsheet
 *
 * Finds (and optionally adds) rows that exist in AppSheet but not in the app — e.g. rows added
 * in AppSheet while the webhook was rejecting calls. Never updates or deletes existing data.
 *
 * Body:
 *   since?:  'YYYY-MM-DD'  WorkOrders are only checked from this date on (default 2026-11-05).
 *                          Other tables are always checked in full (they are small).
 *   tables?: string[]      Dealers | Services | AppUsers | DealerServices | WorkOrders (default all)
 *   dryRun?: boolean       default TRUE — only reports. Send false to write.
 *   ids?:    string[]      with dryRun:false — which rows to add, as "Table:id"
 *                          (default: every missing row that has no warning)
 *
 * Signed-in users only (server/middleware/api-auth.ts).
 */

import { connectToDatabase } from '../../utils/mongodb'
import { addMissingFromAppSheet, findMissingFromAppSheet } from '../../utils/appsheet-missing'

const DEFAULT_SINCE = '2026-11-05'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) || {}
  const sinceText = typeof body.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.since) ? body.since : DEFAULT_SINCE
  const since = new Date(`${sinceText}T00:00:00Z`)
  const tables = Array.isArray(body.tables) ? body.tables.map(String) : undefined
  const dryRun = body.dryRun !== false
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : undefined

  const { db } = await connectToDatabase()

  if (dryRun) {
    const report = await findMissingFromAppSheet(db, { since, tables })
    return { success: true, dryRun: true, ...report }
  }

  const report = await addMissingFromAppSheet(db, { since, tables, ids })
  const added = report.tables.reduce((n, t) => n + (t.added || 0), 0)
  console.log(`[MissingSync] Added ${added} row(s) from AppSheet:`, report.tables.map(t => `${t.table}=${t.added ?? 0}${t.failed?.length ? ` (${t.failed.length} failed)` : ''}`).join(', '))
  return { success: true, dryRun: false, added, ...report }
})
