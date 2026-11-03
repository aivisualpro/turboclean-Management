import { getCrmDb, str } from '../../utils/crm'
import { discoverInventoryPages } from '../../utils/scanner-discover'
import { requireActor } from '../../utils/automation-http'

/**
 * POST /api/scanner/discover { dealershipId, url?, save? }
 * Finds the dealer's inventory listing pages (menu + known platform paths + AI shortlist), verifies
 * each by counting vehicle cards, and with `save: true` stores the verified ones as the
 * dealership's scan pages.
 */
export default defineEventHandler(async (event) => {
  await requireActor(event)
  const body = (await readBody(event)) || {}
  const db = await getCrmDb()
  const id = str(body.dealershipId, 40)
  const result = await discoverInventoryPages(db, id, body.url)
  let saved: { url: string, label: string }[] | null = null
  if (body.save && result.pages.length) {
    const { CRM_COLLECTIONS, toObjectId } = await import('../../utils/crm')
    saved = result.pages.map(p => ({ url: p.url, label: p.label }))
    await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: toObjectId(id) }, { $set: { scanPages: saved, updatedAt: new Date().toISOString() } })
  }
  return { ...result, saved }
})
