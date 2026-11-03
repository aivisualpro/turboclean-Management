<script setup lang="ts">
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { formatDistanceToNow } from 'date-fns'
import { VERDICT_META } from '~/composables/useInventoryScanner'
import {
  ScanSearch, X, ArrowLeft, ArrowRight, RotateCw, Lock, Globe, ChevronDown, Loader2, Square, MonitorPlay, LayoutGrid, CheckCircle2,
  AlertTriangle, Car, Images, ScanLine, Save, PlusSquare, ExternalLink, Cloud, FileStack, Sparkles, History, Eye, CircleSlash, MousePointerClick, List, Search, Bookmark, BookmarkCheck,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * Inventory Scanner — full-screen view of the dealership's website, rendered by a private cloud
 * browser at desktop size. Pick the inventory list (shortcuts or address bar), press Continue, and
 * the scanner collects every vehicle card (all pages), checks every main photo and separates real
 * photos from "No photo" placeholders and stock images. Review, teach, then save it to the CRM.
 */
const props = defineProps<{ dealership: { id: string, name: string, website?: string | null } }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [] }>()

const sc = useInventoryScanner()
const { preview, previewing, previewError, scan, progress, results, frame, error, log, running } = sc
const tab = ref<'site' | 'results'>('site')
const phase = ref<'checking' | 'unavailable' | 'ready' | 'failed'>('checking')
const failMsg = ref('')
const engine = ref<string>('')
const address = ref('')
/** Bookmark the page on screen as one of the dealership's scan pages (what batch scans use). */
const { dealerships: crmDealerships, updateDealership } = useCrmDealerships()
const savedPages = computed(() => crmDealerships.value.find(d => d.id === props.dealership.id)?.scanPages || [])
const pageSaved = computed(() => { const u = (preview.value?.url || '').replace(/\/$/, ''); return !!u && savedPages.value.some(p => p.url.replace(/\/$/, '') === u) })
const savingPage = ref(false)
async function savePage() {
  const url = preview.value?.url
  if (!url || pageSaved.value || savingPage.value) return
  savingPage.value = true
  try {
    const label = (preview.value?.navLinks || []).find(l => l.href === url)?.label || (preview.value?.title || '').split(/[|\-–]/)[0]!.trim().slice(0, 60)
    await updateDealership(props.dealership.id, { scanPages: [...savedPages.value, { url, label }] } as any)
    toast.success('Saved as a scan page', { description: 'Batch scans will read this page for ' + props.dealership.name })
  }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save the page') }
  finally { savingPage.value = false }
}
const editingAddress = ref(false)
const ranHere = ref(false)
const elapsed = ref(0)
let clock: ReturnType<typeof setInterval> | null = null

// Simple history of the pages looked at in this window (Back / Forward).
const visited = ref<string[]>([])
const at = ref(-1)

async function start() {
  phase.value = 'checking'
  failMsg.value = ''
  tab.value = 'site'
  ranHere.value = false
  visited.value = []; at.value = -1
  sc.reset()
  try {
    const st = await sc.status()
    engine.value = st.kind
    if (!st.ok) { phase.value = 'unavailable'; return }
    phase.value = 'ready'
    sc.loadLatest(props.dealership.id).catch(() => {})
    await show()
  } catch (e: any) { phase.value = 'failed'; failMsg.value = e?.data?.message || e?.data?.statusMessage || e?.message || 'Could not start the scanner' }
}
watch(open, (v) => { if (v) start(); else { sc.dispose(); stopClock() } }, { immediate: true })

/** Open a page in the cloud browser and show its snapshot. */
async function show(url?: string, opts: { history?: boolean } = {}) {
  await sc.loadPreview(props.dealership.id, url)
  if (previewError.value) { toast.error(previewError.value); return }
  if (preview.value && opts.history !== false) {
    visited.value = [...visited.value.slice(0, at.value + 1), preview.value.url]
    at.value = visited.value.length - 1
  }
}
const canBack = computed(() => at.value > 0)
const canForward = computed(() => at.value < visited.value.length - 1)
function back() { if (canBack.value) { at.value--; show(visited.value[at.value], { history: false }) } }
function forward() { if (canForward.value) { at.value++; show(visited.value[at.value], { history: false }) } }
function reload() { show(preview.value?.url, { history: false }) }

