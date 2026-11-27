<script setup lang="ts">
/**
 * Quick edit — the dealership list as a spreadsheet.
 * Click a cell and type, Tab / Enter / arrows to move, Shift+arrows or drag to select a range,
 * paste straight from Excel / Google Sheets (new rows are added when you paste past the end),
 * ⌘D fills a selection down, ⌘Z undoes, ⌘S saves. Nothing touches the CRM until you press Save.
 */
import type { CrmDealership } from '~/composables/useCrmDealerships'
import { dueState, formatDuration } from '~/composables/useCrmDealerships'
import type { GridColumn, GridLayout } from '~/composables/useGridLayout'
import { CASCADE_FIELDS } from '~/composables/useCascade'
import { DEALERSHIP_STAGES, INTERACTION_TYPE_MAP, LEAD_SOURCES, LEAD_SOURCE_STYLE, STAGE_STYLE, US_STATES } from '~/constants/crm'
import { INTERACTION_ICONS } from '~/constants/crm-icons'
import { AlertCircle, ArrowDownToLine, Briefcase, Check, ExternalLink, Keyboard, Layers, Loader2, Plus, RotateCcw, Route, Save, ShieldAlert, Trash2, Undo2, UserCircle2, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format, formatDistanceToNow } from 'date-fns'

interface UserOpt { id: string, name: string }
/** What the list page works out about a dealership — the read-only cells show the same thing as the list (one definition). */
interface CellHelpers {
  stageAgeMs: (d: CrmDealership) => number
  isStalled: (d: CrmDealership) => boolean
  needsVerification: (d: CrmDealership) => boolean
  scanPageCount: (d: CrmDealership) => number
  scanPageIssue: (d: CrmDealership) => string
}
const props = defineProps<{
  rows: CrmDealership[], users: UserOpt[], canEdit: boolean, canAdd: boolean
  /** The list's own column layout (useGridLayout on the dealership page) — quick edit draws the very same table. */
  layout: GridLayout<any>
  /** What the list is sorted by (shown in the header; a header click sorts both). */
  sortKey?: string
  sortDir?: 'asc' | 'desc'
  helpers: CellHelpers
  /** While quick edit is open the layout works on this table and scroller (resize, drag to move, fit, frozen columns). */
  bindTable?: (el: HTMLElement | null) => void
  bindScroller?: (el: HTMLElement | null) => void
}>()
const emit = defineEmits<{ close: [], saved: [], sort: [key: string, dir?: 'asc' | 'desc'], manage: [] }>()
const { createDealership, updateDealership } = useCrmDealerships()
const cascade = useCascade()

// ─── Columns ───
// Quick edit never rearranges the table: it draws exactly the columns of the list — same order, same widths, same hidden
// and frozen columns, same header (sort, drag to move, drag the edge to resize, "⋮" menu) — through the same layout object.
// The columns listed in EDIT can be typed into; every other column shows what the list shows and is read-only here.
type ColKey = string
interface Edit { type?: 'select', options?: (row: CrmDealership | null) => string[], suggest?: boolean, required?: boolean, hint?: string }
const PARKED = ['Won', 'Lost', 'Nurture / Follow Up Later']
const EDIT: Record<string, Edit> = {
  name: { required: true },
  dealerGroup: { suggest: true },
  route: { suggest: true, hint: 'Day 1' },
  brands: { hint: 'Ford, Kia' },
  stage: { type: 'select', options: row => DEALERSHIP_STAGES.filter(s => !PARKED.includes(s) || row?.stage === s) },
  city: { suggest: true },
  state: { type: 'select', options: () => [...US_STATES], required: true },
  zip: {},
  phone: {},
  website: {},
  territory: { suggest: true },
  owner: { type: 'select', options: () => ['', ...props.users.map(u => u.name)] },
  leadSource: { type: 'select', options: () => [...LEAD_SOURCES] },
  notes: {},
}
const SUGGEST_KEYS = Object.keys(EDIT).filter(k => EDIT[k]!.suggest)
interface Col extends GridColumn<string> { edit: Edit | null }
/** The list's visible columns, in its order. Unchanged by a resize (widths live in the <col> elements). */
const cols = computed<Col[]>(() => (props.layout.columns.value as GridColumn<string>[]).map(c => ({ ...c, edit: EDIT[c.key] ?? null })))
const colIndex = (key: string) => cols.value.findIndex(c => c.key === key)
/** Attributes every body cell of a column shares (frozen position, last-column edge) — the same as the list's cells. */
const cellBind = computed(() => {
  const out: Record<string, Record<string, unknown>> = {}
  const offsets = props.layout.offsets.value as Record<string, number | undefined>
  for (const c of cols.value) {
    const left = offsets[c.key]
    out[c.key] = {
      'data-col': c.key,
      'class': { 'is-pinned': c.pinned, 'is-pin-edge': c.pinEdge, 'is-last': c.last },
      'style': left === undefined ? undefined : { left: `${left}px` },
    }
  }
  return out
})
/** Width covered by the frozen part — moving the cursor scrolls a cell out from under it. */
const frozenWidth = computed(() => {
  const sizes = props.layout.sizes.value as Record<string, number>
  return props.layout.leadWidth + cols.value.reduce((n, c) => n + (c.pinned ? sizes[c.key] || 0 : 0), 0)
})

// The table and its scroller are handed to the page's layout while quick edit is open.
const bodyEl = ref<HTMLElement | null>(null)
const tableEl = ref<HTMLElement | null>(null)
const setBody = (el: any) => { bodyEl.value = el || null; props.bindScroller?.(bodyEl.value) }
const setTable = (el: any) => { tableEl.value = el || null; props.bindTable?.(tableEl.value) }

