import { getCrmDb } from '../../../../../utils/crm'
import { emailArchiveHtml } from '../../../../../utils/crm-email'
import { getUserSession } from '../../../../../utils/auth'

/**
 * GET /api/crm/email/messages/:id/archive?format=html|pdf&download=1
 * The email exactly as it was sent (envelope + original HTML, inline images embedded), as a page or a PDF.
 */
export default defineEventHandler(async (event) => {
  if (!(await getUserSession(event))) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const db = await getCrmDb()
  const q = getQuery(event)
  const { html, email } = await emailArchiveHtml(db, getRouterParam(event, 'id')!)
  const name = `${String(email.dealershipName || 'email').replace(/[^\w]+/g, '-')}_${String(email.sentAt || email.receivedAt || '').slice(0, 10)}_${String(email.subject || '').replace(/[^\w]+/g, '-').slice(0, 50)}`.replace(/-+/g, '-')
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (q.format === 'pdf') {
    const { cachedPdf } = await import('../../../../../utils/crm-reports')
    const pdf = await cachedPdf(db, `email:${email._id}`, html)
    setHeader(event, 'Content-Type', 'application/pdf')
    setHeader(event, 'Content-Disposition', `${q.download ? 'attachment' : 'inline'}; filename="${name}.pdf"`)
    return pdf
  }
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  if (q.download) setHeader(event, 'Content-Disposition', `attachment; filename="${name}.html"`)
  return html
})
