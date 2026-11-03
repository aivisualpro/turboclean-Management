import { getScannerSession, publicState, startScan } from '../../../../utils/scanner-session'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/scanner/sessions/:id/scan { allPages = true, append = false } — "Continue": start scanning the open page. */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const s = getScannerSession(getRouterParam(event, 'id')!, actor)
  const body = (await readBody(event)) || {}
  startScan(s, { allPages: body.allPages !== false, append: body.append === true })
  return publicState(s)
})
