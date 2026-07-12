import { connectToDatabase } from '../../utils/mongodb'
import { getScheduledDay, nowInTimezone, runMonthlyAutomation } from '../../utils/monthly-automation'

// ─────────────────────────────────────────────────────────────────────────────
// SELF-GATING MONTHLY INVOICE AUTOMATIONS
// Ping this endpoint as often as you like (hourly/daily via external scheduler).
// It iterates every enabled automation record and only fires the ones whose
// day-of-month rule + time + timezone match right now — at most ONCE per
// calendar month per automation (tracked via lastRunKey on each record).
// Automations past their end date are auto-disabled.
// Use ?force=true to run ALL enabled automations immediately (testing).
// ─────────────────────────────────────────────────────────────────────────────

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const force = query.force === 'true' || query.force === '1'

    const { db } = await connectToDatabase()
    const automationsCol = db.collection('turboCleanMonthlyAutomations')

    const automations = await automationsCol.find({ enabled: true }).toArray()
    if (automations.length === 0) {
      return { success: true, message: 'No enabled monthly automations.', results: [] }
    }

    const results: any[] = []

    for (const automation of automations) {
      const label = automation.name || automation._id.toString()
      const tz = automation.timezone || 'America/New_York'
      const now = nowInTimezone(tz)
      const todayStr = `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`
      const monthRunKey = `${now.year}-${String(now.month).padStart(2, '0')}`

      // ── End date reached? Auto-disable and skip ──────────────────────────
      if (automation.endDate && automation.endDate < todayStr) {
        await automationsCol.updateOne(
          { _id: automation._id },
          { $set: { enabled: false, disabledReason: `End date ${automation.endDate} reached`, updatedAt: new Date().toISOString() } },
        )
        results.push({ automation: label, skipped: true, reason: `End date ${automation.endDate} reached — automation disabled.` })
        continue
      }

      if (!force) {
        // ── Already ran this month? ────────────────────────────────────────
        if (automation.lastRunKey === monthRunKey) {
          results.push({ automation: label, skipped: true, reason: `Already ran for ${monthRunKey}.` })
          continue
        }

        // ── Scheduled day gate ─────────────────────────────────────────────
        const scheduledDay = getScheduledDay(automation, now.year, now.month)
        if (now.day !== scheduledDay) {
          results.push({ automation: label, skipped: true, reason: `Not scheduled day (scheduled: ${scheduledDay}, today: ${now.day} in ${tz}).` })
          continue
        }

        // ── Scheduled time gate ────────────────────────────────────────────
        const [schedH, schedM] = (automation.time || '09:00').split(':').map(Number)
        const nowMinutes = now.hour * 60 + now.minute
        const schedMinutes = (schedH || 0) * 60 + (schedM || 0)
        if (nowMinutes < schedMinutes) {
          results.push({ automation: label, skipped: true, reason: `Scheduled time (${automation.time} ${tz}) not reached yet.` })
          continue
        }
      }

      // ── Run it ─────────────────────────────────────────────────────────────
      try {
        const runResult = await runMonthlyAutomation(db, automation, { force })
        results.push({ automation: label, ...runResult })
      }
      catch (err: any) {
        console.error(`[Monthly Cron] Automation "${label}" failed:`, err)
        results.push({ automation: label, success: false, error: err.message })
      }
    }

    const ran = results.filter(r => !r.skipped)
    const sent = ran.reduce((s, r) => s + (r.emailsSent || 0), 0)

    return {
      success: true,
      message: `Monthly automations processed: ${ran.length} ran, ${results.length - ran.length} skipped, ${sent} emails sent.`,
      results,
    }
  }
  catch (error: any) {
    console.error('[Monthly Cron] Fatal error:', error)
    return { success: false, error: error.message }
  }
})
