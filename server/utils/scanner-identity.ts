/**
 * Inventory Scanner — which card is which vehicle.
 *
 * A list page is read several times while it loads (lazy sections, infinite scroll) and again on the
 * next result page. The same car must stay ONE record however the card reads at that moment:
 *   - many sites fill the VIN in a moment after the card appears, so the first reading has no VIN and
 *     the next one does — keyed by "VIN, else address" that was two vehicles (288 counted where the
 *     site lists 266, and the crawl stopped early because it thought it had them all);
 *   - a card can lose its link or its VIN between two readings (a different layout of the same list).
 *
 * So a card is matched to a known vehicle by VIN first, then by the address of its own page, then by
 * stock number — never when the two disagree on the VIN or the model year, and never by an address
 * that several cards share (a "Get pre-approved" link is not a vehicle's page).
 */
import type { ScanVehicle } from './scanner-images'

const VIN_OK = /^[A-HJ-NPR-Z0-9]{17}$/
const pageOf = (u: any) => String(u || '').split('#')[0]!.trim()
const vinOf = (v: any) => { const x = String(v || '').toUpperCase(); return VIN_OK.test(x) ? x : '' }
const stockOf = (s: any) => { const x = String(s || '').trim().toUpperCase(); return x.length >= 4 ? x : '' }
const yearOf = (c: any): number | null => { const y = Number(c?.year) || Number(String(c?.title || '').match(/(?:^|\D)(19[89]\d|20[0-3]\d)(?!\d)/)?.[1]); return y > 1980 ? y : null }

/** Same car? Never when both name a VIN and they differ, or both name a model year and they differ. */
function compatible(a: any, b: any) {
  const va = vinOf(a.vin), vb = vinOf(b.vin)
  if (va && vb && va !== vb) return false
  const ya = yearOf(a), yb = yearOf(b)
  return !(ya && yb && ya !== yb)
}
const betterImage = (a: any, b: any) => (!a?.url && !!b?.url) || (!!a?.url && !!b?.url && a.url !== b.url && (a.nw || 0) === 0 && (b.nw || 0) > 0)

/** The record's permanent key (review choices are stored against it): VIN, else its page, else stock #, else what the card shows. */
export function vehicleKeyOf(c: any, sharedPage = false) {
  const vin = vinOf(c.vin)
  if (vin) return `vin:${vin}`
  if (c.url && !sharedPage) return `url:${pageOf(c.url)}`
  if (c.stock) return `stock:${c.stock}`
  return `t:${c.title}|${c.price}|${c.image?.url || ''}`
}

/** What a later reading of the same card adds: the VIN, a link, a price, a better picture. Nothing is overwritten. */
export function mergeCard(v: ScanVehicle, c: any) {
  if (!v.vin && vinOf(c.vin)) v.vin = vinOf(c.vin)
  if (!v.url && c.url) v.url = c.url
  if (!v.stock && c.stock) v.stock = c.stock
  if (!v.price && c.price) v.price = c.price
  if (c.title && (!v.title || (!yearOf({ title: v.title }) && yearOf({ title: c.title })))) v.title = c.title
  if (!v.year && c.year) v.year = c.year
  if (!v.make && c.make) v.make = c.make
  if (!v.model && c.model) v.model = c.model
  if (!v.condition && ['new', 'used', 'certified'].includes(c.condition)) v.condition = c.condition
  if (betterImage(v.image, c.image)) v.image = c.image
  if (!v.noPhotoText && c.noPhotoText) v.noPhotoText = c.noPhotoText
  if ((c.imageCount || 0) > (v.imageCount || 0)) v.imageCount = c.imageCount
  if (!v.photoCountText && c.photoCountText) v.photoCountText = c.photoCountText
  if (!v.cardText && c.text) v.cardText = String(c.text).slice(0, 240)
}