watch(() => preview.value?.url, (u) => { if (u && !editingAddress.value) address.value = u })
const shownUrl = computed(() => (preview.value?.url || props.dealership.website || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))
const secure = computed(() => (preview.value?.url || props.dealership.website || '').startsWith('https://'))
function submitAddress() {
  editingAddress.value = false
  const v = address.value.trim()
  if (v && v !== preview.value?.url) show(v)
}

// ── Scan ──
const scanning = computed(() => running.value)
watch(scanning, (v) => { v ? startClock() : stopClock() })
function startClock() { stopClock(); const t0 = Date.now(); elapsed.value = 0; clock = setInterval(() => { elapsed.value = Math.round((Date.now() - t0) / 1000) }, 1000) }
function stopClock() { if (clock) clearInterval(clock); clock = null }
onBeforeUnmount(stopClock)

async function cont(opts: { allPages?: boolean, append?: boolean } = {}) {
  ranHere.value = true
  tab.value = 'site'
  try {
    await sc.run(props.dealership.id, { url: preview.value?.url || undefined, allPages: opts.allPages !== false, appendTo: opts.append ? results.value?.scanId : null })
    if (!open.value) return
    if (results.value) {
      tab.value = 'results'
      const cut = scan.value?.status === 'stopped' && /cut off/i.test(progress.value?.message || '')
      toast[cut ? 'warning' : 'success'](cut ? 'Scan was cut off — showing what it found' : 'Scan complete', { description: `${results.value.summary.total} vehicles · ${results.value.summary.withoutReal} without a real photo (${results.value.summary.withoutRealPct ?? 0}%)` })
    }
    else if (error.value) toast.error(error.value)
    else toast.error(progress.value?.message || 'The scan ended without results')
  } catch (e: any) { toast.error(e?.message || 'Could not start the scan') }
}
async function stop() { await sc.stop(); toast('Stopping…', { description: 'The photos found so far are still checked and kept.' }) }

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    const r = await sc.save()
    toast.success('Saved to the CRM', { description: `Inventory audit recorded — ${r.summary.withoutReal} of ${r.summary.total} vehicles without a real photo (${r.summary.withoutRealPct ?? 0}%).` })
    emit('saved')
  } catch (e: any) { toast.error(e?.data?.message || e?.data?.statusMessage || 'Could not save') } finally { saving.value = false }
}
function closeDialog() {
  if (scanning.value && !confirm('A scan is running. Close the scanner and stop it? What it found so far is still checked and kept.')) return
  if (ranHere.value && results.value && !results.value.savedAuditId && !confirm('These results are not saved to the CRM yet. Close anyway? (You can reopen them from “Last scan”.)')) return
  open.value = false
}

// ── Presentation ──
const steps = computed(() => {
  const p = progress.value
  const ph = p?.phase || 'collecting'
  const order = ['collecting', 'analyzing', 'done']
  const idx = ph === 'stopped' ? 2 : Math.max(0, order.indexOf(ph))
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
  if (p.phase === 'collecting') return p.advertised ? Math.min(55, Math.round((p.vehicles / p.advertised) * 55)) : Math.min(50, 4 + p.page * 6)
  return 100
})
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const lastLog = computed(() => log.value[log.value.length - 1]?.text || '')
const kindIcon = (k: string) => k === 'used' || k === 'certified' ? Car : k === 'new' ? Sparkles : Globe
const ago = (iso?: string | null) => { try { return iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : '' } catch { return '' } }

