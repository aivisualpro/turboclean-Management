<script setup lang="ts" generic="K extends string">
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronsUpDown, Columns3, EllipsisVertical, EyeOff, MoveHorizontal, Pin, PinOff, Undo2 } from 'lucide-vue-next'
import type { GridColumn, GridLayout } from '~/composables/useGridLayout'

/**
 * One header cell of a data grid (the <th> itself):
 *  - click the label to sort · drag it sideways to move the column · drag the right edge to resize
 *    (double-click the edge = fit to content) · "⋮" or right-click for the column menu
 *  - keyboard, with the header focused: Alt+←/→ moves the column, Shift+←/→ resizes it.
 */
const props = defineProps<{
  col: GridColumn<K>
  grid: GridLayout<K>
  /** Direction when the table is sorted by this column. */
  sorted?: 'asc' | 'desc' | null
}>()
const emit = defineEmits<{
  /** No direction = toggle (label click). */
  sort: [dir?: 'asc' | 'desc']
  /** Open the Columns panel. */
  manage: []
}>()

const menuOpen = ref(false)
const { draggingKey, resizingKey, sizes, offsets } = props.grid
const size = computed(() => sizes.value[props.col.key])
const left = computed(() => offsets.value[props.col.key])

const STEP = 16
function onKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  const dir = e.key === 'ArrowLeft' ? -1 : 1
  if (e.altKey) { e.preventDefault(); props.grid.moveBy(props.col.key, dir) }
  else if (e.shiftKey) { e.preventDefault(); props.grid.setWidth(props.col.key, size.value + dir * STEP) }
}
</script>

<template>
  <th
    scope="col" class="grid-th" :data-col="col.key"
    :class="{ 'grid-th--right': col.align === 'right', 'is-pinned': col.pinned, 'is-pin-edge': col.pinEdge, 'is-last': col.last, 'is-sorted': !!sorted, 'is-dragging': draggingKey === col.key, 'is-resizing': resizingKey === col.key }"
    :style="left === undefined ? undefined : { left: `${left}px` }"
    :aria-sort="col.sortable ? (sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none') : undefined"
    @pointerdown="grid.startHeaderDrag($event, col.key)"
    @contextmenu.prevent="menuOpen = true"
    @keydown="onKey"
  >
    <div class="grid-th__inner">
      <button v-if="col.sortable" type="button" class="grid-th__label" :title="`Sort by ${col.label}`" @click="emit('sort')">
        <span>{{ col.label }}</span>
        <ArrowUp v-if="sorted === 'asc'" class="grid-th__sort" aria-hidden="true" />
        <ArrowDown v-else-if="sorted === 'desc'" class="grid-th__sort" aria-hidden="true" />
        <ChevronsUpDown v-else class="grid-th__sort grid-th__sort--idle" aria-hidden="true" />
      </button>
      <span v-else class="grid-th__label"><span>{{ col.label }}</span></span>
    </div>

    <DropdownMenu v-model:open="menuOpen">
      <DropdownMenuTrigger as-child>
        <button type="button" class="grid-th__menu" data-grid-nodrag :aria-label="`${col.label} column options`" @pointerdown.stop>
          <EllipsisVertical aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent :align="col.align === 'right' ? 'start' : 'end'" class="w-56">
        <DropdownMenuLabel class="truncate text-xs font-medium text-muted-foreground">{{ col.label }}</DropdownMenuLabel>
        <template v-if="col.sortable">
          <DropdownMenuItem @click="emit('sort', 'asc')"><ArrowUp /> Sort ascending <Check v-if="sorted === 'asc'" class="ml-auto !text-primary" /></DropdownMenuItem>
          <DropdownMenuItem @click="emit('sort', 'desc')"><ArrowDown /> Sort descending <Check v-if="sorted === 'desc'" class="ml-auto !text-primary" /></DropdownMenuItem>
          <DropdownMenuSeparator />
        </template>
        <DropdownMenuItem v-if="col.pinned" @click="grid.setPinned(col.key, false)"><PinOff /> Unfreeze column</DropdownMenuItem>
        <DropdownMenuItem v-else @click="grid.setPinned(col.key, true)"><Pin /> Freeze on the left</DropdownMenuItem>
        <DropdownMenuItem :disabled="!grid.canMoveBy(col.key, -1)" @click="grid.moveBy(col.key, -1)"><ArrowLeft /> Move left <DropdownMenuShortcut>Alt ←</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem :disabled="!grid.canMoveBy(col.key, 1)" @click="grid.moveBy(col.key, 1)"><ArrowRight /> Move right <DropdownMenuShortcut>Alt →</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem @click="grid.autoFit(col.key)"><MoveHorizontal /> Fit to content</DropdownMenuItem>
        <DropdownMenuItem :disabled="size === col.width" @click="grid.resetWidth(col.key)"><Undo2 /> Reset width</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem :disabled="col.required" :title="col.required ? 'This column is always shown' : undefined" @click="grid.setVisible(col.key, false)"><EyeOff /> Hide column</DropdownMenuItem>
        <DropdownMenuItem @click="emit('manage')"><Columns3 /> Manage columns…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <span
      class="grid-th__resizer" data-grid-nodrag role="separator" aria-orientation="vertical"
      :aria-label="`Resize ${col.label}`" :aria-valuenow="size" :aria-valuemin="col.minWidth" :aria-valuemax="col.maxWidth"
      title="Drag to resize · double-click to fit"
      @pointerdown="grid.startResize($event, col.key)" @dblclick.stop.prevent="grid.autoFit(col.key)" @click.stop
    />
  </th>
