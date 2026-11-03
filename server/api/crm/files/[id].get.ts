import { getCrmDb } from '../../../utils/crm'
import { getFile } from '../../../utils/crm-files'

/** GET /api/crm/files/:id — serves a stored CRM image (used for previews in the app). */
export default defineEventHandler(async (event) => {
  const f = await getFile(await getCrmDb(), getRouterParam(event, 'id')!)
  if (!f) throw createError({ statusCode: 404, statusMessage: 'File not found' })
  setHeader(event, 'Content-Type', f.contentType)
  setHeader(event, 'Cache-Control', 'private, max-age=86400')
  return f.data
})
