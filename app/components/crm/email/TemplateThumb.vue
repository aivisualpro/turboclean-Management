<script setup lang="ts">
import { Type } from 'lucide-vue-next'

/** Miniature, non-interactive render of a template version (top of the email), for cards. */
const props = defineProps<{ html: string, format: 'html' | 'text' }>()
const box = ref<HTMLDivElement | null>(null)
const w = ref(0)
let ro: ResizeObserver | null = null
const visible = ref(false)
let io: IntersectionObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(([e]) => { if (e) w.value = e.contentRect.width })
  if (box.value) ro.observe(box.value)
  // Only render when the card scrolls into view.
  io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { visible.value = true; io?.disconnect() } }, { rootMargin: '200px' })
  if (box.value) io.observe(box.value)
})
onBeforeUnmount(() => { ro?.disconnect(); io?.disconnect() })
const scale = computed(() => w.value ? w.value / 680 : 0.4)
const doc = computed(() => props.html.replace(/<head([^>]*)>/i, '<head$1><style>html,body{overflow:hidden!important}</style>'))
</script>

<template>
  <div ref="box" class="relative w-full overflow-hidden bg-[#eef1ef] dark:bg-zinc-900" style="aspect-ratio: 16 / 10">
    <iframe
      v-if="visible && html"
      :srcdoc="doc"
      sandbox=""
      loading="lazy"
      tabindex="-1"
      aria-hidden="true"
      title=""
      class="absolute top-0 left-0 border-0 pointer-events-none origin-top-left bg-white"
      :style="{ width: '680px', height: `${Math.ceil(680 * 10 / 16 / scale) + 40}px`, transform: `scale(${scale})` }"
    />
    <div v-else-if="!html" class="absolute inset-0 flex items-center justify-center text-muted-foreground"><Type class="size-6" /></div>
    <div class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" />
  </div>
</template>
