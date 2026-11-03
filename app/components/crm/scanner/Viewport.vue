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
}>()

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
  <div ref="wrap" class="scanner-viewport relative size-full flex items-start justify-center overflow-hidden select-none" :class="mode === 'live' && 'items-center'">
    <!-- Full-page snapshot -->
    <div v-if="mode === 'page'" class="relative h-full rounded-md overflow-hidden ring-1 ring-white/10 bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]" :style="{ width: `${pageW}px` }">
      <div ref="scroller" class="size-full overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        <img v-if="src" :src="src" alt="Snapshot of the dealer website" class="block w-full h-auto pointer-events-none transition-opacity duration-300" :class="dim && 'opacity-40'" draggable="false">
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
