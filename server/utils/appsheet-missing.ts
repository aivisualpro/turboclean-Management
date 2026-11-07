/**
 * "Missing records" recovery: find rows that exist in AppSheet but NOT in MongoDB and add them.
 *
 * Why: from the Nov 6 2026 security deploy until the AppSheet bots got the webhook key, every
 * AppSheet → app webhook was rejected (401). AppSheet doesn't retry, so rows added in AppSheet
 * during that window never reached the app.
 *
 * Rules (safe by design):
 *   - Only ADDS. Never updates, overwrites or deletes anything that already exists.
 *   - A row counts as "already in the app" when its _id exists (as ObjectId or string).
 *   - Rows are inserted exactly like the webhook's "add" would have done (same mapper, same _id),
 *     plus a `restoredFromAppSheetAt` marker so they can be found later.
 *   - Rows that look like something already re-entered by hand (same dealer name, same user email,
 *     same work order) are flagged with a warning and left unticked in the UI.
 *   - Dry run first: `findMissingFromAppSheet` only reads; `addMissingFromAppSheet` writes.
 */

import type { Db } from 'mongodb'
import { ObjectId } from 'mongodb'
import { REVERSE_TABLE_MAP, callAppSheetDetailed, extractAppSheetRows } from './appsheet'
import { MAPPER_LOOKUP } from './sync-mapper'

export const MISSING_TABLES = ['Dealers', 'Services', 'AppUsers', 'DealerServices', 'WorkOrders'] as const
export type MissingTable = typeof MISSING_TABLES[number]

export interface MissingRow {
  id: string
  label: string
  /** set when the row may already exist under another id (re-entered by hand) */
  warning?: string
  /** extra info, e.g. dealer names that couldn't be matched */
  note?: string
}

export interface MissingTableReport {
  table: MissingTable
  checked: number
  alreadyInApp: number
  missing: MissingRow[]
  skipped: MissingRow[]
  added?: number
  failed?: { id: string, label: string, error: string }[]
  error?: string
}

export interface MissingReport {
  since: string
  tables: MissingTableReport[]
}

/** Reads all rows of one AppSheet table (WorkOrders: only rows dated on/after `since`). */
export type AppSheetRowFetcher = (table: MissingTable, since: Date) => Promise<any[]>

const HEX24 = /^[0-9a-f]{24}$/i
const idVariants = (id: string): any[] => HEX24.test(id) ? [new ObjectId(id), id] : [id]
const toDbId = (id: string): any => HEX24.test(id) ? new ObjectId(id) : id
const norm = (v: any) => String(v ?? '').trim().toLowerCase()
const parseMoney = (v: any) => typeof v === 'number' ? v : (Number.parseFloat(String(v ?? '').replace(/[^\d.-]/g, '')) || 0)
const rowId = (row: any) => String(row?._id ?? row?.id ?? '').trim()
/** Calendar day "YYYY-MM-DD", independent of the server's timezone. AppSheet (Locale en-US) sends "MM/DD/YYYY[ hh:mm:ss]". */
function dayKey(v: any): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  const s = String(v ?? '').trim()
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (us) return `${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}
const usDate = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`

/** Default fetcher: AppSheet API v2 Find. WorkOrders uses a date Selector so we don't pull all ~43k rows. */
export const fetchFromAppSheet: AppSheetRowFetcher = async (table, since) => {
  const base = { Action: 'Find' as const, Properties: { Locale: 'en-US', Timezone: 'UTC' }, Rows: [] }
  if (table === 'WorkOrders') {
    const res = await callAppSheetDetailed(table, { ...base, Selector: `Filter(WorkOrders, DATE([date]) >= DATE("${usDate(since)}"))` }, { maxRetries: 2, timeoutMs: 120_000 })
    const rows = res.ok ? extractAppSheetRows(res.data) : null
    if (rows) return rows
    // Selector rejected (column type / syntax) → read everything and filter here
    console.warn(`[MissingSync] WorkOrders selector failed (${res.error || 'unexpected response'}), reading the whole table instead`)
  }
  const res = await callAppSheetDetailed(table, base, { maxRetries: 2, timeoutMs: table === 'WorkOrders' ? 300_000 : 120_000 })
  if (!res.ok) throw new Error(`AppSheet ${table}: ${res.error || 'request failed'}`)
  const rows = extractAppSheetRows(res.data)
  if (!rows) throw new Error(`AppSheet ${table}: unexpected response`)
  if (table !== 'WorkOrders') return rows
  const from = dayKey(since)
  return rows.filter((r) => { const k = dayKey(r?.date); return !k || k >= from })
}

