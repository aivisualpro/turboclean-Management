import { connectToDatabase } from '../../utils/mongodb'
import { Resend } from 'resend'

import { applyEmailEvent, ingestInboundEmail, verifyResendSignature } from '../../utils/crm-email'

/**
 * Resend webhook.
 *  - email.sent / delivered / delivery_delayed / bounced / complained / opened / clicked
 *      → CRM email tracking (ignored when the message is not a CRM email)
 *  - email.received
 *      → CRM reply tracking first (reply+<id>@, In-Reply-To, sender = emailed contact);
 *        anything that is not CRM mail keeps the original invoice-mailbox handling below.
 * Set RESEND_WEBHOOK_SECRET to enforce Svix signature verification.
 */
export default defineEventHandler(async (event) => {
  try {
    const raw = (await readRawBody(event, 'utf8')) || ''
    const headers = getHeaders(event) as Record<string, string | undefined>
    if (!(await verifyResendSignature(headers, raw))) {
      setResponseStatus(event, 401)
      return { success: false, error: 'Invalid signature' }
    }
    const payload = raw ? JSON.parse(raw) : {}

    if (payload?.type && payload.type !== 'email.received') {
      const { db } = await connectToDatabase()
      const handled = await applyEmailEvent(db, payload)
      return { success: true, message: handled ? 'CRM email event recorded' : 'Ignored event' }
    }
    if (payload?.type !== 'email.received') {
      return { success: true, message: 'Ignored non-email event' }
    }

    const { db } = await connectToDatabase()
    const emailData = payload.data || {}

    const resend = new Resend(process.env.RESEND_API_KEY)

    // 1. Fetch the full email from Resend API (webhook only sends metadata, not HTML body)
    let fetchedHtml = ''
    let fetchedText = ''
    let fetchedHeaders: any = null
    if (emailData.email_id && process.env.RESEND_API_KEY) {
      try {
        const api: any = resend.emails
        const fullEmail = api.receiving?.get ? await api.receiving.get(emailData.email_id) : await resend.emails.get(emailData.email_id)
        if (fullEmail?.data) {
          fetchedHtml = (fullEmail.data as any).html || ''
          fetchedText = (fullEmail.data as any).text || ''
          fetchedHeaders = (fullEmail.data as any).headers || null
        }
      } catch (err) {
        console.error('[Webhook: Resend] Failed to fetch full email payload:', err)
      }
    }

    // 1b. CRM replies (acquisition emails) — stored in turboCleanCrmEmails and the dealership history.
    try {
      const crm = await ingestInboundEmail(db, payload, { html: fetchedHtml, text: fetchedText, headers: fetchedHeaders })
      if (crm) {
        console.log(`[Webhook: Resend] CRM reply stored (${crm.matchedBy || 'unmatched'})`)
        return { success: true, message: 'CRM reply recorded' }
      }
    } catch (err) {
      console.error('[Webhook: Resend] CRM reply handling failed:', err)
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
