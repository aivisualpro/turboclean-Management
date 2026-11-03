import { getCrmDb, str } from '../../utils/crm'
import { previewSite } from '../../utils/scanner-session'
import { requireActor } from '../../utils/automation-http'

/** POST /api/scanner/preview { dealershipId, url? } — full-page screenshot + shortcuts of a dealer page. */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  const body = (await readBody(event)) || {}
  return previewSite(await getCrmDb(), str(body.dealershipId, 40), body.url)
})
