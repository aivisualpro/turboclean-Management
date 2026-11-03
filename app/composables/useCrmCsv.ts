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

export const IMPORT_FIELDS: { key: string, label: string, required?: boolean, aliases: string[] }[] = [
  { key: 'name', label: 'Dealership name', required: true, aliases: ['name', 'dealership', 'dealershipname', 'dealer', 'dealername', 'company', 'store'] },
  { key: 'state', label: 'State', required: true, aliases: ['state', 'st', 'province'] },
  { key: 'city', label: 'City', aliases: ['city', 'town'] },
  { key: 'address', label: 'Address', aliases: ['address', 'street', 'address1', 'streetaddress'] },
  { key: 'zip', label: 'ZIP', aliases: ['zip', 'zipcode', 'postal', 'postalcode'] },
  { key: 'website', label: 'Website', aliases: ['website', 'url', 'site', 'web', 'domain'] },
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

/** Header → field key guess (unknown headers → ''). */
export function guessMapping(headers: string[]) {
  const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9-]/g, '')
  const used = new Set<string>()
  return headers.map((h) => {
    const n = norm(h)
    const f = IMPORT_FIELDS.find(x => !used.has(x.key) && x.aliases.includes(n))
    if (f) used.add(f.key)
    return f?.key || ''
  })
}
