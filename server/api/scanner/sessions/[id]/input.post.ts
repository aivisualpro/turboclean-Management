import { getScannerSession, sendInput } from '../../../../utils/scanner-session'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/scanner/sessions/:id/input { type: move|click|wheel|key|text, x, y, dx, dy, key, text } */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const s = getScannerSession(getRouterParam(event, 'id')!, actor)
  const body = (await readBody(event)) || {}
  const list = Array.isArray(body.events) ? body.events.slice(0, 50) : [body]
  for (const e of list) await sendInput(s, e).catch(() => {})
  return { ok: true }
})
