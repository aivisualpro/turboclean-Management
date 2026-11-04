import { timingSafeEqual } from 'node:crypto'
import { getCrmDb, str } from '../../../../utils/crm'
import { internalToken, keepAlive, runBatchItem } from '../../../../utils/scanner-batch'

/**
 * POST /api/scanner/batches/:id/run-item { dealershipId } — INTERNAL (signed by advanceBatch).
 * Answers at once and keeps scanning in this invocation (waitUntil), so every dealership gets its
 * own server, memory and time budget.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const got = Buffer.from(String(getHeader(event, 'x-zrz-internal') || ''))
  const want = Buffer.from(internalToken(id))
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  const body = (await readBody(event)) || {}
  const db = await getCrmDb()
  keepAlive(runBatchItem(db, id, str(body.dealershipId, 40)).catch(() => {}), event)
  setResponseStatus(event, 202)
  return { started: true }
})
