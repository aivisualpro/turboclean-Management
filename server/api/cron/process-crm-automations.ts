import { getCrmDb } from '../../utils/crm'
import { runDueAutomations } from '../../utils/automation'

// ─────────────────────────────────────────────────────────────────────────────
// CRM AUTOMATIONS (Automations menu)
// The in-app scheduler runs these every minute. On hosts without a long-running
// server (serverless), point an external cron at this endpoint instead — every
// 5 minutes is plenty. Each job is claim-based and self-gating, so extra pings
// are harmless. Nothing is ever emailed without a person approving it first.
// ─────────────────────────────────────────────────────────────────────────────
export default defineEventHandler(async () => {
  try {
    const ran = await runDueAutomations(await getCrmDb())
    return { success: true, message: `${ran.length} CRM automation${ran.length === 1 ? '' : 's'} ran`, results: ran.map(r => ({ key: r.key, status: r.status, summary: r.summary })) }
  }
  catch (error: any) {
    console.error('[CRM Automations Cron] Fatal error:', error)
    return { success: false, error: error.message }
  }
})
