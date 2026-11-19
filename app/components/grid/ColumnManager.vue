<script setup lang="ts" generic="K extends string">
import { Check, CloudOff, Columns3, GripVertical, Loader2, Lock, MoveHorizontal, Pin, RotateCcw, Search, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { GridColumn, GridLayout } from '~/composables/useGridLayout'

/**
 * "Columns" button + panel for a data grid: switch columns on and off, drag them into order,
 * freeze them on the left, fit widths, reset. Every change applies (and is saved) immediately.
 */
const props = defineProps<{ grid: GridLayout<K> }>()
const open = defineModel<boolean>('open', { default: false })

const { allColumns, columns, sizes, hiddenCount, isCustomized, saveState } = props.grid

const query = ref('')
const searching = computed(() => query.value.trim().length > 0)
const rows = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? allColumns.value.filter(c => c.label.toLowerCase().includes(q)) : allColumns.value
})
/** How many columns are frozen, switched-off ones included (the list shows them all). */
const frozenTotal = computed(() => allColumns.value.filter(c => c.pinned).length)
watch(open, (v) => { if (!v) query.value = '' })

const searchEl = ref<{ $el?: HTMLElement } | null>(null)
function focusSearch(e: Event) { e.preventDefault(); searchEl.value?.$el?.focus() }

