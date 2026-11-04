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

/** Route / visit day: "DAY 1" → "Day 1", "day-2" → "Day 2", otherwise trimmed as typed. */
export function normalizeRoute(v: unknown) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 80)
  const m = s.match(/^day\s*-?\s*(\d{1,3})$/i)
  return m ? `Day ${Number(m[1])}` : s
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
  // "DBA Gates Nissan" (registered as "doing business as") is the same store as "Gates Nissan".
  return String(v ?? '').toLowerCase().replace(/^\s*d\.?b\.?a\.?\s*:?\s*/, '').replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(NAME_NOISE, ' ').replace(/\s+/g, ' ').trim()
}

export const emailKey = (v: unknown) => String(v ?? '').trim().toLowerCase()
export const personKey = (first: unknown, last: unknown) => `${String(first ?? '').trim().toLowerCase()} ${String(last ?? '').trim().toLowerCase()}`.trim()


// Words that stay upper-case when a SHOUTED name is tidied.
const KEEP_UPPER = new Set(['GMC', 'VW', 'BMW', 'KIA', 'CT', 'US', 'USA', 'CDJR', 'RAM', 'SUV', 'LR1', 'PAG', 'SST', 'JB', 'DNBRY', 'MJ', 'A-1', 'II', 'III', 'IV', 'NY', 'NJ', 'MA', 'RI'])
const KEEP_LOWER = new Set(['of', 'and', 'the', 'by', 'at', 'on', 'in'])
/** "DBA GATES GMC BUICK INC" → "Gates GMC Buick"; names typed normally are left alone (only DBA / suffix removed). */
export function cleanDealerName(v: unknown) {
  let s = String(v ?? '').trim().replace(/\s+/g, ' ')
  s = s.replace(/^d\.?b\.?a\.?\s*:?\s*/i, '')
  const letters = s.replace(/\([^)]*\)/g, '').replace(/[^A-Za-z]/g, '')
  const shouted = letters.length >= 4 && letters.replace(/[^A-Z]/g, '').length / letters.length >= 0.8
  if (shouted) {
    s = s.replace(/\s*,\s*/g, ', ').replace(/\s*&\s*/g, ' & ')
    s = s.split(' ').map((w, i) => {
      const core = w.toUpperCase().split(/['’]/)[0]!.replace(/[^A-Z0-9-]/g, '')
      if (KEEP_UPPER.has(core)) return w.toUpperCase().replace(/['’]S\b/, "'s")
      if (i > 0 && KEEP_LOWER.has(w.toLowerCase())) return w.toLowerCase()
      return w.toLowerCase().replace(/(^|[-('/.])([a-z])/g, (_m, p, c) => p + c.toUpperCase()).replace(/^Mc([a-z])/, (_m, c) => `Mc${c.toUpperCase()}`).replace(/'S\b/g, "'s")
    }).join(' ')
  }
  let prev = ''
  while (prev !== s) { prev = s; s = s.replace(/[\s,]+(inc\.?|llc\.?|l\.l\.c\.|corp\.?|ltd\.?|co\.?|the)$/i, '').trim() }
  return s.slice(0, 200)
}
/** A dealer group that is really a visit day ("DAY 5") — older imports put routes there. */
export const looksLikeRouteDay = (v: unknown) => /^\s*day\s*-?\s*\d{1,3}\s*$/i.test(String(v ?? ''))
