import { connectToDatabase } from '../../utils/mongodb'
import { processDueInvoiceAutomations } from '../../utils/invoice-automation'

/** Manual "Run Now" — generates and delivers immediately, bypassing the schedule gate */
export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event) || {}
    const { automationId } = body
    if (!automationId) {
      return { success: false, message: 'Missing automationId' }
    }

    const { db } = await connectToDatabase()
    const { results } = await processDueInvoiceAutomations(db, { force: true, automationId })

    const result = results[0]
    if (!result) {
      return { success: false, message: 'Automation not found' }
    }
    if (result.skipped) {
      return { success: false, message: result.reason || 'Automation was skipped' }
    }

    return {
      success: result.success,
      status: result.status,
      message: result.summary,
      run: result.run
        ? {
            invoicesEmailed: result.run.invoicesEmailed,
            emailsSent: result.run.emailsSent,
            dailiesGenerated: result.run.dailiesGenerated,
            weekliesGenerated: result.run.weekliesGenerated,
            invoiceNumbers: result.run.invoiceNumbers,
            errors: result.run.errors,
          }
        : null,
    }
  }
  catch (error: any) {
    console.error('Error running invoice automation:', error)
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to run automation' })
  }
})