interface Ctx {
  db: Db
  since: Date
  dealerNameById: Map<string, string>
  dealerIdByName: Map<string, string>
  /** dealers found missing in this run (DealerServices / WorkOrders may point at them) */
  newDealerIds: Set<string>
  /** dry run: also resolve new dealers' names, so the preview shows what will happen */
  preview: boolean
}

async function loadDealerMaps(db: Db) {
  const dealers = await db.collection('turboCleanDealers').find({}, { projection: { dealer: 1 } }).toArray()
  const dealerNameById = new Map<string, string>()
  const dealerIdByName = new Map<string, string>()
  for (const d of dealers) {
    dealerNameById.set(String(d._id), d.dealer || '')
    if (d.dealer) dealerIdByName.set(norm(d.dealer), String(d._id))
  }
  return { dealerNameById, dealerIdByName }
}

function labelFor(table: MissingTable, row: any, ctx: Ctx): string {
  const dealer = (id: any) => ctx.dealerNameById.get(String(id ?? '')) || String(id ?? '') || '—'
  switch (table) {
    case 'Dealers': return row.dealer || '(no name)'
    case 'Services': return row.service || '(no name)'
    case 'AppUsers': return [row.name, row.email].filter(Boolean).join(' · ') || '(no name)'
    case 'DealerServices': return `${row.service ?? row.Service ?? '(service)'} · ${dealer(row.dealer)} · $${parseMoney(row.total ?? row.Total).toFixed(2)}`
    case 'WorkOrders': return [dayKey(row.date) || '(no date)', dealer(row.dealer), row.stockNumber && `Stock ${row.stockNumber}`, row.vin && row.vin !== 'N/A' && `VIN ${row.vin}`, `$${parseMoney(row.total).toFixed(2)}`].filter(Boolean).join(' · ')
  }
}

/** Ids (as strings) of AppSheet rows that already exist in the collection. */
async function existingIds(db: Db, collection: string, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>()
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000)
    const docs = await db.collection(collection).find({ _id: { $in: chunk.flatMap(idVariants) } }, { projection: { _id: 1 } }).toArray()
    for (const d of docs) found.add(String(d._id))
  }
  return found
}