/** Pressing "Undo" in the toast must not count as clicking away from the panel. */
function keepOpenForToast(e: Event) {
  const target = (e as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent?.target as HTMLElement | null
  if (target?.closest?.('[data-sonner-toaster]')) e.preventDefault()
}
function resetAll() {
  const before = props.grid.reset()
  toast('Columns are back to the default layout', { action: { label: 'Undo', onClick: () => props.grid.restore(before) } })
}

// Screen-reader feedback for moves made with the keyboard
const announcement = ref('')
function say(c: GridColumn<K>) {
  const i = allColumns.value.findIndex(x => x.key === c.key)
  announcement.value = `${c.label} moved to position ${i + 1} of ${allColumns.value.length}`
}

// ─── Drag to reorder (pointer events — works with mouse, pen and touch) ───
const listEl = ref<HTMLElement | null>(null)
const drag = reactive({ key: '' as string, lineTop: -1 })
function onGrip(e: PointerEvent, c: GridColumn<K>) {
  const list = listEl.value
  if (!list || searching.value || e.button !== 0) return
  e.preventDefault()
  const grip = e.currentTarget as HTMLElement
  grip.setPointerCapture?.(e.pointerId)
  const all = allColumns.value
  const frozen = frozenTotal.value
  let y = e.clientY, frame = 0, done = false
  let target: { before: K | null, pinned: boolean } | null = null
  drag.key = c.key

  const update = () => {
    const els = [...list.querySelectorAll<HTMLElement>('[data-row]')]
    let i = els.findIndex((el) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2 })
    if (i < 0) i = els.length
    // Above the divider = frozen, below = scrolling; exactly on it the column keeps what it was.
    const pinned = frozen > 0 && (i < frozen || (i === frozen && c.pinned))
    const at = all.findIndex(x => x.key === c.key)
    const stays = pinned === c.pinned && (i === at || i === at + 1)
    target = stays ? null : { before: all[i]?.key ?? null, pinned }
    const edge = pinned && i === frozen && i > 0 ? els[i - 1]! : null // last frozen slot: line under the last frozen row
    const ref = edge ?? els[i] ?? els[els.length - 1]
    drag.lineTop = stays || !ref ? -1 : (edge || i >= els.length ? ref.offsetTop + ref.offsetHeight : ref.offsetTop)
  }
  const tick = () => {
    if (done) return
    const r = list.getBoundingClientRect()
    const step = y < r.top + 28 ? -8 : y > r.bottom - 28 ? 8 : 0
    if (step) { const from = list.scrollTop; list.scrollTop = from + step; if (list.scrollTop !== from) update() }
    frame = requestAnimationFrame(tick)
  }
  const onMove = (ev: PointerEvent) => { y = ev.clientY; update() }
  const finish = (drop: boolean) => {
    if (done) return
    done = true
    cancelAnimationFrame(frame)
    grip.removeEventListener('pointermove', onMove)
    grip.removeEventListener('pointerup', onUp)
    grip.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey, true)
    drag.key = ''
    drag.lineTop = -1
    if (drop && target) props.grid.move(c.key, target.before, target.pinned)
  }
  const onUp = () => finish(true)
  const onCancel = () => finish(false)
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false) } }
  grip.addEventListener('pointermove', onMove)
  grip.addEventListener('pointerup', onUp)
  grip.addEventListener('pointercancel', onCancel)
  window.addEventListener('keydown', onKey, true)
  frame = requestAnimationFrame(tick)
}
async function onGripKey(e: KeyboardEvent, c: GridColumn<K>) {
  if (searching.value || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
  e.preventDefault()
  if (!props.grid.moveBy(c.key, e.key === 'ArrowUp' ? -1 : 1, false)) return
  say(c)
  await nextTick()
  listEl.value?.querySelector<HTMLElement>(`[data-key="${c.key}"] [data-grip]`)?.focus()
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button variant="outline" size="sm" class="h-8 gap-1.5" title="Columns — show, hide, reorder and freeze (C)" data-testid="grid-columns-button">
        <Columns3 class="size-4" /><span class="hidden xl:inline">Columns</span>
        <span v-if="hiddenCount" class="rounded-full bg-primary/10 px-1.5 text-[11px] font-medium tabular-nums leading-4 text-primary">{{ columns.length }}/{{ allColumns.length }}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="grid-columns w-[min(92vw,360px)] p-0" data-testid="grid-columns-panel" @open-auto-focus="focusSearch" @interact-outside="keepOpenForToast">
      <div class="flex items-center justify-between gap-2 border-b px-2 py-2">
        <p class="text-sm font-semibold">Columns</p>
        <div class="flex items-center gap-2">
          <span class="text-xs text-muted-foreground"><b class="font-semibold text-foreground tabular-nums">{{ columns.length }}</b> of {{ allColumns.length }} shown</span>
          <Button variant="ghost" size="sm" class="h-7 gap-1 px-2 text-xs" :disabled="!isCustomized" title="Back to the default order, widths and visibility" @click="resetAll"><RotateCcw class="size-3.5" /> Reset</Button>
        </div>
      </div>

      <div class="relative border-b p-2">
        <Search class="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input ref="searchEl" v-model="query" placeholder="Find a column…" class="h-8 pl-7 pr-7 text-[13px]" aria-label="Find a column" />
        <button v-if="query" type="button" class="absolute right-3.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Clear search" @click="query = ''"><X class="size-3.5" /></button>
      </div>

      <ul ref="listEl" class="relative max-h-[min(56vh,460px)] overflow-y-auto overscroll-contain p-1" :class="drag.key && 'select-none'" role="list" aria-label="Columns in display order">
        <template v-for="(c, i) in rows" :key="c.key">
          <li v-if="!searching && frozenTotal && (i === 0 || i === frozenTotal)" role="presentation" class="flex items-center gap-2 px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" :class="i > 0 && 'mt-1 border-t pt-2'">
            <template v-if="i === 0"><Pin class="size-3" /> Frozen on the left</template>
            <template v-else>Scrolling</template>
          </li>
          <li
            data-row :data-key="c.key"
            class="group/row flex h-8 items-center gap-1.5 rounded-md pl-0.5 pr-2 transition-colors hover:bg-accent/60"
            :class="drag.key === c.key && 'bg-accent opacity-50'"
          >
            <button
              type="button" data-grip class="grid size-6 shrink-0 touch-none place-items-center rounded text-muted-foreground/50 outline-none transition-colors hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-0"
              :class="drag.key === c.key ? 'cursor-grabbing' : 'cursor-grab'" :disabled="searching"
              :aria-label="`Move ${c.label} — drag, or use the up and down arrow keys`"
              @pointerdown="onGrip($event, c)" @keydown="onGripKey($event, c)"
            ><GripVertical class="size-3.5" /></button>
            <label :for="`grid-col-${grid.id}-${c.key}`" class="min-w-0 flex-1 cursor-pointer truncate text-[13px] leading-8" :class="c.visible ? 'text-foreground' : 'text-muted-foreground'">{{ c.label }}</label>
            <span v-if="sizes[c.key] !== c.width" class="shrink-0 text-[10px] tabular-nums text-muted-foreground" :title="`Width changed to ${sizes[c.key]}px (default ${c.width}px)`">{{ sizes[c.key] }}px</span>
            <button
              type="button" class="grid size-6 shrink-0 place-items-center rounded outline-none transition-all hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed"
              :class="c.pinned ? 'text-primary' : 'text-muted-foreground/60 opacity-0 group-hover/row:opacity-100'"
              :aria-pressed="c.pinned" :disabled="!c.pinned && !grid.canPin(c.key)"
              :aria-label="c.pinned ? `Unfreeze ${c.label}` : `Freeze ${c.label} on the left`"
              :title="c.pinned ? 'Unfreeze' : grid.canPin(c.key) ? 'Freeze on the left — stays in view while you scroll sideways' : 'No room to freeze another column'"
              @click="grid.setPinned(c.key, !c.pinned)"
            ><Pin class="size-3.5" :class="c.pinned && 'fill-current'" /></button>
            <span v-if="c.required" class="grid h-[1.15rem] w-8 shrink-0 place-items-center text-muted-foreground/70" title="Always shown — it identifies the row"><Lock class="size-3.5" /></span>
            <Switch v-else :id="`grid-col-${grid.id}-${c.key}`" :model-value="c.visible" :aria-label="`Show ${c.label}`" @update:model-value="grid.setVisible(c.key, !!$event)" />
          </li>
        </template>
        <li v-if="!rows.length" role="presentation" class="px-2 py-6 text-center text-xs text-muted-foreground">No column called “{{ query.trim() }}”.</li>
        <li v-show="drag.lineTop >= 0" role="presentation" aria-hidden="true" class="pointer-events-none absolute inset-x-1 z-10 h-0.5 -translate-y-px rounded-full bg-primary" :style="{ top: `${drag.lineTop}px` }" />
      </ul>

      <div class="flex items-center gap-1 border-t px-2 py-1.5">
        <Button variant="ghost" size="sm" class="h-7 px-2 text-xs" :disabled="!hiddenCount" @click="grid.showAll()">Show all</Button>
        <Button variant="ghost" size="sm" class="h-7 gap-1 px-2 text-xs" title="Size every column to its content" @click="grid.autoFitAll()"><MoveHorizontal class="size-3.5" /> Fit widths</Button>
        <span class="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground" aria-live="polite">
          <template v-if="saveState === 'saving'"><Loader2 class="size-3 animate-spin" /> Saving…</template>
          <template v-else-if="saveState === 'synced'"><Check class="size-3 text-emerald-600" /> <span title="Your layout follows you to any computer you sign in on">Saved to your account</span></template>
          <template v-else-if="saveState === 'local'"><CloudOff class="size-3" /> <span title="Saved in this browser — it will sync to your account when the connection is back">Saved on this device</span></template>
          <template v-else>Default layout</template>
        </span>
      </div>
      <p class="border-t bg-muted/40 px-2.5 py-1.5 text-[11px] leading-4 text-muted-foreground">
        In the table: drag a header to move it, drag its right edge to resize, double-click the edge to fit. Right-click a header for more.
      </p>
      <span class="sr-only" aria-live="assertive">{{ announcement }}</span>
    </PopoverContent>
  </Popover>
</template>
