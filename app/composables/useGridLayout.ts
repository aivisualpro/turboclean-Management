import type { ComputedRef, Ref } from 'vue'
import { useElementSize } from '@vueuse/core'
import type { GridColumnDef, GridLayoutState, GridSort } from '~/lib/gridLayout'
import { clampGridWidth, defaultGridLayout, moveGridColumn, normalizeGridLayout, sameGridLayout, sameGridSort } from '~/lib/gridLayout'

/**
 * Column layout for a data table: reorder, resize, show / hide and freeze columns — saved per person.
 *
 *   const grid = useGridLayout('crm-dealerships', COLUMNS, { table, scroller })
 *
 * - The layout is kept in this browser straight away (no flash on the next visit) and, when `sync`
 *   is on, in the person's account so it follows them to another computer. The newest copy wins.
 * - Built so a big table stays quick: `columns` (what the rows are rendered from) only changes when
 *   the order / visibility / frozen set changes. Widths live apart (`sizes`) and are read only by the
 *   header cells and the <colgroup>, so resizing never re-renders the rows; while an edge is being
 *   dragged just one <col> and the table's width change in the DOM.
 * - Everything touching the DOM runs after mount — the server render and the first client render
 *   are identical (the default layout), so there is no hydration mismatch.
 */

/** A column as the table should draw it right now (widths are in `sizes`, sticky offsets in `offsets`). */
export interface GridColumn<K extends string = string> extends GridColumnDef<K> {
  visible: boolean
  pinned: boolean
  /** Last frozen column — draws the divider between the frozen and the scrolling part. */
  pinEdge: boolean
  /** Last visible column. */
  last: boolean
}

export type GridSaveState = 'idle' | 'saving' | 'synced' | 'local'

export interface GridLayoutOptions {
  /** The <table> element (needed for resizing, fit-to-content and drag-to-reorder). */
  table: Ref<HTMLElement | null | undefined>
  /** The element that scrolls the table. */
  scroller: Ref<HTMLElement | null | undefined>
  /** Width of the fixed leading column (row checkbox); 0 when the table has none. */
  leadWidth?: number
  /** Save the layout to the person's account as well as this browser. Default true. */
  sync?: boolean
  /** Share of the visible width frozen columns may take before freezing another is refused. Default 0.6. */
  maxPinnedShare?: number
  /** Called when a freeze was refused because there is no room for it. */
  onPinRefused?: (col: GridColumnDef) => void
}

export interface GridLayout<K extends string = string> {
  id: string
  /** Visible columns in display order — what the table renders. Unchanged by a resize. */
  columns: ComputedRef<GridColumn<K>[]>
  /** Every column in display order, switched off ones included — what the Columns panel lists. */
  allColumns: ComputedRef<GridColumn<K>[]>
  /** Current width in px of every column. */
  sizes: ComputedRef<Record<K, number>>
  /** Sticky `left` in px of each frozen, visible column. */
  offsets: ComputedRef<Partial<Record<K, number>>>
  /** The remembered sort (null until the person sorts) — saved and synced with the layout. */
  sort: ComputedRef<GridSort<K> | null>
  setSort: (key: K, dir: 'asc' | 'desc') => void
  hiddenCount: ComputedRef<number>
  pinnedCount: ComputedRef<number>
  /** The person has changed the columns from the default layout (sorting does not count). */
  isCustomized: ComputedRef<boolean>
  saveState: Ref<GridSaveState>
  /** Key of the column being dragged / resized right now ('' when none). */
  draggingKey: Ref<string>
  resizingKey: Ref<string>
  /**
   * Bind on the <table> as `:style="grid.tableStyle"` (and give it the class `data-grid`).
   * A plain object on purpose: it is kept up to date in place, so the page does not re-render when a width changes.
   */
  tableStyle: { width: string }
  leadWidth: number
  setVisible: (key: K, visible: boolean) => void
  showAll: () => void
  setPinned: (key: K, pinned: boolean) => boolean
  canPin: (key: K) => boolean
  /** Put `key` before `beforeKey` (null = at the end). `pinned` defaults to the column's current state. */
  move: (key: K, beforeKey: K | null, pinned?: boolean) => void
  /** Step one place left (-1) or right (1). `visibleOnly` skips columns that are switched off. */
  moveBy: (key: K, delta: -1 | 1, visibleOnly?: boolean) => boolean
  canMoveBy: (key: K, delta: -1 | 1, visibleOnly?: boolean) => boolean
  setWidth: (key: K, px: number) => void
  resetWidth: (key: K) => void
  /** Size one column / every visible column to its content (header and loaded rows). */
  autoFit: (key: K) => void
  autoFitAll: () => void
  reset: () => GridLayoutState
  /** Put back a layout returned by `reset()` (Undo). */
  restore: (state: GridLayoutState) => void
  /** Pointer handlers for the header cells. */
  startResize: (e: PointerEvent, key: K) => void
  startHeaderDrag: (e: PointerEvent, key: K) => void
  /** Bind to `mouseover` on <tbody>: a cut-off cell gets its full text as a tooltip. */
  hintOverflow: (e: MouseEvent) => void
}