async function checkTable(table: MissingTable, rows: any[], ctx: Ctx): Promise<MissingTableReport> {
  const report: MissingTableReport = { table, checked: rows.length, alreadyInApp: 0, missing: [], skipped: [] }
  const { db } = ctx

  if (table === 'DealerServices') {
    const dealerIds = [...new Set(rows.map(r => String(r.dealer ?? '').trim()).filter(Boolean))]
    const dealers = dealerIds.length
      ? await db.collection('turboCleanDealers').find({ _id: { $in: dealerIds.flatMap(idVariants) } }, { projection: { 'services.id': 1, 'services._id': 1 } }).toArray()
      : []
    const serviceIdsByDealer = new Map<string, Set<string>>()
    for (const d of dealers) serviceIdsByDealer.set(String(d._id), new Set((d.services || []).flatMap((s: any) => [s?.id, s?._id]).filter(Boolean).map(String)))
    for (const row of rows) {
      const id = rowId(row)
      const dealerId = String(row.dealer ?? '').trim()
      const label = labelFor(table, row, ctx)
      if (!id) { report.skipped.push({ id: '', label, warning: 'Row has no _id in AppSheet' }); continue }
      if (!dealerId) { report.skipped.push({ id, label, warning: 'Row has no dealer' }); continue }
      const services = serviceIdsByDealer.get(dealerId)
      if (services?.has(id)) { report.alreadyInApp++; continue }
      if (!services && !ctx.newDealerIds.has(dealerId)) { report.skipped.push({ id, label, warning: 'Its dealer is not in the app (and not in AppSheet either)' }); continue }
      report.missing.push({ id, label, ...(ctx.newDealerIds.has(dealerId) ? { note: 'Dealer is also being added' } : {}) })
    }
    return report
  }

  const collection = REVERSE_TABLE_MAP[table]!
  const ids = rows.map(rowId).filter(Boolean)
  const have = await existingIds(db, collection, ids)

  // Look-alike checks (re-entered by hand while sync was down)
  let emails = new Set<string>()
  let workOrderKeys = new Set<string>()
  if (table === 'AppUsers') {
    emails = new Set((await db.collection(collection).find({}, { projection: { email: 1 } }).toArray()).map(u => norm(u.email)).filter(Boolean))
  }
  if (table === 'WorkOrders') {
    const from = new Date(ctx.since.getTime() - 2 * 86_400_000)
    const recent = await db.collection(collection).find({ date: { $gte: from } }, { projection: { dealer: 1, date: 1, stockNumber: 1, vin: 1, dealerServiceId: 1 } }).toArray()
    for (const w of recent) workOrderKeys.add(woKey(w))
  }

  for (const row of rows) {
    const id = rowId(row)
    const label = labelFor(table, row, ctx)
    if (!id) { report.skipped.push({ id: '', label, warning: 'Row has no _id in AppSheet' }); continue }
    if (have.has(id)) { report.alreadyInApp++; continue }
    const item: MissingRow = { id, label }
    if (table === 'Dealers' && row.dealer && ctx.dealerIdByName.has(norm(row.dealer))) item.warning = 'A dealer with this name already exists in the app'
    if (table === 'AppUsers' && row.email && emails.has(norm(row.email))) item.warning = 'A user with this email already exists in the app'
    if (table === 'WorkOrders') {
      if (workOrderKeys.has(woKey(row))) item.warning = 'Same dealer, date, stock/VIN and service already exists — maybe re-entered by hand'
      const dealerId = String(row.dealer ?? '').trim()
      if (dealerId && !ctx.dealerNameById.has(dealerId) && !ctx.newDealerIds.has(dealerId)) item.note = 'Its dealer is not in the app'
    }
    if (table === 'AppUsers') {
      const { unmatched } = mapRegisterDealers(row.registerDealers, ctx)
      if (unmatched.length) item.note = `Dealer(s) not found, left out: ${unmatched.join(', ')}`
    }
    report.missing.push(item)
  }
  if (table === 'Dealers') {
    const byId = new Map(rows.map(r => [rowId(r), r]))
    for (const m of report.missing) {
      ctx.newDealerIds.add(m.id)
      // In a dry run, treat them as if added (in a real run insertRow does this once they exist)
      const name = byId.get(m.id)?.dealer
      if (ctx.preview && name) {
        ctx.dealerNameById.set(m.id, name)
        if (!ctx.dealerIdByName.has(norm(name))) ctx.dealerIdByName.set(norm(name), m.id)
      }
    }
  }
  return report
}

function woKey(w: any) {
  const vin = norm(w.vin) === 'n/a' ? '' : norm(w.vin)
  const stock = norm(w.stockNumber) === 'n/a' ? '' : norm(w.stockNumber)
  return [String(w.dealer ?? ''), dayKey(w.date), stock, vin, String(w.dealerServiceId ?? '')].join('|')
}

/** AppSheet keeps registerDealers as "Name A , Name B"; MongoDB keeps dealer ids. */
function mapRegisterDealers(value: any, ctx: Ctx) {
  const parts = String(value ?? '').split(/\s*,\s*/).map(s => s.trim()).filter(Boolean)
  const ids: string[] = []
  const unmatched: string[] = []
  for (const p of parts) {
    if (HEX24.test(p) && (ctx.dealerNameById.has(p) || ctx.newDealerIds.has(p))) ids.push(p)
    else if (ctx.dealerIdByName.has(norm(p))) ids.push(ctx.dealerIdByName.get(norm(p))!)
    else unmatched.push(p)
  }
  return { ids: [...new Set(ids)], unmatched }
}