export function createVehicleIndex(vehicles: ScanVehicle[]) {
  const byKey = new Map<string, ScanVehicle>()
  const byVin = new Map<string, ScanVehicle>()
  const byPage = new Map<string, ScanVehicle>()
  const byStock = new Map<string, ScanVehicle>()
  /** Addresses that more than one card of a reading points to — not a vehicle's own page. */
  const shared = new Set<string>()
  const stockKey = (v: any) => { const s = stockOf(v.stock); return s ? `${v.listUrl || ''}|${s}` : '' }
  const add = (v: ScanVehicle) => {
    byKey.set(v.key, v)
    const vin = vinOf(v.vin); if (vin && !byVin.has(vin)) byVin.set(vin, v)
    const page = pageOf(v.url); if (page && !shared.has(page) && !byPage.has(page)) byPage.set(page, v)
    const sk = stockKey(v); if (sk && !byStock.has(sk)) byStock.set(sk, v)
  }
  // An address that stored vehicles with different VINs share is not a vehicle's own page.
  const pageVins = new Map<string, Set<string>>()
  for (const v of vehicles) { const page = pageOf(v.url), vin = vinOf(v.vin); if (page && vin) pageVins.set(page, (pageVins.get(page) || new Set<string>()).add(vin)) }
  for (const [page, vins] of pageVins) if (vins.size > 1) shared.add(page)
  for (const v of vehicles) add(v)

  return {
    shared,
    /** Call with every reading before matching its cards: an address on two different cards is marked as shared. */
    noteReading(cards: any[]) {
      const first = new Map<string, any>()
      for (const c of cards || []) {
        const page = pageOf(c?.url); if (!page) continue
        const had = first.get(page)
        if (!had) { first.set(page, c); continue }
        // Two cards, one address: the same card read twice (same VIN / no VIN and the same title) is fine; anything else is a shared link.
        const same = (k: string) => String(had[k] || '') === String(c[k] || '')
        const sameCard = vinOf(had.vin) && vinOf(c.vin) ? vinOf(had.vin) === vinOf(c.vin) : (same('title') && same('price') && same('stock') && compatible(had, c))
        if (!sameCard) { shared.add(page); byPage.delete(page) }
      }
    },
    isShared: (url: any) => shared.has(pageOf(url)),
    /** A key for a vehicle seen for the first time (never one already taken). */
    keyFor(c: any) {
      const base = vehicleKeyOf(c, shared.has(pageOf(c.url)))
      let k = base
      for (let n = 2; byKey.has(k); n++) k = `${base}#${n}`
      return k
    },
    /** The vehicle this card belongs to, when it is already known. */
    find(c: any, listUrl = ''): ScanVehicle | null {
      const vin = vinOf(c.vin)
      if (vin) { const v = byVin.get(vin); if (v) return v }
      const page = pageOf(c.url)
      if (page && !shared.has(page)) { const v = byPage.get(page); if (v && compatible(v, c)) return v }
      const s = stockOf(c.stock)
      if (s) { const v = byStock.get(`${listUrl}|${s}`); if (v && compatible(v, c) && (!vin || !vinOf(v.vin))) return v }
      const v = byKey.get(vehicleKeyOf(c, !!page && shared.has(page)))
      return v && compatible(v, c) ? v : null
    },
    /** Forget a vehicle that turned out not to belong to the list. */
    remove(v: ScanVehicle) {
      if (byKey.get(v.key) === v) byKey.delete(v.key)
      const vin = vinOf(v.vin); if (vin && byVin.get(vin) === v) byVin.delete(vin)
      const page = pageOf(v.url); if (page && byPage.get(page) === v) byPage.delete(page)
      const sk = stockKey(v); if (sk && byStock.get(sk) === v) byStock.delete(sk)
    },
    /** A later reading of a known vehicle: keep what it adds and index the new facts (its VIN, its page). */
    merge(v: ScanVehicle, c: any) { mergeCard(v, c); add(v) },
    add,
  }
}

/**
 * One pass over stored vehicles: a record without a VIN that points to the same page as exactly one
 * record with a VIN is that same car (read before its VIN appeared). The VIN record stays; a person's
 * choices on the other one move over. Returns how many were folded in.
 */
export function foldTwinVehicles(vehicles: ScanVehicle[]): { vehicles: ScanVehicle[], folded: number } {
  const withVin = new Map<string, ScanVehicle[]>()
  for (const v of vehicles) { const page = pageOf(v.url); if (page && vinOf(v.vin)) withVin.set(page, [...(withVin.get(page) || []), v]) }
  const noVin = new Map<string, number>()
  for (const v of vehicles) { const page = pageOf(v.url); if (page && !vinOf(v.vin)) noVin.set(page, (noVin.get(page) || 0) + 1) }
  const drop = new Set<ScanVehicle>()
  for (const v of vehicles) {
    if (vinOf(v.vin)) continue
    const page = pageOf(v.url)
    const twins = page ? withVin.get(page) : null
    if (!twins || twins.length !== 1 || noVin.get(page) !== 1 || !compatible(twins[0], v)) continue
    const keep = twins[0]!
    if (!keep.override && v.override) keep.override = v.override
    if (!keep.listing && v.listing) keep.listing = v.listing
    if (betterImage(keep.image, v.image)) keep.image = v.image
    if (!keep.noPhotoText && v.noPhotoText) keep.noPhotoText = v.noPhotoText
    drop.add(v)
  }
  return drop.size ? { vehicles: vehicles.filter(v => !drop.has(v)), folded: drop.size } : { vehicles, folded: 0 }
}
