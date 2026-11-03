<script setup lang="ts">
import { Monitor, Smartphone, ExternalLink, Loader2 } from 'lucide-vue-next'

/**
 * Inbox-style email preview: the message as a dealer would see it — sender, subject, preview text
 * and the full design — on desktop (680px) or a phone (390px). The email is rendered in a sandboxed
 * frame (no scripts) that grows to its full height, so the page scrolls like a real mail client.
 */
const props = withDefaults(defineProps<{
  html: string
  subject?: string
  preheader?: string
  from?: { name: string, email: string } | null
  to?: { name: string, email: string } | null
  loading?: boolean
  /** Fixed-height viewport (scrolls inside) instead of growing with the email. */
  maxHeight?: string
  compact?: boolean
}>(), { subject: '', preheader: '', from: null, to: null, loading: false, maxHeight: '', compact: false })
const device = defineModel<'desktop' | 'mobile'>('device', { default: 'desktop' })

const frame = ref<HTMLIFrameElement | null>(null)
const height = ref(900)
const doc = computed(() => {
  const html = props.html || ''
  const base = '<base target="_blank"><style>html,body{margin:0}::-webkit-scrollbar{width:0;height:0}</style>'
  return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${base}`) : `${base}${html}`
})
function measure() {
  try {
    const d = frame.value?.contentDocument
    if (!d?.documentElement) return
    const h = Math.max(d.documentElement.scrollHeight, d.body?.scrollHeight || 0)
    if (h && Math.abs(h - height.value) > 4) height.value = Math.min(h, 12_000)
  } catch {}
}
let timers: ReturnType<typeof setTimeout>[] = []
function onLoad() {
  measure()
  timers.forEach(clearTimeout)
  timers = [150, 500, 1200].map(ms => setTimeout(measure, ms))
}
watch(device, () => nextTick(() => setTimeout(measure, 60)))
onBeforeUnmount(() => timers.forEach(clearTimeout))

const width = computed(() => device.value === 'mobile' ? 390 : 680)
const initials = computed(() => (props.from?.name || 'ZRZ OPS').split(/[\s|]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join(''))
const fromName = computed(() => (props.from?.name || '').split('|')[0]!.trim() || 'ZRZ OPS')
function openFull() {
  const w = window.open('', '_blank')
  if (!w) return
  w.document.open()
  w.document.write(props.html)
  w.document.close()
}
</script>

<template>
  <div class="flex flex-col min-h-0 rounded-xl border bg-card overflow-hidden">
    <!-- Toolbar -->
    <div class="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-muted/30">
      <div role="tablist" aria-label="Preview size" class="inline-flex rounded-lg border bg-muted/40 p-0.5">
        <button type="button" role="tab" :aria-selected="device === 'desktop'" class="rounded-md px-2.5 py-1 text-xs font-medium inline-flex items-center gap-1.5" :class="device === 'desktop' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'" @click="device = 'desktop'"><Monitor class="size-3.5" /> Desktop</button>
        <button type="button" role="tab" :aria-selected="device === 'mobile'" class="rounded-md px-2.5 py-1 text-xs font-medium inline-flex items-center gap-1.5" :class="device === 'mobile' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'" @click="device = 'mobile'"><Smartphone class="size-3.5" /> Mobile</button>
      </div>
      <slot name="toolbar" />
      <Loader2 v-if="loading" class="size-4 animate-spin text-muted-foreground" />
      <Button variant="ghost" size="sm" class="h-7 gap-1.5 text-xs ml-auto" :disabled="!html" @click="openFull"><ExternalLink class="size-3.5" /> Full size</Button>
    </div>

    <!-- Mail client -->
    <div class="flex-1 min-h-0 overflow-y-auto bg-[#eef1ef] dark:bg-zinc-900" :style="maxHeight ? { maxHeight } : undefined">
      <div class="mx-auto py-5 px-3 transition-[max-width] duration-300" :style="{ maxWidth: `${width + 24}px` }">
        <!-- Envelope -->
        <div v-if="!compact" class="rounded-t-2xl bg-white dark:bg-zinc-800 border border-b-0 border-black/5 dark:border-white/10 px-4 pt-4 pb-3">
          <p class="text-[15px] font-semibold leading-snug text-zinc-900 dark:text-zinc-50 break-words">{{ subject || 'No subject' }}</p>
          <div class="mt-3 flex items-start gap-3">
            <span class="size-9 shrink-0 rounded-full bg-[#0e1714] text-[#4ade80] text-xs font-bold flex items-center justify-center">{{ initials }}</span>
            <div class="min-w-0 flex-1 text-xs leading-5">
              <p class="truncate text-zinc-900 dark:text-zinc-100"><span class="font-semibold">{{ fromName }}</span> <span class="text-zinc-500">&lt;{{ from?.email || 'sales@zrzops.com' }}&gt;</span></p>
              <p class="truncate text-zinc-500">to {{ to?.name || to?.email || 'the dealer' }}<span v-if="to?.email && to?.name"> &lt;{{ to.email }}&gt;</span></p>
            </div>
            <span class="text-[11px] text-zinc-500 shrink-0">Today</span>
          </div>
          <p v-if="preheader && device === 'mobile'" class="mt-2 text-xs text-zinc-500 line-clamp-2">{{ preheader }}</p>
        </div>
        <!-- Phone bezel / desktop sheet -->
        <div class="bg-white overflow-hidden border border-black/5 dark:border-white/10 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.35)]" :class="compact ? 'rounded-2xl' : 'rounded-b-2xl'">
          <div v-if="!html" class="h-96 flex flex-col items-center justify-center gap-2 text-sm text-zinc-500"><Loader2 v-if="loading" class="size-5 animate-spin" /><span>{{ loading ? 'Rendering…' : 'Nothing to preview yet' }}</span></div>
          <iframe
            v-else
            ref="frame"
            :srcdoc="doc"
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            title="Email preview"
            class="block w-full border-0 bg-white"
            :style="{ height: `${height}px` }"
            @load="onLoad"
          />
        </div>
      </div>
    </div>
  </div>
</template>
