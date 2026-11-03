/**
 * Standardisation + duplicate keys — so the same dealership typed three ways is still one dealership.
 */

export const US_STATE_CODES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC', 'washington dc': 'DC', 'washington d.c.': 'DC',
}
const CODES = new Set(Object.values(US_STATE_CODES))

/** "connecticut" / "Ct" / "CT " → "CT". Unknown values are returned trimmed (and flagged by the data-quality scan). */
export function normalizeState(v: unknown) {
  const s = String(v ?? '').trim()
  if (!s) return ''
  const up = s.toUpperCase().replace(/\./g, '')
  if (CODES.has(up)) return up
  return US_STATE_CODES[s.toLowerCase()] || s
}
export const isStateCode = (v: string) => CODES.has(v)

export const CAR_BRANDS = [
  'Acura', 'Alfa Romeo', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler', 'Dodge', 'Ferrari',
  'Fiat', 'Ford', 'Genesis', 'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Jaguar', 'Jeep', 'Kia', 'Lamborghini', 'Land Rover', 'Lexus',
  'Lincoln', 'Lucid', 'Maserati', 'Mazda', 'McLaren', 'Mercedes-Benz', 'MINI', 'Mitsubishi', 'Nissan', 'Polestar', 'Porsche', 'Ram',
  'Rivian', 'Rolls-Royce', 'Subaru', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo', 'Harley-Davidson', 'Kawasaki', 'Yamaha', 'Used / independent',
] as const
const BRAND_ALIASES: Record<string, string> = {
  chevy: 'Chevrolet', vw: 'Volkswagen', mercedes: 'Mercedes-Benz', 'mercedes benz': 'Mercedes-Benz', benz: 'Mercedes-Benz',
  'land-rover': 'Land Rover', landrover: 'Land Rover', 'range rover': 'Land Rover', mini: 'MINI', 'rolls royce': 'Rolls-Royce',
  cdjr: 'Chrysler', 'chrysler dodge jeep ram': 'Chrysler', 'alfa': 'Alfa Romeo', infinity: 'Infiniti', hyundia: 'Hyundai',
  used: 'Used / independent', independent: 'Used / independent', 'pre-owned': 'Used / independent', preowned: 'Used / independent',
}
/** "toyota", "TOYOTA " → "Toyota"; "CDJR" → Chrysler, Dodge, Jeep, Ram. Unknown brands keep their spelling (title-cased). */
export function normalizeBrands(v: unknown): string[] {
  const list = Array.isArray(v) ? v : String(v ?? '').split(/[,;/|]+/)
  const out: string[] = []
  for (const raw of list) {
    const s = String(raw ?? '').trim()
    if (!s) continue
    const k = s.toLowerCase().replace(/\s+/g, ' ')
    if (k === 'cdjr' || k === 'chrysler dodge jeep ram') { out.push('Chrysler', 'Dodge', 'Jeep', 'Ram'); continue }
    const hit = (CAR_BRANDS as readonly string[]).find(b => b.toLowerCase() === k) || BRAND_ALIASES[k]
    out.push(hit || s.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 60))
  }
  return [...new Set(out)]
}
export const isKnownBrand = (b: string) => (CAR_BRANDS as readonly string[]).includes(b)

/** 10-digit US numbers → (203) 555-0100; anything else kept as typed. */
export function normalizePhone(v: unknown) {
  const s = String(v ?? '').trim()
  const d = s.replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  if (ten.length === 10 && !/x|ext/i.test(s)) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
  return s.slice(0, 40)
}
export const phoneKey = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }

/** "new haven" → "New Haven" (only when typed all lower/upper case). */
export function normalizeCity(v: unknown) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 120)
  if (s && (s === s.toLowerCase() || s === s.toUpperCase())) return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  return s
}

/** https://www.Smith-Toyota.com/new → smith-toyota.com */
export function websiteKey(v: unknown) {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return ''
  try { return new URL(s.startsWith('http') ? s : `https://${s}`).hostname.replace(/^www\./, '') } catch { return '' }
}

const NAME_NOISE = /\b(the|of|inc|llc|co|corp|dealership|auto|automotive|motors?|cars?|group|sales)\b/g
/** "The Smith Toyota of Hartford, LLC" → "smith toyota hartford" — for fuzzy duplicate matching. */
export function nameKey(v: unknown) {
  return String(v ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(NAME_NOISE, ' ').replace(/\s+/g, ' ').trim()
}

export const emailKey = (v: unknown) => String(v ?? '').trim().toLowerCase()
export const personKey = (first: unknown, last: unknown) => `${String(first ?? '').trim().toLowerCase()} ${String(last ?? '').trim().toLowerCase()}`.trim()
