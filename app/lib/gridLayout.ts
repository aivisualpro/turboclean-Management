/**
 * Data-grid column layout — the pure part (no Vue, no DOM), so it is easy to test.
 *
 * A layout is what one person has done to a table's columns: the order they dragged them into,
 * the ones they switched off, the ones frozen on the left and any widths they changed.
 * It is saved per person (see `useGridLayout`) and must survive the table itself changing:
 * a column added to the code later appears in its natural place, a removed one is dropped.
 */

export interface GridColumnDef<K extends string = string> {
  key: K
  label: string
  /** Width in px until the person resizes it. */
  width: number
  minWidth?: number
  maxWidth?: number
  align?: 'left' | 'right'
  sortable?: boolean
  /** Switched off until the person turns it on (default: shown). */
  hidden?: boolean
  /** Frozen on the left until the person unfreezes it. */
  pinned?: boolean
  /** The row's identity — can be moved and resized, never switched off. */
  required?: boolean
}

export interface GridSort<K extends string = string> { key: K, dir: 'asc' | 'desc' }

export interface GridLayoutState {
  v: 1
  /** Every column the layout knows, in display order (frozen columns first). */
  order: string[]
  hidden: string[]
  pinned: string[]
  /** Only the widths that differ from the column's default. */
  widths: Record<string, number>
  /** The column the person last sorted by; null = the table's own default sort. */
  sort: GridSort | null
  /** ms since epoch of the last change; 0 = never customised. The newest copy wins when syncing. */
  updatedAt: number
}

export const GRID_MIN_WIDTH = 56
export const GRID_MAX_WIDTH = 720

export function clampGridWidth(def: Pick<GridColumnDef, 'minWidth' | 'maxWidth'>, px: number) {
  const min = def.minWidth ?? GRID_MIN_WIDTH
  const max = Math.max(min, def.maxWidth ?? GRID_MAX_WIDTH)
  return Math.round(Math.min(max, Math.max(min, Number.isFinite(px) ? px : min)))
}

/** Frozen columns first, each group keeping its own order. */
function pinnedFirst(order: string[], pinned: string[]) {
  const p = new Set(pinned)
  return [...order.filter(k => p.has(k)), ...order.filter(k => !p.has(k))]
}

export function defaultGridLayout(defs: readonly GridColumnDef[]): GridLayoutState {
  const pinned = defs.filter(d => d.pinned).map(d => d.key)
  return {
    v: 1,
    order: pinnedFirst(defs.map(d => d.key), pinned),
    hidden: defs.filter(d => d.hidden && !d.required).map(d => d.key),
    pinned,
    widths: {},
    sort: null,
    updatedAt: 0,
  }
}

const strings = (v: unknown): string[] => Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : []

/**
 * Makes any saved value safe to use with today's columns: unknown columns are dropped, columns
 * that did not exist when it was saved are slotted in after their natural neighbour with their
 * default visibility, widths are clamped, and a required column can never end up hidden.
 */
export function normalizeGridLayout(raw: unknown, defs: readonly GridColumnDef[]): GridLayoutState {
  const base = defaultGridLayout(defs)
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<GridLayoutState>
  const byKey = new Map(defs.map(d => [d.key as string, d]))
  const saved = strings(r.order).filter(k => byKey.has(k))
  if (!saved.length) return base

  const known = new Set(saved)
  const order = [...saved]
  const hidden = new Set(strings(r.hidden).filter(k => known.has(k) && !byKey.get(k)!.required))
  const pinned = new Set(strings(r.pinned).filter(k => known.has(k)))
  defs.forEach((d, i) => {
    if (known.has(d.key)) return
    // New since this layout was saved: place it right after the column that precedes it in the code.
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const idx = order.indexOf(defs[j]!.key)
      if (idx >= 0) { at = idx + 1; break }
    }
    order.splice(at, 0, d.key)
    if (d.hidden && !d.required) hidden.add(d.key)
    if (d.pinned) pinned.add(d.key)
  })

  const widths: Record<string, number> = {}
  if (r.widths && typeof r.widths === 'object') {
    for (const [k, v] of Object.entries(r.widths)) {
      const d = byKey.get(k)
      if (!d || typeof v !== 'number' || !Number.isFinite(v)) continue
      const w = clampGridWidth(d, v)
      if (w !== d.width) widths[k] = w
    }
  }
  const pinnedList = order.filter(k => pinned.has(k))
  // A remembered sort only counts while that column still exists and can be sorted.
  const s = r.sort
  const sort = s && typeof s === 'object' && byKey.get(s.key)?.sortable && (s.dir === 'asc' || s.dir === 'desc') ? { key: s.key, dir: s.dir } : null
  return {
    v: 1,
    order: pinnedFirst(order, pinnedList),
    hidden: order.filter(k => hidden.has(k)),
    pinned: pinnedList,
    widths,
    sort,
    updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) && r.updatedAt > 0 ? Math.floor(r.updatedAt) : 0,
  }
}

export function sameGridSort(a: GridSort | null | undefined, b: GridSort | null | undefined) {
  return (!a && !b) || (!!a && !!b && a.key === b.key && a.dir === b.dir)
}

/** Same columns, order, visibility, frozen set and widths (the sort and the timestamp are ignored). */
export function sameGridLayout(a: GridLayoutState, b: GridLayoutState) {
  const list = (x: string[], y: string[]) => x.length === y.length && x.every((k, i) => k === y[i])
  const set = (x: string[], y: string[]) => x.length === y.length && x.every(k => y.includes(k))
  const ka = Object.keys(a.widths), kb = Object.keys(b.widths)
  return list(a.order, b.order) && set(a.hidden, b.hidden) && list(a.pinned, b.pinned)
    && ka.length === kb.length && ka.every(k => a.widths[k] === b.widths[k])
}

/**
 * Puts `key` immediately before `beforeKey` (or at the end when null) and sets whether it is frozen.
 * Columns that are switched off keep their slot, so turning one back on returns it where it was.
 */
export function moveGridColumn(state: GridLayoutState, key: string, beforeKey: string | null, pinned: boolean): GridLayoutState {
  if (!state.order.includes(key) || beforeKey === key) return state
  const order = state.order.filter(k => k !== key)
  const at = beforeKey ? order.indexOf(beforeKey) : -1
  if (at >= 0) order.splice(at, 0, key)
  else order.push(key)
  const pinnedSet = new Set(state.pinned)
  if (pinned) pinnedSet.add(key)
  else pinnedSet.delete(key)
  const pinnedList = order.filter(k => pinnedSet.has(k))
  return { ...state, order: pinnedFirst(order, pinnedList), pinned: pinnedList }
}
