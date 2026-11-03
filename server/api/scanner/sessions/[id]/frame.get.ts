import { getScannerSession } from '../../../../utils/scanner-session'
import { requireActor } from '../../../../utils/automation-http'

/** GET /api/scanner/sessions/:id/frame — latest screencast frame as JPEG (fallback when SSE is blocked). */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const s = getScannerSession(getRouterParam(event, 'id')!, actor)
  if (!s.frame) { setResponseStatus(event, 204); return null }
  setHeader(event, 'content-type', 'image/jpeg')
  setHeader(event, 'cache-control', 'no-store')
  return Buffer.from(s.frame.data, 'base64')
})
