import { ObjectId } from 'mongodb'
import { connectToDatabase } from '../../utils/mongodb'
import { runMonthlyAutomation } from '../../utils/monthly-automation'

// Manual run — generates (or reuses) the invoice for the billing month and sends it now
export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event) || {}
    const { automationId } = body
    if (!automationId)
      return { success: false, message: 'Missing automationId' }

    const { db } = await connectToDatabase()

    let objectId: any = automationId
    try { objectId = new ObjectId(automationId) }
    catch { }

    const automation = await db.collection('turboCleanMonthlyAutomations').findOne({ _id: objectId })
    if (!automation)
      return { success: false, message: 'Automation not found' }

    const result = await runMonthlyAutomation(db, automation, { force: true })

    if (!result.success) {
      return { success: false, message: result.error || 'Run failed', ...result }
    }

    return {
      success: true,
      message: `Invoice ${result.invoiceNumber} (${result.monthLabel}) sent to ${result.emailsSent} recipient${result.emailsSent === 1 ? '' : 's'}.`,
      ...result,
    }
  }
  catch (error: any) {
    console.error('Error running monthly automation:', error)
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to run automation' })
  }
})
