<script setup lang="ts">
/**
 * Quick edit — the dealership list as a spreadsheet.
 * Click a cell and type, Tab / Enter / arrows to move, Shift+arrows or drag to select a range,
 * paste straight from Excel / Google Sheets (new rows are added when you paste past the end),
 * ⌘D fills a selection down, ⌘Z undoes, ⌘S saves. Nothing touches the CRM until you press Save.
 */
import type { CrmDealership } from '~/composables/useCrmDealerships'
import { CASCADE_FIELDS } from '~/composables/useCascade'
import { DEALERSHIP_STAGES, LEAD_SOURCES, STAGE_STYLE, US_STATES } from '~/constants/crm'
import { AlertCircle, ArrowDownToLine, Check, ExternalLink, Keyboard, Loader2, Plus, RotateCcw, Save, Trash2, Undo2, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

interface UserOpt { id: string, name: string }
const props = defineProps<{ rows: CrmDealership[], users: UserOpt[], canEdit: boolean, canAdd: boolean }>()
const emit = defineEmits<{ close: [], saved: [] }>()
const { createDealership, updateDealership } = useCrmDealerships()
const cascade = useCascade()

// ─── Columns ───
type ColKey = 'dealershipId' | 'name' | 'dealerGroup' | 'route' | 'brands' | 'stage' | 'city' | 'state' | 'zip' | 'phone' | 'website' | 'territory' | 'owner' | 'leadSource' | 'notes'
interface Col { key: ColKey, label: string, w: number, type?: 'select', options?: (row: CrmDealership | null) => string[], suggest?: boolean, readonly?: boolean, required?: boolean, hint?: string, mono?: boolean }
const PARKED = ['Won', 'Lost', 'Nurture / Follow Up Later']
const COLS: Col[] = [
  { key: 'dealershipId', label: 'ID', w: 86, readonly: true, mono: true },
  { key: 'name', label: 'Dealership', w: 250, required: true },
  { key: 'dealerGroup', label: 'Dealer group', w: 170, suggest: true },
  { key: 'route', label: 'Route', w: 96, suggest: true, hint: 'Day 1' },
  { key: 'brands', label: 'Brands', w: 180, hint: 'Ford, Kia' },
  { key: 'stage', label: 'Stage', w: 180, type: 'select', options: row => DEALERSHIP_STAGES.filter(s => !PARKED.includes(s) || row?.stage === s) },
  { key: 'city', label: 'City', w: 150, suggest: true },
  { key: 'state', label: 'State', w: 72, type: 'select', options: () => [...US_STATES], required: true },
  { key: 'zip', label: 'ZIP', w: 80 },
  { key: 'phone', label: 'Phone', w: 130 },
  { key: 'website', label: 'Website', w: 200 },
  { key: 'territory', label: 'Territory', w: 140, suggest: true },
  { key: 'owner', label: 'Owner', w: 150, type: 'select', options: () => ['', ...props.users.map(u => u.name)] },
  { key: 'leadSource', label: 'Lead source', w: 150, type: 'select', options: () => [...LEAD_SOURCES] },
  { key: 'notes', label: 'Notes', w: 280 },
]
const colIndex = Object.fromEntries(COLS.map((c, i) => [c.key, i])) as Record<ColKey, number>

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
  for (const c of COLS) if (c.suggest) out[c.key] = [...new Set(props.rows.map(r => original(r, c.key)).filter(Boolean))].sort((a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }))
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
  const c = COLS[colIndex[col]]!
  if (!g || c.readonly) return
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
const bodyEl = ref<HTMLElement | null>(null)
const range = computed(() => {
  if (!cur.value) return null
  const a = anchor.value || cur.value
  return { r1: Math.min(a.r, cur.value.r), r2: Math.max(a.r, cur.value.r), c1: Math.min(a.c, cur.value.c), c2: Math.max(a.c, cur.value.c) }
})
const inRange = (r: number, c: number) => !!range.value && r >= range.value.r1 && r <= range.value.r2 && c >= range.value.c1 && c <= range.value.c2
const isCur = (r: number, c: number) => !!cur.value && cur.value.r === r && cur.value.c === c
const rangeSize = computed(() => range.value ? (range.value.r2 - range.value.r1 + 1) * (range.value.c2 - range.value.c1 + 1) : 0)