</template>

<!-- Not scoped on purpose: these rules also style the body cells and the drag helpers appended to <body>.
     Every selector starts with "table.data-grid" so it outranks the app-wide table design in tailwind.css. -->
<style>
table.data-grid { table-layout: fixed; min-width: 100%; }

/* ── Header ── */
table.data-grid > thead > tr > th { position: sticky; top: 0; z-index: 20; }
table.data-grid > thead > tr > th.grid-th { padding: 0; user-select: none; -webkit-user-select: none; }
table.data-grid .grid-th__inner { display: flex; align-items: center; min-width: 0; height: 28px; padding: 0 8px; transition: opacity .12s; }
table.data-grid .grid-th--right .grid-th__inner { justify-content: flex-end; }
table.data-grid .grid-th__label {
  display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%;
  font: inherit; letter-spacing: inherit; text-transform: uppercase; border-radius: 3px;
}
table.data-grid .grid-th__label > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
table.data-grid button.grid-th__label { cursor: pointer; }
table.data-grid button.grid-th__label:focus-visible,
table.data-grid .grid-th__menu:focus-visible { outline: 2px solid var(--ring, #fff); outline-offset: 2px; }
table.data-grid .grid-th__sort { flex: none; width: 12px; height: 12px; }
table.data-grid .grid-th__sort--idle { opacity: .4; }
table.data-grid .grid-th.is-sorted .grid-th__label { color: #fff; }
table.data-grid .grid-th.is-dragging .grid-th__inner { opacity: .3; }

/* "⋮" — appears on hover / keyboard focus, over the end of the label */
table.data-grid .grid-th__menu {
  --th-bg: #18181b;
  position: absolute; top: 50%; right: 9px; translate: 0 -50%;
  display: grid; place-items: center; width: 18px; height: 20px; border-radius: 4px;
  color: #a1a1aa; background: var(--th-bg); box-shadow: -8px 0 6px -2px var(--th-bg);
  opacity: 0; cursor: pointer; transition: opacity .12s, background-color .12s, color .12s;
}
.dark table.data-grid .grid-th__menu { --th-bg: #09090b; }
table.data-grid .grid-th--right .grid-th__menu { right: auto; left: 4px; box-shadow: 8px 0 6px -2px var(--th-bg); }
table.data-grid .grid-th__menu > svg { width: 14px; height: 14px; }
table.data-grid .grid-th:hover .grid-th__menu,
table.data-grid .grid-th__menu:focus-visible,
table.data-grid .grid-th__menu[data-state="open"] { opacity: 1; }
table.data-grid .grid-th__menu:hover,
table.data-grid .grid-th__menu[data-state="open"] { background: #3f3f46; color: #fff; box-shadow: none; }

/* Right edge — drag to resize */
table.data-grid .grid-th__resizer { position: absolute; top: 0; right: 0; bottom: 0; width: 9px; cursor: col-resize; touch-action: none; }
table.data-grid .grid-th__resizer::after {
  content: ''; position: absolute; top: 6px; bottom: 6px; right: 0; width: 2px; border-radius: 2px;
  background: transparent; transition: background-color .12s, top .12s, bottom .12s;
}
table.data-grid .grid-th__resizer:hover::after,
table.data-grid .grid-th.is-resizing .grid-th__resizer::after { top: 0; bottom: 0; background: var(--primary); }

/* ── Body ── one line per row; anything longer is cut with "…" (hover shows the full text) */
table.data-grid > tbody > tr > td { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Spacer: takes whatever width is left when the columns are narrower than the view (a wide screen, zoomed out).
   No line between the last column and the spacer, so the spare width reads as the end of the last column — never as an empty extra column. */
table.data-grid > :is(thead, tbody) > tr > .grid-filler { padding: 0; border-right: 0; }
table.data-grid > :is(thead, tbody) > tr > .is-last { border-right: 0; }

/* ── Frozen columns ── */
table.data-grid--pin > :is(thead, tbody) > tr > .is-pinned { position: sticky; }
table.data-grid--pin > thead > tr > th.is-pinned { z-index: 30; }
table.data-grid--pin > tbody > tr > td.is-pinned { z-index: 10; background: var(--background); }
table.data-grid--pin > tbody > tr:is(:hover, :focus-visible) > td.is-pinned { background: color-mix(in oklab, var(--accent) 40%, var(--background)); }
table.data-grid--pin > tbody > tr.is-selected > td.is-pinned { background: color-mix(in oklab, var(--primary) 5%, var(--background)); }
table.data-grid--pin > tbody > tr.is-selected:is(:hover, :focus-visible) > td.is-pinned { background: color-mix(in oklab, var(--primary) 10%, var(--background)); }
table.data-grid--pin > tbody > tr > td.is-pin-edge { border-right-color: color-mix(in oklab, var(--primary) 60%, transparent); }
table.data-grid--pin > :is(thead, tbody) > tr > .is-pin-edge { transition: box-shadow .15s; }
[data-scrolled-x] > table.data-grid--pin > :is(thead, tbody) > tr > .is-pin-edge { box-shadow: 8px 0 10px -6px rgb(0 0 0 / .3); clip-path: inset(0 -14px 0 0); }

/* ── While dragging ── (helpers live on <body>) */
.grid-drag-shield { position: fixed; inset: 0; z-index: 9997; user-select: none; -webkit-user-select: none; touch-action: none; }
.grid-drag-ghost {
  position: fixed; top: 0; left: 0; z-index: 9999; pointer-events: none; will-change: transform;
  max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 5px 10px; border-radius: 6px; background: #18181b; color: #fafafa;
  font-size: 11px; font-weight: 600; line-height: 16px; letter-spacing: .05em; text-transform: uppercase;
  box-shadow: 0 0 0 2px var(--primary), 0 10px 28px rgb(0 0 0 / .3);
}
.grid-drop-line, .grid-resize-line { position: fixed; top: 0; left: 0; z-index: 9998; pointer-events: none; will-change: transform; background: var(--primary); }
.grid-drop-line { width: 3px; border-radius: 2px; box-shadow: 0 0 0 1px var(--background); transition: opacity .1s; }
.grid-resize-line { width: 1px; opacity: .55; }

@media (prefers-reduced-motion: reduce) {
  table.data-grid .grid-th__inner, table.data-grid .grid-th__menu, table.data-grid .grid-th__resizer::after, .grid-drop-line { transition: none; }
}
</style>
