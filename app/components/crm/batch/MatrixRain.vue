<script setup lang="ts">
/**
 * Subtle "digital rain" backdrop for Mission Control. Canvas-based, throttled, pauses when the tab
 * is hidden, and switches itself off when the person prefers reduced motion.
 */
const props = withDefaults(defineProps<{ opacity?: number, speed?: number }>(), { opacity: 0.18, speed: 1 })
const canvas = ref<HTMLCanvasElement | null>(null)
let raf = 0
let last = 0
let cols: number[] = []
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789ABCDEF<>/={}'
function size() {
  const c = canvas.value
  if (!c) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const r = c.getBoundingClientRect()
  c.width = Math.floor(r.width * dpr); c.height = Math.floor(r.height * dpr)
  c.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0)
  cols = Array.from({ length: Math.ceil(r.width / 16) }, () => Math.random() * -60)
}
function frame(t: number) {
  raf = requestAnimationFrame(frame)
  if (t - last < 70 / props.speed) return
  last = t
  const c = canvas.value
  if (!c || document.hidden) return
  const ctx = c.getContext('2d')!
  const w = c.clientWidth, h = c.clientHeight
  ctx.fillStyle = 'rgba(5, 10, 8, 0.18)'
  ctx.fillRect(0, 0, w, h)
  ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace'
  for (let i = 0; i < cols.length; i++) {
    const y = cols[i]! * 16
    const ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!
    ctx.fillStyle = Math.random() < 0.08 ? '#d1fae5' : '#34d399'
    ctx.fillText(ch, i * 16, y)
    cols[i] = y > h && Math.random() > 0.975 ? 0 : cols[i]! + 1
  }
}
onMounted(() => {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  size()
  window.addEventListener('resize', size)
  raf = requestAnimationFrame(frame)
})
onBeforeUnmount(() => { cancelAnimationFrame(raf); window.removeEventListener('resize', size) })
</script>

<template>
  <canvas ref="canvas" class="pointer-events-none absolute inset-0 size-full" :style="{ opacity }" aria-hidden="true" />
</template>
