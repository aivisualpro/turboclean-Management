import { getCrmDb } from '../../../utils/crm'
import { tickBatches } from '../../../utils/scanner-batch'
import { requireActor } from '../../../utils/automation-http'

/**
 * GET /api/scanner/batches/tick — Vercel Cron (every minute): restarts stalled dealerships of every
 * running batch from their checkpoints. Authorised by CRON_SECRET (Vercel sends it as a Bearer
 * token), the Vercel cron user agent, or a signed-in user.
 */
export default defineEventHandler(async (event) => {
  const auth = String(getHeader(event, 'authorization') || '')
  const ua = String(getHeader(event, 'user-agent') || '')
  const cronOk = process.env.CRON_SECRET ? auth === `Bearer ${process.env.CRON_SECRET}` : /vercel-cron/i.test(ua)
  if (!cronOk) await requireActor(event)
  return { batches: await tickBatches(await getCrmDb()) }
})