function select(r: number, c: number, extend = false) {
  r = Math.max(0, Math.min(gridRows.value.length - 1, r)); c = Math.max(0, Math.min(COLS.length - 1, c))
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
  const col = COLS[cur.value.c]!
  if (col.readonly) return
  const g = gridRows.value[cur.value.r]!
  // Typing into a drop-down column jumps to the first option starting with that letter.
  if (col.type === 'select') { const opts = col.options!(g.row); draft.value = (initial && opts.find(o => o.toLowerCase().startsWith(initial.toLowerCase()))) || value(g, col.key) }
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
    const col = COLS[cur.value.c]!
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
    const g = gridRows.value[r]!, col = COLS[c]!
    if (!col.readonly && value(g, col.key) !== '') setCell(g.key, col.key, '', b)
  }
  commitBatch(b)
}
function fillDown() {
  if (!range.value || range.value.r2 === range.value.r1) return
  const b: UndoEntry[] = []
  for (let c = range.value.c1; c <= range.value.c2; c++) {
    const col = COLS[c]!
    if (col.readonly) continue
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
    for (let c = range.value.c1; c <= range.value.c2; c++) cells.push(value(gridRows.value[r]!, COLS[c]!.key))
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
    for (let r = range.value!.r1; r <= range.value!.r2; r++) for (let c = range.value!.c1; c <= range.value!.c2; c++) if (!COLS[c]!.readonly) setCell(gridRows.value[r]!.key, COLS[c]!.key, matrix[0]![0]!, b)
    commitBatch(b); return
  }
  for (let i = 0; i < matrix.length; i++) {
    const r = cur.value.r + i
    if (r >= gridRows.value.length) { if (!props.canAdd) break; createdRows.push(addRow()) }
    const g = gridRows.value[r]!
    for (let j = 0; j < matrix[i]!.length; j++) {
      const c = cur.value.c + j
      if (c >= COLS.length) break
      const col = COLS[c]!
      if (!col.readonly) setCell(g.key, col.key, matrix[i]![j]!.trim(), b)
    }
  }
  commitBatch(b, createdRows)
  anchor.value = { ...cur.value }
  cur.value = { r: Math.min(gridRows.value.length - 1, cur.value.r + matrix.length - 1), c: Math.min(COLS.length - 1, cur.value.c + Math.max(...matrix.map(m => m.length)) - 1) }
  toast.success(`Pasted ${b.length} cell${b.length === 1 ? '' : 's'}${createdRows.length ? ` · ${createdRows.length} new row${createdRows.length === 1 ? '' : 's'}` : ''}`)
}

