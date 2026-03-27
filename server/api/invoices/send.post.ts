import { Resend } from 'resend'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { email, html, subject } = body

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
    return { success: true, data }
  } catch (error: any) {
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to send email' })
  }
})
