import { getCrmDb } from '../../../../utils/crm'
import { recheckPhotos } from '../../../../utils/scanner-session'
import { requireActor } from '../../../../utils/automation-http'

/** POST /api/scanner/scans/:id/recheck — download and judge every photo of a finished crawl again (no new crawl). */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  return recheckPhotos(await getCrmDb(), getRouterParam(event, 'id')!)
})
