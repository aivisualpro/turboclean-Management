<script setup lang="ts">
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { VERDICT_META } from '~/composables/useInventoryScanner'
import {
  ScanSearch, X, ArrowLeft, ArrowRight, RotateCw, Lock, Globe, ChevronDown, Loader2, Square, MonitorPlay, LayoutGrid, CheckCircle2,
  AlertTriangle, Car, Images, ScanLine, Save, PlusSquare, ExternalLink, Cpu, MousePointerClick, Sparkles,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * Inventory Scanner — full-screen live browser on the dealership's website.
 * Browse to the inventory list, press Continue, and the scanner collects every vehicle card
 * (all pages), checks every main photo and separates real photos from placeholders, stock
 * images and cars with no photo. Review, teach, then save it to the CRM as an audit.
 */
const props = defineProps<{ dealership: { id: string, name: string, website?: string | null } }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [] }>()

const sc = useInventoryScanner()
const { state, progress, results, frame, error, ended, log } = sc
const tab = ref<'live' | 'results'>('live')
const phase = ref<'checking' | 'unavailable' | 'starting' | 'ready' | 'failed'>('checking')
const failMsg = ref('')
const address = ref('')
const editingAddress = ref(false)
const viewportRef = ref<{ focus: () => void } | null>(null)
const elapsed = ref(0)
let clock: ReturnType<typeof setInterval> | null = null

async function start() {
  phase.value = 'checking'
  failMsg.value = ''
  tab.value = 'live'
  try {
    const st = await sc.status()
    if (!st.ok) { phase.value = 'unavailable'; return }
    phase.value = 'starting'
    await sc.open(props.dealership.id)
    phase.value = 'ready'
  } catch (e: any) { phase.value = 'failed'; failMsg.value = e?.data?.statusMessage || e?.message || 'Could not start the scanner' }
}
watch(open, (v) => { if (v) start(); else { sc.close(); stopClock() } }, { immediate: true })
watch(() => state.value?.url, (u) => { if (u && !editingAddress.value) address.value = u })
watch(ended, (r) => { if (r && open.value && r !== 'closed') { phase.value = 'failed'; failMsg.value = /session ended/i.test(r) ? `${r}. Press “Try again” to start a fresh browser.` : `The browser stopped (${r}). Press “Try again” to start a fresh browser.` } })

const scanning = computed(() => !!state.value?.scanning || progress.value?.phase === 'collecting' || progress.value?.phase === 'analyzing')
watch(scanning, (v) => { v ? startClock() : stopClock() })
watch(() => progress.value?.phase, (p, prev) => {
  if ((p === 'done' || p === 'stopped') && prev && prev !== p) { tab.value = 'results'; if (!results.value) sc.refreshResults() }
  if (p === 'error') toast.error(progress.value?.message || 'Scan failed')
})
function startClock() { stopClock(); const t0 = Date.now(); elapsed.value = 0; clock = setInterval(() => { elapsed.value = Math.round((Date.now() - t0) / 1000) }, 1000) }
function stopClock() { if (clock) clearInterval(clock); clock = null }
onBeforeUnmount(stopClock)

const secure = computed(() => (state.value?.url || '').startsWith('https://'))
const shownUrl = computed(() => (state.value?.url || '').replace(/^https?:\/\/(www\.)?/, ''))
function submitAddress() {
  editingAddress.value = false
  if (address.value.trim() && address.value !== state.value?.url) sc.go({ url: address.value.trim() }).catch((e: any) => toast.error(e?.data?.statusMessage || 'Could not open that address'))
}
const goLink = (href: string) => sc.go({ url: href }).catch((e: any) => toast.error(e?.data?.statusMessage || 'Could not open that page'))

async function cont(opts: { allPages?: boolean, append?: boolean } = {}) {
  try { await sc.scan({ allPages: opts.allPages !== false, append: !!opts.append }); tab.value = 'live' }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not start the scan') }
}
async function stop() { try { await sc.stop() } catch {} }

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    const r = await sc.save()
    toast.success('Saved to the CRM', { description: `Inventory audit recorded — ${r.summary.withoutReal} of ${r.summary.total} vehicles without a real photo (${r.summary.withoutRealPct ?? 0}%).` })
    emit('saved')
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save') } finally { saving.value = false }
}
function closeDialog() {
  if (scanning.value && !confirm('A scan is running. Close the scanner and lose it?')) return
  if (results.value && !results.value.savedAuditId && !confirm('These results are not saved to the CRM yet. Close anyway?')) return
  open.value = false
}

