/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF, BOM). Returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++ } else quoted = false }
      else cell += c
    }
    else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(x => x.trim())) rows.push(row)
      row = []
    }
    else cell += c
  }
  row.push(cell)
  if (row.some(x => x.trim())) rows.push(row)
  return rows
}

/** `multi` fields may be mapped from several columns (e.g. page 1, page 2, page 3 → crawl pages). */
export const IMPORT_FIELDS: { key: string, label: string, required?: boolean, multi?: boolean, aliases: string[] }[] = [
  { key: 'name', label: 'Dealership name', required: true, aliases: ['name', 'dealership', 'dealershipname', 'dealer', 'dealername', 'company', 'store'] },
  { key: 'state', label: 'State', required: true, aliases: ['state', 'st', 'province'] },
  { key: 'city', label: 'City', aliases: ['city', 'town'] },
  { key: 'address', label: 'Address', aliases: ['address', 'street', 'address1', 'streetaddress'] },
  { key: 'zip', label: 'ZIP', aliases: ['zip', 'zipcode', 'postal', 'postalcode'] },
  { key: 'website', label: 'Website', aliases: ['website', 'websites', 'url', 'site', 'web', 'domain', 'homepage', 'websiteurl'] },
  { key: 'scanPages', label: 'Crawl page (inventory URL)', multi: true, aliases: ['page', 'pages', 'page1', 'page2', 'page3', 'page4', 'page5', 'page6', 'crawlpage', 'crawlpages', 'scanpage', 'scanpages', 'inventoryurl', 'inventorypage', 'usedinventory', 'newinventory', 'usedurl', 'newurl', 'srp'] },
  { key: 'phone', label: 'Main phone', aliases: ['phone', 'mainphone', 'telephone', 'tel', 'dealershipphone'] },
  { key: 'brands', label: 'Brands', aliases: ['brand', 'brands', 'make', 'makes', 'franchise', 'franchises'] },
  { key: 'dealerGroup', label: 'Dealer group', aliases: ['group', 'dealergroup', 'parentgroup'] },
  { key: 'territory', label: 'Territory / market', aliases: ['territory', 'market', 'region'] },
  { key: 'route', label: 'Route / day', aliases: ['route', 'routeday', 'day', 'visitday', 'routegroup'] },
  { key: 'leadSource', label: 'Lead source', aliases: ['leadsource', 'source'] },
  { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comments'] },
  { key: 'contactFirstName', label: 'Contact first name', aliases: ['firstname', 'contactfirstname', 'first', 'fname'] },
  { key: 'contactLastName', label: 'Contact last name', aliases: ['lastname', 'contactlastname', 'last', 'lname', 'surname'] },
  { key: 'contactRole', label: 'Contact role', aliases: ['role', 'contactrole', 'position'] },
  { key: 'contactJobTitle', label: 'Contact job title', aliases: ['title', 'jobtitle', 'contacttitle'] },
  { key: 'contactEmail', label: 'Contact email', aliases: ['email', 'contactemail', 'emailaddress', 'e-mail'] },
  { key: 'contactPhone', label: 'Contact phone', aliases: ['contactphone', 'mobile', 'cell', 'directphone', 'cellphone'] },
]

/**
 * Header → field key guess (unknown headers → ''). With sample rows the VALUES are checked too:
 * a column full of "DAY 1 / DAY 2" is a route even when its header says "Group", and an empty
 * column is ignored so it can't overwrite anything.
 */
export function guessMapping(headers: string[], rows: string[][] = []) {
  const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9-]/g, '')
  const values = (i: number) => rows.slice(0, 200).map(r => (r[i] || '').trim()).filter(Boolean)
  const isDays = (i: number) => { const v = values(i); return v.length > 0 && v.filter(x => /^day\s*-?\s*\d{1,3}$/i.test(x)).length / v.length >= 0.8 }
  const used = new Set<string>()
  const out = headers.map(() => '')
  // 1. Columns whose values are visit days → Route.
  if (rows.length) headers.forEach((_h, i) => { if (!used.has('route') && isDays(i)) { out[i] = 'route'; used.add('route') } })
  // 2. Headers.
  headers.forEach((h, i) => {
    if (out[i]) return
    if (rows.length && !values(i).length) return // empty column → ignore
    const n = norm(h)
    const f = IMPORT_FIELDS.find(x => (x.multi || !used.has(x.key)) && x.aliases.includes(n))
    if (f) { out[i] = f.key; used.add(f.key); return }
    // Columns full of inventory links (…/used-inventory, /inventory/new, searchused.aspx) → crawl pages.
    const v = values(i)
    if (rows.length && v.length && v.filter(x => /^https?:\/\/\S+\/(?:\S*(?:inventory|used|new|pre-?owned|certified|vehicles|search)\S*)/i.test(x)).length / v.length >= 0.6) out[i] = 'scanPages'
  })
  return out
}
/** Join one mapped field's cells: crawl pages one per line, everything else comma-separated; empty cells skipped. */
export function joinMapped(key: string, cells: string[]) {
  const vals = cells.map(c => (c || '').trim()).filter(Boolean)
  return key === 'scanPages' ? vals.join('\n') : vals.join(', ')
}
