import { connectToDatabase } from '../../utils/mongodb'
import { processDueInvoiceAutomations } from '../../utils/invoice-automation'

// ─────────────────────────────────────────────────────────────────────────────
// SELF-GATING DAILY & WEEKLY INVOICE AUTOMATIONS
// The in-app scheduler (server/plugins/automation-scheduler.ts) hits this
// logic every minute; an external scheduler can also ping this endpoint as
// often as it likes. Each enabled automation fires at most ONCE per calendar
// day (claimed atomically via lastRunKey), on its own time and timezone.
// Use ?force=true to run ALL enabled automations immediately (testing).
// ─────────────────────────────────────────────────────────────────────────────

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const force = query.force === 'true' || query.force === '1'

    const { db } = await connectToDatabase()
    const { processed, results } = await processDueInvoiceAutomations(db, { force })

    const skipped = results.filter(r => r.skipped).length
    const emailsSent = results.reduce((s, r) => s + (r.run?.emailsSent || 0), 0)

    return {
      success: true,
      message: `Invoice automations processed: ${processed} ran, ${skipped} skipped, ${emailsSent} emails sent.`,
      results: results.map(r => ({
        automation: r.automation,
        skipped: r.skipped,
        reason: r.reason,
        status: r.status,
        summary: r.summary,
      })),
    }
  }
  catch (error: any) {
    console.error('[Invoice Automations Cron] Fatal error:', error)
    return { success: false, error: error.message }
  }
})
