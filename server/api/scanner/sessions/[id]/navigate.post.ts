import { getScannerSession, navigate } from '../../../../utils/scanner-session'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/scanner/sessions/:id/navigate { url } | { action: back|forward|reload } */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const s = getScannerSession(getRouterParam(event, 'id')!, actor)
  await navigate(s, (await readBody(event)) || {})
  return { ok: true }
})
