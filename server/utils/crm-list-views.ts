/**
 * List views — the filters each person last had on a list (the dealership list: stage, state, owner,
 * audit, history conditions…).
 *
 * One document per person per list: { userId, viewId, view, updatedAt }. The page decides what the
 * filters mean (see app/lib/dealershipView.ts and app/composables/useListView.ts); the server only
 * keeps a small, well-formed value for the signed-in person and lets the newest copy win, so filters
 * changed on one computer are not overwritten by an older tab on another.
 */
import type { Db } from 'mongodb'
import type { SessionActor } from './crm'

export const LIST_VIEW_COLLECTION = 'turboCleanCrmListViews'

const LIST_VIEW_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/
const LIST_VIEW_KEY_RE = /^[a-z][\w-]{0,31}$/i
const LIST_VIEW_MAX_KEYS = 40
const LIST_VIEW_MAX_TEXT = 200
const LIST_VIEW_MAX_ROWS = 30

export type ListViewValue = string | Record<string, string>[]
export interface StoredListView { v: 1, view: Record<string, ListViewValue>, updatedAt: number }

/** The list's id from the URL — lowercase letters, digits and dashes only. */
export function listViewId(raw: unknown): string {
  const id = String(raw ?? '').trim()
  if (!LIST_VIEW_ID_RE.test(id)) throw createError({ statusCode: 400, statusMessage: 'Unknown list' })
  return id
}

/** Keeps only what a view may contain: short texts, and lists of rows of short texts. Throws 400 when the body is not a view. */
export function sanitizeListView(raw: any, updatedAt: unknown, now = Date.now()): StoredListView {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400, statusMessage: 'That is not a list view' })
  const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '').slice(0, LIST_VIEW_MAX_TEXT)
  const flat = (o: any) => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(o || {}).slice(0, LIST_VIEW_MAX_KEYS)) if (LIST_VIEW_KEY_RE.test(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) out[k] = text(v)
    return out
  }
  const view: Record<string, ListViewValue> = {}
  for (const [k, v] of Object.entries(raw).slice(0, LIST_VIEW_MAX_KEYS)) {
    if (!LIST_VIEW_KEY_RE.test(k)) continue
    if (Array.isArray(v)) view[k] = v.filter(x => x && typeof x === 'object' && !Array.isArray(x)).slice(0, LIST_VIEW_MAX_ROWS).map(flat)
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') view[k] = text(v)
  }
  const at = Number(updatedAt)
  // A computer whose clock runs ahead must not win every future comparison.
  return { v: 1, view, updatedAt: Number.isFinite(at) && at > 0 ? Math.min(Math.floor(at), now) : now }
}

let listViewIndex = false
async function listViews(db: Db) {
  const col = db.collection(LIST_VIEW_COLLECTION)
  if (!listViewIndex) {
    listViewIndex = true
    try { await col.createIndex({ userId: 1, viewId: 1 }, { unique: true }) }
    catch (e) { console.warn('[list-views] index creation skipped:', (e as Error).message) }
  }
  return col
}

/** The signed-in person's filters for one list (null when they never set any). */
export async function readListView(db: Db, actor: SessionActor | null, viewId: string): Promise<StoredListView | null> {
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const doc = await (await listViews(db)).findOne({ userId: actor.id, viewId })
  return (doc?.view as StoredListView | undefined) ?? null
}

/** Saves the filters unless a newer copy is already stored; returns whichever is now current. */
export async function writeListView(db: Db, actor: SessionActor | null, viewId: string, body: any): Promise<StoredListView> {
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const view = sanitizeListView(body?.view, body?.updatedAt)
  const col = await listViews(db)
  const existing = await col.findOne({ userId: actor.id, viewId })
  const stored = existing?.view as StoredListView | undefined
  if (stored && stored.updatedAt > view.updatedAt) return stored
  await col.updateOne(
    { userId: actor.id, viewId },
    { $set: { userId: actor.id, viewId, view, updatedAt: new Date().toISOString() }, $setOnInsert: { createdAt: new Date().toISOString() } },
    { upsert: true },
  )
  return view
}
