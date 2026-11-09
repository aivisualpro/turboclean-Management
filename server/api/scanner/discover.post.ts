import { getCrmDb, str } from '../../utils/crm'
import { discoverInventoryPages } from '../../utils/scanner-discover'
import { requireActor } from '../../utils/automation-http'

/**
 * POST /api/scanner/discover { dealershipId, url?, save?: true | 'merge' }
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
    const { sanitizeScanPages } = await import('../../utils/scanner-scope')
    const col = db.collection(CRM_COLLECTIONS.dealerships)
    const before = await col.findOne({ _id: toObjectId(id) }, { projection: { scanPages: 1 } })
    // Verified pages only, each stamped with what was just seen on it (the health badge next to the page).
    const at = new Date().toISOString()
    // `save: 'merge'` keeps the pages already saved and adds the newly verified ones; `save: true` replaces the list.
    const keep = body.save === 'merge' ? sanitizeScanPages(before?.scanPages, before?.scanPages).pages : []
    const clean = sanitizeScanPages([...keep, ...result.pages.map(p => ({ url: p.url, label: p.label }))], before?.scanPages).pages
    const { scopeKey } = await import('../../utils/scanner-scope')
    saved = clean.map((p) => {
      const seen = result.pages.find(x => scopeKey(x.url) === scopeKey(p.url))
      if (!seen) return p
      return { url: p.url, label: p.label || seen.label, health: { status: 'ok', vehicles: seen.cards || 0, advertised: seen.total ?? null, at, note: 'Verified by page detection', landedUrl: null } }
    }) as any
    if (saved!.length) await col.updateOne({ _id: toObjectId(id) }, { $set: { scanPages: saved, updatedAt: at } })
    else saved = null
  }
  return { ...result, saved }
})
