import { getCrmDb } from '../../utils/crm'
import { AUTOMATIONS, automationDb, envStatus, getAutomationState, inSendWindow, nextWindowLabel, zonedNow } from '../../utils/automation'
import { emailDb } from '../../utils/crm-email'
import { requireActor } from '../../utils/automation-http'

/** GET /api/automations — the Automation Center: every automation with its state, plus what needs you. */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  const db = await getCrmDb()
  const { drafts } = await automationDb(db)
  const { emails } = await emailDb(db)
  const { settings, jobs } = await getAutomationState(db)
  const d = db.collection('turboCleanCrmDealerships')
  const live = { archivedAt: null, dealerId: null }
  const [statusCounts, repliesToConfirm, hot, needToday, sentToday] = await Promise.all([
    drafts.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
    emails.countDocuments({ direction: 'inbound', sentiment: null }),
    d.countDocuments({ ...live, 'automation.priority.tier': 'Hot' }),
    d.countDocuments({ ...live, 'automation.nextBest.due': { $in: ['now', 'today'] } }),
    drafts.countDocuments({ status: 'sent', sentDay: zonedNow().day }),
  ])
  const byStatus = Object.fromEntries(statusCounts.map(s => [s._id, s.n]))
  return {
    automations: AUTOMATIONS.map(a => ({ ...a, ...jobs[a.key] })),
    settings,
    env: envStatus(),
    sending: { inWindow: inSendWindow(settings), nextWindow: nextWindowLabel(settings), sentToday, limit: settings.dailySendLimit },
    needsYou: {
      draftsPending: byStatus.pending || 0,
      draftsApproved: byStatus.approved || 0,
      draftsFailed: byStatus.failed || 0,
      repliesToConfirm,
      hot,
      needToday,
    },
  }
})