async function insertRow(table: MissingTable, row: any, ctx: Ctx): Promise<void> {
  const { db } = ctx
  const id = rowId(row)
  const restoredFromAppSheetAt = new Date()

  if (table === 'DealerServices') {
    const dealerId = String(row.dealer ?? '').trim()
    const entry = {
      id,
      service: row.service ?? row.Service ?? '',
      amount: parseMoney(row.amount ?? row.Amount),
      tax: parseMoney(row.tax ?? row.Tax),
      total: parseMoney(row.total ?? row.Total),
    }
    // Atomic "only if not there yet" → safe to run twice
    const res = await db.collection('turboCleanDealers').updateOne(
      { _id: toDbId(dealerId), 'services.id': { $ne: id }, 'services._id': { $ne: id } },
      { $push: { services: entry } as any, $set: { updatedAt: new Date(), lastUpdatedBy: 'appsheet-restore' } },
    )
    if (!res.matchedCount) throw new Error('Dealer not found, or the service is already there')
    return
  }

  const mapper = MAPPER_LOOKUP[table]!
  const doc: Record<string, any> = { ...mapper.toMongo(row), _id: toDbId(id), restoredFromAppSheetAt }
  if (table === 'AppUsers') doc.registerDealers = mapRegisterDealers(row.registerDealers, ctx).ids
  if (table === 'Dealers' && !doc.createdAt) doc.createdAt = new Date()
  await db.collection(REVERSE_TABLE_MAP[table]!).insertOne(doc as any)
  if (table === 'Dealers') {
    ctx.dealerNameById.set(id, doc.dealer || '')
    if (doc.dealer) ctx.dealerIdByName.set(norm(doc.dealer), id)
  }
}

async function buildCtx(db: Db, since: Date, preview: boolean): Promise<Ctx> {
  return { db, since, ...(await loadDealerMaps(db)), newDealerIds: new Set(), preview }
}

/** Read-only: what AppSheet has that the app doesn't. */
export async function findMissingFromAppSheet(db: Db, opts: { tables?: string[], since: Date, fetchRows?: AppSheetRowFetcher }): Promise<MissingReport> {
  const fetchRows = opts.fetchRows || fetchFromAppSheet
  const wanted = MISSING_TABLES.filter(t => !opts.tables?.length || opts.tables.includes(t))
  // Dealers are always checked first so DealerServices / WorkOrders / users can point at new dealers
  const order = wanted.includes('Dealers') || !wanted.some(t => t !== 'Services') ? wanted : (['Dealers', ...wanted] as MissingTable[])
  const ctx = await buildCtx(db, opts.since, true)
  const tables: MissingTableReport[] = []
  for (const table of order) {
    try {
      const rows = await fetchRows(table, opts.since)
      const report = await checkTable(table, rows, ctx)
      if (wanted.includes(table)) tables.push(report)
    }
    catch (e: any) {
      if (wanted.includes(table)) tables.push({ table, checked: 0, alreadyInApp: 0, missing: [], skipped: [], error: e?.message || String(e) })
    }
  }
  return { since: opts.since.toISOString().slice(0, 10), tables }
}

/**
 * Adds the chosen missing rows. Everything is re-checked first (so a stale preview can't
 * create duplicates); `ids` limits which rows are added (default: all missing rows without a warning).
 */
export async function addMissingFromAppSheet(db: Db, opts: { tables?: string[], since: Date, ids?: string[], fetchRows?: AppSheetRowFetcher }): Promise<MissingReport> {
  const fetchRows = opts.fetchRows || fetchFromAppSheet
  const wanted = MISSING_TABLES.filter(t => !opts.tables?.length || opts.tables.includes(t))
  const pick = opts.ids ? new Set(opts.ids) : null
  const ctx = await buildCtx(db, opts.since, false)
  const tables: MissingTableReport[] = []

  for (const table of MISSING_TABLES) {
    if (!wanted.includes(table) && table !== 'Dealers') continue
    try {
      const rows = await fetchRows(table, opts.since)
      const report = await checkTable(table, rows, ctx)
      if (!wanted.includes(table)) continue // Dealers checked only so others can see new dealer ids
      report.added = 0
      report.failed = []
      const byId = new Map(rows.map(r => [rowId(r), r]))
      for (const m of report.missing) {
        if (pick ? !pick.has(`${table}:${m.id}`) : !!m.warning) continue
        try {
          await insertRow(table, byId.get(m.id), ctx)
          report.added++
        }
        catch (e: any) {
          const dup = e?.code === 11000
          report.failed.push({ id: m.id, label: m.label, error: dup ? 'Already exists (duplicate key)' : (e?.message || String(e)) })
        }
      }
      tables.push(report)
    }
    catch (e: any) {
      if (wanted.includes(table)) tables.push({ table, checked: 0, alreadyInApp: 0, missing: [], skipped: [], added: 0, error: e?.message || String(e) })
    }
  }
  return { since: opts.since.toISOString().slice(0, 10), tables }
}
