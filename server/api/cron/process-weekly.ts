import { connectToDatabase } from '../../utils/mongodb'
import { generateInvoiceHtml, htmlToPdfBuffer } from '../../utils/invoice-pdf'
import { Resend } from 'resend'

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const settingsCol = db.collection('settings')
    const dealersCol = db.collection('dealers')

    const settings = await settingsCol.findOne({ type: 'general' })
    if (!settings?.automations?.weeklyInvoiceEmail?.enabled) {
      return { success: true, message: 'Weekly invoice automation is disabled.' }
    }

    // ── 1. Generate Weekly Invoices (rolls up unbilled daily invoices) ──────────
    const generateResult: any = await $fetch('/api/invoices/generate', {
      method: 'POST',
      body: { type: 'weekly' }
    }).catch((err: any) => ({ success: false, error: err.message }))

    if (!generateResult.success && generateResult.error) {
      console.error('[Weekly Cron] Invoice generation failed:', generateResult.error)
    }

    // ── 2. Find all Draft weekly invoices ready to send ────────────────────────
    const invoicesCol = db.collection('turboCleanInvoices')
    const emailLogsCol = db.collection('turboCleanEmailLogs')

    const draftWeeklyInvoices = await invoicesCol.find({
      type: 'Weekly',
      status: 'Draft'
    }).toArray()

    if (draftWeeklyInvoices.length === 0) {
      return {
        success: true,
        message: 'Weekly invoices generated but no draft invoices to send.',
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

    // ── 4. Send each weekly invoice to dealer contacts ─────────────────────────
    for (const invoice of draftWeeklyInvoices) {
      const dealerId = invoice.dealerId?.toString()
      const targetEmails = dealerEmailMap.get(dealerId)

      if (!targetEmails || targetEmails.length === 0) continue

      try {
        const invoiceData = {
          invoiceNumber: invoice.number,
          invoiceType: 'Weekly',
          date: invoice.date,
          dueDate: invoice.dueDate,
          weekNumber: invoice.weekNumber,
          weekYear: invoice.weekYear,
          weekStart: invoice.weekStart,
          weekEnd: invoice.weekEnd,
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
          console.error('[Weekly Cron] PDF generation failed:', pdfErr.message, pdfErr.stack)
        }

        const attachments: { filename: string; content: Buffer; contentType: string }[] = []
        if (pdfBuffer) {
          attachments.push({ filename: `${invoice.number}.pdf`, content: pdfBuffer, contentType: 'application/pdf' })
        } else {
          // Last resort fallback — should never happen with jsPDF
          attachments.push({ filename: `${invoice.number}.pdf`, content: Buffer.from(emailHtml, 'utf-8'), contentType: 'application/pdf' })
        }

        const weekLabel = `W${String(invoice.weekNumber).padStart(2, '0')}-${invoice.weekYear}`
        const subject = `Weekly Invoice ${invoice.number} – ${invoice.dealerName} (${weekLabel})`

        for (const toEmail of targetEmails) {
          try {
            await resend.emails.send({
              from: 'billing@zrzops.com',
              to: toEmail,
              subject,
              html: emailHtml,
              attachments,
            })

            // Log email with automation flag
            await emailLogsCol.insertOne({
              dealerId,
              invoiceId: invoice._id.toString(),
              email: toEmail,
              subject,
              type: 'Invoice',
              invoiceType: 'Weekly',
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
                filename: att.filename
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
      message: `Weekly automation complete: ${emailsSent} emails sent.`,
      stats: { generated: generateResult.generated || 0, emailsSent, emailsFailed },
      errors
    }
  } catch (error: any) {
    console.error('[Weekly Cron] Fatal error:', error)
    return { success: false, error: error.message }
  }
})