const steps = computed(() => {
  const p = progress.value
  const ph = p?.phase || 'browsing'
  const order = ['collecting', 'analyzing', 'done']
  const idx = ph === 'stopped' ? 2 : order.indexOf(ph)
  return [
    { key: 'collecting', label: 'Collect vehicles', icon: Car, detail: p ? `${p.vehicles} found${p.advertised ? ` of ${p.advertised}` : ''} · page ${p.page || 1}` : '' },
    { key: 'analyzing', label: 'Check every photo', icon: Images, detail: p && p.toAnalyze ? `${p.analyzed} of ${p.toAnalyze}` : 'Waiting' },
    { key: 'done', label: 'Ready to review', icon: CheckCircle2, detail: '' },
  ].map((s, i) => ({ ...s, state: i < idx ? 'done' : i === idx ? 'active' : 'todo' }))
})
const pctDone = computed(() => {
  const p = progress.value
  if (!p) return 0
  if (p.phase === 'analyzing') return 55 + Math.round((p.analyzed / Math.max(1, p.toAnalyze)) * 45)
  if (p.phase === 'collecting') return p.advertised ? Math.min(55, Math.round((p.vehicles / p.advertised) * 55)) : Math.min(50, 8 + p.page * 6)
  return 100
})
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const lastLog = computed(() => log.value[log.value.length - 1]?.text || '')
const kindIcon = (k: string) => k === 'used' || k === 'certified' ? Car : k === 'new' ? Sparkles : Globe
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <DialogContent
        class="scanner fixed inset-2 z-50 flex flex-col overflow-hidden rounded-xl border-2 border-primary bg-background shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        @escape-key-down="(e: Event) => { e.preventDefault(); if (!(e.target as HTMLElement)?.closest?.('.scanner-viewport')) closeDialog() }"
        @interact-outside="(e: Event) => e.preventDefault()"
        @open-auto-focus="(e: Event) => e.preventDefault()"
      >
        <!-- Title bar -->
        <header class="shrink-0 h-12 flex items-center gap-3 px-3 border-b bg-card">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="size-8 rounded-lg bg-red-600 text-white flex items-center justify-center shadow-sm shadow-red-600/30"><ScanSearch class="size-4.5" /></span>
            <div class="min-w-0 leading-tight">
              <DialogTitle class="text-sm font-semibold truncate">Inventory Scanner</DialogTitle>
              <DialogDescription class="text-[11px] text-muted-foreground truncate">{{ dealership.name }}</DialogDescription>
            </div>
          </div>
          <div v-if="phase === 'ready'" role="tablist" class="ml-4 inline-flex rounded-lg border bg-muted/40 p-0.5">
            <button type="button" role="tab" :aria-selected="tab === 'live'" class="rounded-md px-3 py-1 text-xs font-medium inline-flex items-center gap-1.5" :class="tab === 'live' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'" @click="tab = 'live'"><MonitorPlay class="size-3.5" /> Live browser</button>
            <button type="button" role="tab" :aria-selected="tab === 'results'" :disabled="!results" class="rounded-md px-3 py-1 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-40" :class="tab === 'results' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'" @click="tab = 'results'">
              <LayoutGrid class="size-3.5" /> Results <span v-if="results" class="rounded-full px-1.5 text-[10px] tabular-nums bg-background/80 text-foreground">{{ results.summary.total }}</span>
            </button>
          </div>
          <div class="ml-auto flex items-center gap-2">
            <span v-if="phase === 'ready'" class="hidden md:inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><Cpu class="size-3.5" /> {{ state?.browser === 'remote' ? 'Hosted Chrome' : 'Private Chrome' }} · {{ state?.viewport.width }}×{{ state?.viewport.height }}</span>
            <Button variant="ghost" size="icon" class="size-8" aria-label="Close scanner" @click="closeDialog"><X class="size-4" /></Button>
          </div>
        </header>

        <!-- Browser toolbar -->
        <div v-if="phase === 'ready' && tab === 'live'" class="shrink-0 flex items-center gap-2 px-2 py-1.5 border-b bg-muted/30">
          <div class="flex items-center">
            <Button variant="ghost" size="icon" class="size-8" aria-label="Back" :disabled="!state?.history.canBack || scanning" @click="sc.go({ action: 'back' })"><ArrowLeft class="size-4" /></Button>
            <Button variant="ghost" size="icon" class="size-8" aria-label="Forward" :disabled="!state?.history.canForward || scanning" @click="sc.go({ action: 'forward' })"><ArrowRight class="size-4" /></Button>
            <Button variant="ghost" size="icon" class="size-8" aria-label="Reload" :disabled="scanning" @click="sc.go({ action: 'reload' })"><RotateCw class="size-4" :class="state?.loading && 'animate-spin'" /></Button>
          </div>
          <form class="flex-1 min-w-0" @submit.prevent="submitAddress">
            <div class="relative flex items-center h-8 rounded-full border bg-background px-3 gap-2 focus-within:ring-2 focus-within:ring-primary/40">
              <Lock v-if="secure" class="size-3.5 text-emerald-600 shrink-0" /><Globe v-else class="size-3.5 text-muted-foreground shrink-0" />
              <input v-if="editingAddress" v-model="address" class="flex-1 min-w-0 bg-transparent text-xs outline-none" autofocus spellcheck="false" aria-label="Web address" @blur="submitAddress">
              <button v-else type="button" class="flex-1 min-w-0 text-left text-xs truncate" :disabled="scanning" @click="editingAddress = true; address = state?.url || ''">{{ shownUrl || 'Loading…' }}</button>
              <div v-if="state?.loading" class="absolute left-3 right-3 bottom-0 h-0.5 overflow-hidden rounded-full"><div class="h-full w-1/3 bg-primary animate-[scanner-load_1.1s_ease-in-out_infinite]" /></div>
            </div>
          </form>
          <div class="hidden xl:flex items-center gap-1 max-w-[38%] overflow-hidden">
            <button v-for="l in state?.navLinks || []" :key="l.href" type="button" class="shrink-0 rounded-full border bg-background px-2.5 h-7 text-[11px] font-medium inline-flex items-center gap-1 hover:bg-muted disabled:opacity-50" :disabled="scanning" :title="l.href" @click="goLink(l.href)"><component :is="kindIcon(l.kind)" class="size-3" /> {{ l.label }}</button>
          </div>
          <span class="hidden lg:inline-flex items-center gap-1.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 px-2 h-7 text-[11px] font-semibold"><span class="relative flex size-2"><span class="absolute inline-flex size-full rounded-full bg-red-500 opacity-60 animate-ping" /><span class="relative inline-flex size-2 rounded-full bg-red-500" /></span> LIVE</span>
          <div v-if="!scanning" class="flex items-center">
            <Button class="h-8 rounded-r-none bg-red-600 hover:bg-red-700 text-white gap-1.5 shadow-sm shadow-red-600/30" @click="cont()"><ScanLine class="size-4" /> Continue — scan inventory</Button>
            <DropdownMenu>
              <DropdownMenuTrigger as-child><Button class="h-8 w-8 px-0 rounded-l-none border-l border-red-800/40 bg-red-600 hover:bg-red-700 text-white" aria-label="More scan options"><ChevronDown class="size-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-72">
                <DropdownMenuItem @click="cont()"><ScanLine class="size-4" /> Scan all pages (recommended)</DropdownMenuItem>
                <DropdownMenuItem @click="cont({ allPages: false })"><MousePointerClick class="size-4" /> Scan this page only</DropdownMenuItem>
                <DropdownMenuItem :disabled="!results" @click="cont({ append: true })"><PlusSquare class="size-4" /> Add this list to the results (e.g. New after Used)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button v-else variant="outline" class="h-8 gap-1.5" @click="stop"><Square class="size-3.5 fill-current" /> Stop</Button>
        </div>

        <!-- Body -->
        <div class="flex-1 min-h-0 relative">
          <!-- Starting / problems -->
          <div v-if="phase !== 'ready'" class="absolute inset-0 flex items-center justify-center p-6 bg-[radial-gradient(ellipse_at_top,#27272a,#09090b)] text-white">
            <div v-if="phase === 'checking' || phase === 'starting'" class="text-center space-y-4">
              <div class="relative mx-auto size-20">
                <div class="absolute inset-0 rounded-2xl bg-red-600/20 animate-ping" />
                <div class="relative size-20 rounded-2xl bg-red-600 flex items-center justify-center shadow-2xl shadow-red-600/40"><ScanSearch class="size-9" /></div>
              </div>
              <div>
                <p class="text-lg font-semibold">{{ phase === 'checking' ? 'Preparing the scanner…' : 'Starting a private browser…' }}</p>
                <p class="text-sm text-white/60">Opening {{ (dealership.website || '').replace(/^https?:\/\//, '') || 'the dealership website' }} at desktop size</p>
              </div>
            </div>
            <div v-else class="max-w-lg rounded-2xl border border-white/10 bg-white/5 p-6 space-y-3 backdrop-blur">
              <div class="flex items-center gap-2 text-amber-400"><AlertTriangle class="size-5" /><p class="font-semibold">{{ phase === 'unavailable' ? 'Chrome is needed on the server' : 'The scanner could not start' }}</p></div>
              <p v-if="phase === 'unavailable'" class="text-sm text-white/80">The scanner drives Google Chrome on the machine that runs this app. Install Google Chrome there (or set <code class="px-1 rounded bg-white/10">SCANNER_CHROME_PATH</code>), or point <code class="px-1 rounded bg-white/10">SCANNER_BROWSER_WS</code> at a hosted Chrome.</p>
              <p v-else class="text-sm text-white/80">{{ failMsg }}</p>
              <div class="flex gap-2 pt-1"><Button class="bg-red-600 hover:bg-red-700 text-white" @click="start">Try again</Button><Button variant="outline" class="bg-transparent text-white border-white/20 hover:bg-white/10" @click="open = false">Close</Button></div>
            </div>
          </div>

          <!-- Live -->
          <div v-show="phase === 'ready' && tab === 'live'" class="absolute inset-0 p-3 bg-[radial-gradient(ellipse_at_top,#27272a,#09090b)]">
            <CrmScannerViewport ref="viewportRef" :frame="frame" :viewport="state?.viewport || { width: 1440, height: 900 }" :interactive="!scanning" @input="sc.input">
              <template #overlay>
                <div v-if="!frame" class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-100 text-zinc-500">
                  <Loader2 class="size-6 animate-spin" /><p class="text-sm">Loading {{ shownUrl || 'the website' }}…</p>
                </div>
                <!-- Scan sweep -->
                <div v-if="scanning" class="pointer-events-none absolute inset-0 overflow-hidden">
                  <div class="absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-red-500/15 to-transparent animate-[scanner-sweep_2.4s_linear_infinite]" />
                  <div class="absolute inset-0 ring-4 ring-inset ring-red-500/40 rounded-md" />
                </div>
              </template>

              <!-- Coach mark before the first scan -->
              <div v-if="!scanning && frame && !results && progress?.phase !== 'error'" class="absolute top-3 left-1/2 -translate-x-1/2 max-w-[92%] rounded-full bg-black/75 text-white text-xs px-4 py-2 backdrop-blur shadow-lg flex items-center gap-2">
                <MousePointerClick class="size-4 text-red-400 shrink-0" />
                <span>Go to the <b>inventory list</b> ({{ (state?.navLinks || []).filter(l => l.kind === 'used').length ? 'try the shortcuts above' : 'e.g. Used Inventory' }}), close any pop-ups, then press <b class="text-red-300">Continue</b>.</span>
              </div>
              <div v-if="progress?.phase === 'error' && !scanning" class="absolute top-3 left-1/2 -translate-x-1/2 max-w-[92%] rounded-xl bg-rose-600 text-white text-sm px-4 py-2.5 shadow-lg flex items-center gap-2"><AlertTriangle class="size-4 shrink-0" /> {{ progress.message }}</div>
              <div v-if="error" class="absolute top-14 left-1/2 -translate-x-1/2 max-w-[92%] rounded-xl bg-amber-500 text-black text-sm px-4 py-2 shadow-lg">{{ error }}</div>

              <!-- Scan progress -->
              <Transition enter-from-class="opacity-0 translate-y-4" enter-active-class="transition duration-300" leave-to-class="opacity-0 translate-y-4" leave-active-class="transition duration-200">
                <div v-if="scanning" class="absolute bottom-5 left-1/2 -translate-x-1/2 w-[min(760px,94%)] rounded-2xl border border-white/10 bg-zinc-950/85 text-white shadow-2xl backdrop-blur-xl p-4 space-y-3">
                  <div class="flex items-center gap-3">
                    <div class="size-10 rounded-xl bg-red-600 flex items-center justify-center shadow-lg shadow-red-600/40"><ScanLine class="size-5" /></div>
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-semibold">{{ progress?.phase === 'analyzing' ? 'Checking every photo' : 'Collecting every vehicle' }}</p>
                      <p class="text-xs text-white/60 truncate">{{ lastLog || progress?.message }}</p>
                    </div>
                    <div class="text-right"><p class="text-2xl font-bold tabular-nums leading-none">{{ progress?.vehicles || 0 }}</p><p class="text-[10px] uppercase tracking-wider text-white/50">vehicles</p></div>
                    <div class="text-right pl-3 border-l border-white/10"><p class="text-lg font-semibold tabular-nums leading-none">{{ mmss(elapsed) }}</p><p class="text-[10px] uppercase tracking-wider text-white/50">elapsed</p></div>
                  </div>
                  <div class="h-1.5 rounded-full bg-white/10 overflow-hidden"><div class="h-full rounded-full bg-gradient-to-r from-red-500 to-orange-400 transition-all duration-500" :style="{ width: `${pctDone}%` }" /></div>
                  <ol class="grid grid-cols-3 gap-2">
                    <li v-for="st in steps" :key="st.key" class="flex items-center gap-2 rounded-lg px-2 py-1.5" :class="st.state === 'active' ? 'bg-white/10' : ''">
                      <span class="size-6 rounded-full flex items-center justify-center shrink-0" :class="st.state === 'done' ? 'bg-emerald-500' : st.state === 'active' ? 'bg-red-600' : 'bg-white/10'">
                        <CheckCircle2 v-if="st.state === 'done'" class="size-3.5" /><Loader2 v-else-if="st.state === 'active'" class="size-3.5 animate-spin" /><component :is="st.icon" v-else class="size-3.5 text-white/50" />
                      </span>
                      <div class="min-w-0"><p class="text-xs font-medium truncate" :class="st.state === 'todo' && 'text-white/50'">{{ st.label }}</p><p v-if="st.state === 'active' && st.detail" class="text-[10px] text-white/60 truncate tabular-nums">{{ st.detail }}</p></div>
                    </li>
                  </ol>
                </div>
              </Transition>
            </CrmScannerViewport>
          </div>

          <!-- Results -->
          <div v-if="phase === 'ready' && tab === 'results' && results" class="absolute inset-0 flex flex-col">
            <div class="flex-1 min-h-0">
              <CrmScannerResults :results="results" :review="sc.review" :list-rules="sc.listRules" :add-rule="sc.addRule" :remove-rule="sc.removeRule" />
            </div>
            <footer class="shrink-0 border-t bg-card px-3 py-2 flex flex-wrap items-center gap-3">
              <div class="flex items-center gap-3 text-xs text-muted-foreground min-w-0">
                <span class="inline-flex items-center gap-1.5"><span class="size-2 rounded-full" :class="VERDICT_META.missing.dot" />Saves an inventory audit for <b class="text-foreground">{{ dealership.name }}</b>:</span>
                <span class="tabular-nums">{{ results.summary.total }} vehicles · <b class="text-foreground">{{ results.summary.withoutReal }}</b> without a real photo ({{ results.summary.withoutRealPct ?? 0 }}%)</span>
                <span v-if="results.hasEvidence" class="hidden md:inline">+ screenshot for emails</span>
              </div>
              <div class="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" class="h-8 gap-1.5" @click="tab = 'live'"><MonitorPlay class="size-4" /> Back to browser</Button>
                <Button v-if="results.savedAuditId" size="sm" class="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-600/90 text-white" @click="open = false"><CheckCircle2 class="size-4" /> Saved — close</Button>
                <Button v-else size="sm" class="h-8 gap-1.5" :disabled="saving" @click="save"><Loader2 v-if="saving" class="size-4 animate-spin" /><Save v-else class="size-4" /> Save to CRM</Button>
              </div>
            </footer>
          </div>
        </div>

        <!-- Status bar -->
        <div v-if="phase === 'ready'" class="shrink-0 h-6 px-3 border-t bg-muted/40 text-[10px] text-muted-foreground flex items-center gap-3">
          <span class="truncate">{{ state?.title || shownUrl }}</span>
          <a v-if="state?.url" :href="state.url" target="_blank" rel="noopener" class="ml-auto inline-flex items-center gap-1 hover:text-foreground shrink-0">Open in my browser <ExternalLink class="size-3" /></a>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
@keyframes scanner-load { 0% { transform: translateX(-100%) } 100% { transform: translateX(300%) } }
@keyframes scanner-sweep { 0% { top: -6rem } 100% { top: 100% } }
</style>