function onKey(e: KeyboardEvent) {
  if (editing.value) return
  // The page has single-letter shortcuts (n, d, /) — keys typed into the sheet stay in the sheet.
  e.stopPropagation()
  const meta = e.metaKey || e.ctrlKey
  if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
  if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return }
  if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); fillDown(); return }
  if (meta && e.key.toLowerCase() === 'c') { e.preventDefault(); copyRange(); return }
  if (meta && e.key.toLowerCase() === 'a') { e.preventDefault(); anchor.value = { r: 0, c: 0 }; cur.value = { r: gridRows.value.length - 1, c: COLS.length - 1 }; return }
  if (!cur.value) { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); select(0, 1) } return }
  const { r, c } = cur.value
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); select(meta ? gridRows.value.length - 1 : r + 1, c, e.shiftKey); return
    case 'ArrowUp': e.preventDefault(); select(meta ? 0 : r - 1, c, e.shiftKey); return
    case 'ArrowRight': e.preventDefault(); select(r, meta ? COLS.length - 1 : c + 1, e.shiftKey); return
    case 'ArrowLeft': e.preventDefault(); select(r, meta ? 0 : c - 1, e.shiftKey); return
    case 'Home': e.preventDefault(); select(r, 0, e.shiftKey); return
    case 'End': e.preventDefault(); select(r, COLS.length - 1, e.shiftKey); return
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
  if (focus) { commitBatch([], [key]); nextTick(() => { select(gridRows.value.length - 1, colIndex.name); startEdit('') }) }
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
const colAt = (c: number) => COLS[c] as Col
const rowAt = (r: number) => gridRows.value[r] as GridRow
const optionsFor = (c: Col, g: GridRow) => c.options ? c.options(g.row) : []
const cellTitle = (g: GridRow, key: ColKey) => {
  if (g.row && isChanged(g, key)) return `Was: ${original(g.row, key) || '—'}`
  return undefined
}
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

    <!-- Sheet -->
    <div ref="bodyEl" class="flex-1 min-h-0 overflow-auto select-none">
      <table class="table-fixed border-separate border-spacing-0 text-[13px]" :style="{ width: `${44 + COLS.reduce((n, c) => n + c.w, 0)}px` }">
        <colgroup><col style="width:44px"><col v-for="c in COLS" :key="c.key" :style="{ width: `${c.w}px` }"></colgroup>
        <thead class="sticky top-0 z-20">
          <tr>
            <th class="sticky left-0 z-30 bg-muted border-b border-r px-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">#</th>
            <th v-for="c in COLS" :key="c.key" class="bg-muted border-b border-r px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap" :class="c.readonly && 'text-muted-foreground/60'">
              <span :title="c.hint ? `e.g. ${c.hint}` : undefined">{{ c.label }}</span><span v-if="c.required" class="text-rose-500">*</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(g, r) in gridRows" :key="g.key" class="group/row" :class="errors[g.key] ? 'bg-rose-500/5' : g.add ? 'bg-emerald-500/5' : edits[g.key] ? 'bg-amber-500/[0.04]' : ''">
            <td class="sticky left-0 z-10 border-b border-r bg-background px-1 text-center text-[10px] text-muted-foreground tabular-nums align-middle" :class="cur?.r === r && 'bg-primary/10 text-primary font-semibold'">
              <button v-if="errors[g.key]" type="button" class="inline-flex items-center justify-center size-5 rounded text-rose-600" :title="errors[g.key]" @click="saveAnyway(g.key)"><AlertCircle class="size-3.5" /></button>
              <button v-else-if="g.add" type="button" class="inline-flex items-center justify-center size-5 rounded text-emerald-600 hover:bg-rose-500/10 hover:text-rose-600" title="Remove this new row" @click="removeNewRow(g.key)"><Trash2 class="size-3" /></button>
              <button v-else-if="edits[g.key]" type="button" class="inline-flex items-center justify-center size-5 rounded text-amber-600 hover:bg-amber-500/10" title="Revert this row" @click="revertRow(g.key)"><RotateCcw class="size-3" /></button>
              <template v-else>
                <span class="group-hover/row:hidden">{{ r + 1 }}</span>
                <NuxtLink :to="`/crm/dealership/${g.key}`" target="_blank" class="hidden group-hover/row:inline-flex items-center justify-center size-5 rounded text-primary hover:bg-primary/10" title="Open in a new tab"><ExternalLink class="size-3" /></NuxtLink>
              </template>
            </td>
            <td
              v-for="(c, ci) in COLS" :key="c.key" :data-cell="`${r}:${ci}`"
              class="relative border-b border-r px-2 h-8 align-middle whitespace-nowrap overflow-hidden text-ellipsis max-w-0"
              :class="[
                c.readonly ? 'text-muted-foreground/70' : 'cursor-cell',
                c.mono && 'font-mono text-[11px]',
                inRange(r, ci) && !isCur(r, ci) && 'bg-primary/10',
                isCur(r, ci) && 'ring-2 ring-inset ring-primary bg-primary/5 z-[5]',
                isChanged(g, c.key) && !g.add && 'bg-amber-500/15 text-amber-900 dark:text-amber-200',
                g.add && c.required && !value(g, c.key) && 'bg-rose-500/10',
              ]"
              :title="cellTitle(g, c.key)"
              @mousedown="onCellDown($event, r, ci)" @mouseover="onCellOver(r, ci)" @dblclick="startEdit()"
            >
              <template v-if="isCur(r, ci) && editing">
                <select
                  v-if="c.type === 'select'" :ref="setEditor" v-model="draft"
                  class="absolute inset-0 w-full h-full bg-background px-1.5 text-[13px] outline-none ring-2 ring-inset ring-primary"
                  @keydown="onEditorKey" @change="commit()" @blur="commit()"
                >
                  <option v-for="o in optionsFor(c, g)" :key="o" :value="o">{{ o || '— none —' }}</option>
                </select>
                <input
                  v-else :ref="setEditor" v-model="draft" type="text" :list="c.suggest ? `qe-${c.key}` : undefined" autocomplete="off" spellcheck="false"
                  class="absolute inset-0 w-full h-full bg-background px-2 text-[13px] outline-none ring-2 ring-inset ring-primary"
                  @keydown="onEditorKey" @blur="commit()"
                >
              </template>
              <template v-else>
                <span v-if="c.key === 'stage' && value(g, c.key)" class="inline-flex items-center gap-1.5"><span class="size-1.5 rounded-full" :class="STAGE_STYLE[value(g, c.key)]?.dot" />{{ value(g, c.key) }}</span>
                <template v-else-if="value(g, c.key)">{{ value(g, c.key) }}</template>
                <span v-else-if="g.add && c.hint" class="text-muted-foreground/40">{{ c.hint }}</span>
              </template>
            </td>
          </tr>
          <tr v-if="!gridRows.length"><td :colspan="COLS.length + 1" class="px-4 py-10 text-center text-sm text-muted-foreground">No dealerships match the current filters.</td></tr>
        </tbody>
      </table>
      <datalist v-for="c in COLS.filter(x => x.suggest)" :id="`qe-${c.key}`" :key="c.key"><option v-for="s in suggestions[c.key] || []" :key="s" :value="s" /></datalist>
    </div>

    <!-- Status bar -->
    <div class="shrink-0 flex items-center gap-3 border-t bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
      <template v-if="cur">
        <span class="tabular-nums">Row {{ cur.r + 1 }} · {{ colAt(cur.c).label }}</span>
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
