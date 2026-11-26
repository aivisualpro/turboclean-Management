import { getCrmDb } from '../../../utils/crm'
import { saveRule } from '../../../utils/scanner-images'
import { getScan } from '../../../utils/scanner-session'
import { requireActor } from '../../../utils/automation-http'

/**
 * POST /api/scanner/rules { hash?, urlContains?, verdict, label?, thumb? }
 * or { scanId, imageId, verdict, … } — a rule for a picture of a crawl: its fingerprints are read from the stored crawl.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const db = await getCrmDb()
  const body = (await readBody(event)) || {}
  if (body.scanId && body.imageId) {
    const scan = await getScan(db, String(body.scanId))
    const img = (scan.images || []).find(i => i.id === String(body.imageId))
    if (!img?.hash) throw createError({ statusCode: 400, statusMessage: 'This picture could not be measured, so it cannot be remembered' })
    Object.assign(body, { hash: img.hash, hash2: img.hash2 || undefined, fp: img.fp || undefined, thumb: body.thumb || img.url })
  }
  return { rule: await saveRule(db, body, actor) }
})