/** What a read-only cell says, as plain text (copying a selection, the status bar). */
function readText(d: CrmDealership, key: ColKey): string {
  const a = d.auditSummary?.latest, p = d.contactSummary?.primary, i = d.interactionSummary
  switch (key) {
    case 'dealershipId': return d.dealershipId || ''
    case 'inStage': return formatDuration(props.helpers.stageAgeMs(d))
    case 'lastTouch': return i?.last ? `${i.last.typeLabel} · ${format(new Date(i.last.occurredAt), 'MMM d, yyyy')}` : ''
    case 'nextAction': return i?.nextAction ? `${i.nextAction.date || ''} ${i.nextAction.text}`.trim() : ''
    case 'scanPages': return String(d.scanPages?.length || 0)
    case 'primaryContact': return p?.fullName || ''
    case 'primaryTitle': return p ? (p.jobTitle || p.role || '') : ''
    case 'primaryEmail': return p?.email || ''
    case 'contacts': return String(d.contactSummary?.active ?? 0)
    case 'missingPhotos': return a && a.missingPhotoPct !== null ? `${a.missingPhotoPct}%` : ''
    case 'inventory': return a ? String(a.totalVehicles) : ''
    case 'lastAudit': return a ? format(new Date(a.auditedAt), 'MMM d, yyyy') : ''
    case 'added': return d.createdAt ? format(new Date(d.createdAt), 'MMM d, yyyy') : ''
    case 'updated': return d.updatedAt ? format(new Date(d.updatedAt), 'MMM d, yyyy') : ''
    default: return ''
  }
}
const brandList = (v: string) => v.split(/[,;/|]+/).map(x => x.trim()).filter(Boolean)
const DUE_TONE = { overdue: 'text-rose-600 dark:text-rose-400', today: 'text-amber-600 dark:text-amber-400', soon: 'text-sky-600 dark:text-sky-400', later: 'text-muted-foreground', none: 'text-muted-foreground' }

/** Stored value → what the cell shows / edits. */
function original(row: CrmDealership, key: ColKey): string {
  switch (key) {
    case 'brands': return (row.brands || []).join(', ')
    case 'owner': return row.assignedUserName || ''
    case 'website': return row.website || ''
    default: return String((row as any)[key] ?? '')
  }
}

// ─── Rows: existing (keyed by id) + new ones (keyed new-N) ───
interface NewRow { key: string, values: Record<string, string>, allowDuplicate?: boolean }
let newSeq = 0
const added = ref<NewRow[]>([])
const edits = ref<Record<string, Partial<Record<ColKey, string>>>>({})
const errors = ref<Record<string, string>>({})
const allowDup = ref<Record<string, boolean>>({})
interface GridRow { key: string, row: CrmDealership | null, add: NewRow | null }
const gridRows = computed<GridRow[]>(() => [
  ...props.rows.map(r => ({ key: r.id, row: r, add: null })),
  ...added.value.map(a => ({ key: a.key, row: null, add: a })),
])
const rowByKey = computed(() => new Map(gridRows.value.map(g => [g.key, g])))
function value(g: GridRow, key: ColKey): string {
  if (!EDIT[key]) return g.row ? readText(g.row, key) : ''
  if (g.add) return g.add.values[key] ?? ''
  const e = edits.value[g.key]
  return e && key in e ? e[key]! : original(g.row!, key)
}
function isChanged(g: GridRow, key: ColKey) { return !!g.add ? !!g.add.values[key] : !!edits.value[g.key] && key in edits.value[g.key]! }
const changeCount = computed(() => Object.values(edits.value).reduce((n, e) => n + Object.keys(e).length, 0))
const dirtyRows = computed(() => Object.keys(edits.value).length)
const dirty = computed(() => changeCount.value > 0 || added.value.length > 0)
defineExpose({ dirty })

/** Suggestions for free-text columns = every value already in use. */
const suggestions = computed(() => {
  const out: Partial<Record<ColKey, string[]>> = {}
  for (const k of SUGGEST_KEYS) out[k] = [...new Set(props.rows.map(r => original(r, k)).filter(Boolean))].sort((a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }))
  return out
})
const defaultState = computed(() => {
  const n: Record<string, number> = {}
  for (const r of props.rows) if (r.state) n[r.state] = (n[r.state] || 0) + 1
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
})

// ─── Undo ───
type UndoEntry = { key: string, col: ColKey, prev: string | undefined }
/** One undo step: the cells it changed and any new rows it created (a paste past the end). */
type UndoStep = { cells: UndoEntry[], newRows: string[] }
const undoStack = ref<UndoStep[]>([])
function setCell(key: string, col: ColKey, v: string, batch?: UndoEntry[]) {
  const g = rowByKey.value.get(key)
  if (!g || !EDIT[col]) return
  if (col === 'state') v = v.trim().toUpperCase().slice(0, 2)
  const prev = g.add ? g.add.values[col] : edits.value[key]?.[col]
  batch?.push({ key, col, prev })
  if (g.add) { g.add.values[col] = v; return }
  const e = { ...(edits.value[key] || {}) }
  if (v === original(g.row!, col)) delete e[col]
  else e[col] = v
  if (Object.keys(e).length) edits.value = { ...edits.value, [key]: e }
  else { const n = { ...edits.value }; delete n[key]; edits.value = n }
  delete errors.value[key]
}
function commitBatch(cells: UndoEntry[], newRows: string[] = []) { if (cells.length || newRows.length) undoStack.value = [...undoStack.value.slice(-99), { cells, newRows }] }
function undo() {
  const step = undoStack.value[undoStack.value.length - 1]
  if (!step) return
  undoStack.value = undoStack.value.slice(0, -1)
  for (const u of [...step.cells].reverse()) {
    const g = rowByKey.value.get(u.key)
    if (!g) continue
    if (g.add) { if (u.prev === undefined) delete g.add.values[u.col]; else g.add.values[u.col] = u.prev }
    else setCell(u.key, u.col, u.prev === undefined ? original(g.row!, u.col) : u.prev)
  }
  if (step.newRows.length) added.value = added.value.filter(a => !step.newRows.includes(a.key))
  if (cur.value && cur.value.r >= gridRows.value.length) cur.value = anchor.value = gridRows.value.length ? { r: gridRows.value.length - 1, c: cur.value.c } : null
}

// ─── Selection & editing ───
const cur = ref<{ r: number, c: number } | null>(null)
const anchor = ref<{ r: number, c: number } | null>(null)
const editing = ref(false)
const draft = ref('')
const editorEl = ref<HTMLInputElement | HTMLSelectElement | null>(null)
// The editor sits inside v-for, so a plain ref would become an array — use a callback ref.
const setEditor = (el: any) => { editorEl.value = el || null }
const gridEl = ref<HTMLElement | null>(null)
const range = computed(() => {
  if (!cur.value) return null
  const a = anchor.value || cur.value
  return { r1: Math.min(a.r, cur.value.r), r2: Math.max(a.r, cur.value.r), c1: Math.min(a.c, cur.value.c), c2: Math.max(a.c, cur.value.c) }
})
const inRange = (r: number, c: number) => !!range.value && r >= range.value.r1 && r <= range.value.r2 && c >= range.value.c1 && c <= range.value.c2
const isCur = (r: number, c: number) => !!cur.value && cur.value.r === r && cur.value.c === c
const rangeSize = computed(() => range.value ? (range.value.r2 - range.value.r1 + 1) * (range.value.c2 - range.value.c1 + 1) : 0)

