import { getCrmDb, str } from '../../utils/crm'
import { verifyScanPage } from '../../utils/scanner-discover'
import { requireActor } from '../../utils/automation-http'

/**
 * POST /api/scanner/check-page { dealershipId, url }
 * Opens one scan page and reports what is there: vehicle listings (how many), a forward to the home
 * page, nothing, or a refusal. Saved on the scan page as its health badge.
 */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  const body = (await readBody(event)) || {}
  return verifyScanPage(await getCrmDb(), str(body.dealershipId, 40), str(body.url, 2000))
})
