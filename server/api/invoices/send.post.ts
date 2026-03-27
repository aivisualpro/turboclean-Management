import { Resend } from 'resend'
import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { email, html, subject, dealerId, invoiceId } = body

  if (!email || !html || !subject) {
    throw createError({ statusCode: 400, statusMessage: 'Missing parameters' })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)

  try {
    const data = await resend.emails.send({
      from: 'billing@zrzops.com',
      to: email,
      subject: subject,
      html: html,
    })

    if (dealerId) {
      const { db } = await connectToDatabase()
      await db.collection('turboCleanEmailLogs').insertOne({
        dealerId,
        invoiceId,
        email,
        subject,
        type: 'Invoice',
        status: 'Sent',
        sentAt: new Date().toISOString()
      })
    }

    return { success: true, data }
  } catch (error: any) {
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to send email' })
  }
})
