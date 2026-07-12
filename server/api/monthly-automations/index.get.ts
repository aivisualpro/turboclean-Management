import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async () => {
  try {
    const { db } = await connectToDatabase()
    const automations = await db.collection('turboCleanMonthlyAutomations')
      .find({})
      .sort({ createdAt: -1 })
      .toArray()

    return {
      success: true,
      automations: automations.map((a: any) => ({
        id: a._id.toString(),
        name: a.name || '',
        dealerId: a.dealerId,
        dealerName: a.dealerName || '',
        enabled: !!a.enabled,
        lineItems: a.lineItems || [],
        scheduleType: a.scheduleType || 'day_of_month',
        dayOfMonth: a.dayOfMonth ?? 1,
        nth: a.nth || 'First',
        weekday: a.weekday || 'Monday',
        time: a.time || '09:00',
        timezone: a.timezone || 'America/New_York',
        billingMonth: a.billingMonth || 'current',
        endDate: a.endDate || '',
        emails: a.emails || [],
        emailSubject: a.emailSubject || '',
        emailBody: a.emailBody || '',
        lastRunKey: a.lastRunKey || '',
        lastRunAt: a.lastRunAt || '',
        lastInvoiceNumber: a.lastInvoiceNumber || '',
        lastRunStatus: a.lastRunStatus || '',
        runsCount: a.runsCount || 0,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
    }
  }
  catch (error: any) {
    console.error('Error fetching monthly automations:', error)
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to fetch automations' })
  }
})
