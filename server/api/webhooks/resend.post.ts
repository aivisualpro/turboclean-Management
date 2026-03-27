import { connectToDatabase } from '../../utils/mongodb'
import { Resend } from 'resend' // Optional: if we needed to verify signatures, but we will just trust it for now or rely on Resend's security.

export default defineEventHandler(async (event) => {
  try {
    const payload = await readBody(event)

    const resend = new Resend(process.env.RESEND_API_KEY)
    
    // Check if it's an email received event
    if (payload?.type !== 'email.received') {
      return { success: true, message: 'Ignored non-email event' }
    }

    const { db } = await connectToDatabase()
    const emailData = payload.data || {}

    // 1. Fetch the actual full email structure from Resend API (since Webhook omits HTML bodies)
    let fetchedHtml = ''
    let fetchedText = ''
    if (emailData.email_id && process.env.RESEND_API_KEY) {
      try {
        const fullEmail = await resend.emails.get(emailData.email_id)
        if (fullEmail.data) {
          fetchedHtml = fullEmail.data.html || ''
          fetchedText = fullEmail.data.text || ''
        }
      } catch (err) {
        console.error('[Webhooks: Resend Inbound Error] Failed to fetch full payload:', err)
      }
    }

    // Extract clean email address from "Sender Name <sender@domain.com>"
    const rawFrom = emailData.from || ''
    const fromMatch = rawFrom.match(/<([^>]+)>/)
    const senderEmail = fromMatch ? fromMatch[1].trim() : rawFrom.trim()

    // Extract TO address similarly handles arrays
    const rawTo = Array.isArray(emailData.to) ? emailData.to[0] : (emailData.to || '')
    const toMatch = rawTo.match(/<([^>]+)>/)
    const toEmail = toMatch ? toMatch[1].trim() : rawTo.trim()

    // 2. Identify Dealer Setup
    // Strategy A: Match Dealer by sender's exact email
    let dealer = await db.collection('turboCleanDealers').findOne({ 
      email: { $regex: new RegExp(`^${senderEmail}$`, 'i') } 
    })

    // Strategy B: If no dealer matches (like when testing from a developer email), 
    // extract invoice number from "Re: Invoice D-INV-XXXXX" and find the attached dealer.
    if (!dealer && emailData.subject) {
      // Match both D-INV-12345678-1234 and W-INV-2026-01037 formats
      const invoiceMatch = emailData.subject.match(/((?:D|W)-INV-[\d\-]+)/i)
      if (invoiceMatch) {
        const invNumber = invoiceMatch[1].toUpperCase()
        const invoice = await db.collection('turboCleanInvoices').findOne({ number: invNumber })
        if (invoice && invoice.dealerId) {
          try {
            const { ObjectId } = require('mongodb')
            const dId = typeof invoice.dealerId === 'string' ? new ObjectId(invoice.dealerId) : invoice.dealerId
            dealer = await db.collection('turboCleanDealers').findOne({ _id: dId })
          } catch (err) {
            console.error('[Webhooks: Resend Inbound] Dealer ID cast failed', err)
          }
        }
      }
    }

    // Prepare attachments if any
    const attachments = (emailData.attachments || []).map((att: any) => ({
      filename: att.filename,
      content: att.content // Base64 or URL depending on Resend API payload shape
    }))

    // Construct the standard Mailbox schema object we just designed for the UI
    const inboundEmailRecord = {
      dealerId: dealer ? dealer._id.toString() : null, // If null, it's an orphan email
      type: 'Incoming',
      folder: 'inbox',
      status: 'Delivered', 
      subject: emailData.subject || '(No Subject)',
      from: senderEmail,
      to: toEmail,
      bodyHtml: fetchedHtml || `<p>${fetchedText?.replace(/\n/g, '<br>') || emailData.text?.replace(/\n/g, '<br>') || 'No HTML body provided in payload.'}</p>`,
      bodyText: fetchedText || emailData.text || '',
      attachments: attachments,
      receivedAt: new Date(payload.created_at || emailData.created_at || new Date()).toISOString(),
      resendEventId: payload.id || null,
      messageId: emailData.id || emailData.email_id || null
    }

    // 3. Save it to our database!
    await db.collection('turboCleanEmailLogs').insertOne(inboundEmailRecord)
    
    return { success: true, message: 'Email ingested and routed correctly' }
  } catch (error: any) {
    console.error('[Webhooks: Resend Inbound Error]', error)
    return createError({ statusCode: 500, statusMessage: error.message || 'Webhook consumption failed' })
  }
})
