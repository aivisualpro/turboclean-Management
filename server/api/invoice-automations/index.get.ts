import { connectToDatabase } from '../../utils/mongodb'
import { AUTOMATIONS_COLLECTION, RUNS_COLLECTION, computeNextRun, scheduleSentence } from '../../utils/invoice-automation'

export default defineEventHandler(async () => {
  try {
    const { db } = await connectToDatabase()

    const [automations, stats30d] = await Promise.all([
      db.collection(AUTOMATIONS_COLLECTION).find({}).sort({ createdAt: -1 }).toArray(),
      db.collection(RUNS_COLLECTION).aggregate([
        { $match: { startedAt: { $gte: new Date(Date.now() - 30 * 86400000) } } },
        {
          $group: {
            _id: null,
            runs: { $sum: 1 },
            invoicesGenerated: { $sum: { $add: [{ $ifNull: ['$dailiesGenerated', 0] }, { $ifNull: ['$weekliesGenerated', 0] }] } },
            invoicesEmailed: { $sum: { $ifNull: ['$invoicesEmailed', 0] } },
            emailsSent: { $sum: { $ifNull: ['$emailsSent', 0] } },
            failures: { $sum: { $cond: [{ $eq: ['$status', 'Failed'] }, 1, 0] } },
          },
        },
      ]).toArray().catch(() => []),
    ])

    return {
      success: true,
      scheduler: { active: !!(globalThis as any)._automationSchedulerTimer },
      stats: stats30d[0] || { runs: 0, invoicesGenerated: 0, invoicesEmailed: 0, emailsSent: 0, failures: 0 },
      automations: automations.map((a: any) => ({
        id: a._id.toString(),
        name: a.name || '',
        frequency: a.frequency === 'weekly' ? 'weekly' : 'daily',
        enabled: !!a.enabled,
        dealerScope: a.dealerScope === 'selected' ? 'selected' : 'all',
        dealerIds: a.dealerIds || [],
        dealerNames: a.dealerNames || [],
        runDays: a.runDays || [],
        weekday: a.weekday || 'Monday',
        time: a.time || '07:00',
        timezone: a.timezone || 'America/New_York',
        billingDay: a.billingDay === 'same' ? 'same' : 'previous',
        autoSend: a.autoSend !== false,
        useDealerContacts: a.useDealerContacts !== false,
        emails: a.emails || [],
        emailSubject: a.emailSubject || '',
        emailBody: a.emailBody || '',
        endDate: a.endDate || '',
        disabledReason: a.disabledReason || '',
        lastRunKey: a.lastRunKey || '',
        lastRunAt: a.lastRunAt || '',
        lastRunStatus: a.lastRunStatus || '',
        lastRunSummary: a.lastRunSummary || '',
        runsCount: a.runsCount || 0,
        // A corrupt doc (e.g. bad timezone) must never take the whole list down
        scheduleLabel: (() => { try { return scheduleSentence(a) } catch { return 'Invalid schedule — edit this automation' } })(),
        nextRun: (() => { try { return computeNextRun(a) } catch { return null } })(),
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
    }
  }
  catch (error: any) {
    console.error('Error fetching invoice automations:', error)
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to fetch automations' })
  }
})
