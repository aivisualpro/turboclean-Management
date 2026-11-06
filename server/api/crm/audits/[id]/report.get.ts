import { getCrmDb } from '../../../../utils/crm'
import { getUserSession } from '../../../../utils/auth'
import { applyReportSettings, cachedPdf, getAuditReport, getReportSettings, reportToken } from '../../../../utils/crm-reports'

/**
 * GET /api/crm/audits/:id/report?format=html|pdf&download=1[&t=token]
 * A dealer's inventory analysis report for one audit, exactly as stored when the audit was recorded.
 * Signed in → always. With a valid `t` token → public (the {{reportUrl}} link in emails).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''
  const q = getQuery(event)
  const token = String(q.t || '')
  const isPublic = !!token
  if (isPublic ? token !== reportToken(id) : !(await getUserSession(event))) throw createError({ statusCode: isPublic ? 404 : 401, statusMessage: isPublic ? 'Report not found' : 'Sign in first' })
  const db = await getCrmDb()
  const report: any = await getAuditReport(db, id)
  // Team settings (e.g. the over-time chart switched off) apply to stored reports too.
  report.html = applyReportSettings(report.html, await getReportSettings(db))
  const name = `${String(report.dealershipName || 'dealer').replace(/[^\w]+/g, '-')}_inventory-report_${String(report.auditedAt).slice(0, 10)}`
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Robots-Tag', 'noindex')
  if (q.format === 'pdf') {
    const pdf = await cachedPdf(db, `report:${id}`, report.html.replace('__REPORT_ACTIONS__', ''))
    setHeader(event, 'Content-Type', 'application/pdf')
    setHeader(event, 'Content-Disposition', `${q.download ? 'attachment' : 'inline'}; filename="${name}.pdf"`)
    return pdf
  }
  const pdfHref = `?format=pdf&download=1${isPublic ? `&t=${encodeURIComponent(token)}` : ''}`
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return report.html.replace('__REPORT_ACTIONS__', q.embed ? '' : `<a href="${pdfHref}">Download PDF</a>`)
})
