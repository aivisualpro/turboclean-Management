/**
 * In-app automation scheduler.
 *
 * Checks every 60 seconds whether any invoice automation (daily/weekly) or
 * monthly automation is due, and fires the ones that are. All processors are
 * self-gating and claim-based, so ticking often is safe — each automation
 * still runs at most once per period, even across restarts or multiple ticks.
 *
 * Without this plugin, automations only fire when an EXTERNAL scheduler pings
 * /api/cron/* — which is why they previously showed "Never run yet".
 *
 * Disable with AUTOMATION_SCHEDULER_DISABLED=1 (e.g. when an external cron
 * owns scheduling in production).
 */

import process from 'node:process'
import { connectToDatabase } from '../utils/mongodb'
import { processDueInvoiceAutomations } from '../utils/invoice-automation'

declare global {
  // eslint-disable-next-line vars-on-top
  var _automationSchedulerTimer: any
}

export default defineNitroPlugin(() => {
  if (process.env.AUTOMATION_SCHEDULER_DISABLED === '1') {
    console.log('[Automation Scheduler] Disabled via AUTOMATION_SCHEDULER_DISABLED=1')
    return
  }

  // Guard against duplicate timers on dev-server hot reloads
  if (globalThis._automationSchedulerTimer) return

  let running = false

  const tick = async () => {
    if (running) return
    running = true
    try {
      // ── Daily & weekly invoice automations ──
      try {
        const { db } = await connectToDatabase()
        const { processed, results } = await processDueInvoiceAutomations(db)
        if (processed > 0) {
          for (const r of results.filter(x => !x.skipped)) {
            console.log(`[Automation Scheduler] Ran "${r.automation}" → ${r.status}: ${r.summary}`)
          }
        }
      }
      catch (e: any) {
        console.error('[Automation Scheduler] Invoice automations tick failed:', e?.message)
      }

      // ── Monthly automations (existing self-gating endpoint) ──
      try {
        const res: any = await (globalThis as any).$fetch('/api/cron/process-monthly')
        const ran = (res?.results || []).filter((r: any) => !r.skipped)
        if (ran.length > 0) {
          console.log(`[Automation Scheduler] Monthly automations: ${res.message}`)
        }
      }
      catch (e: any) {
        console.error('[Automation Scheduler] Monthly automations tick failed:', e?.message)
      }
    }
    finally {
      running = false
    }
  }

  globalThis._automationSchedulerTimer = setInterval(tick, 60_000)
  // First pass shortly after boot so overdue automations catch up immediately
  setTimeout(tick, 15_000)
  console.log('[Automation Scheduler] Started — checking daily/weekly/monthly automations every 60s')
})
