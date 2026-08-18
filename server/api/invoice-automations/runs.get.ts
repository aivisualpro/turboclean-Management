import { connectToDatabase } from '../../utils/mongodb'
import { RUNS_COLLECTION } from '../../utils/invoice-automation'

/** Run history feed — ?automationId=... narrows to one automation */
export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const automationId = (query.automationId as string) || ''
    const limit = Math.min(Number(query.limit) || 20, 100)

    const { db } = await connectToDatabase()

    const match: any = {}
    if (automationId) match.automationId = automationId

    const runs = await db.collection(RUNS_COLLECTION)
      .find(match)
      .sort({ startedAt: -1 })
      .limit(limit)
      .toArray()

    return {
      success: true,
      runs: runs.map((r: any) => ({
        id: r._id.toString(),
        automationId: r.automationId,
        automationName: r.automationName || '',
        frequency: r.frequency || 'daily',
        trigger: r.trigger || 'schedule',
        startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : r.startedAt,
        finishedAt: r.finishedAt instanceof Date ? r.finishedAt.toISOString() : r.finishedAt,
        status: r.status || '',
        summary: r.summary || '',
        dailiesGenerated: r.dailiesGenerated || 0,
        weekliesGenerated: r.weekliesGenerated || 0,
        invoicesEmailed: r.invoicesEmailed || 0,
        emailsSent: r.emailsSent || 0,
        emailsFailed: r.emailsFailed || 0,
        skippedNoRecipients: r.skippedNoRecipients || 0,
        invoiceNumbers: r.invoiceNumbers || [],
        errors: r.errors || [],
      })),
    }
  }
  catch (error: any) {
    console.error('Error fetching automation runs:', error)
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to fetch runs' })
  }
})
