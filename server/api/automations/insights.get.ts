import { getCrmDb } from '../../utils/crm'
import { automationDb } from '../../utils/automation'
import { automationStats, buildInsights, latestInsights } from '../../utils/automation-insights'
import { requireActor } from '../../utils/automation-http'

/** GET /api/automations/insights?refresh=1 — latest weekly strategy report (refresh = build a new one now). */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  const db = await getCrmDb()
  if (getQuery(event).refresh) {
    const doc = await buildInsights(db)
    const { insights } = await automationDb(db)
    await insights.insertOne({ ...doc })
    return { report: doc }
  }
  const report = await latestInsights(db)
  return { report, liveAutomation: report ? null : await automationStats(db) }
})
