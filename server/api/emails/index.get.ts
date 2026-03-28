import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const dealerId = query.dealerId as string

  if (!dealerId) throw createError({ statusCode: 400, statusMessage: 'Missing dealerId' })

  try {
    const { db } = await connectToDatabase()
    // Sort by receivedAt DESC — covers both inbound (receivedAt) and outbound (mapped as receivedAt)
    const logs = await db
      .collection('turboCleanEmailLogs')
      .find({ dealerId })
      .sort({ receivedAt: -1, sentAt: -1 })
      .toArray()

    return logs.map(doc => ({
      id: doc._id.toString(),
      invoiceId: doc.invoiceId,
      email: doc.email,
      subject: doc.subject,
      type: doc.type,
      status: doc.status,
      sentAt: doc.sentAt,
      // Automation flag — true when sent by cron automation
      sentByAutomation: doc.sentByAutomation === true,
      // Mailbox Support Fields:
      folder: doc.folder || 'sent',
      from: doc.from,
      to: doc.to,
      bodyHtml: doc.bodyHtml,
      bodyText: doc.bodyText,
      attachments: doc.attachments,
      receivedAt: doc.receivedAt || doc.sentAt,
    }))
  } catch (error: any) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
