import { connectToDatabase } from '../../utils/mongodb'
import { Resend } from 'resend' // Optional: if we needed to verify signatures, but we will just trust it for now or rely on Resend's security.

export default defineEventHandler(async (event) => {
  try {
    const payload = await readBody(event)

    // Check if it's an email received event
    if (payload?.type !== 'email.received') {
      return { success: true, message: 'Ignored non-email event' }
    }

    const { db } = await connectToDatabase()
    const emailData = payload.data || {}

    // Extract clean email address from "Sender Name <sender@domain.com>"
    const rawFrom = emailData.from || ''
    const fromMatch = rawFrom.match(/<([^>]+)>/)
    const senderEmail = fromMatch ? fromMatch[1].trim() : rawFrom.trim()

    // Extract TO address similarly handles arrays
    const rawTo = Array.isArray(emailData.to) ? emailData.to[0] : (emailData.to || '')
    const toMatch = rawTo.match(/<([^>]+)>/)
    const toEmail = toMatch ? toMatch[1].trim() : rawTo.trim()

    // 1. Identify Dealer by the sender's email
    // This perfectly matches the user's suggestion: find the dealer by checking their known email
    const dealer = await db.collection('turboCleanDealers').findOne({ 
      email: { $regex: new RegExp(`^${senderEmail}$`, 'i') } 
    })

    // Prepare attachments if any
    const attachments = (emailData.attachments || []).map((att: any) => ({
      filename: att.filename,
      content: att.content // Base64 or URL depending on Resend API payload shape
    }))

    // Construct the standard Mailbox schema object we just designed for the UI
    const inboundEmailRecord = {
      dealerId: dealer ? dealer._id.toString() : null, // If null, it's an orphan email, but keep it!
      type: 'Incoming',
      folder: 'inbox',
      status: 'Delivered', // For inbound, "Delivered" or "Received"
      subject: emailData.subject || '(No Subject)',
      from: senderEmail,
      to: toEmail,
      bodyHtml: emailData.html || `<p>${emailData.text?.replace(/\n/g, '<br>') || 'No content'}</p>`,
      bodyText: emailData.text || '',
      attachments: attachments,
      receivedAt: new Date(payload.created_at || emailData.created_at || new Date()).toISOString(),
      resendEventId: payload.id || null,
      messageId: emailData.id || null
    }

    // 2. Save it to our database!
    await db.collection('turboCleanEmailLogs').insertOne(inboundEmailRecord)
    
    // Quick tip: If you wanted real-time frontend updates, we could emit a sockets event here, 
    // but the Next/Nuxt fetch pattern handles it fast enough on re-visit.

    return { success: true, message: 'Email ingested and routed correctly' }
  } catch (error: any) {
    console.error('[Webhooks: Resend Inbound Error]', error)
    return createError({ statusCode: 500, statusMessage: error.message || 'Webhook consumption failed' })
  }
})