const SYNC_DELAY = 800
const DRAG_THRESHOLD = 6
const EDGE = 56 // px from the scroller edge where dragging starts to auto-scroll

export function useGridLayout<K extends string>(id: string, defs: readonly GridColumnDef<K>[], opts: GridLayoutOptions): GridLayout<K> {
  const leadWidth = opts.leadWidth ?? 0
  const storageKey = `zrz:grid:${id}:v1`
  const endpoint = `/api/crm/grid-layouts/${encodeURIComponent(id)}`
  const byKey = new Map(defs.map(d => [d.key as string, d]))

  const state = ref<GridLayoutState>(defaultGridLayout(defs))
  const saveState = ref<GridSaveState>('idle')
  const draggingKey = ref('')
  const resizingKey = ref('')

  // ─── Derived ───
  // Structure and widths are derived apart. Each goes through a string first: a computed that returns
  // the same string does not wake its dependants, so a width change never touches `columns`.
  const structureKey = computed(() => JSON.stringify([state.value.order, state.value.hidden, state.value.pinned]))
  const allColumns = computed<GridColumn<K>[]>(() => {
    const [order, hiddenList, pinnedList] = JSON.parse(structureKey.value) as [string[], string[], string[]]
    const hidden = new Set(hiddenList), pinned = new Set(pinnedList)
    const list = order.map(key => ({ ...byKey.get(key)!, visible: !hidden.has(key), pinned: pinned.has(key), pinEdge: false, last: false }) as GridColumn<K>)
    const shown = list.filter(c => c.visible)
    const edge = shown.filter(c => c.pinned).at(-1)
    if (edge) edge.pinEdge = true
    if (shown.length) shown.at(-1)!.last = true
    return list
  })
  const columns = computed(() => allColumns.value.filter(c => c.visible))
  const sizes = computed(() => {
    const out = {} as Record<K, number>
    for (const d of defs) out[d.key] = clampGridWidth(d, state.value.widths[d.key] ?? d.width)
    return out
  })
  const offsetsKey = computed(() => {
    const out: Record<string, number> = {}
    let left = leadWidth
    for (const c of columns.value) {
      if (!c.pinned) continue
      out[c.key] = left
      left += sizes.value[c.key]
    }
    return JSON.stringify(out)
  })
  const offsets = computed(() => JSON.parse(offsetsKey.value) as Partial<Record<K, number>>)
  const sortKey = computed(() => JSON.stringify(state.value.sort ?? null))
  const sort = computed(() => JSON.parse(sortKey.value) as GridSort<K> | null)
  const hiddenCount = computed(() => allColumns.value.length - columns.value.length)
  const pinnedCount = computed(() => columns.value.filter(c => c.pinned).length)
  const isCustomized = computed(() => !sameGridLayout(state.value, defaultGridLayout(defs)))
  const totalWidth = computed(() => leadWidth + columns.value.reduce((n, c) => n + sizes.value[c.key], 0))
  const pinnedWidth = computed(() => leadWidth + columns.value.reduce((n, c) => n + (c.pinned ? sizes.value[c.key] : 0), 0))

  const { width: viewWidth } = useElementSize(opts.scroller as Ref<HTMLElement | null>)
  const maxPinnedShare = opts.maxPinnedShare ?? 0.6
  /** On a narrow window (a phone) the frozen part would swallow the table — then nothing sticks; the order is kept. */
  const MIN_SCROLLING_PART = 220
  const pinActive = computed(() => {
    if (!pinnedCount.value) return false
    const view = viewWidth.value
    return !view || (pinnedWidth.value <= view * Math.max(maxPinnedShare, 0.75) && view - pinnedWidth.value >= MIN_SCROLLING_PART)
  })

  // The table's width and state classes are applied to the element directly (see `tableStyle` in the interface).
  const tableStyle = { width: `${totalWidth.value}px` }
  watch(totalWidth, (w) => { tableStyle.width = `${w}px` }, { flush: 'sync' })
  watchPostEffect(() => {
    const el = opts.table.value
    const width = `${totalWidth.value}px`, pin = pinActive.value
    // The columns are narrower than the view: a spacer column takes the rest.
    const fills = !!viewWidth.value && totalWidth.value < viewWidth.value
    if (!el) return
    el.style.width = width
    el.classList.toggle('data-grid--pin', pin)
    el.classList.toggle('data-grid--fills', fills)
  })

  // ─── Saving: this browser first, then the account ───
  let pushTimer: ReturnType<typeof setTimeout> | null = null
  let mounted = false
  function persistLocal() {
    try { localStorage.setItem(storageKey, JSON.stringify(state.value)) } catch { /* private mode / storage full — the layout still works for this visit */ }
  }
  async function pushRemote() {
    pushTimer = null
    if (opts.sync === false) return
    const sent = state.value.updatedAt
    saveState.value = 'saving'
    try {
      await $fetch(endpoint, { method: 'PUT', body: { layout: state.value } })
      if (state.value.updatedAt === sent) saveState.value = 'synced'
    }
    catch { saveState.value = 'local' }
  }
  function schedulePush() {
    if (opts.sync === false || !mounted) return
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(pushRemote, SYNC_DELAY)
  }
  /** Every change goes through here. */
  function commit(next: GridLayoutState) {
    const clean = normalizeGridLayout({ ...next, updatedAt: 1 }, defs)
    if (sameGridLayout(clean, state.value) && sameGridSort(clean.sort, state.value.sort)) return
    state.value = { ...clean, updatedAt: Date.now() }
    persistLocal()
    if (opts.sync === false) saveState.value = 'local'
    schedulePush()
  }
  function adopt(raw: unknown) {
    const next = normalizeGridLayout(raw, defs)
    if (next.updatedAt <= state.value.updatedAt) return false
    state.value = next
    return true
  }
  function onStorage(e: StorageEvent) {
    // The same person changed the layout in another tab.
    if (e.key !== storageKey || !e.newValue) return
    try { adopt(JSON.parse(e.newValue)) } catch {}
  }
  async function pullRemote() {
    if (opts.sync === false) { saveState.value = state.value.updatedAt ? 'local' : 'idle'; return }
    try {
      const res = await $fetch<{ layout: unknown }>(endpoint)
      const remote = res?.layout ? normalizeGridLayout(res.layout, defs) : null
      if (remote && remote.updatedAt > state.value.updatedAt) { state.value = remote; persistLocal(); saveState.value = 'synced' }
      else if (state.value.updatedAt > (remote?.updatedAt ?? 0)) await pushRemote() // changed here while offline / before sync existed
      else saveState.value = remote ? 'synced' : 'idle'
    }
    catch { saveState.value = state.value.updatedAt ? 'local' : 'idle' }
  }

  // ─── Actions ───
  const col = (key: string) => allColumns.value.find(c => c.key === key)
  function setVisible(key: K, visible: boolean) {
    const d = byKey.get(key)
    if (!d || (d.required && !visible)) return
    const hidden = new Set(state.value.hidden)
    if (visible) hidden.delete(key)
    else hidden.add(key)
    commit({ ...state.value, hidden: [...hidden] })
  }
  function showAll() { commit({ ...state.value, hidden: [] }) }

  function canPin(key: K) {
    const c = col(key)
    if (!c) return false
    if (c.pinned || !viewWidth.value) return true
    return pinnedWidth.value + sizes.value[key] <= viewWidth.value * maxPinnedShare
  }
  function setPinned(key: K, pinned: boolean) {
    const c = col(key)
    if (!c || c.pinned === pinned) return true
    if (pinned && !canPin(key)) { opts.onPinRefused?.(c); return false }
    // Freezing puts it last among the frozen columns; unfreezing puts it first among the rest.
    const firstFree = state.value.order.find(k => k !== key && !state.value.pinned.includes(k)) ?? null
    commit(moveGridColumn(state.value, key, firstFree, pinned))
    return true
  }
  function move(key: K, beforeKey: K | null, pinned?: boolean) {
    const c = col(key)
    if (!c) return
    let pin = pinned ?? c.pinned
    if (pin && !c.pinned && !canPin(key)) { opts.onPinRefused?.(c); pin = false }
    commit(moveGridColumn(state.value, key, beforeKey, pin))
  }
  /** Neighbours in the same part (frozen / scrolling) of the table. */
  function zone(key: K, visibleOnly: boolean) {
    const c = col(key)
    if (!c) return null
    const list = allColumns.value.filter(x => x.pinned === c.pinned && (!visibleOnly || x.visible || x.key === key))
    return { c, list, i: list.findIndex(x => x.key === key) }
  }
  function canMoveBy(key: K, delta: -1 | 1, visibleOnly = true) {
    const z = zone(key, visibleOnly)
    return !!z && z.i + delta >= 0 && z.i + delta < z.list.length
  }
  function moveBy(key: K, delta: -1 | 1, visibleOnly = true) {
    const z = zone(key, visibleOnly)
    if (!z || !canMoveBy(key, delta, visibleOnly)) return false
    if (delta < 0) { commit(moveGridColumn(state.value, key, z.list[z.i - 1]!.key, z.c.pinned)); return true }
    // Stepping right = landing just after the next neighbour, i.e. before whatever follows it.
    const order = state.value.order
    const after = order[order.indexOf(z.list[z.i + 1]!.key) + 1] ?? null
    commit(moveGridColumn(state.value, key, after === key ? null : after, z.c.pinned))
    return true
  }
  function setWidth(key: K, px: number) {
    const d = byKey.get(key)
    if (!d) return
    const w = clampGridWidth(d, px)
    const widths = { ...state.value.widths }
    if (w === d.width) delete widths[key]
    else widths[key] = w
    commit({ ...state.value, widths })
  }
  function resetWidth(key: K) {
    const widths = { ...state.value.widths }
    delete widths[key]
    commit({ ...state.value, widths })
  }
  /** Columns back to the default; what the table is sorted by is left alone. */
  function reset() {
    const before = state.value
    commit({ ...defaultGridLayout(defs), sort: before.sort })
    return before
  }
  function setSort(key: K, dir: 'asc' | 'desc') {
    if (!byKey.get(key)?.sortable) return
    commit({ ...state.value, sort: { key, dir } })
  }
  function restore(prev: GridLayoutState) { commit(prev) }

  /**
   * A see-through layer over the page for the length of a drag: it shows the right cursor everywhere and
   * keeps rows from reacting to the pointer. (A class on <html> with a "*" rule would do the same, but it
   * makes the browser restyle every cell of the table when the drag starts and again when it ends.)
   */
  function dragShield(cursor: string) {
    const el = Object.assign(document.createElement('div'), { className: 'grid-drag-shield' })
    el.style.cursor = cursor
    document.body.append(el)
    return () => el.remove()
  }
  const colEl = (table: HTMLElement, key: string) => table.querySelector<HTMLElement>(`colgroup > col[data-col="${key}"]`)

  // ─── Fit to content ───
  /**
   * Natural width of the given columns, measured by letting the browser lay the table out by content
   * for one synchronous pass (nothing is painted in between). Covers the header and every loaded row.
   */
  function measure(keys: string[]): Record<string, number> {
    const table = opts.table.value
    const out: Record<string, number> = {}
    if (!table) return out
    const style = table.style
    const prev = { layout: style.tableLayout, width: style.width, minWidth: style.minWidth }
    const cols = keys.map(k => colEl(table, k))
    const prevWidths = cols.map(c => c?.style.width ?? '')
    style.tableLayout = 'auto'
    style.width = 'max-content'
    style.minWidth = '0'
    cols.forEach((c) => { if (c) c.style.width = '1px' })
    for (const k of keys) {
      const th = table.querySelector<HTMLElement>(`thead th[data-col="${k}"]`)
      if (th) out[k] = Math.ceil(th.getBoundingClientRect().width) + 2
    }
    cols.forEach((c, i) => { if (c) c.style.width = prevWidths[i]! })
    style.tableLayout = prev.layout
    style.width = prev.width
    style.minWidth = prev.minWidth
    return out
  }
  const FIT_MAX = 480
  function fitWidth(key: string, px: number) {
    const d = byKey.get(key)!
    return clampGridWidth({ minWidth: d.minWidth, maxWidth: Math.min(d.maxWidth ?? FIT_MAX, FIT_MAX) }, px)
  }
  function autoFit(key: K) {
    const w = measure([key])[key]
    if (w) setWidth(key, fitWidth(key, w))
  }
  function autoFitAll() {
    const sizes = measure(columns.value.map(c => c.key))
    const widths = { ...state.value.widths }
    for (const [k, w] of Object.entries(sizes)) widths[k] = fitWidth(k, w)
    commit({ ...state.value, widths })
  }

  // ─── Resize: drag a header's right edge ───
  function startResize(e: PointerEvent, key: K) {
    const c = col(key), table = opts.table.value
    if (!c || !table || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX, startW = sizes.value[key], startTotal = totalWidth.value
    let w = startW, frame = 0, done = false, moved = false
    let dropShield: (() => void) | null = null
    resizingKey.value = key
    const th = table.querySelector<HTMLElement>(`thead th[data-col="${key}"]`)
    const colNode = colEl(table, key)
    // Frozen columns to the right of a frozen one slide along with its edge.
    const mine = offsets.value[key]
    const followers = mine === undefined
      ? []
      : columns.value.filter(x => (offsets.value[x.key] ?? -1) > mine).map(x => ({ from: offsets.value[x.key]!, cells: [...table.querySelectorAll<HTMLElement>(`:is(th, td)[data-col="${x.key}"]`)] }))
    // A guide down the whole table shows where the edge will land.
    const guide = Object.assign(document.createElement('div'), { className: 'grid-resize-line' })
    const place = () => {
      if (!th || !moved || done) return
      const view = (opts.scroller.value ?? table).getBoundingClientRect(), r = th.getBoundingClientRect()
      guide.style.transform = `translate3d(${Math.round(r.right) - 1}px, ${Math.round(view.top)}px, 0)`
      guide.style.height = `${Math.round(view.height)}px`
      guide.style.display = r.right < view.left || r.right > view.right + 1 ? 'none' : ''
    }
    // Straight to the DOM: one <col> and the table width (plus any following frozen cells).
    const apply = () => {
      frame = 0
      const d = w - startW
      if (colNode) colNode.style.width = `${w}px`
      table.style.width = `${startTotal + d}px`
      for (const f of followers) for (const el of f.cells) el.style.left = `${f.from + d}px`
      place()
    }
    const onMove = (ev: PointerEvent) => {
      // A double-click (fit to content) usually wobbles a pixel or two — that is not a resize.
      if (!moved) {
        if (Math.abs(ev.clientX - startX) < 3) return
        moved = true
        dropShield = dragShield('col-resize')
        document.body.append(guide)
      }
      w = clampGridWidth(c, startW + ev.clientX - startX)
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const finish = (keep: boolean) => {
      if (done) return
      done = true
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      dropShield?.()
      guide.remove()
      resizingKey.value = ''
      if (!moved) return
      if (!keep) w = startW
      apply() // the DOM ends exactly where the saved layout will render it (or back where it started)
      if (w !== startW) setWidth(key, w)
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false) } }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
  }

  // ─── Reorder: drag a header sideways ───
  function startHeaderDrag(e: PointerEvent, key: K) {
    const c = col(key), table = opts.table.value
    // Touch scrolls the table; on phones and tablets columns are arranged in the Columns panel.
    if (!c || !table || e.button !== 0 || e.pointerType === 'touch') return
    if ((e.target as HTMLElement | null)?.closest('[data-grid-nodrag]')) return
    const startX = e.clientX, startY = e.clientY
    let active = false, done = false, x = startX, y = startY, scrollFrame = 0
    let ghost: HTMLElement | null = null, line: HTMLElement | null = null, dropShield: (() => void) | null = null
    let target: { before: K | null, pinned: boolean } | null = null

    const headers = () => [...table.querySelectorAll<HTMLElement>('thead th[data-col]')].map(el => ({ key: el.dataset.col as K, pinned: el.classList.contains('is-pinned'), r: el.getBoundingClientRect() }))
    const update = () => {
      if (!ghost || !line) return
      ghost.style.transform = `translate3d(${x + 14}px, ${y + 12}px, 0)`
      const view = (opts.scroller.value ?? table).getBoundingClientRect()
      const all = headers()
      const frozen = all.filter(h => h.pinned), free = all.filter(h => !h.pinned)
      const frozenRight = frozen.length ? Math.max(...frozen.map(h => h.r.right)) : view.left + leadWidth
      // The part of the table under the pointer decides whether the column lands frozen or not.
      const inFrozen = frozen.length > 0 && pinActive.value && x < frozenRight
      const list = inFrozen ? frozen : free
      let i = list.findIndex(h => x < h.r.left + h.r.width / 2)
      if (i < 0) i = list.length
      const before = list[i]?.key ?? (inFrozen ? free[0]?.key ?? null : null)
      let lineX = i < list.length ? list[i]!.r.left : (list[i - 1]?.r.right ?? frozenRight)
      lineX = Math.min(view.right - 1, Math.max(inFrozen ? view.left : frozenRight, lineX))
      // Dropping it where it already is changes nothing — no line then.
      const order = columns.value
      const at = order.findIndex(o => o.key === key)
      const stays = inFrozen === c.pinned && (before === key || before === (order[at + 1]?.key ?? null) || (inFrozen && i === list.length && order[at + 1]?.pinned === false))
      target = stays ? null : { before, pinned: inFrozen }
      line.style.opacity = stays ? '0' : '1'
      line.style.transform = `translate3d(${Math.round(lineX) - 1}px, ${Math.round(view.top)}px, 0)`
      line.style.height = `${Math.round(view.height)}px`
    }
    const autoScroll = () => {
      scrollFrame = 0
      const sc = opts.scroller.value
      if (!sc || done) return
      const view = sc.getBoundingClientRect()
      const leftEdge = view.left + (pinActive.value ? pinnedWidth.value : leadWidth)
      let step = 0
      if (x > view.right - EDGE) step = Math.ceil((x - (view.right - EDGE)) / 4)
      else if (x < leftEdge + EDGE && x > leftEdge) step = -Math.ceil((leftEdge + EDGE - x) / 4)
      if (step) {
        const from = sc.scrollLeft
        sc.scrollLeft = from + Math.max(-24, Math.min(24, step))
        if (sc.scrollLeft !== from) update()
      }
      scrollFrame = requestAnimationFrame(autoScroll)
    }
    const begin = () => {
      active = true
      draggingKey.value = key
      dropShield = dragShield('grabbing')
      ghost = Object.assign(document.createElement('div'), { className: 'grid-drag-ghost', textContent: c.label })
      line = Object.assign(document.createElement('div'), { className: 'grid-drop-line' })
      document.body.append(line, ghost)
      scrollFrame = requestAnimationFrame(autoScroll)
    }
    const onMove = (ev: PointerEvent) => {
      x = ev.clientX; y = ev.clientY
      if (!active) {
        if (Math.hypot(x - startX, y - startY) < DRAG_THRESHOLD) return
        begin()
      }
      ev.preventDefault()
      update()
    }
    const finish = (drop: boolean) => {
      if (done) return
      done = true
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      if (!active) return
      if (scrollFrame) cancelAnimationFrame(scrollFrame)
      ghost?.remove()
      line?.remove()
      dropShield?.()
      draggingKey.value = ''
      // The mouse-up of a drag would otherwise count as a click on the header (and sort the table).
      const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault() }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, true), 0)
      if (drop && target) move(key, target.before, target.pinned)
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false) } }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
  }

  // ─── Small touches ───
  function hintOverflow(e: MouseEvent) {
    const td = (e.target as HTMLElement | null)?.closest?.('td[data-col]') as HTMLElement | null
    // Cells that explain themselves (their own title, or one on something inside) are left alone.
    if (!td || (td.title && !td.dataset.autoTitle) || td.querySelector('[title]')) return
    const cut = td.scrollWidth > td.clientWidth + 1 || [...td.querySelectorAll<HTMLElement>('.truncate')].some(el => el.scrollWidth > el.clientWidth + 1)
    if (cut) { td.title = (td.textContent || '').replace(/\s+/g, ' ').trim(); td.dataset.autoTitle = '1' }
    else if (td.dataset.autoTitle) { td.removeAttribute('title'); delete td.dataset.autoTitle }
  }
  /** A shadow under the frozen columns appears only once the table is scrolled sideways. */
  function onScroll(e: Event) {
    const el = e.currentTarget as HTMLElement
    el.toggleAttribute('data-scrolled-x', el.scrollLeft > 0)
  }
  watch(() => opts.scroller.value, (el, old) => {
    old?.removeEventListener('scroll', onScroll)
    el?.addEventListener('scroll', onScroll, { passive: true })
  }, { flush: 'post' })

  function adoptLocal() {
    try { const raw = localStorage.getItem(storageKey); if (raw) adopt(JSON.parse(raw)) } catch {}
  }
  // Arriving from another page of the app: the saved layout is used from the very first render.
  // On a full page load the first render has to match the server's, so it waits for mount.
  if (import.meta.client && !useNuxtApp().isHydrating) adoptLocal()
  onMounted(() => {
    mounted = true
    adoptLocal()
    opts.scroller.value?.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('storage', onStorage)
    pullRemote()
  })
  onBeforeUnmount(() => {
    mounted = false
    window.removeEventListener('storage', onStorage)
    opts.scroller.value?.removeEventListener('scroll', onScroll)
    // A change made in the last moment before leaving the page is still sent.
    if (pushTimer) { clearTimeout(pushTimer); pushRemote() }
  })

  return {
    id, columns, allColumns, sizes, offsets, sort, setSort, hiddenCount, pinnedCount, isCustomized, saveState, draggingKey, resizingKey, tableStyle, leadWidth,
    setVisible, showAll, setPinned, canPin, move, moveBy, canMoveBy, setWidth, resetWidth, autoFit, autoFitAll, reset, restore,
    startResize, startHeaderDrag, hintOverflow,
  }
}