function select(r: number, c: number, extend = false) {
  r = Math.max(0, Math.min(gridRows.value.length - 1, r)); c = Math.max(0, Math.min(cols.value.length - 1, c))
  if (!extend || !cur.value) anchor.value = { r, c }
  cur.value = { r, c }
  nextTick(() => {
    const cell = bodyEl.value?.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`)
    cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}
let dragging = false
function onCellDown(e: MouseEvent, r: number, c: number) {
  if (editing.value) { if (isCur(r, c)) return; commit() }
  if (e.button !== 0) return
  select(r, c, e.shiftKey)
  dragging = true
  gridEl.value?.focus({ preventScroll: true })
  e.preventDefault()
}
function onCellOver(r: number, c: number) { if (dragging && cur.value && (cur.value.r !== r || cur.value.c !== c)) { cur.value = { r, c } } }
onMounted(() => { window.addEventListener('mouseup', () => { dragging = false }) })

function startEdit(initial?: string) {
  if (!cur.value || !props.canEdit) return
  const col = cols.value[cur.value.c]!
  if (!col.edit) return
  const g = gridRows.value[cur.value.r]!
  // Typing into a drop-down column jumps to the first option starting with that letter.
  if (col.edit.type === 'select') { const opts = col.edit.options!(g.row); draft.value = (initial && opts.find(o => o.toLowerCase().startsWith(initial.toLowerCase()))) || value(g, col.key) }
  else draft.value = initial !== undefined ? initial : value(g, col.key)
  editing.value = true
  nextTick(() => {
    const el = editorEl.value
    if (!el) return
    el.focus()
    if (el instanceof HTMLInputElement) { if (initial === undefined) el.select(); else el.setSelectionRange(el.value.length, el.value.length) }
    else if (initial === undefined) { try { (el as any).showPicker?.() } catch {} }
  })
}
function commit(move?: 'down' | 'right' | 'left' | 'up') {
  if (editing.value && cur.value) {
    const g = gridRows.value[cur.value.r]!
    const col = cols.value[cur.value.c]!
    const v = draft.value
    if (v !== value(g, col.key)) { const b: UndoEntry[] = []; setCell(g.key, col.key, v, b); commitBatch(b) }
  }
  editing.value = false
  gridEl.value?.focus({ preventScroll: true })
  if (move && cur.value) {
    const d = { down: [1, 0], up: [-1, 0], right: [0, 1], left: [0, -1] }[move]
    select(cur.value.r + d[0]!, cur.value.c + d[1]!)
  }
}
function cancelEdit() { editing.value = false; gridEl.value?.focus({ preventScroll: true }) }

function clearRange() {
  if (!range.value) return
  const b: UndoEntry[] = []
  for (let r = range.value.r1; r <= range.value.r2; r++) for (let c = range.value.c1; c <= range.value.c2; c++) {
    const g = gridRows.value[r]!, col = cols.value[c]!
    if (col.edit && value(g, col.key) !== '') setCell(g.key, col.key, '', b)
  }
  commitBatch(b)
}
function fillDown() {
  if (!range.value || range.value.r2 === range.value.r1) return
  const b: UndoEntry[] = []
  for (let c = range.value.c1; c <= range.value.c2; c++) {
    const col = cols.value[c]!
    if (!col.edit) continue
    const top = value(gridRows.value[range.value.r1]!, col.key)
    for (let r = range.value.r1 + 1; r <= range.value.r2; r++) setCell(gridRows.value[r]!.key, col.key, top, b)
  }
  commitBatch(b)
  toast(`Filled ${b.length} cell${b.length === 1 ? '' : 's'}`)
}
async function copyRange() {
  if (!range.value) return
  const lines: string[] = []
  for (let r = range.value.r1; r <= range.value.r2; r++) {
    const cells: string[] = []
    for (let c = range.value.c1; c <= range.value.c2; c++) cells.push(value(gridRows.value[r]!, cols.value[c]!.key))
    lines.push(cells.join('\t'))
  }
  try { await navigator.clipboard.writeText(lines.join('\n')); toast(`Copied ${rangeSize.value} cell${rangeSize.value === 1 ? '' : 's'}`) } catch { toast.error('Clipboard is blocked by the browser') }
}
/** Excel / Sheets paste: tab-separated rows, starting at the selected cell; rows past the end become new dealerships. */
function onPaste(e: ClipboardEvent) {
  if (editing.value || !cur.value || !props.canEdit) return
  const text = e.clipboardData?.getData('text/plain') || ''
  if (!text) return
  e.preventDefault()
  const lines = text.replace(/\r/g, '').split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  const matrix = lines.map(l => l.split('\t'))
  const b: UndoEntry[] = []
  const createdRows: string[] = []
  // One value pasted onto a selection → fill the whole selection with it.
  if (matrix.length === 1 && matrix[0]!.length === 1 && rangeSize.value > 1) {
    for (let r = range.value!.r1; r <= range.value!.r2; r++) for (let c = range.value!.c1; c <= range.value!.c2; c++) if (cols.value[c]!.edit) setCell(gridRows.value[r]!.key, cols.value[c]!.key, matrix[0]![0]!, b)
    commitBatch(b); return
  }
  for (let i = 0; i < matrix.length; i++) {
    const r = cur.value.r + i
    if (r >= gridRows.value.length) { if (!props.canAdd) break; createdRows.push(addRow()) }
    const g = gridRows.value[r]!
    for (let j = 0; j < matrix[i]!.length; j++) {
      const c = cur.value.c + j
      if (c >= cols.value.length) break
      const col = cols.value[c]!
      if (col.edit) setCell(g.key, col.key, matrix[i]![j]!.trim(), b)
    }
  }
  commitBatch(b, createdRows)
  anchor.value = { ...cur.value }
  cur.value = { r: Math.min(gridRows.value.length - 1, cur.value.r + matrix.length - 1), c: Math.min(cols.value.length - 1, cur.value.c + Math.max(...matrix.map(m => m.length)) - 1) }
  toast.success(`Pasted ${b.length} cell${b.length === 1 ? '' : 's'}${createdRows.length ? ` · ${createdRows.length} new row${createdRows.length === 1 ? '' : 's'}` : ''}`)
}

function onKey(e: KeyboardEvent) {
  if (editing.value) return
  // The page has single-letter shortcuts (n, d, /) — keys typed into the sheet stay in the sheet.
  e.stopPropagation()
  // The header has its own keys (Enter sorts, Alt/Shift + arrows move and resize a column).
  if ((e.target as HTMLElement | null)?.closest?.('thead')) return
  const meta = e.metaKey || e.ctrlKey
  if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
  if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return }
  if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); fillDown(); return }
  if (meta && e.key.toLowerCase() === 'c') { e.preventDefault(); copyRange(); return }
  if (meta && e.key.toLowerCase() === 'a') { e.preventDefault(); anchor.value = { r: 0, c: 0 }; cur.value = { r: gridRows.value.length - 1, c: cols.value.length - 1 }; return }
  if (!cur.value) { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); select(0, Math.max(0, cols.value.findIndex(c => c.edit))) } return }
  const { r, c } = cur.value
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); select(meta ? gridRows.value.length - 1 : r + 1, c, e.shiftKey); return
    case 'ArrowUp': e.preventDefault(); select(meta ? 0 : r - 1, c, e.shiftKey); return
    case 'ArrowRight': e.preventDefault(); select(r, meta ? cols.value.length - 1 : c + 1, e.shiftKey); return
    case 'ArrowLeft': e.preventDefault(); select(r, meta ? 0 : c - 1, e.shiftKey); return
    case 'Home': e.preventDefault(); select(r, 0, e.shiftKey); return
    case 'End': e.preventDefault(); select(r, cols.value.length - 1, e.shiftKey); return
    case 'PageDown': e.preventDefault(); select(r + 20, c, e.shiftKey); return
    case 'PageUp': e.preventDefault(); select(r - 20, c, e.shiftKey); return
    case 'Tab': e.preventDefault(); select(r, c + (e.shiftKey ? -1 : 1)); return
    case 'Enter': case 'F2': e.preventDefault(); startEdit(); return
    case 'Escape': e.preventDefault(); anchor.value = cur.value; return
    case 'Delete': case 'Backspace': e.preventDefault(); clearRange(); return
  }
  if (e.key.length === 1 && !meta && !e.altKey) { e.preventDefault(); startEdit(e.key) }
}
function onEditorKey(e: KeyboardEvent) {
  e.stopPropagation()
  switch (e.key) {
    case 'Enter': e.preventDefault(); commit(e.shiftKey ? 'up' : 'down'); return
    case 'Tab': e.preventDefault(); commit(e.shiftKey ? 'left' : 'right'); return
    case 'Escape': e.preventDefault(); cancelEdit(); return
  }
}

// ─── Rows ───
function addRow(focus = false) {
  const key = `new-${++newSeq}`
  added.value = [...added.value, { key, values: { state: defaultState.value } }]
  if (focus) { commitBatch([], [key]); nextTick(() => { select(gridRows.value.length - 1, Math.max(0, colIndex('name'))); startEdit('') }) }
  return key
}
function removeNewRow(key: string) {
  added.value = added.value.filter(a => a.key !== key)
  delete errors.value[key]
  if (cur.value && cur.value.r >= gridRows.value.length) cur.value = anchor.value = null
}
function revertRow(key: string) {
  const n = { ...edits.value }; delete n[key]; edits.value = n; delete errors.value[key]
}
function discardAll() {
  if (dirty.value && !confirm(`Discard ${changeCount.value} change${changeCount.value === 1 ? '' : 's'}${added.value.length ? ` and ${added.value.length} new row${added.value.length === 1 ? '' : 's'}` : ''}?`)) return
  edits.value = {}; added.value = []; errors.value = {}; undoStack.value = []
}

// ─── Save ───
const saving = ref(false)
const progress = ref({ done: 0, total: 0 })
function payloadFor(vals: Partial<Record<ColKey, string>>) {
  const p: Record<string, any> = {}
  for (const [k, v] of Object.entries(vals)) {
    if (k === 'owner') { const u = props.users.find(x => x.name === v); p.assignedUserId = u?.id || ''; p.assignedUserName = u?.name || '' }
    else if (k === 'brands') p.brands = String(v || '').split(/[,;/|]+/).map(s => s.trim()).filter(Boolean)
    else p[k] = v
  }
  return p
}
const friendly = (e: any) => e?.data?.statusMessage || e?.statusMessage || e?.message || 'Could not save'
async function save() {
  if (saving.value || !dirty.value) return
  // New rows must at least have a name and a state.
  const newRows = added.value.filter((a) => {
    if (String(a.values.name || '').trim() && String(a.values.state || '').trim()) return true
    errors.value[a.key] = 'New dealerships need a name and a state'
    return false
  })
  const editKeys = Object.keys(edits.value)
  saving.value = true
  progress.value = { done: 0, total: editKeys.length + newRows.length }
  const changed: { field: typeof CASCADE_FIELDS[number], from: string, to: string, id: string }[] = []
  let ok = 0, failed = 0
  for (const key of editKeys) {
    const g = rowByKey.value.get(key)
    const vals = edits.value[key]
    if (!g?.row || !vals) { progress.value.done++; continue }
    try {
      const saved = await updateDealership(key, { ...payloadFor(vals), ...(allowDup.value[key] ? { allowDuplicate: true } : {}) } as any)
      for (const f of CASCADE_FIELDS) if (f in vals) changed.push({ field: f, from: String((g.row as any)[f] || ''), to: String((saved as any)[f] || ''), id: key })
      revertRow(key); ok++
    }
    catch (e: any) {
      failed++
      errors.value[key] = e?.statusCode === 409 && e?.data?.data?.duplicates?.length ? `Looks like a duplicate of ${e.data.data.duplicates.map((d: any) => d.name).join(', ')} — click to save anyway` : friendly(e)
    }
    progress.value.done++
  }
  for (const a of newRows) {
    try {
      await createDealership({ ...payloadFor(a.values), ...(allowDup.value[a.key] ? { allowDuplicate: true } : {}) } as any)
      removeNewRow(a.key); ok++
    }
    catch (e: any) {
      failed++
      errors.value[a.key] = e?.statusCode === 409 && e?.data?.data?.duplicates?.length ? `Looks like a duplicate of ${e.data.data.duplicates.map((d: any) => d.name).join(', ')} — click to save anyway` : friendly(e)
    }
    progress.value.done++
  }
  saving.value = false
  undoStack.value = []
  if (ok) toast.success(`Saved ${ok} dealership${ok === 1 ? '' : 's'}`, failed ? { description: `${failed} could not be saved — see the red rows` } : undefined)
  else if (failed) toast.error(`${failed} row${failed === 1 ? '' : 's'} could not be saved`)
  if (ok) emit('saved')
  if (changed.length) cascade.offer(changed)
}
/** A red row that is a possible duplicate: allow it and save again. */
function saveAnyway(key: string) {
  if (!/save anyway/.test(errors.value[key] || '')) return
  allowDup.value[key] = true
  delete errors.value[key]
  save()
}

// Leaving the page with unsaved cells → browser prompt.
const guard = (e: BeforeUnloadEvent) => { if (dirty.value) { e.preventDefault(); e.returnValue = '' } }
onMounted(() => window.addEventListener('beforeunload', guard))
onBeforeUnmount(() => window.removeEventListener('beforeunload', guard))
function close() {
  if (dirty.value && !confirm('You have unsaved changes. Leave quick edit and lose them?')) return
  emit('close')
}
const colAt = (c: number) => cols.value[c] as Col
const rowAt = (r: number) => gridRows.value[r] as GridRow
const optionsFor = (c: Col, g: GridRow) => c.edit?.options ? c.edit.options(g.row) : []
const cellTitle = (g: GridRow, key: ColKey) => {
  if (g.row && isChanged(g, key)) return `Was: ${original(g.row, key) || '—'}`
  return undefined
}

// ─── Keeping the cursor right when the table changes under it ───
// A column was moved, hidden or shown (header drag, column menu, Columns panel): what was being typed is kept,
// and the cursor stays on the same column (or lets go when that column is gone).
watch(() => cols.value.map(c => c.key), (now, was) => {
  if (now.join('|') === was.join('|')) return
  if (editing.value && cur.value) {
    const g = gridRows.value[cur.value.r], key = was[cur.value.c]
    if (g && key && draft.value !== value(g, key)) { const b: UndoEntry[] = []; setCell(g.key, key, draft.value, b); commitBatch(b) }
    editing.value = false
  }
  const at = (p: { r: number, c: number } | null) => p ? now.indexOf(was[p.c] ?? '') : -1
  const c = at(cur.value), a = at(anchor.value)
  if (cur.value) cur.value = c < 0 ? null : { r: cur.value.r, c }
  anchor.value = cur.value && a >= 0 && anchor.value ? { r: anchor.value.r, c: a } : cur.value ? { ...cur.value } : null
})
// Sorted from the header: the rows move, so the cursor lets go (edits stay — they belong to the dealership, not the row number).
watch(() => [props.sortKey, props.sortDir], () => { if (editing.value) commit(); cur.value = anchor.value = null })
</script>

<template>
  <div ref="gridEl" tabindex="0" class="absolute inset-0 flex flex-col bg-background outline-none" @keydown="onKey" @paste="onPaste">
    <!-- Toolbar -->
    <div class="shrink-0 flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
      <div class="flex items-center gap-2 mr-2">
        <span class="text-sm font-semibold">Quick edit</span>
        <span class="text-xs text-muted-foreground tabular-nums">{{ rows.length }} row{{ rows.length === 1 ? '' : 's' }}</span>
      </div>
      <Transition name="fade">
        <span v-if="dirty" class="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 tabular-nums">
          <span class="size-1.5 rounded-full bg-amber-500" />
          {{ changeCount }} change{{ changeCount === 1 ? '' : 's' }} in {{ dirtyRows }} row{{ dirtyRows === 1 ? '' : 's' }}<template v-if="added.length"> · {{ added.length }} new</template>
        </span>
      </Transition>
      <Button v-if="canAdd" variant="outline" size="sm" class="h-7 gap-1.5 text-xs" @click="addRow(true)"><Plus class="size-3.5" /> Add row</Button>
      <Button variant="outline" size="sm" class="h-7 gap-1.5 text-xs" :disabled="!undoStack.length" title="Undo (⌘Z)" @click="undo"><Undo2 class="size-3.5" /> Undo</Button>
      <Button variant="outline" size="sm" class="h-7 gap-1.5 text-xs" :disabled="!range || range.r1 === range.r2" title="Copy the top cell of the selection into the cells below it (⌘D)" @click="fillDown"><ArrowDownToLine class="size-3.5" /> Fill down</Button>
      <Button variant="ghost" size="sm" class="h-7 gap-1.5 text-xs text-muted-foreground" :disabled="!dirty || saving" @click="discardAll"><RotateCcw class="size-3.5" /> Discard</Button>
      <div class="ml-auto flex items-center gap-2">
        <Popover>
          <PopoverTrigger as-child><Button variant="ghost" size="sm" class="h-7 gap-1.5 text-xs text-muted-foreground"><Keyboard class="size-3.5" /> Shortcuts</Button></PopoverTrigger>
          <PopoverContent align="end" class="w-80 text-xs">
            <p class="font-semibold mb-2">Works like a spreadsheet</p>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt class="font-mono text-[11px] text-muted-foreground">Type</dt><dd>Start editing the selected cell (replaces it)</dd>
              <dt class="font-mono text-[11px] text-muted-foreground">Enter / F2</dt><dd>Edit · Enter again moves down</dd>
              <dt class="font-mono text-[11px] text-muted-foreground">Tab / ⇧Tab</dt><dd>Next / previous cell</dd>
              <dt class="font-mono text-[11px] text-muted-foreground">⇧ + arrows</dt><dd>Select a range (or drag with the mouse)</dd>
              <dt class="font-mono text-[11px] text-muted-foreground">⌘V</dt><dd>Paste from Excel / Sheets — extra rows become new dealerships</dd>
              <dt class="font-mono text-[11px] text-muted-foreground">⌘D</dt><dd>Fill the selection with its top cell</dd>
              <dt class="font-mono text-[11px] text-muted-foreground">⌘C</dt><dd>Copy the selection</dd>
              <dt class="font-mono text-[11px] text-muted-foreground">Delete</dt><dd>Clear the selection</dd>
              <dt class="font-mono text-[11px] text-muted-foreground">⌘Z</dt><dd>Undo</dd>
              <dt class="font-mono text-[11px] text-muted-foreground">⌘S</dt><dd>Save everything</dd>
            </dl>
            <p class="mt-2 text-muted-foreground">Changed cells turn amber. Renaming a dealer group, route, territory or city asks whether to rename it on the other dealerships too.</p>
          </PopoverContent>
        </Popover>
        <Button size="sm" class="h-7 gap-1.5 text-xs" :disabled="!dirty || saving || !canEdit" title="Save (⌘S)" @click="save">
          <Loader2 v-if="saving" class="size-3.5 animate-spin" /><Save v-else class="size-3.5" />
          <template v-if="saving">Saving {{ progress.done }}/{{ progress.total }}</template>
          <template v-else>Save{{ dirty ? ` ${dirtyRows + added.length}` : '' }}</template>
        </Button>
        <Button variant="outline" size="sm" class="h-7 gap-1.5 text-xs" @click="close"><X class="size-3.5" /> Done</Button>
      </div>
      <div v-if="saving" class="basis-full h-1 rounded-full bg-muted overflow-hidden"><div class="h-full bg-primary transition-all" :style="{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }" /></div>
    </div>

    <!-- Sheet — the same table as the list: its columns, its header, its frozen columns -->
    <div :ref="setBody" class="flex-1 min-h-0 overflow-auto select-none" :style="{ scrollPaddingLeft: `${frozenWidth}px`, scrollPaddingTop: '30px' }">
      <table :ref="setTable" class="data-grid crm-grid qe-grid text-[13px] leading-5 border-separate border-spacing-0" :style="layout.tableStyle">
        <GridColgroup :grid="layout" />
        <thead>
          <tr class="text-[11px] uppercase tracking-wider">
            <th class="is-pinned qe-lead" style="left: 0" title="Row">#</th>
            <GridHeaderCell
              v-for="c in cols" :key="c.key" :col="c" :grid="layout" :sorted="sortKey === c.key ? sortDir : null"
              @sort="emit('sort', c.key, $event)" @manage="emit('manage')"
            />
            <th class="grid-filler" aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(g, r) in gridRows" :key="g.key" class="group/row transition-colors hover:bg-accent/40" :class="errors[g.key] ? 'qe-row-error' : g.add ? 'qe-row-new' : edits[g.key] ? 'qe-row-edited' : ''">
            <td class="is-pinned qe-lead border-b border-border/60 py-1" :class="cur?.r === r && 'qe-lead-cur'" style="left: 0">
              <button v-if="errors[g.key]" type="button" class="inline-flex items-center justify-center size-5 rounded text-rose-600" :title="errors[g.key]" @click="saveAnyway(g.key)"><AlertCircle class="size-3.5" /></button>
              <button v-else-if="g.add" type="button" class="inline-flex items-center justify-center size-5 rounded text-emerald-600 hover:bg-rose-500/10 hover:text-rose-600" title="Remove this new row" @click="removeNewRow(g.key)"><Trash2 class="size-3" /></button>
              <button v-else-if="edits[g.key]" type="button" class="inline-flex items-center justify-center size-5 rounded text-amber-600 hover:bg-amber-500/10" title="Revert this row" @click="revertRow(g.key)"><RotateCcw class="size-3" /></button>
              <template v-else>
                <span class="group-hover/row:hidden">{{ r + 1 }}</span>
                <NuxtLink :to="`/crm/dealership/${g.key}`" target="_blank" class="hidden group-hover/row:inline-flex items-center justify-center size-5 rounded text-primary hover:bg-primary/10" title="Open in a new tab"><ExternalLink class="size-3" /></NuxtLink>
              </template>
            </td>
            <td
              v-for="(c, ci) in cols" :key="c.key" v-bind="cellBind[c.key]" :data-cell="`${r}:${ci}`"
              class="qe-cell relative px-3 border-b border-border/60 whitespace-nowrap py-1"
              :class="[
                c.align === 'right' && 'text-right tabular-nums',
                c.edit ? 'cursor-cell' : 'cursor-default',
                inRange(r, ci) && !isCur(r, ci) && 'qe-range',
                isCur(r, ci) && 'qe-cur',
                c.edit && !g.add && isChanged(g, c.key) && 'qe-changed',
                g.add && c.edit?.required && !value(g, c.key) && 'qe-missing',
              ]"
              :title="cellTitle(g, c.key)"
              @mousedown="onCellDown($event, r, ci)" @mouseover="onCellOver(r, ci)" @dblclick="startEdit()"
            >
              <template v-if="c.edit && isCur(r, ci) && editing">
                <select
                  v-if="c.edit.type === 'select'" :ref="setEditor" v-model="draft"
                  class="absolute inset-0 w-full h-full bg-background px-1.5 text-left text-[13px] outline-none ring-2 ring-inset ring-primary"
                  @keydown="onEditorKey" @change="commit()" @blur="commit()"
                >
                  <option v-for="o in optionsFor(c, g)" :key="o" :value="o">{{ o || '— none —' }}</option>
                </select>
                <input
                  v-else :ref="setEditor" v-model="draft" type="text" :list="c.edit.suggest ? `qe-${c.key}` : undefined" autocomplete="off" spellcheck="false"
                  class="absolute inset-0 w-full h-full bg-background px-2 text-left text-[13px] outline-none ring-2 ring-inset ring-primary"
                  @keydown="onEditorKey" @blur="commit()"
                >
              </template>

              <!-- Columns that can be typed into: shown the way the list shows them, from the value being edited -->
              <template v-else-if="c.edit">
                <template v-if="!value(g, c.key)">
                  <span v-if="g.add" class="text-muted-foreground/40">{{ c.edit.hint }}</span>
                  <span v-else-if="c.key === 'owner'" class="inline-flex max-w-full min-w-0 items-center gap-1.5 align-bottom text-xs text-rose-600 dark:text-rose-400"><UserCircle2 class="size-3.5 shrink-0" /> <span class="truncate">Unassigned</span></span>
                  <span v-else class="text-muted-foreground/50">—</span>
                </template>
                <span v-else-if="c.key === 'name'" class="font-semibold text-foreground">{{ value(g, c.key) }}</span>
                <div v-else-if="c.key === 'brands'" class="flex items-center gap-1"><Badge v-for="b in brandList(value(g, c.key))" :key="b" variant="secondary" class="h-[18px] text-[10px] px-1.5 py-0 font-medium">{{ b }}</Badge></div>
                <div v-else-if="c.key === 'stage'" class="flex min-w-0 items-center gap-1.5">
                  <Badge variant="outline" class="h-5 min-w-0 shrink gap-1.5 py-0 text-[11px] font-medium" :class="STAGE_STYLE[value(g, c.key)]?.badge"><span class="size-1.5 shrink-0 rounded-full" :class="STAGE_STYLE[value(g, c.key)]?.dot" /><span class="truncate">{{ value(g, c.key) }}</span></Badge>
                  <span v-if="g.row?.dealerId" class="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"><Briefcase class="size-3" /> Dealer</span>
                </div>
                <span v-else-if="c.key === 'leadSource'" class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"><span class="size-1.5 shrink-0 rounded-full" :class="LEAD_SOURCE_STYLE[value(g, c.key)]?.dot" /><span class="truncate">{{ value(g, c.key) }}</span></span>
                <span v-else-if="c.key === 'state'" class="font-mono text-xs">{{ value(g, c.key) }}</span>
                <span v-else-if="c.key === 'zip' || c.key === 'phone'" class="tabular-nums">{{ value(g, c.key) }}</span>
                <span v-else-if="c.key === 'website'" class="inline-flex max-w-full min-w-0 items-center gap-1 align-bottom text-primary"><span class="truncate">{{ value(g, c.key).replace(/^https?:\/\//, '') }}</span><ExternalLink class="size-3 shrink-0 opacity-50" /></span>
                <span v-else-if="c.key === 'route'" class="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/5 px-1.5 py-0.5 align-bottom text-[11px] font-medium text-sky-700 dark:text-sky-300"><Route class="size-3 shrink-0" /><span class="truncate">{{ value(g, c.key) }}</span></span>
                <template v-else>{{ value(g, c.key) }}</template>
              </template>

              <!-- Every other column: what the list shows (read-only here) -->
              <template v-else-if="g.row">
                <span v-if="c.key === 'dealershipId'" class="font-mono text-[11px] text-muted-foreground">{{ g.row.dealershipId }}</span>
                <span v-else-if="c.key === 'inStage'" class="text-xs" :class="helpers.isStalled(g.row) ? 'text-orange-600 dark:text-orange-400 font-medium' : 'text-muted-foreground'">{{ formatDuration(helpers.stageAgeMs(g.row)) }}</span>
                <template v-else-if="c.key === 'lastTouch'">
                  <span v-if="g.row.interactionSummary?.last" class="flex min-w-0 items-center gap-1.5 text-xs">
                    <component :is="INTERACTION_ICONS[INTERACTION_TYPE_MAP[g.row.interactionSummary.last.type]?.icon || 'StickyNote']" class="size-3.5 shrink-0 text-muted-foreground" />
                    <span class="shrink-0">{{ g.row.interactionSummary.last.typeLabel }}</span>
                    <span class="truncate text-muted-foreground">· {{ formatDistanceToNow(new Date(g.row.interactionSummary.last.occurredAt), { addSuffix: true }) }}</span>
                  </span>
                  <span v-else class="text-xs text-muted-foreground/60 italic">Never contacted</span>
                </template>
                <template v-else-if="c.key === 'nextAction'">
                  <div v-if="g.row.interactionSummary?.nextAction" class="flex items-center gap-1.5 min-w-0 text-xs">
                    <span class="shrink-0 tabular-nums font-medium" :class="DUE_TONE[dueState(g.row.interactionSummary.nextAction.date)]">{{ g.row.interactionSummary.nextAction.date ? (dueState(g.row.interactionSummary.nextAction.date) === 'today' ? 'Today' : format(new Date(`${g.row.interactionSummary.nextAction.date}T00:00:00`), 'MMM d')) : 'No date' }}</span>
                    <span class="truncate text-muted-foreground">{{ g.row.interactionSummary.nextAction.text }}</span>
                  </div>
                  <span v-else class="text-muted-foreground/50">—</span>
                </template>
                <span
                  v-else-if="c.key === 'scanPages'" class="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 align-bottom text-[11px] font-medium"
                  :class="helpers.scanPageIssue(g.row) ? 'border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-300' : g.row.scanPages?.length ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300' : g.row.website ? 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300' : 'border-dashed border-border/70 text-muted-foreground/60'"
                >
                  <Layers class="size-3 shrink-0" />
                  <span class="truncate">
                    <template v-if="helpers.scanPageIssue(g.row)">{{ helpers.scanPageCount(g.row) ? `${helpers.scanPageCount(g.row)} page${helpers.scanPageCount(g.row) === 1 ? '' : 's'} · check` : 'Fix pages' }}</template>
                    <template v-else-if="g.row.scanPages?.length">{{ g.row.scanPages.length }} page{{ g.row.scanPages.length === 1 ? '' : 's' }}</template>
                    <template v-else-if="g.row.website">Pick pages</template>
                    <template v-else>—</template>
                  </span>
                </span>
                <template v-else-if="c.key === 'primaryContact'">
                  <div v-if="g.row.contactSummary?.primary" class="flex min-w-0 items-center gap-2">
                    <span class="truncate font-medium">{{ g.row.contactSummary.primary.fullName }}</span>
                    <Badge v-if="helpers.needsVerification(g.row)" variant="outline" class="shrink-0 text-[10px] gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20" title="Contact details unverified for 90+ days"><ShieldAlert class="size-3" /> Verify</Badge>
                  </div>
                  <span v-else class="text-xs italic text-muted-foreground/70">No contacts yet</span>
                </template>
                <span v-else-if="c.key === 'primaryTitle'" class="text-muted-foreground">{{ g.row.contactSummary?.primary ? (g.row.contactSummary.primary.jobTitle || g.row.contactSummary.primary.role) : '—' }}</span>
                <template v-else-if="c.key === 'primaryEmail'">
                  <span v-if="g.row.contactSummary?.primary?.email">{{ g.row.contactSummary.primary.email }}</span>
                  <span v-else class="text-muted-foreground/50">—</span>
                </template>
                <template v-else-if="c.key === 'contacts'">
                  <span class="font-medium">{{ g.row.contactSummary?.active ?? 0 }}</span>
                  <span v-if="g.row.contactSummary?.inactive" class="text-[11px] text-muted-foreground ml-1" :title="`${g.row.contactSummary.inactive} former`">+{{ g.row.contactSummary.inactive }}</span>
                </template>
                <template v-else-if="c.key === 'missingPhotos'">
                  <template v-if="g.row.auditSummary?.latest && g.row.auditSummary.latest.missingPhotoPct !== null">
                    <span class="font-semibold" :class="g.row.auditSummary.latest.missingPhotoPct >= 25 ? 'text-rose-600 dark:text-rose-400' : g.row.auditSummary.latest.missingPhotoPct >= 10 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'">{{ g.row.auditSummary.latest.missingPhotoPct }}%</span>
                    <span v-if="g.row.auditSummary.previous && g.row.auditSummary.previous.missingPhotoPct !== null" class="ml-1 text-[10px]" :class="g.row.auditSummary.latest.missingPhotoPct > g.row.auditSummary.previous.missingPhotoPct ? 'text-rose-500' : g.row.auditSummary.latest.missingPhotoPct < g.row.auditSummary.previous.missingPhotoPct ? 'text-emerald-500' : 'text-muted-foreground'" :title="`Previous ${g.row.auditSummary.previous.missingPhotoPct}%`">{{ g.row.auditSummary.latest.missingPhotoPct > g.row.auditSummary.previous.missingPhotoPct ? '▲' : g.row.auditSummary.latest.missingPhotoPct < g.row.auditSummary.previous.missingPhotoPct ? '▼' : '•' }}</span>
                  </template>
                  <span v-else class="text-muted-foreground/50">—</span>
                </template>
                <template v-else-if="c.key === 'inventory'">
                  <span v-if="g.row.auditSummary?.latest">{{ g.row.auditSummary.latest.totalVehicles }}</span><span v-else class="text-muted-foreground/50">—</span>
                </template>
                <template v-else-if="c.key === 'lastAudit'">
                  <span v-if="g.row.auditSummary?.latest" class="text-xs">
                    <span class="text-muted-foreground tabular-nums">{{ formatDistanceToNow(new Date(g.row.auditSummary.latest.auditedAt), { addSuffix: true }) }}</span>
                    <span class="ml-1 text-[10px] text-muted-foreground/70">· {{ g.row.auditSummary.count }}×</span>
                  </span>
                  <span v-else class="text-xs italic text-muted-foreground/60">Not audited</span>
                </template>
                <span v-else-if="c.key === 'added'" class="text-xs text-muted-foreground tabular-nums">{{ format(new Date(g.row.createdAt), 'MMM d, yyyy') }}</span>
                <span v-else-if="c.key === 'updated'" class="text-xs text-muted-foreground tabular-nums">{{ formatDistanceToNow(new Date(g.row.updatedAt), { addSuffix: true }) }}</span>
                <template v-else>{{ readText(g.row, c.key) }}</template>
              </template>
            </td>
            <td class="grid-filler" aria-hidden="true" />
          </tr>
          <tr v-if="!gridRows.length"><td :colspan="cols.length + 2" class="px-4 py-10 text-center text-sm text-muted-foreground">No dealerships match the current filters.</td></tr>
        </tbody>
      </table>
      <datalist v-for="k in SUGGEST_KEYS" :id="`qe-${k}`" :key="k"><option v-for="s in suggestions[k] || []" :key="s" :value="s" /></datalist>
    </div>

    <!-- Status bar -->
    <div class="shrink-0 flex items-center gap-3 border-t bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
      <template v-if="cur">
        <span class="tabular-nums">Row {{ cur.r + 1 }} · {{ colAt(cur.c).label }}</span>
        <span v-if="!colAt(cur.c).edit">· shown for reference — it can't be changed in quick edit</span>
        <span v-if="rangeSize > 1" class="tabular-nums">· {{ rangeSize }} cells selected</span>
        <span v-if="rowAt(cur.r)?.row && isChanged(rowAt(cur.r), colAt(cur.c).key)" class="text-amber-600 dark:text-amber-400">· was "{{ cellTitle(rowAt(cur.r), colAt(cur.c).key)?.replace('Was: ', '') }}"</span>
      </template>
      <span v-else>Click a cell to start. Paste a whole block from Excel with ⌘V.</span>
      <span v-if="Object.keys(errors).length" class="ml-auto inline-flex items-center gap-1 text-rose-600 dark:text-rose-400"><AlertCircle class="size-3" /> {{ Object.keys(errors).length }} row{{ Object.keys(errors).length === 1 ? '' : 's' }} need attention — hover the red icon</span>
      <span v-else-if="!dirty" class="ml-auto inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Check class="size-3" /> Everything saved</span>
    </div>
    <CrmCascadeDialog :cascade="cascade" />
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity .15s }
.fade-enter-from, .fade-leave-to { opacity: 0 }
</style>

<!-- Not scoped: the sheet is the app's data grid (rules in tailwind.css + GridHeaderCell); these only add what a sheet needs.
     Selectors start with "table.qe-grid.data-grid" so they outrank the shared rules (frozen cells have a solid background). -->
<style>
/* Framed by the box around it, like the list (the shared rule only reaches two levels deep) */
table.qe-grid.data-grid { border: 0; border-radius: 0; }
table.qe-grid.data-grid > thead > tr:first-child > th:is(:first-child, :last-child) { border-radius: 0; }

/* Row number */
table.qe-grid.data-grid > :is(thead, tbody) > tr > .qe-lead { padding-left: 0; padding-right: 0; text-align: center; font-size: 10px; font-variant-numeric: tabular-nums; }
table.qe-grid.data-grid > tbody > tr > td.qe-lead { color: var(--muted-foreground); }
table.qe-grid.data-grid > tbody > tr > td.qe-lead.qe-lead-cur { color: var(--primary); font-weight: 600; background: color-mix(in oklab, var(--primary) 10%, var(--background)); }

/* Rows with something pending — the tint also has to reach the frozen cells */
table.qe-grid.data-grid > tbody > tr.qe-row-error { background: color-mix(in oklab, #f43f5e 5%, transparent); }
table.qe-grid.data-grid > tbody > tr.qe-row-new { background: color-mix(in oklab, #10b981 5%, transparent); }
table.qe-grid.data-grid > tbody > tr.qe-row-edited { background: color-mix(in oklab, #f59e0b 4%, transparent); }
table.qe-grid.data-grid--pin > tbody > tr.qe-row-error > td.is-pinned { background: color-mix(in oklab, #f43f5e 5%, var(--background)); }
table.qe-grid.data-grid--pin > tbody > tr.qe-row-new > td.is-pinned { background: color-mix(in oklab, #10b981 5%, var(--background)); }
table.qe-grid.data-grid--pin > tbody > tr.qe-row-edited > td.is-pinned { background: color-mix(in oklab, #f59e0b 4%, var(--background)); }

/* Cells */
table.qe-grid.data-grid > tbody > tr > td.qe-cell.qe-missing { background: color-mix(in oklab, #f43f5e 10%, var(--background)); }
table.qe-grid.data-grid > tbody > tr > td.qe-cell.qe-changed { background: color-mix(in oklab, #f59e0b 16%, var(--background)); }
table.qe-grid.data-grid > tbody > tr > td.qe-cell.qe-range { background: color-mix(in oklab, var(--primary) 10%, var(--background)); }
table.qe-grid.data-grid > tbody > tr > td.qe-cell.qe-cur { outline: 2px solid var(--primary); outline-offset: -2px; }
table.qe-grid.data-grid > tbody > tr > td.qe-cell.qe-cur:not(.qe-changed, .qe-missing) { background: color-mix(in oklab, var(--primary) 5%, var(--background)); }
</style>
