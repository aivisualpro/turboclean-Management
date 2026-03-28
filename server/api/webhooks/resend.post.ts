import { connectToDatabase } from '../../utils/mongodb'
import { Resend } from 'resend'

export default defineEventHandler(async (event) => {
  try {
    const payload = await readBody(event)

    // Check if it's an email received event
    if (payload?.type !== 'email.received') {
      return { success: true, message: 'Ignored non-email event' }
    }

    const { db } = await connectToDatabase()
    const emailData = payload.data || {}

    const resend = new Resend(process.env.RESEND_API_KEY)

    // 1. Fetch the full email from Resend API (webhook only sends metadata, not HTML body)
    let fetchedHtml = ''
    let fetchedText = ''
    if (emailData.email_id && process.env.RESEND_API_KEY) {
      try {
        const fullEmail = await resend.emails.get(emailData.email_id)
        if (fullEmail.data) {
          fetchedHtml = (fullEmail.data as any).html || ''
          fetchedText = (fullEmail.data as any).text || ''
        }
      } catch (err) {
        console.error('[Webhook: Resend] Failed to fetch full email payload:', err)
      }
    }

    // 2. Parse sender / recipient
    const rawFrom = emailData.from || ''
    const fromMatch = rawFrom.match(/<([^>]+)>/)
    const senderEmail = fromMatch ? fromMatch[1].trim() : rawFrom.trim()

    const rawTo = Array.isArray(emailData.to) ? emailData.to[0] : (emailData.to || '')
    const toMatch = rawTo.match(/<([^>]+)>/)
    const toEmail = toMatch ? toMatch[1].trim() : rawTo.trim()

    // 3. Identify the dealer
    // Strategy A: Match by sender email in the `dealers` collection
    let dealer = await db.collection('dealers').findOne({
      $or: [
        { email: { $regex: new RegExp(`^${senderEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
        { 'contacts.emails': senderEmail }
      ]
    })

    // Strategy B: Extract invoice number from subject line ("Re: Invoice D-INV-...")
    if (!dealer && emailData.subject) {
      const invoiceMatch = emailData.subject.match(/((?:D|W)-INV-[\d\-]+)/i)
      if (invoiceMatch) {
        const invNumber = invoiceMatch[1].toUpperCase()
        const invoice = await db.collection('turboCleanInvoices').findOne({ number: invNumber })
        if (invoice?.dealerId) {
          const dealerIdStr = invoice.dealerId.toString()
          // Search by string ID (stored as string in dealers collection)
          dealer = await db.collection('dealers').findOne({
            $or: [
              { _id: dealerIdStr as any },
              { id: dealerIdStr }
            ]
          })
          // Fallback: try ObjectId cast
          if (!dealer) {
            try {
              const { ObjectId } = require('mongodb')
              dealer = await db.collection('dealers').findOne({ _id: new ObjectId(dealerIdStr) })
            } catch (_) {}
          }
        }
      }
    }

    // 4. Prepare attachments
    const attachments = (emailData.attachments || []).map((att: any) => ({
      filename: att.filename,
      content: att.content // base64 string or URL as provided by Resend
    }))

    // 5. Persist as inbound email record in turboCleanEmailLogs
    const inboundRecord = {
      dealerId: dealer ? dealer._id.toString() : null,
      type: 'Incoming',
      folder: 'inbox',
      status: 'Delivered',
      subject: emailData.subject || '(No Subject)',
      from: senderEmail,
      to: toEmail,
      bodyHtml: fetchedHtml
        || `<p>${(fetchedText || emailData.text || 'No body provided.').replace(/\n/g, '<br>')}</p>`,
      bodyText: fetchedText || emailData.text || '',
      attachments,
      receivedAt: new Date(payload.created_at || emailData.created_at || Date.now()).toISOString(),
      resendEventId: payload.id || null,
      messageId: emailData.id || emailData.email_id || null,
    }

    await db.collection('turboCleanEmailLogs').insertOne(inboundRecord)

    console.log(`[Webhook: Resend] Ingested inbound email from ${senderEmail}, dealer=${dealer?._id || 'orphan'}`)
    return { success: true, message: 'Email ingested and routed correctly' }
  } catch (error: any) {
    console.error('[Webhook: Resend] Error:', error)
    // Return 200 to prevent Resend from retrying indefinitely
    return { success: false, error: error.message }
  }
})
