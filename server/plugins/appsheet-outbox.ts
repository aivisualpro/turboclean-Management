/**
 * Background retrier for the AppSheet sync outbox.
 *
 * Any change that failed to reach AppSheet (network blip, AppSheet down,
 * rate limit, server restart mid-push) sits in `turboCleanSyncOutbox` as
 * `pending`. This plugin drains that queue every 60s with exponential
 * backoff so changes eventually land in AppSheet without anyone noticing.
 *
 * Disable with APPSHEET_OUTBOX_DISABLED=1 if ever needed.
 */

import process from 'node:process'
import { connectToDatabase } from '../utils/mongodb'
import { drainOutbox } from '../utils/appsheet-sync'

declare global {
  // eslint-disable-next-line vars-on-top
  var _appsheetOutboxTimer: any
}

export default defineNitroPlugin(() => {
  if (process.env.APPSHEET_OUTBOX_DISABLED === '1') {
    console.log('[SyncOutbox] Disabled via APPSHEET_OUTBOX_DISABLED=1')
    return
  }

  // Guard against duplicate timers on dev-server hot reloads
  if (globalThis._appsheetOutboxTimer) return

  let running = false

  const tick = async () => {
    if (running) return
    running = true
    try {
      const { db } = await connectToDatabase()
      const { processed, succeeded } = await drainOutbox(db)
      if (processed > 0) {
        console.log(`[SyncOutbox] Retried ${processed} pending AppSheet sync(s) — ${succeeded} succeeded`)
      }
    }
    catch (e: any) {
      console.error('[SyncOutbox] Drain failed:', e?.message)
    }
    finally {
      running = false
    }
  }

  globalThis._appsheetOutboxTimer = setInterval(tick, 60_000)
  // First pass shortly after boot to pick up anything left from a previous run
  setTimeout(tick, 10_000)
  console.log('[SyncOutbox] AppSheet outbox retrier started (checks every 60s)')
})
