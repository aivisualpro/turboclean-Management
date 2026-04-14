import { connectToDatabase } from '../../utils/mongodb'
import { generateInvoiceHtml, htmlToPdfBuffer } from '../../utils/invoice-pdf'
import { Resend } from 'resend'

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const settingsCol = db.collection('settings')
    const dealersCol = db.collection('dealers')

    const settings = await settingsCol.findOne({ type: 'general' })
    if (!settings?.automations?.dailyInvoiceEmail?.enabled) {
      return { success: true, message: 'Daily invoice automation is disabled.' }
    }

    // ── 1. Generate Daily Invoices ─────────────────────────────────────────────
    const generateResult: any = await $fetch('/api/invoices/generate', {
      method: 'POST',
      body: { type: 'daily' }
    }).catch((err: any) => ({ success: false, error: err.message }))

    if (!generateResult.success && generateResult.error) {
      console.error('[Daily Cron] Invoice generation failed:', generateResult.error)
    }

    // ── 2. Find all Draft daily invoices that haven't been emailed ─────────────
    const invoicesCol = db.collection('turboCleanInvoices')
    const emailLogsCol = db.collection('turboCleanEmailLogs')

    const draftDailyInvoices = await invoicesCol.find({
      type: 'Daily',
      status: 'Draft'
    }).toArray()

    if (draftDailyInvoices.length === 0) {
      return {
        success: true,
        message: 'Daily invoices generated but no draft invoices to send.',
        generated: generateResult.generated || 0
      }
    }

    // ── 3. Find dealers with receiveInvoices contacts ──────────────────────────
    const dealers = await dealersCol.find({
      'contacts.receiveInvoices': true,
      status: 'Authorised'
    }).toArray()

    const dealerEmailMap = new Map<string, string[]>()
    for (const dealer of dealers) {
      const validEmails: string[] = (dealer.contacts || [])
        .filter((c: any) => c.receiveInvoices && c.emails?.length > 0)
        .flatMap((c: any) => c.emails.flatMap((e: string) => typeof e === 'string' ? e.split(',') : []).map((e: string) => e.trim().replace(/,+$/, '')).filter(Boolean))
      if (validEmails.length > 0) {
        dealerEmailMap.set(dealer._id.toString(), validEmails)
      }
    }

    if (dealerEmailMap.size === 0) {
      return { success: true, message: 'No dealers have receiveInvoices contacts configured.' }
    }

    const resend = new Resend(process.env.RESEND_API_KEY)
    let emailsSent = 0
    let emailsFailed = 0
    const errors: any[] = []

    // ── 4. Send each invoice to its dealer contacts ────────────────────────────
    for (const invoice of draftDailyInvoices) {
      const dealerId = invoice.dealerId?.toString()
      const targetEmails = dealerEmailMap.get(dealerId)

      if (!targetEmails || targetEmails.length === 0) continue

      try {
        // Build invoice data for PDF/HTML generation
        const invoiceData = {
          invoiceNumber: invoice.number,
          invoiceType: 'Daily',
          date: invoice.date,
          dueDate: invoice.dueDate,
          dealerName: invoice.dealerName,
          dealerEmail: invoice.dealerEmail,
          dealerAddress: invoice.dealerAddress,
          lineItems: invoice.lineItems || [],
          subtotal: invoice.subtotal,
          taxTotal: invoice.taxTotal,
          total: invoice.total,
        }

        const emailHtml = generateInvoiceHtml(invoiceData)
        let pdfBuffer: Buffer | null = null
        try {
          pdfBuffer = await htmlToPdfBuffer(emailHtml, invoiceData)
        } catch (pdfErr: any) {
          console.error('[Daily Cron] PDF generation failed:', pdfErr.message, pdfErr.stack)
        }

        const attachments: { filename: string; content: Buffer; contentType: string }[] = []
        if (pdfBuffer) {
          attachments.push({ filename: `${invoice.number}.pdf`, content: pdfBuffer, contentType: 'application/pdf' })
        } else {
          // Last resort fallback — should never happen with jsPDF
          attachments.push({ filename: `${invoice.number}.pdf`, content: Buffer.from(emailHtml, 'utf-8'), contentType: 'application/pdf' })
        }

        for (const toEmail of targetEmails) {
          try {
            await resend.emails.send({
              from: 'billing@zrzops.com',
              to: toEmail,
              subject: `Invoice ${invoice.number} – ${invoice.dealerName} (${invoice.date})`,
              html: emailHtml,
              attachments,
            })

            // Log the sent email
            await emailLogsCol.insertOne({
              dealerId,
              invoiceId: invoice._id.toString(),
              email: toEmail,
              subject: `Invoice ${invoice.number} – ${invoice.dealerName} (${invoice.date})`,
              type: 'Invoice',
              invoiceType: 'Daily',
              attachmentCount: attachments.length,
              status: 'Sent',
              sentAt: new Date().toISOString(),
              // Automation flag
              sentByAutomation: true,
              // Mailbox UI fields
              folder: 'sent',
              from: 'billing@zrzops.com',
              to: toEmail,
              bodyHtml: emailHtml,
              receivedAt: new Date().toISOString(),
              attachments: attachments.map(att => ({
                filename: att.filename,
                content: `data:${att.contentType};base64,${att.content.toString('base64')}`
              }))
            })

            emailsSent++
          } catch (sendErr: any) {
            emailsFailed++
            errors.push({ dealerId, toEmail, error: sendErr.message })
          }
        }

        // Mark invoice as 'Emailed'
        await invoicesCol.updateOne({ _id: invoice._id }, { $set: { status: 'Emailed' } })
      } catch (err: any) {
        emailsFailed++
        errors.push({ dealerId, invoiceId: invoice._id.toString(), error: err.message })
      }
    }

    return {
      success: true,
      message: `Daily automation complete: ${emailsSent} emails sent.`,
      stats: { generated: generateResult.generated || 0, emailsSent, emailsFailed },
      errors
    }
  } catch (error: any) {
    console.error('[Daily Cron] Fatal error:', error)
    return { success: false, error: error.message }
  }
})
