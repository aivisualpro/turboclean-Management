import { closeSession, getScannerSession } from '../../../../utils/scanner-session'
import { requireActor } from '../../../../utils/automation-http'

/** DELETE /api/scanner/sessions/:id — close the browser. */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const s = getScannerSession(getRouterParam(event, 'id')!, actor)
  await closeSession(s.id)
  return { ok: true }
})