const hoverHref = ref<string | null>(null)
const pageQuery = ref('')
const PAGE_KIND_LABEL: Record<string, string> = { used: 'Pre-owned / used', certified: 'Certified', new: 'New', all: 'All inventory', other: 'Other pages' }
const pageGroups = computed(() => {
  const q = pageQuery.value.trim().toLowerCase()
  const list = (preview.value?.pages || []).filter(p => !q || `${p.label} ${p.href}`.toLowerCase().includes(q))
  const groups: { kind: string, label: string, items: typeof list }[] = []
  for (const kind of ['used', 'certified', 'new', 'all', 'other']) {
    const items = list.filter(p => p.kind === kind).slice(0, kind === 'other' ? 40 : 12)
    if (items.length) groups.push({ kind, label: PAGE_KIND_LABEL[kind]!, items })
  }
  return groups
})
const liveSrc = computed(() => frame.value ? `data:image/jpeg;base64,${frame.value.data}` : null)
const viewMode = computed<'page' | 'live'>(() => scanning.value && liveSrc.value ? 'live' : 'page')
const viewSrc = computed(() => viewMode.value === 'live' ? liveSrc.value : preview.value?.screenshot || null)
const detected = computed(() => preview.value?.detected)
/** The previous scan, offered when nothing has been run in this window yet. */
const lastScan = computed(() => !ranHere.value && !scanning.value ? scan.value : null)
const engineLabel = computed(() => engine.value === 'serverless' ? 'Cloud Chrome' : engine.value === 'remote' ? 'Hosted Chrome' : 'Private Chrome')
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <DialogContent
        class="scanner fixed inset-2 z-50 flex flex-col overflow-hidden rounded-xl border-2 border-primary bg-background shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        @escape-key-down="(e: Event) => { e.preventDefault(); if (!editingAddress) closeDialog() }"
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
            <button type="button" role="tab" :aria-selected="tab === 'site'" class="rounded-md px-3 py-1 text-xs font-medium inline-flex items-center gap-1.5" :class="tab === 'site' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'" @click="tab = 'site'"><MonitorPlay class="size-3.5" /> Website</button>
            <button type="button" role="tab" :aria-selected="tab === 'results'" :disabled="!results" class="rounded-md px-3 py-1 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-40" :class="tab === 'results' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'" @click="tab = 'results'">
              <LayoutGrid class="size-3.5" /> Results <span v-if="results" class="rounded-full px-1.5 text-[10px] tabular-nums bg-background/80 text-foreground">{{ results.summary.total }}</span>
            </button>
          </div>
          <div class="ml-auto flex items-center gap-2">
            <span v-if="phase === 'ready'" class="hidden md:inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><Cloud class="size-3.5" /> {{ engineLabel }} · 1440×900</span>
            <Button variant="ghost" size="icon" class="size-8" aria-label="Close scanner" @click="closeDialog"><X class="size-4" /></Button>
          </div>
        </header>

        <!-- Browser toolbar -->
        <div v-if="phase === 'ready' && tab === 'site'" class="shrink-0 flex items-center gap-2 px-2 py-1.5 border-b bg-muted/30">
          <div class="flex items-center">
            <Button variant="ghost" size="icon" class="size-8" aria-label="Back" :disabled="!canBack || scanning || previewing" @click="back"><ArrowLeft class="size-4" /></Button>
            <Button variant="ghost" size="icon" class="size-8" aria-label="Forward" :disabled="!canForward || scanning || previewing" @click="forward"><ArrowRight class="size-4" /></Button>
            <Button variant="ghost" size="icon" class="size-8" aria-label="Reload" :disabled="scanning || previewing" @click="reload"><RotateCw class="size-4" :class="previewing && 'animate-spin'" /></Button>
          </div>
          <form class="flex-1 min-w-0" @submit.prevent="submitAddress">
            <div class="relative flex items-center h-8 rounded-full border bg-background px-3 gap-2 focus-within:ring-2 focus-within:ring-primary/40">
              <Lock v-if="secure" class="size-3.5 text-emerald-600 shrink-0" /><Globe v-else class="size-3.5 text-muted-foreground shrink-0" />
              <input v-if="editingAddress" v-model="address" class="flex-1 min-w-0 bg-transparent text-xs outline-none" autofocus spellcheck="false" aria-label="Web address" placeholder="Paste the inventory page address and press Enter" @blur="submitAddress" @keydown.esc.stop="editingAddress = false">
              <button v-else type="button" class="flex-1 min-w-0 text-left text-xs truncate" :disabled="scanning" title="Type or paste another page address" @click="editingAddress = true; address = preview?.url || dealership.website || ''">{{ shownUrl || 'Loading…' }}</button>
              <div v-if="previewing" class="absolute left-3 right-3 bottom-0 h-0.5 overflow-hidden rounded-full"><div class="h-full w-1/3 bg-primary animate-[scanner-load_1.1s_ease-in-out_infinite]" /></div>
            </div>
          </form>
          <Button variant="outline" size="sm" class="h-8 gap-1.5 text-xs shrink-0" :class="pageSaved && 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300'" :disabled="!preview?.url || previewing || scanning || savingPage || pageSaved" :title="pageSaved ? 'This page is one of the dealership\'s scan pages' : 'Save this page as a scan page — batch scans read the saved pages'" @click="savePage">
            <Loader2 v-if="savingPage" class="size-3.5 animate-spin" /><BookmarkCheck v-else-if="pageSaved" class="size-3.5" /><Bookmark v-else class="size-3.5" />
            <span class="hidden lg:inline">{{ pageSaved ? 'Scan page' : 'Save as scan page' }}</span>
          </Button>
          <div class="hidden xl:flex items-center gap-1 max-w-[30%] overflow-hidden">
            <button v-for="l in preview?.navLinks || []" :key="l.href" type="button" class="shrink-0 rounded-full border bg-background px-2.5 h-7 text-[11px] font-medium inline-flex items-center gap-1 hover:bg-muted disabled:opacity-50" :class="preview?.url === l.href && 'border-primary text-primary'" :disabled="scanning || previewing" :title="l.href" @click="show(l.href)"><component :is="kindIcon(l.kind)" class="size-3" /> {{ l.label }}</button>
          </div>
          <DropdownMenu v-if="preview?.pages?.length" @update:open="(o: boolean) => { if (!o) pageQuery = '' }">
            <DropdownMenuTrigger as-child><Button variant="outline" class="h-8 gap-1.5 text-xs" :disabled="scanning || previewing" title="Every page linked from this site's menus"><List class="size-3.5" /> Pages <span class="text-muted-foreground tabular-nums">{{ preview.pages.length }}</span></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-80 p-0">
              <div class="p-2 border-b"><div class="relative"><Search class="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input v-model="pageQuery" placeholder="Find a page…" class="h-8 pl-8 text-xs" @keydown.stop /></div></div>
              <div class="max-h-[60vh] overflow-y-auto py-1">
                <template v-for="g in pageGroups" :key="g.kind">
                  <DropdownMenuLabel class="text-[10px] uppercase tracking-wider text-muted-foreground">{{ g.label }}</DropdownMenuLabel>
                  <DropdownMenuItem v-for="pg in g.items" :key="pg.href" class="text-xs gap-2" :title="pg.href" @click="show(pg.href)"><component :is="kindIcon(pg.kind)" class="size-3.5 text-muted-foreground shrink-0" /><span class="truncate">{{ pg.label }}</span><span class="ml-auto text-[10px] text-muted-foreground truncate max-w-28">{{ pg.href.replace(/^https?:\/\/[^/]+/, '') || '/' }}</span></DropdownMenuItem>
                </template>
                <p v-if="!pageGroups.length" class="px-3 py-6 text-xs text-muted-foreground text-center">No page matches.</p>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <span v-if="scanning" class="hidden lg:inline-flex items-center gap-1.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 px-2 h-7 text-[11px] font-semibold"><span class="relative flex size-2"><span class="absolute inline-flex size-full rounded-full bg-red-500 opacity-60 animate-ping" /><span class="relative inline-flex size-2 rounded-full bg-red-500" /></span> SCANNING</span>
          <span v-else-if="previewing" class="hidden lg:inline-flex items-center gap-1.5 rounded-full bg-muted text-muted-foreground px-2 h-7 text-[11px] font-medium"><Loader2 class="size-3 animate-spin" /> Opening…</span>
          <span v-else-if="detected && detected.cards" class="hidden lg:inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 h-7 text-[11px] font-semibold tabular-nums" title="Vehicle cards the scanner can see on this page"><Car class="size-3.5" /> {{ detected.cards }} on this page<template v-if="detected.advertised"> · {{ detected.advertised }} in stock</template></span>
          <span v-else-if="preview" class="hidden lg:inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 h-7 text-[11px] font-semibold"><CircleSlash class="size-3.5" /> No vehicles on this page</span>
          <div v-if="!scanning" class="flex items-center">
            <Button class="h-8 rounded-r-none bg-red-600 hover:bg-red-700 text-white gap-1.5 shadow-sm shadow-red-600/30" :disabled="previewing || !preview" @click="cont()"><ScanLine class="size-4" /> Continue — scan inventory</Button>
            <DropdownMenu>
              <DropdownMenuTrigger as-child><Button class="h-8 w-8 px-0 rounded-l-none border-l border-red-800/40 bg-red-600 hover:bg-red-700 text-white" aria-label="More scan options" :disabled="previewing || !preview"><ChevronDown class="size-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-72">
                <DropdownMenuItem @click="cont()"><ScanLine class="size-4" /> Scan all pages (recommended)</DropdownMenuItem>
                <DropdownMenuItem @click="cont({ allPages: false })"><FileStack class="size-4" /> Scan this page only</DropdownMenuItem>
                <DropdownMenuItem :disabled="!results" @click="cont({ append: true })"><PlusSquare class="size-4" /> Add this list to the results (e.g. New after Used)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button v-else variant="outline" class="h-8 gap-1.5" @click="stop"><Square class="size-3.5 fill-current" /> Stop</Button>
        </div>

        <!-- Body -->
        <div class="flex-1 min-h-0 relative">
          <!-- Starting / problems -->
          <div v-if="phase !== 'ready' || (!preview && tab === 'site')" class="absolute inset-0 flex items-center justify-center p-6 bg-[radial-gradient(ellipse_at_top,#27272a,#09090b)] text-white">
            <div v-if="phase === 'checking' || (phase === 'ready' && previewing)" class="text-center space-y-5">
              <div class="relative mx-auto size-20">
                <div class="absolute inset-0 rounded-2xl bg-red-600/20 animate-ping" />
                <div class="relative size-20 rounded-2xl bg-red-600 flex items-center justify-center shadow-2xl shadow-red-600/40"><ScanSearch class="size-9" /></div>
              </div>
              <div>
                <p class="text-lg font-semibold">{{ phase === 'checking' ? 'Preparing the scanner…' : `Opening ${shownUrl || 'the dealership website'}` }}</p>
                <p class="text-sm text-white/60">A private {{ engine === 'serverless' ? 'cloud ' : '' }}browser is loading it at desktop size — the first open can take 10–20 seconds.</p>
              </div>
            </div>
            <div v-else class="max-w-lg rounded-2xl border border-white/10 bg-white/5 p-6 space-y-3 backdrop-blur">
              <div class="flex items-center gap-2 text-amber-400"><AlertTriangle class="size-5" /><p class="font-semibold">{{ phase === 'unavailable' ? 'The scanner is not available on this server' : phase === 'ready' ? 'The website could not be opened' : 'The scanner could not start' }}</p></div>
              <p v-if="phase === 'unavailable'" class="text-sm text-white/80">The scanner drives a headless Chrome. Install Google Chrome on the machine that runs this app (or set <code class="px-1 rounded bg-white/10">SCANNER_CHROME_PATH</code>); on Vercel it runs automatically.</p>
              <p v-else class="text-sm text-white/80">{{ phase === 'ready' ? previewError : failMsg }}</p>
              <div class="flex gap-2 pt-1">
                <Button class="bg-red-600 hover:bg-red-700 text-white" @click="phase === 'ready' ? show(preview?.url, { history: false }) : start()">Try again</Button>
                <Button v-if="phase === 'ready' && lastScan && results" variant="outline" class="bg-transparent text-white border-white/20 hover:bg-white/10" @click="tab = 'results'">Last scan results</Button>
                <Button variant="outline" class="bg-transparent text-white border-white/20 hover:bg-white/10" @click="open = false">Close</Button>
              </div>
            </div>
          </div>

          <!-- Website -->
          <div v-if="phase === 'ready' && preview" v-show="tab === 'site'" class="absolute inset-0 p-3 bg-[radial-gradient(ellipse_at_top,#27272a,#09090b)]">
            <CrmScannerViewport :mode="viewMode" :src="viewSrc" :viewport="{ width: 1440, height: 900 }" :dim="previewing" :hotspots="preview?.hotspots" :page-size="preview ? { width: preview.width, height: preview.height } : undefined" :clickable="!scanning && !previewing" @navigate="show($event)" @hover="hoverHref = $event">
              <template #overlay>
                <div v-if="previewing" class="absolute inset-0 flex items-start justify-center pt-24 pointer-events-none">
                  <div class="rounded-full bg-black/75 text-white text-xs px-4 py-2 backdrop-blur shadow-lg flex items-center gap-2"><Loader2 class="size-4 animate-spin" /> Opening the page…</div>
                </div>
                <!-- Scan sweep -->
                <div v-if="scanning" class="pointer-events-none absolute inset-0 overflow-hidden">
                  <div class="absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-red-500/15 to-transparent animate-[scanner-sweep_2.4s_linear_infinite]" />
                  <div class="absolute inset-0 ring-4 ring-inset ring-red-500/40 rounded-md" />
                </div>
              </template>

              <!-- Coach mark -->
              <div v-if="!scanning && !previewing" class="absolute top-3 left-1/2 -translate-x-1/2 max-w-[92%] rounded-full bg-black/75 text-white text-xs px-4 py-2 backdrop-blur shadow-lg flex items-center gap-2">
                <MousePointerClick class="size-4 text-red-400 shrink-0" />
                <span v-if="detected?.cards">Looks good — <b>{{ detected.cards }} vehicles</b> on this page. Scroll to check, then press <b class="text-red-300">Continue</b>.</span>
                <span v-else-if="preview?.httpStatus && preview.httpStatus >= 400">The site answered <b>HTTP {{ preview.httpStatus }}</b>{{ preview.httpStatus === 429 ? ' (too many requests)' : '' }} — wait a moment and press reload, or open another page.</span>
                <span v-else>Hover the <b>menu</b> on the page below (drop-downs open here too){{ (preview?.navLinks || []).length ? ', use a shortcut' : '' }}, or open <b>Pages</b> — then press <b class="text-red-300">Continue</b>.</span>
              </div>
              <!-- Last scan -->
              <div v-if="lastScan && !scanning && !previewing" class="absolute top-14 left-1/2 -translate-x-1/2 max-w-[92%] rounded-xl border border-white/10 bg-zinc-950/85 text-white text-xs pl-3 pr-1.5 py-1.5 backdrop-blur shadow-lg flex items-center gap-2.5">
                <History class="size-4 text-white/60 shrink-0" />
                <template v-if="lastScan.status === 'running'"><Loader2 class="size-3.5 animate-spin" /> A scan is running ({{ lastScan.progress.vehicles }} vehicles so far)…</template>
                <template v-else-if="lastScan.status === 'interrupted' || lastScan.status === 'failed'"><span class="text-amber-300">Last scan {{ ago(lastScan.createdAt) }} did not finish</span><span class="text-white/50 truncate">{{ lastScan.error || 'it was cut off' }}</span></template>
                <template v-else-if="results">
                  <span>Last scan {{ ago(results.finishedAt || lastScan.createdAt) }}: <b class="tabular-nums">{{ results.summary.total }}</b> vehicles · <b class="tabular-nums text-rose-300">{{ results.summary.withoutReal }}</b> without a real photo ({{ results.summary.withoutRealPct ?? 0 }}%)</span>
                  <span v-if="lastScan.status === 'saved'" class="rounded-full bg-emerald-500/20 text-emerald-300 px-1.5 text-[10px] font-semibold">Saved</span>
                  <Button size="sm" variant="secondary" class="h-7 text-xs" @click="tab = 'results'">View results</Button>
                </template>
              </div>
              <div v-if="error && !scanning" class="absolute top-3 left-1/2 -translate-x-1/2 max-w-[92%] rounded-xl bg-rose-600 text-white text-sm px-4 py-2.5 shadow-lg flex items-center gap-2"><AlertTriangle class="size-4 shrink-0" /> {{ error }}</div>

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
                  <p class="text-[10px] text-white/40">You can keep this window open or close it — closing stops the scan and keeps what it found.</p>
                </div>
              </Transition>
            </CrmScannerViewport>
          </div>

          <!-- Results -->
          <div v-if="phase === 'ready' && tab === 'results' && results" class="absolute inset-0 flex flex-col bg-background">
            <div class="flex-1 min-h-0">
              <CrmScannerResults :results="results" :review="sc.review" :list-rules="sc.listRules" :add-rule="sc.addRule" :remove-rule="sc.removeRule" />
            </div>
            <footer class="shrink-0 border-t bg-card px-3 py-2 flex flex-wrap items-center gap-3">
              <div class="flex items-center gap-3 text-xs text-muted-foreground min-w-0">
                <span class="inline-flex items-center gap-1.5"><span class="size-2 rounded-full" :class="VERDICT_META.missing.dot" />Saves an inventory audit for <b class="text-foreground">{{ dealership.name }}</b>:</span>
                <span class="tabular-nums">{{ results.summary.total }} vehicles · <b class="text-foreground">{{ results.summary.withoutReal }}</b> without a real photo ({{ results.summary.withoutRealPct ?? 0 }}%)</span>
                <span v-if="results.finishedAt" class="hidden md:inline">· scanned {{ ago(results.finishedAt) }}</span>
              </div>
              <div class="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" class="h-8 gap-1.5" @click="tab = 'site'"><MonitorPlay class="size-4" /> Back to website</Button>
                <Button v-if="results.savedAuditId" size="sm" class="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-600/90 text-white" @click="open = false"><CheckCircle2 class="size-4" /> Saved — close</Button>
                <Button v-else size="sm" class="h-8 gap-1.5" :disabled="saving" @click="save"><Loader2 v-if="saving" class="size-4 animate-spin" /><Save v-else class="size-4" /> Save to CRM</Button>
              </div>
            </footer>
          </div>
        </div>

        <!-- Status bar -->
        <div v-if="phase === 'ready'" class="shrink-0 h-6 px-3 border-t bg-muted/40 text-[10px] text-muted-foreground flex items-center gap-3">
          <span class="truncate">{{ preview?.title || shownUrl }}</span>
          <span v-if="hoverHref" class="truncate text-foreground">→ {{ hoverHref }}</span>
          <span v-else-if="preview && !scanning" class="hidden md:inline shrink-0">· links on the page are clickable — the scan itself browses every inventory page for you</span>
          <a v-if="preview?.url" :href="preview.url" target="_blank" rel="noopener" class="ml-auto inline-flex items-center gap-1 hover:text-foreground shrink-0">Open in my browser <ExternalLink class="size-3" /></a>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
@keyframes scanner-load { 0% { transform: translateX(-100%) } 100% { transform: translateX(300%) } }
@keyframes scanner-sweep { 0% { top: -6rem } 100% { top: 100% } }
</style>
