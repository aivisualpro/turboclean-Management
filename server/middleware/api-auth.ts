import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import process from 'node:process'
import { getUserSession } from '../utils/auth'

/**
 * Every /api route needs a signed-in user — except the ones below, which are called by other
 * systems or by dealers and check their own key / token / signature:
 *   login / logout / me · Nuxt internals (/api/_…) · Resend webhook (signed) · AppSheet webhook
 *   (SYNC_WEBHOOK_SECRET when set) · cron (self-gating; ?force needs a user or CRON_SECRET) ·
 *   batch autopilot tick (CRON_SECRET) and run-item (signed) · dealer report links (?t= token) ·
 *   unsubscribe links (token) · inventory collector (AUTOMATION_API_TOKEN) · CRM file images (GET).
 */
const PUBLIC: RegExp[] = [
  /^\/api\/_/,
  /^\/api\/auth\/(login|logout|me)$/,
  /^\/api\/webhooks\//,
  /^\/api\/sync\/webhook$/,
  /^\/api\/cron\//,
  /^\/api\/scanner\/batches\/tick$/,
  /^\/api\/scanner\/batches\/[^/]+\/run-item$/,
  /^\/api\/crm\/audits\/[^/]+\/report$/,
  /^\/api\/crm\/email\/unsubscribe\//,
  /^\/api\/automations\/inventory$/,
]
const PUBLIC_GET: RegExp[] = [/^\/api\/crm\/files\/[^/]+$/]

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }

export default defineEventHandler(async (event) => {
  const path = (event.path || '').split('?')[0]!.replace(/\/+$/, '')
  if (!path.startsWith('/api/')) return
  const method = event.method || 'GET'

  // AppSheet webhook: when SYNC_WEBHOOK_SECRET is set, the bot URL must carry ?key=<secret> (or header x-webhook-key).
  if (path === '/api/sync/webhook') {
    const secret = process.env.SYNC_WEBHOOK_SECRET || ''
    if (secret) {
      const given = String(getQuery(event).key || getHeader(event, 'x-webhook-key') || '')
      if (!same(given, secret)) throw createError({ statusCode: 401, statusMessage: 'Invalid webhook key' })
    }
    return
  }
  // Cron: the regular "is anything due?" ping stays open (it only runs what is due); forcing a run is not.
  if (path.startsWith('/api/cron/')) {
    const q = getQuery(event)
    if (q.force === 'true' || q.force === '1') {
      const cron = process.env.CRON_SECRET || ''
      const bearer = String(getHeader(event, 'authorization') || '')
      if (!(cron && same(bearer, `Bearer ${cron}`)) && !(await getUserSession(event))) throw createError({ statusCode: 401, statusMessage: 'Sign in to force a run' })
    }
    return
  }
  if (PUBLIC.some(r => r.test(path))) return
  if ((method === 'GET' || method === 'HEAD') && PUBLIC_GET.some(r => r.test(path))) return
  if (!(await getUserSession(event))) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
})
