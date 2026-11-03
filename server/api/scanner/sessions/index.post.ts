import { getCrmDb, str } from '../../../utils/crm'
import { createSession, publicState } from '../../../utils/scanner-session'
import { requireActor } from '../../../utils/automation-http'

/** POST /api/scanner/sessions { dealershipId, url? } — open a live browser on the dealership's website. */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const body = (await readBody(event)) || {}
  const s = await createSession(await getCrmDb(), str(body.dealershipId, 64), str(body.url, 1000) || undefined, actor)
  return publicState(s)
})
