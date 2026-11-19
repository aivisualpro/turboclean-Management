/**
 * Data-grid column layouts — how each person arranged a table's columns (order, hidden, frozen, widths).
 *
 * One document per person per table: { userId, gridId, layout, updatedAt }. The browser keeps its own
 * copy and decides what the layout means for today's columns (see app/lib/gridLayout.ts); the server
 * only stores a size-capped, well-formed value and lets the newest copy win, so a layout changed on one
 * computer is not overwritten by an older one from another.
 */
import type { Db } from 'mongodb'
import type { SessionActor } from './crm'

export const GRID_LAYOUT_COLLECTION = 'turboCleanCrmGridLayouts'

const GRID_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/
const GRID_COLUMN_RE = /^[A-Z][\w-]{0,63}$/i
const GRID_MAX_COLUMNS = 200

export interface StoredGridLayout { v: 1, order: string[], hidden: string[], pinned: string[], widths: Record<string, number>, updatedAt: number }

/** The table's id from the URL — lowercase letters, digits and dashes only. */
export function gridLayoutId(raw: unknown): string {
  const id = String(raw ?? '').trim()
  if (!GRID_ID_RE.test(id)) throw createError({ statusCode: 400, statusMessage: 'Unknown table' })
  return id
}

/** Keeps only what a layout may contain. Throws 400 when the body is not a layout at all. */
export function sanitizeGridLayout(raw: any, now = Date.now()): StoredGridLayout {
  const keys = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === 'string' && GRID_COLUMN_RE.test(k)))].slice(0, GRID_MAX_COLUMNS) : []
  const order = keys(raw?.order)
  if (!raw || typeof raw !== 'object' || !order.length) throw createError({ statusCode: 400, statusMessage: 'That is not a column layout' })
  const known = new Set(order)
  const widths: Record<string, number> = {}
  if (raw.widths && typeof raw.widths === 'object' && !Array.isArray(raw.widths)) {
    for (const [k, w] of Object.entries(raw.widths)) {
      if (known.has(k) && typeof w === 'number' && Number.isFinite(w)) widths[k] = Math.round(Math.min(2000, Math.max(24, w)))
    }
  }
  const at = Number(raw.updatedAt)
  return {
    v: 1,
    order,
    hidden: keys(raw.hidden).filter(k => known.has(k)),
    pinned: keys(raw.pinned).filter(k => known.has(k)),
    widths,
    // A computer whose clock runs ahead must not win every future comparison.
    updatedAt: Number.isFinite(at) && at > 0 ? Math.min(Math.floor(at), now) : now,
  }
}

let gridLayoutIndex = false
async function gridLayouts(db: Db) {
  const col = db.collection(GRID_LAYOUT_COLLECTION)
  if (!gridLayoutIndex) {
    gridLayoutIndex = true
    try { await col.createIndex({ userId: 1, gridId: 1 }, { unique: true }) }
    catch (e) { console.warn('[grid-layouts] index creation skipped:', (e as Error).message) }
  }
  return col
}

export async function readGridLayout(db: Db, actor: SessionActor | null, gridId: string): Promise<StoredGridLayout | null> {
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const doc = await (await gridLayouts(db)).findOne({ userId: actor.id, gridId })
  return (doc?.layout as StoredGridLayout | undefined) ?? null
}

/** Saves the layout unless a newer one is already stored; returns whichever is now current. */
export async function writeGridLayout(db: Db, actor: SessionActor | null, gridId: string, body: any): Promise<StoredGridLayout> {
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const layout = sanitizeGridLayout(body)
  const col = await gridLayouts(db)
  const existing = await col.findOne({ userId: actor.id, gridId })
  const stored = existing?.layout as StoredGridLayout | undefined
  if (stored && stored.updatedAt > layout.updatedAt) return stored
  await col.updateOne(
    { userId: actor.id, gridId },
    { $set: { userId: actor.id, gridId, layout, updatedAt: new Date().toISOString() }, $setOnInsert: { createdAt: new Date().toISOString() } },
    { upsert: true },
  )
  return layout
}
