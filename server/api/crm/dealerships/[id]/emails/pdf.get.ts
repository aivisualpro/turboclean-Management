import { CRM_COLLECTIONS, actorFromSession, getCrmDb, toObjectId } from '../../../../../utils/crm'
import { auditEmailTemplateId, emailPreviewDocument } from '../../../../../utils/crm-email'
import { getUserSession } from '../../../../../utils/auth'

/**
 * GET /api/crm/dealerships/:id/emails/pdf?templateId=…|audit&contactId=…&format=pdf|html&download=1
 * The email this dealership would get from a template (its latest audit + contact), as a PDF —
 * nothing is sent. Handy to print or hand over when there is no contact email yet.
 * `templateId=audit` (or none) is the inventory-audit email.
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const q = getQuery(event)
  const db = await getCrmDb()
  let templateId = String(q.templateId || '')
  if (!templateId || templateId === 'audit') templateId = (await auditEmailTemplateId(db)) || ''
  if (!templateId) throw createError({ statusCode: 400, statusMessage: 'Pick a template first' })
  const dealership = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: toObjectId(getRouterParam(event, 'id')!) })
  if (!dealership) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  const { html, fileName } = await emailPreviewDocument(db, dealership, { templateId, contactId: q.contactId ? String(q.contactId) : null }, actorFromSession(session))
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (q.format === 'html') { setHeader(event, 'Content-Type', 'text/html; charset=utf-8'); return html }
  const { cachedPdf } = await import('../../../../../utils/crm-reports')
  const pdf = await cachedPdf(db, `email-preview:${dealership._id}`, html)
  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `${q.download ? 'attachment' : 'inline'}; filename="${fileName}.pdf"`)
  return pdf
})
