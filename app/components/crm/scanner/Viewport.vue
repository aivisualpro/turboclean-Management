<script setup lang="ts">
/**
 * Live remote-browser viewport: paints screencast frames and forwards mouse, wheel and keyboard
 * to the server-side Chrome tab (coordinates mapped to the 1440×900 desktop viewport).
 */
const props = defineProps<{
  frame: { data: string, w: number, h: number, ts: number } | null
  viewport: { width: number, height: number }
  interactive: boolean
}>()
const emit = defineEmits<{ input: [e: Record<string, any>] }>()

const wrap = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const box = ref({ w: 0, h: 0 })
const focused = ref(false)
let ro: ResizeObserver | null = null

const fit = computed(() => {
  const { width: vw, height: vh } = props.viewport
  const scale = Math.min(box.value.w / vw, box.value.h / vh) || 0
  return { scale, w: Math.floor(vw * scale), h: Math.floor(vh * scale) }
})

let painting = false
let next: string | null = null
async function paint(data: string) {
  if (painting) { next = data; return }
  painting = true
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = `data:image/jpeg;base64,${data}`
    await img.decode()
    const c = canvas.value
    if (c) {
      if (c.width !== props.viewport.width) { c.width = props.viewport.width; c.height = props.viewport.height }
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    }
  } catch {}
  painting = false
  if (next) { const n = next; next = null; paint(n) }
}
watch(() => props.frame?.ts, () => { if (props.frame) paint(props.frame.data) })

onMounted(() => {
  ro = new ResizeObserver(([e]) => { if (e) box.value = { w: e.contentRect.width, h: e.contentRect.height } })
  if (wrap.value) ro.observe(wrap.value)
  if (props.frame) paint(props.frame.data)
})
onBeforeUnmount(() => ro?.disconnect())

function point(ev: MouseEvent) {
  const r = canvas.value!.getBoundingClientRect()
  return { x: Math.round(((ev.clientX - r.left) / r.width) * props.viewport.width), y: Math.round(((ev.clientY - r.top) / r.height) * props.viewport.height) }
}
let lastMove = 0
function onMove(ev: MouseEvent) {
  if (!props.interactive) return
  const now = performance.now()
  if (now - lastMove < 45) return
  lastMove = now
  emit('input', { type: 'move', ...point(ev) })
}
let downAt: { x: number, y: number } | null = null
function onDown(ev: MouseEvent) {
  if (!props.interactive || ev.button !== 0) return
  downAt = { x: ev.clientX, y: ev.clientY }
  wrap.value?.focus({ preventScroll: true })
}
function onUp(ev: MouseEvent) {
  if (!props.interactive || !downAt || ev.button !== 0) return
  const moved = Math.abs(ev.clientX - downAt.x) + Math.abs(ev.clientY - downAt.y)
  downAt = null
  if (moved < 8) { emit('input', { type: 'click', ...point(ev) }); ripple(ev) }
}
function onWheel(ev: WheelEvent) {
  if (!props.interactive) return
  const k = ev.deltaMode === 1 ? 40 : ev.deltaMode === 2 ? 800 : 1
  emit('input', { type: 'wheel', ...point(ev), dx: ev.deltaX * k, dy: ev.deltaY * k })
}
const SPECIAL = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'])
async function onKey(ev: KeyboardEvent) {
  if (!props.interactive) return
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'v') {
    ev.preventDefault()
    try { const t = await navigator.clipboard.readText(); if (t) emit('input', { type: 'text', text: t }) } catch {}
    return
  }
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return
  if (SPECIAL.has(ev.key)) { ev.preventDefault(); ev.stopPropagation(); emit('input', { type: 'key', key: ev.key }); return }
  if (ev.key.length === 1) { ev.preventDefault(); emit('input', ev.key === ' ' ? { type: 'key', key: ' ' } : { type: 'text', text: ev.key }) }
}

// Click feedback
const ripples = ref<{ id: number, x: number, y: number }[]>([])
let rid = 0
function ripple(ev: MouseEvent) {
  const r = wrap.value!.getBoundingClientRect()
  const id = ++rid
  ripples.value.push({ id, x: ev.clientX - r.left, y: ev.clientY - r.top })
  setTimeout(() => { ripples.value = ripples.value.filter(x => x.id !== id) }, 600)
}
defineExpose({ focus: () => wrap.value?.focus({ preventScroll: true }) })
</script>

<template>
  <div
    ref="wrap"
    tabindex="0"
    class="scanner-viewport relative size-full flex items-center justify-center outline-none select-none overflow-hidden"
    :class="interactive ? 'cursor-default' : 'cursor-progress'"
    role="application"
    aria-label="Live dealership website. Click, scroll and type to use it."
    @keydown="onKey"
    @focus="focused = true"
    @blur="focused = false"
    @wheel.prevent="onWheel"
  >
    <div class="relative shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] rounded-md overflow-hidden ring-1 ring-white/10 bg-white" :style="{ width: `${fit.w}px`, height: `${fit.h}px` }">
      <canvas
        ref="canvas"
        :width="viewport.width"
        :height="viewport.height"
        class="block size-full"
        @mousemove="onMove"
        @mousedown="onDown"
        @mouseup="onUp"
        @contextmenu.prevent
      />
      <span v-for="r in ripples" :key="r.id" class="pointer-events-none absolute size-8 -ml-4 -mt-4 rounded-full border-2 border-red-500/80 animate-[scanner-ping_0.6s_ease-out_forwards]" :style="{ left: `${r.x - (box.w - fit.w) / 2}px`, top: `${r.y - (box.h - fit.h) / 2}px` }" />
      <slot name="overlay" />
      <div v-if="interactive && !focused && frame" class="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white/90 backdrop-blur">Click the page to use it — scroll, click and type work like a normal browser</div>
    </div>
    <slot />
  </div>
</template>

<style scoped>
@keyframes scanner-ping { from { transform: scale(0.4); opacity: 1 } to { transform: scale(1.8); opacity: 0 } }
</style>
