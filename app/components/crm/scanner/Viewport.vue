<script setup lang="ts">
/**
 * Website view for the Inventory Scanner (read-only — the page runs in a cloud browser).
 *  - mode "page": a full-page snapshot of the dealer page, scrollable like a normal website
 *  - mode "live": the live 1440×900 frame while the scan runs, fitted to the space
 */
const props = defineProps<{
  mode: 'page' | 'live'
  src: string | null
  viewport: { width: number, height: number }
  dim?: boolean
  /** Link areas on the snapshot (document pixels) — clicking one opens that page. */
  hotspots?: { x: number, y: number, w: number, h: number, href: string, label: string, children?: { label: string, href: string }[] }[]
  /** Natural size of the snapshot image (document pixels). */
  pageSize?: { width: number, height: number }
  clickable?: boolean
}>()
const emit = defineEmits<{ navigate: [href: string], hover: [href: string | null] }>()
const pct = (n: number, of: number) => `${(n / Math.max(1, of)) * 100}%`

// Drop-down / mega menus: hovering (or clicking) a menu item that has sub-links opens our own menu
// under it, drawn from the links the page keeps hidden until hover.
type Spot = NonNullable<typeof props.hotspots>[number]
const menuFor = ref<Spot | null>(null)
let hideTimer: ReturnType<typeof setTimeout> | null = null
function openMenu(h: Spot) { if (hideTimer) clearTimeout(hideTimer); hideTimer = null; menuFor.value = h }
function closeMenuSoon() { if (hideTimer) clearTimeout(hideTimer); hideTimer = setTimeout(() => { menuFor.value = null }, 220) }
function keepMenu() { if (hideTimer) clearTimeout(hideTimer); hideTimer = null }
function onSpotEnter(h: Spot) { emit('hover', h.href || null); if (h.children?.length) openMenu(h); else closeMenuSoon() }
function onSpotClick(h: Spot) {
  if (h.href) { menuFor.value = null; emit('navigate', h.href) }
  else if (h.children?.length) openMenu(h)
}
function go(href: string) { menuFor.value = null; emit('navigate', href) }
watch(() => props.src, () => { menuFor.value = null })
const menuStyle = computed(() => {
  const h = menuFor.value, p = props.pageSize
  if (!h || !p) return {}
  // Open below the item; flip to the left edge when it would overflow the page.
  const left = h.x + 360 > p.width ? Math.max(0, h.x + h.w - 360) : h.x
  return { left: pct(left, p.width), top: pct(h.y + h.h, p.height) }
})

const wrap = ref<HTMLDivElement | null>(null)
const scroller = ref<HTMLDivElement | null>(null)
const box = ref({ w: 0, h: 0 })
let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(([e]) => { if (e) box.value = { w: e.contentRect.width, h: e.contentRect.height } })
  if (wrap.value) ro.observe(wrap.value)
})
onBeforeUnmount(() => ro?.disconnect())

const fit = computed(() => {
  const { width: vw, height: vh } = props.viewport
  const scale = Math.min(box.value.w / vw, box.value.h / vh) || 0
  return { w: Math.floor(vw * scale), h: Math.floor(vh * scale) }
})
// Page mode: as wide as the space allows (never wider than the real 1440 px page).
const pageW = computed(() => Math.min(box.value.w, props.viewport.width))

// A new page always starts at the top.
watch(() => props.src, (a, b) => { if (props.mode === 'page' && a && b && a !== b) scroller.value?.scrollTo({ top: 0 }) })
defineExpose({ scrollToTop: () => scroller.value?.scrollTo({ top: 0, behavior: 'smooth' }) })
</script>

<template>
  <div ref="wrap" class="scanner-viewport relative size-full flex items-start justify-center overflow-hidden select-none" :class="mode === 'live' && 'items-center'" @mouseleave="emit('hover', null)">
    <!-- Full-page snapshot -->
    <div v-if="mode === 'page'" class="relative h-full rounded-md overflow-hidden ring-1 ring-white/10 bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]" :style="{ width: `${pageW}px` }">
      <div ref="scroller" class="size-full overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        <div class="relative">
          <img v-if="src" :src="src" alt="Snapshot of the dealer website" class="block w-full h-auto pointer-events-none transition-opacity duration-300" :class="dim && 'opacity-40'" draggable="false">
          <!-- Click map: every link on the page, placed exactly where it is on the snapshot -->
          <template v-if="src && clickable && pageSize && hotspots?.length">
            <a
              v-for="(h, i) in hotspots"
              :key="i"
              :href="h.href || '#'"
              :title="h.children?.length ? `${h.label} — ${h.children.length} sub-pages` : h.label ? `${h.label} — ${h.href}` : h.href"
              class="absolute block rounded-sm outline-none ring-emerald-500 hover:ring-2 hover:bg-emerald-400/15 focus-visible:ring-2 cursor-pointer"
              :class="menuFor === h && 'ring-2 bg-emerald-400/15'"
              :style="{ left: pct(h.x, pageSize.width), top: pct(h.y, pageSize.height), width: pct(h.w, pageSize.width), height: pct(h.h, pageSize.height) }"
              @click.prevent="onSpotClick(h)"
              @mouseenter="onSpotEnter(h)"
              @mouseleave="emit('hover', null); closeMenuSoon()"
            />
            <!-- Our rendering of the page's drop-down / mega menu -->
            <div
              v-if="menuFor?.children?.length"
              class="absolute z-10 w-[360px] max-w-[92%] rounded-xl border bg-popover text-popover-foreground shadow-2xl ring-1 ring-black/5 overflow-hidden"
              :style="menuStyle"
              @mouseenter="keepMenu"
              @mouseleave="closeMenuSoon"
            >
              <div class="px-3 py-2 border-b bg-muted/40 text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                <span class="truncate">{{ menuFor.label || 'Menu' }}</span>
                <button type="button" class="text-[10px] font-medium hover:text-foreground" @click.stop="menuFor = null">close</button>
              </div>
              <ul class="max-h-[60vh] overflow-y-auto py-1 grid" :class="menuFor.children.length > 10 ? 'grid-cols-2' : 'grid-cols-1'">
                <li v-if="menuFor.href" class="col-span-full">
                  <button type="button" class="w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-muted" @click.stop="go(menuFor!.href)">Open “{{ menuFor.label }}” page →</button>
                </li>
                <li v-for="c in menuFor.children" :key="c.href">
                  <button type="button" class="w-full text-left px-3 py-1.5 text-xs hover:bg-muted truncate" :title="c.href" @click.stop="go(c.href)" @mouseenter="emit('hover', c.href)">{{ c.label }}</button>
                </li>
              </ul>
            </div>
          </template>
        </div>
      </div>
      <slot name="overlay" />
    </div>
    <!-- Live frame -->
    <div v-else class="relative rounded-md overflow-hidden ring-1 ring-white/10 bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]" :style="{ width: `${fit.w}px`, height: `${fit.h}px` }">
      <img v-if="src" :src="src" alt="The scanner working on the dealer website" class="block size-full object-cover pointer-events-none transition-opacity duration-300" :class="dim && 'opacity-40'" draggable="false">
      <slot name="overlay" />
    </div>
    <slot />
  </div>
</template>
