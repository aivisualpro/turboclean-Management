<script setup lang="ts">
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { formatDistanceToNow } from 'date-fns'
import { VERDICT_META } from '~/composables/useInventoryScanner'
import type { ScanPage, ScopeRow } from '~/lib/scanScope'
import { HEALTH_META, SCOPE_META, TONE, checkScanPage, guessPageLabel, normalizeAddress, pagePath, scopeKey } from '~/lib/scanScope'
import {
  ScanSearch, X, ArrowLeft, ArrowRight, RotateCw, Lock, Globe, ChevronDown, Loader2, Square, MonitorPlay, LayoutGrid, CheckCircle2,
  AlertTriangle, Car, Images, ScanLine, Save, ExternalLink, Cloud, FileStack, Sparkles, History, CircleSlash, MousePointerClick, List, Search,
  BookmarkCheck, BookmarkPlus, Wand2, Plus, Trash2, Activity, CircleDashed, CornerUpLeft, ShieldCheck, Ban, PlayCircle, ListChecks, Mail,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * Inventory Crawler — built around the dealership's saved scan pages.
 *
 * The crawler reads the saved scan pages (each inventory list, followed through all of its result
 * pages) and nothing else on the site: never the home page, never a page that is not in the plan.
 *  - Left: the crawl plan — every scan page with its health, live progress while crawling, and the
 *    result per page afterwards. Add a page by address, by detection, or from the page on screen.
 *  - Right: a private cloud browser to look at a scan page (or to browse the site and find the
 *    right inventory page). The bar above it always says whether the page on screen is in the plan.
 */
const props = defineProps<{ dealership: { id: string, name: string, website?: string | null } }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [], /** Email the audit that was just saved (opens the composer on the audit email). */ email: [] }>()

const sc = useInventoryScanner()
const { preview, previewing, previewError, scan, progress, results, frame, error, log, running } = sc
const { updateDealership, fetchDealershipRecord } = useCrmDealerships()
const tab = ref<'site' | 'results'>('site')
const phase = ref<'checking' | 'unavailable' | 'ready' | 'failed'>('checking')
const failMsg = ref('')
const engine = ref<string>('')
const address = ref('')
const editingAddress = ref(false)
const addressInput = ref<HTMLInputElement | null>(null)
function editAddress() {
  editingAddress.value = true
  address.value = preview.value?.url || website.value || ''
  nextTick(() => { addressInput.value?.focus(); addressInput.value?.select() })
}
const ranHere = ref(false)
const elapsed = ref(0)
let clock: ReturnType<typeof setInterval> | null = null

// ── Scan pages (the crawl plan) ──
const pages = ref<ScanPage[]>([])
const website = ref(props.dealership.website || '')
const loadingPages = ref(false)
/** Pages left out of the next crawl (everything else that can be crawled is included). */
const excluded = ref(new Set<string>())
const busyPage = ref<string | null>(null)
const testing = ref(new Set<string>())

interface PlanRow { key: string, url: string, label: string, named: boolean, path: string, ok: boolean, problem: string, problemShort: string, health: ScanPage['health'], live: ScopeRow | null }
/** Per-page state of the crawl run in this window: live while it runs, final afterwards. */
const runScope = computed(() => {
  const list: ScopeRow[] = !ranHere.value ? [] : (running.value ? progress.value?.scope : results.value?.scope || progress.value?.scope) || []
  return new Map(list.map(e => [scopeKey(e.url), e]))
})
const plan = computed<PlanRow[]>(() => pages.value.map((p) => {
  const fit = checkScanPage(p.url)
  const key = scopeKey(p.url) || p.url
  return { key, url: p.url, label: fit.ok ? (p.label || guessPageLabel(p.url)) : (p.label || fit.short), named: !!p.label, path: fit.ok ? pagePath(p.url) : p.url.replace(/^https?:\/\/(www\.)?/, ''), ok: fit.ok, problem: fit.message, problemShort: fit.short, health: p.health || null, live: runScope.value.get(key) || null }
}))
const crawlable = computed(() => plan.value.filter(r => r.ok))
const chosen = computed(() => crawlable.value.filter(r => !excluded.value.has(r.key)))
const unusable = computed(() => plan.value.filter(r => !r.ok))
function toggle(r: PlanRow) { const s = new Set(excluded.value); s.has(r.key) ? s.delete(r.key) : s.add(r.key); excluded.value = s }

async function loadPages() {
  loadingPages.value = true
  try {
    const rec = await fetchDealershipRecord(props.dealership.id)
    pages.value = (rec.dealership.scanPages || []).map(p => ({ ...p }))
    website.value = rec.dealership.website || props.dealership.website || ''
  }
  finally { loadingPages.value = false }
}
async function savePages(next: ScanPage[]) {
  const d = await updateDealership(props.dealership.id, { scanPages: next.map(p => ({ url: p.url, label: p.label })) } as any)
  pages.value = (d.scanPages || []).map(p => ({ ...p }))
}
const failText = (e: any, fallback: string) => e?.data?.message || e?.data?.statusMessage || e?.message || fallback

/** Add an address to the plan (it must be an inventory list — the home page is refused with the reason). */
const draft = ref('')
const draftProblem = computed(() => { const v = draft.value.trim(); if (!v) return ''; const c = checkScanPage(v); return c.ok ? (plan.value.some(r => r.key === scopeKey(v)) ? 'This page is already in the plan' : '') : c.message })
async function addAddress(raw: string, label = '', opts: { show?: boolean } = {}) {
  const url = normalizeAddress(raw)
  const fit = checkScanPage(url || raw)
  if (!url || !fit.ok) { toast.error('Not an inventory page', { description: fit.message }); return false }
  if (plan.value.some(r => r.key === scopeKey(url))) { toast('Already in the crawl plan'); return false }
  busyPage.value = url
  try {
    await savePages([...pages.value, { url, label }])
    toast.success('Added to the crawl plan', { description: `${label || guessPageLabel(url)} · ${pagePath(url)}` })
    if (opts.show !== false) show(url)
    return true
  }
  catch (e: any) { toast.error('Could not add the page', { description: failText(e, 'Try again') }); return false }
  finally { busyPage.value = null }
}
async function addDraft() { if (draft.value.trim() && !draftProblem.value && await addAddress(draft.value)) draft.value = '' }
/** The page on screen → scan page. */
async function addCurrent() {
  const url = preview.value?.url
  if (!url) return
  const label = (preview.value?.navLinks || []).find(l => l.href === url)?.label || (preview.value?.title || '').split(/[|\-–]/)[0]!.trim().slice(0, 60)
  if (await addAddress(url, label, { show: false }) && preview.value?.scope) preview.value = { ...preview.value, scope: { ...preview.value.scope, isScanPage: true, scanPageUrl: url } }
}
async function removePage(r: PlanRow) {
  const before = pages.value.map(p => ({ ...p }))
  busyPage.value = r.url
  try {
    await savePages(before.filter(p => p.url !== r.url))
    toast('Removed from the crawl plan', { description: `${r.label} · ${r.path}`, action: { label: 'Undo', onClick: () => { savePages(before).catch(() => toast.error('Could not put it back')) } } })
  }
  catch (e: any) { toast.error('Could not remove the page', { description: failText(e, 'Try again') }) }
  finally { busyPage.value = null }
}
/** Open one scan page in the cloud browser and record what is really on it. */
async function testPage(r: PlanRow) {
  if (testing.value.has(r.key)) return
  testing.value = new Set(testing.value).add(r.key)
  try {
    const res = await $fetch<{ url: string, health: NonNullable<ScanPage['health']> }>('/api/scanner/check-page', { method: 'POST', body: { dealershipId: props.dealership.id, url: r.url } })
    pages.value = pages.value.map(p => p.url === r.url ? { ...p, health: res.health } : p)
    const m = HEALTH_META[res.health.status]
    toast[m.tone === 'ok' ? 'success' : 'warning'](`${r.label}: ${m.label.toLowerCase()}`, { description: res.health.status === 'ok' ? `${res.health.vehicles} vehicles on the first page${res.health.advertised ? ` · ${res.health.advertised} listed` : ''}` : res.health.note })
  }
  catch (e: any) { toast.error('Could not test the page', { description: failText(e, 'Try again') }) }
  finally { const s = new Set(testing.value); s.delete(r.key); testing.value = s }
}
/** Find the inventory pages automatically: verified ones are added to the plan. */
const detecting = ref(false)
const detectNote = ref('')
const detectLog = ref<string[]>([])
async function detect() {
  if (detecting.value) return
  if (!website.value) return toast.error('This dealership has no website', { description: 'Add the website on the dealership first, or paste an inventory page address.' })
  detecting.value = true
  detectNote.value = 'Reading the site\'s menus and opening each candidate — 20 to 60 seconds…'
  detectLog.value = []
  try {
    const r = await $fetch<any>('/api/scanner/discover', { method: 'POST', body: { dealershipId: props.dealership.id, save: 'merge' } })
    detectLog.value = r.log || []
    const found: any[] = r.pages || []
    if (r.saved) pages.value = r.saved
    else await loadPages()
    detectNote.value = found.length
      ? `${found.length} inventory page${found.length === 1 ? '' : 's'} verified · ${found.reduce((n, f) => n + (f.total || f.cards || 0), 0)} vehicles`
      : 'No page with vehicle listings was found. Browse the site on the right, open the inventory list and add it.'
    if (found.length) { toast.success(detectNote.value); if (!preview.value?.scope?.isScanPage && crawlable.value[0]) show(crawlable.value[0].url) }
    else toast.warning('No inventory pages found automatically', { description: 'Open the inventory list on the right and press “Add as scan page”.' })
  }
  catch (e: any) { detectNote.value = ''; toast.error('Could not read the website', { description: failText(e, 'Try again') }) }
  finally { detecting.value = false }
}

// Simple history of the pages looked at in this window (Back / Forward).
const visited = ref<string[]>([])
const at = ref(-1)

async function start() {
  phase.value = 'checking'
  failMsg.value = ''
  tab.value = 'site'
  ranHere.value = false
  visited.value = []; at.value = -1
  excluded.value = new Set()
  draft.value = ''; detectNote.value = ''; detectLog.value = []
  sc.reset()
  try {
    const [st] = await Promise.all([sc.status(), loadPages()])
    engine.value = st.kind
    if (!st.ok) { phase.value = 'unavailable'; return }
    phase.value = 'ready'
    sc.loadLatest(props.dealership.id).catch(() => {})
    // Open on the first scan page — the website's home page is only shown when there is nothing to crawl yet.
    await show(crawlable.value[0]?.url)
  } catch (e: any) { phase.value = 'failed'; failMsg.value = failText(e, 'Could not start the crawler') }
}
watch(open, (v) => { if (v) start(); else { sc.dispose(); stopClock() } }, { immediate: true })

/** Open a page in the cloud browser and show its snapshot (looking only — nothing is crawled). */
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
const shownUrl = computed(() => (preview.value?.url || website.value || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))
const secure = computed(() => (preview.value?.url || website.value || '').startsWith('https://'))
function submitAddress() {
  editingAddress.value = false
  const v = address.value.trim()
  if (v && v !== preview.value?.url) show(v)
}
/** Where the page on screen stands: in the plan, addable, or never crawlable (home page, one vehicle's page). */
const onScreen = computed(() => {
  const p = preview.value
  if (!p) return null
  const row = plan.value.find(r => r.ok && (r.key === scopeKey(p.url) || (!!p.scope?.scanPageUrl && r.url === p.scope.scanPageUrl))) || null
  const fit = checkScanPage(p.url)
  return { row, inPlan: !!row, canAdd: !row && fit.ok, problem: fit.ok ? '' : fit.message, problemShort: fit.short }
})

// ── Crawl ──
const scanning = computed(() => running.value)
watch(scanning, (v) => { v ? startClock() : stopClock() })
function startClock() { stopClock(); const t0 = Date.now(); elapsed.value = 0; clock = setInterval(() => { elapsed.value = Math.round((Date.now() - t0) / 1000) }, 1000) }
function stopClock() { if (clock) clearInterval(clock); clock = null }
onBeforeUnmount(stopClock)

/** A stopped crawl (blocked, paused, cut off) can be continued: finished lists are kept, the rest is read. */
const canResume = computed(() => !scanning.value && scan.value?.status === 'stopped' && !!results.value)
async function crawl(opts: { allPages?: boolean, resume?: boolean } = {}) {
  const urls = chosen.value.map(r => r.url)
  if (!urls.length) return toast.error('Nothing to crawl yet', { description: crawlable.value.length ? 'Tick at least one scan page.' : 'Add the dealership\'s inventory pages first — the crawler only reads saved scan pages.' })
  ranHere.value = true
  tab.value = 'site'
  try {
    await sc.run(props.dealership.id, { urls, allPages: opts.allPages !== false, appendTo: opts.resume ? (results.value?.scanId || scan.value?.id) : null })
    if (!open.value) return
    // Every crawl records how each scan page did — refresh the health badges.
    loadPages().catch(() => {})
    if (results.value) {
      tab.value = 'results'
      const cut = scan.value?.status === 'stopped' && /cut off/i.test(progress.value?.message || '')
      const off = (results.value.scope || []).filter(e => ['bad', 'warn'].includes(SCOPE_META[e.status]?.tone || ''))
      const numbers = `${results.value.summary.total} vehicles · ${results.value.summary.withoutReal} without a real photo (${results.value.summary.withoutRealPct ?? 0}%)`
      if (cut) toast.warning('Crawl was cut off — showing what it found', { description: numbers })
      else if (off.length) toast.warning(`Crawl complete — ${off.length} scan page${off.length === 1 ? ' needs' : 's need'} attention`, { description: `${numbers}. See “Scope” above the results.` })
      else toast.success('Crawl complete', { description: numbers })
    }
    else if (error.value) toast.error('Nothing was read', { description: error.value })
    else toast.error(progress.value?.message || 'The crawl ended without results')
  } catch (e: any) { toast.error('The crawl could not start', { description: e?.message || 'Try again' }) }
}
async function stop() { await sc.stop(); toast('Stopping…', { description: 'The photos found so far are still checked and kept.' }) }

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    const r = await sc.save()
    toast.success('Saved to the CRM', { description: `Inventory audit recorded — ${r.summary.withoutReal} of ${r.summary.total} vehicles without a real photo (${r.summary.withoutRealPct ?? 0}%).` })
    emit('saved')
  } catch (e: any) { toast.error(failText(e, 'Could not save')) } finally { saving.value = false }
}
function emailAudit() { open.value = false; emit('email') }
function closeDialog() {
  if (scanning.value && !confirm('A crawl is running. Close the crawler and stop it? What it found so far is still checked and kept.')) return
  if (ranHere.value && results.value && !results.value.savedAuditId && !confirm('These results are not saved to the CRM yet. Close anyway? (You can reopen them from “Last crawl”.)')) return
  open.value = false
}

// ── Presentation ──
const livePage = computed(() => (progress.value?.scope || []).find(e => e.status === 'running') || null)
const livePos = computed(() => { const sc2 = progress.value?.scope || []; const i = sc2.findIndex(e => e.status === 'running'); return i >= 0 ? `Scan page ${i + 1} of ${sc2.length}` : '' })
const steps = computed(() => {
  const p = progress.value
  const ph = p?.phase || 'collecting'
  const order = ['collecting', 'analyzing', 'done']
  const idx = ph === 'stopped' ? 2 : Math.max(0, order.indexOf(ph))
  return [
    { key: 'collecting', label: 'Read the scan pages', icon: Car, detail: p ? `${p.vehicles} vehicles${livePos.value ? ` · ${livePos.value.toLowerCase()}` : ''}` : '' },
    { key: 'analyzing', label: 'Check every photo', icon: Images, detail: p && p.toAnalyze ? `${p.analyzed} of ${p.toAnalyze}` : 'Waiting' },
    { key: 'done', label: 'Ready to review', icon: CheckCircle2, detail: '' },
  ].map((s, i) => ({ ...s, state: i < idx ? 'done' : i === idx ? 'active' : 'todo' }))
})
const pctDone = computed(() => {
  const p = progress.value
  if (!p) return 0
  if (p.phase === 'analyzing') return 55 + Math.round((p.analyzed / Math.max(1, p.toAnalyze)) * 45)
  if (p.phase === 'collecting') {
    const list = p.scope || []
    if (!list.length) return Math.min(50, 4 + p.page * 6)
    // Each scan page is an equal share; the one being read counts by vehicles collected.
    const part = list.reduce((n, e) => n + (e.status === 'running' ? (e.advertised ? Math.min(0.95, e.vehicles / e.advertised) : Math.min(0.8, e.resultPages * 0.2)) : e.status === 'pending' ? 0 : 1), 0)
    return Math.max(3, Math.round((part / list.length) * 55))
  }
  return 100
})
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const lastLog = computed(() => log.value[log.value.length - 1]?.text || '')
const kindIcon = (k: string) => k === 'used' || k === 'certified' ? Car : k === 'new' ? Sparkles : Globe
const ago = (iso?: string | null) => { try { return iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : '' } catch { return '' } }
const LIVE_ICON: Record<string, any> = { pending: CircleDashed, running: Loader2, done: CheckCircle2, stuck: AlertTriangle, blocked: AlertTriangle, skipped: CircleDashed, empty: CircleSlash, redirected: CornerUpLeft, error: AlertTriangle }
/** One line under a scan page: live progress, the result of this crawl, or its health. */
function rowLine(r: PlanRow): { text: string, tone: keyof typeof TONE } {
  if (!r.ok) return { text: 'Not an inventory list, so it is never crawled. Remove it, then detect or add the page that lists the vehicles.', tone: 'bad' }
  const e = r.live
  if (e) {
    const m = SCOPE_META[e.status] || SCOPE_META.pending
    const of = e.advertised ? ` of ${e.advertised}` : ''
    if (e.status === 'running') return { text: `Reading result page ${e.resultPages + 1} · ${e.vehicles}${of} vehicles`, tone: 'live' }
    if (e.status === 'pending') return { text: 'Waiting for its turn', tone: 'idle' }
    if (e.status === 'done') return { text: e.note || `${e.vehicles} vehicles${e.resultPages > 1 ? ` · ${e.resultPages} result pages` : ''}${e.withoutRealPct != null && e.vehicles ? ` · ${e.withoutRealPct}% without a real photo` : ''}`, tone: 'ok' }
    return { text: `${m.label}${e.vehicles ? ` · ${e.vehicles}${of} vehicles kept` : ''}${e.note ? ` — ${e.note}` : ''}`, tone: m.tone }
  }
  if (scanning.value) return { text: 'Not part of this crawl', tone: 'idle' }
  const h = r.health
  if (!h) return { text: 'Not tested yet', tone: 'idle' }
  const m = HEALTH_META[h.status] || HEALTH_META.ok
  if (h.status === 'ok') return { text: `${m.label} · ${h.advertised || h.vehicles} vehicles · ${ago(h.at)}`, tone: 'ok' }
  return { text: `${HEALTH_LINE[h.status] || m.label} · ${ago(h.at)}`, tone: m.tone }
}
const HEALTH_LINE: Record<string, string> = { empty: 'No vehicles found on it', redirected: 'Forwards to the home page', blocked: 'The site refused the last visit', error: 'Could not be opened' }
/** The longer explanation, as a tooltip. */
const rowHint = (r: PlanRow) => r.live?.note || (!r.live && r.health?.note) || r.problem || `Look at ${r.url}`
const rowPct = (r: PlanRow) => r.live?.status === 'running' ? (r.live.advertised ? Math.min(100, Math.round((r.live.vehicles / r.live.advertised) * 100)) : null) : null

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
/** The previous crawl, offered when nothing has been run in this window yet. */
const lastScan = computed(() => !ranHere.value && !scanning.value ? scan.value : null)
const engineLabel = computed(() => engine.value === 'serverless' ? 'Cloud Chrome' : engine.value === 'remote' ? 'Hosted Chrome' : 'Private Chrome')
const crawlLabel = computed(() => chosen.value.length ? `Crawl ${chosen.value.length} scan page${chosen.value.length === 1 ? '' : 's'}` : 'Crawl')
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
            <span class="size-8 shrink-0 rounded-lg bg-red-600 text-white flex items-center justify-center shadow-sm shadow-red-600/30"><ScanSearch class="size-4.5" /></span>
            <div class="min-w-0 leading-tight">
              <DialogTitle class="text-sm font-semibold truncate">Inventory Crawler</DialogTitle>
              <DialogDescription class="text-[11px] text-muted-foreground truncate">{{ dealership.name }}</DialogDescription>
            </div>
          </div>
          <div v-if="phase === 'ready'" role="tablist" class="sm:ml-4 inline-flex shrink-0 rounded-lg border bg-muted/40 p-0.5">
            <button type="button" role="tab" :aria-selected="tab === 'site'" class="rounded-md px-3 py-1 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap" :class="tab === 'site' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'" @click="tab = 'site'"><ListChecks class="size-3.5" /> Crawl plan</button>
            <button type="button" role="tab" :aria-selected="tab === 'results'" :disabled="!results" class="rounded-md px-3 py-1 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40" :class="tab === 'results' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'" @click="tab = 'results'">
              <LayoutGrid class="size-3.5" /> Results <span v-if="results" class="rounded-full px-1.5 text-[10px] tabular-nums bg-background/80 text-foreground">{{ results.summary.total }}</span>
            </button>
          </div>
          <div class="ml-auto flex items-center gap-2">
            <span v-if="phase === 'ready'" class="hidden md:inline-flex items-center gap-1.5 rounded-full px-2 h-6 text-[11px] font-medium" :class="TONE.ok.soft" title="The crawler reads the saved scan pages and their result pages. It never starts from the home page and never follows a link out of a list."><ShieldCheck class="size-3.5" /> Scan pages only</span>
            <span v-if="phase === 'ready'" class="hidden lg:inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><Cloud class="size-3.5" /> {{ engineLabel }} · 1440×900</span>
            <Button variant="ghost" size="icon" class="size-8" aria-label="Close the crawler" @click="closeDialog"><X class="size-4" /></Button>
          </div>
        </header>

        <!-- Body -->
        <div class="flex-1 min-h-0 relative">
          <!-- Starting / problems -->
          <div v-if="phase !== 'ready'" class="absolute inset-0 flex items-center justify-center p-6 bg-[radial-gradient(ellipse_at_top,#27272a,#09090b)] text-white">
            <div v-if="phase === 'checking'" class="text-center space-y-5">
              <div class="relative mx-auto size-20">
                <div class="absolute inset-0 rounded-2xl bg-red-600/20 animate-ping" />
                <div class="relative size-20 rounded-2xl bg-red-600 flex items-center justify-center shadow-2xl shadow-red-600/40"><ScanSearch class="size-9" /></div>
              </div>
              <div>
                <p class="text-lg font-semibold">Preparing the crawler…</p>
                <p class="text-sm text-white/70">Loading {{ dealership.name }}'s scan pages and a private browser.</p>
              </div>
            </div>
            <div v-else class="max-w-lg rounded-2xl border border-white/10 bg-white/5 p-6 space-y-3">
              <div class="flex items-center gap-2 text-amber-400"><AlertTriangle class="size-5" /><p class="font-semibold">{{ phase === 'unavailable' ? 'The crawler is not available on this server' : 'The crawler could not start' }}</p></div>
              <p v-if="phase === 'unavailable'" class="text-sm text-white/80">The crawler drives a headless Chrome. Install Google Chrome on the machine that runs this app (or set <code class="px-1 rounded bg-white/10">SCANNER_CHROME_PATH</code>); on Vercel it runs automatically.</p>
              <p v-else class="text-sm text-white/80">{{ failMsg }}</p>
              <div class="flex gap-2 pt-1">
                <Button class="bg-red-600 hover:bg-red-700 text-white" @click="start()">Try again</Button>
                <Button variant="outline" class="bg-transparent text-white border-white/20 hover:bg-white/10" @click="open = false">Close</Button>
              </div>
            </div>
          </div>

          <!-- Crawl plan + browser -->
          <div v-if="phase === 'ready'" v-show="tab === 'site'" class="absolute inset-0 flex flex-col lg:flex-row">
            <!-- ── The crawl plan ── -->
            <aside class="shrink-0 w-full lg:w-[348px] max-h-[58%] lg:max-h-none flex flex-col border-b lg:border-b-0 lg:border-r bg-card" aria-label="Scan pages">
              <div class="shrink-0 px-3 pt-3 pb-2">
                <div class="flex items-baseline justify-between gap-2">
                  <h2 class="text-sm font-semibold">Scan pages</h2>
                  <span class="text-[11px] tabular-nums text-muted-foreground">{{ crawlable.length ? `${chosen.length} of ${crawlable.length} in this crawl` : 'none yet' }}</span>
                </div>
                <p class="mt-0.5 hidden sm:block text-[11px] leading-snug text-muted-foreground">The crawler reads these inventory lists, every result page of each — and nothing else on the site.</p>
              </div>

              <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
                <!-- Loading -->
                <ul v-if="loadingPages && !pages.length" class="space-y-1.5" aria-hidden="true">
                  <li v-for="i in 3" :key="i" class="rounded-lg border p-2"><div class="h-3.5 w-2/5 rounded bg-muted animate-pulse" /><div class="mt-1.5 h-3 w-4/5 rounded bg-muted/70 animate-pulse" /></li>
                </ul>

                <!-- Nothing to crawl yet -->
                <div v-else-if="!plan.length" class="rounded-xl border-2 border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-2">
                  <p class="text-sm font-semibold text-foreground">No scan pages yet</p>
                  <p class="text-muted-foreground leading-relaxed">Nothing is crawled until you say which pages list the vehicles. Two ways to add them:</p>
                  <ol class="space-y-1.5 text-muted-foreground leading-relaxed list-decimal pl-4">
                    <li><b class="text-foreground">Detect</b> — the crawler reads the site's menus and keeps only pages that really list vehicles.</li>
                    <li><b class="text-foreground">Browse</b> — open the inventory list on the right (menu or “Site menu”), then press <b class="text-foreground">Add as scan page</b>.</li>
                  </ol>
                </div>

                <ul v-else class="space-y-1.5">
                  <li
                    v-for="r in plan" :key="r.key"
                    class="group rounded-lg border bg-background transition-colors"
                    :class="[onScreen?.row?.key === r.key && 'border-primary ring-1 ring-primary', !r.ok && 'border-rose-500/40 bg-rose-500/5', r.live?.status === 'running' && 'border-red-500/50']"
                  >
                    <div class="flex items-start gap-2 p-2">
                      <!-- Include in this crawl / live status -->
                      <span v-if="r.live" class="mt-0.5 size-4 shrink-0 flex items-center justify-center" :class="TONE[SCOPE_META[r.live.status]?.tone || 'idle'].text" :title="SCOPE_META[r.live.status]?.label">
                        <component :is="LIVE_ICON[r.live.status] || CircleDashed" class="size-4" :class="r.live.status === 'running' && 'animate-spin'" />
                      </span>
                      <Ban v-else-if="!r.ok" class="mt-0.5 size-4 shrink-0 text-rose-600" />
                      <input v-else type="checkbox" class="mt-0.5 size-4 shrink-0 accent-primary cursor-pointer disabled:cursor-default" :checked="!excluded.has(r.key)" :disabled="scanning" :aria-label="`Include ${r.label} in this crawl`" @change="toggle(r)">

                      <button type="button" class="min-w-0 flex-1 text-left disabled:cursor-default" :disabled="scanning || previewing" :title="rowHint(r)" @click="show(r.url)">
                        <p class="text-[13px] font-medium leading-tight truncate" :class="!r.ok && 'text-rose-700 dark:text-rose-300'">{{ r.label }}</p>
                        <p class="text-[11px] text-muted-foreground truncate">{{ r.path }}</p>
                        <p class="mt-1 text-[11px] leading-snug" :class="[TONE[rowLine(r).tone].text, r.ok && 'line-clamp-2']">{{ rowLine(r).text }}</p>
                        <div v-if="r.live?.status === 'running'" class="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                          <div v-if="rowPct(r) != null" class="h-full rounded-full bg-red-500 transition-[width] duration-500" :style="{ width: `${rowPct(r)}%` }" />
                          <div v-else class="h-full w-1/3 rounded-full bg-red-500 animate-[scanner-load_1.1s_ease-in-out_infinite]" />
                        </div>
                      </button>

                      <div v-if="!scanning" class="flex shrink-0 items-center opacity-70 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                        <Button v-if="r.ok" variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-foreground" :disabled="testing.has(r.key)" :aria-label="`Test ${r.label}`" title="Test this page — opens it and counts the vehicles" @click="testPage(r)">
                          <Loader2 v-if="testing.has(r.key)" class="size-3.5 animate-spin" /><Activity v-else class="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-rose-600" :disabled="busyPage === r.url" :aria-label="`Remove ${r.label} from the crawl plan`" title="Remove from the crawl plan" @click="removePage(r)">
                          <Loader2 v-if="busyPage === r.url" class="size-3.5 animate-spin" /><Trash2 v-else class="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </li>
                </ul>

                <p v-if="unusable.length && crawlable.length" class="mt-2 rounded-md px-2 py-1.5 text-[11px] leading-snug" :class="TONE.bad.soft">
                  {{ unusable.length }} saved address{{ unusable.length === 1 ? ' is' : 'es are' }} not an inventory list and {{ unusable.length === 1 ? 'is' : 'are' }} never crawled.
                </p>
              </div>

              <!-- Add pages -->
              <div v-if="!scanning" class="shrink-0 border-t px-2 py-2 space-y-1.5">
                <form class="flex items-center gap-1.5" @submit.prevent="addDraft">
                  <Input v-model="draft" class="h-8 text-xs" placeholder="Paste an inventory page address" aria-label="Inventory page address" spellcheck="false" :aria-invalid="!!draftProblem" @keydown.esc.stop="draft = ''" />
                  <Button type="submit" variant="outline" size="sm" class="h-8 shrink-0 gap-1" :disabled="!draft.trim() || !!draftProblem || !!busyPage"><Plus class="size-3.5" /> Add</Button>
                </form>
                <p v-if="draftProblem" class="text-[11px] leading-snug text-rose-600 dark:text-rose-400" role="alert">{{ draftProblem }}</p>
                <Button :variant="crawlable.length ? 'outline' : 'default'" size="sm" class="w-full h-8 gap-1.5 text-xs" :disabled="detecting || !website" :title="website ? 'Reads the site\'s menus and keeps only pages that really list vehicles' : 'This dealership has no website'" @click="detect">
                  <Loader2 v-if="detecting" class="size-3.5 animate-spin" /><Wand2 v-else class="size-3.5" /> {{ detecting ? 'Detecting…' : 'Detect inventory pages' }}
                </Button>
                <p v-if="detectNote" class="text-[11px] leading-snug text-muted-foreground">{{ detectNote }}</p>
                <details v-if="detectLog.length && !detecting" class="text-[11px] text-muted-foreground"><summary class="cursor-pointer hover:text-foreground">What was checked</summary><pre class="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] leading-4">{{ detectLog.join('\n') }}</pre></details>
              </div>

              <!-- Primary action -->
              <div class="shrink-0 border-t bg-muted/30 p-2 space-y-1.5">
                <div v-if="!scanning" class="flex">
                  <Button class="flex-1 h-10 rounded-r-none bg-red-600 hover:bg-red-700 text-white gap-2 shadow-sm shadow-red-600/30 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none" :disabled="!chosen.length || previewing && !preview" @click="crawl()"><ScanLine class="size-4" /> {{ crawlLabel }}</Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child><Button class="h-10 w-9 px-0 rounded-l-none border-l border-red-800/40 bg-red-600 hover:bg-red-700 text-white disabled:bg-muted disabled:text-muted-foreground" aria-label="More crawl options" :disabled="!chosen.length"><ChevronDown class="size-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-80">
                      <DropdownMenuItem @click="crawl()"><ScanLine class="size-4" /> Crawl every result page (recommended)</DropdownMenuItem>
                      <DropdownMenuItem @click="crawl({ allPages: false })"><FileStack class="size-4" /> Quick test — first result page of each list</DropdownMenuItem>
                      <DropdownMenuItem :disabled="!canResume" @click="crawl({ resume: true })"><PlayCircle class="size-4" /> Continue the last crawl (keeps what it found)</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <Button v-else variant="outline" class="w-full h-10 gap-2" @click="stop"><Square class="size-3.5 fill-current" /> Stop — keep what was found <span class="ml-auto tabular-nums text-muted-foreground">{{ mmss(elapsed) }}</span></Button>
                <p class="hidden sm:block text-[11px] leading-snug text-muted-foreground" :class="scanning && '!block'">
                  <template v-if="scanning">{{ livePos || 'Starting' }}{{ livePage ? ` · ${livePage.label || pagePath(livePage.url)}` : '' }}</template>
                  <template v-else-if="chosen.length">Only the ticked pages are opened. A “next” link that leaves a list is not followed.</template>
                  <template v-else-if="crawlable.length">Tick at least one scan page to crawl.</template>
                  <template v-else>Add a scan page to enable the crawl.</template>
                </p>
              </div>
            </aside>

            <!-- ── The browser ── -->
            <div class="flex-1 min-w-0 min-h-0 flex flex-col">
              <div class="shrink-0 flex items-center gap-2 px-2 py-1.5 border-b bg-muted/30">
                <div class="flex items-center">
                  <Button variant="ghost" size="icon" class="size-8" aria-label="Back" :disabled="!canBack || scanning || previewing" @click="back"><ArrowLeft class="size-4" /></Button>
                  <Button variant="ghost" size="icon" class="size-8" aria-label="Forward" :disabled="!canForward || scanning || previewing" @click="forward"><ArrowRight class="size-4" /></Button>
                  <Button variant="ghost" size="icon" class="size-8" aria-label="Reload" :disabled="scanning || previewing" @click="reload"><RotateCw class="size-4" :class="previewing && 'animate-spin'" /></Button>
                </div>
                <form class="flex-1 min-w-0" @submit.prevent="submitAddress">
                  <div class="relative flex items-center h-8 rounded-full border bg-background px-3 gap-2 focus-within:ring-2 focus-within:ring-primary/40">
                    <Lock v-if="secure" class="size-3.5 text-emerald-600 shrink-0" /><Globe v-else class="size-3.5 text-muted-foreground shrink-0" />
                    <input v-if="editingAddress" ref="addressInput" v-model="address" class="flex-1 min-w-0 bg-transparent text-xs outline-none" spellcheck="false" aria-label="Web address" placeholder="Type or paste a page address and press Enter" @blur="submitAddress" @keydown.esc.stop="editingAddress = false">
                    <button v-else type="button" class="flex-1 min-w-0 text-left text-xs truncate" :disabled="scanning" title="Look at another page (looking never crawls)" @click="editAddress">{{ shownUrl || 'Loading…' }}</button>
                    <div v-if="previewing" class="absolute left-3 right-3 bottom-0 h-0.5 overflow-hidden rounded-full"><div class="h-full w-1/3 bg-primary animate-[scanner-load_1.1s_ease-in-out_infinite]" /></div>
                  </div>
                </form>

                <!-- Is the page on screen in the crawl plan? -->
                <template v-if="onScreen && !scanning && !previewing">
                  <span v-if="onScreen.inPlan" class="inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-[11px] font-semibold shrink-0" :class="TONE.ok.soft" title="This page is a saved scan page — it is read when you crawl"><BookmarkCheck class="size-3.5" /> <span class="hidden md:inline">In the crawl plan</span></span>
                  <span v-else-if="!onScreen.canAdd" class="inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-[11px] font-semibold shrink-0" :class="TONE.bad.soft" :title="onScreen.problem"><Ban class="size-3.5" /> <span class="hidden md:inline">{{ onScreen.problemShort }} — never crawled</span></span>
                  <template v-else>
                    <span class="hidden xl:inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-[11px] font-semibold shrink-0" :class="TONE.warn.soft" title="The crawler only reads saved scan pages. This page is not one of them."><CircleSlash class="size-3.5" /> Not in the crawl plan</span>
                    <Button size="sm" class="h-8 gap-1.5 text-xs shrink-0" :disabled="!!busyPage" title="Save this page as a scan page so the crawler reads it" @click="addCurrent"><Loader2 v-if="busyPage" class="size-3.5 animate-spin" /><BookmarkPlus v-else class="size-3.5" /> Add as scan page</Button>
                  </template>
                </template>

                <DropdownMenu v-if="preview?.pages?.length" @update:open="(o: boolean) => { if (!o) pageQuery = '' }">
                  <DropdownMenuTrigger as-child><Button variant="outline" class="h-8 gap-1.5 text-xs shrink-0" :disabled="scanning || previewing" title="Every page linked from this site's menus — use it to find the inventory lists"><List class="size-3.5" /> <span class="hidden md:inline">Site menu</span> <span class="text-muted-foreground tabular-nums">{{ preview.pages.length }}</span></Button></DropdownMenuTrigger>
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
                <span v-if="scanning" class="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 px-2.5 h-7 text-[11px] font-semibold shrink-0"><span class="relative flex size-2"><span class="absolute inline-flex size-full rounded-full bg-red-500 opacity-60 animate-ping" /><span class="relative inline-flex size-2 rounded-full bg-red-500" /></span> CRAWLING</span>
              </div>

              <div class="flex-1 min-h-0 relative bg-[radial-gradient(ellipse_at_top,#27272a,#09090b)]">
                <!-- Opening the first page / it could not be opened -->
                <div v-if="!preview" class="absolute inset-0 flex items-center justify-center p-6 text-white">
                  <div v-if="previewing" class="text-center space-y-3">
                    <Loader2 class="mx-auto size-7 animate-spin text-white/70" />
                    <p class="text-sm font-medium">Opening {{ shownUrl || 'the page' }}</p>
                    <p class="text-xs text-white/60">A private browser loads it at desktop size — the first open can take 10–20 seconds.</p>
                  </div>
                  <div v-else class="max-w-md rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
                    <div class="flex items-center gap-2 text-amber-400"><AlertTriangle class="size-5" /><p class="font-semibold">{{ previewError ? 'The page could not be opened' : 'Nothing to show yet' }}</p></div>
                    <p class="text-sm text-white/80">{{ previewError || 'Add a scan page on the left, or paste a page address in the bar above.' }}</p>
                    <div class="flex gap-2">
                      <Button v-if="previewError" class="bg-red-600 hover:bg-red-700 text-white" @click="show(crawlable[0]?.url)">Try again</Button>
                      <Button v-if="lastScan && results" variant="outline" class="bg-transparent text-white border-white/20 hover:bg-white/10" @click="tab = 'results'">Last crawl results</Button>
                    </div>
                  </div>
                </div>

                <div v-else class="absolute inset-0 p-3">
                  <CrmScannerViewport :mode="viewMode" :src="viewSrc" :viewport="{ width: 1440, height: 900 }" :dim="previewing" :hotspots="preview?.hotspots" :page-size="preview ? { width: preview.width, height: preview.height } : undefined" :clickable="!scanning && !previewing" @navigate="show($event)" @hover="hoverHref = $event">
                    <template #overlay>
                      <div v-if="previewing" class="absolute inset-0 flex items-start justify-center pt-24 pointer-events-none">
                        <div class="rounded-full bg-black/80 text-white text-xs px-4 py-2 shadow-lg flex items-center gap-2"><Loader2 class="size-4 animate-spin" /> Opening the page…</div>
                      </div>
                      <!-- Crawl sweep -->
                      <div v-if="scanning" class="pointer-events-none absolute inset-0 overflow-hidden">
                        <div class="absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-red-500/15 to-transparent animate-[scanner-sweep_2.4s_linear_infinite]" />
                        <div class="absolute inset-0 ring-4 ring-inset ring-red-500/40 rounded-md" />
                      </div>
                    </template>

                    <!-- What this page means for the crawl -->
                    <div v-if="!scanning && !previewing && !error && onScreen" class="absolute top-3 left-1/2 -translate-x-1/2 max-w-[92%] rounded-full bg-black/80 text-white text-xs px-4 py-2 shadow-lg flex items-center gap-2">
                      <template v-if="preview?.httpStatus && preview.httpStatus >= 400">
                        <AlertTriangle class="size-4 text-amber-400 shrink-0" />
                        <span>The site answered <b>HTTP {{ preview.httpStatus }}</b>{{ preview.httpStatus === 429 ? ' (too many requests)' : preview.httpStatus === 403 ? ' (it refused this visit)' : '' }} — wait a moment and press reload.</span>
                      </template>
                      <template v-else-if="onScreen.inPlan">
                        <BookmarkCheck class="size-4 text-emerald-400 shrink-0" />
                        <span v-if="detected?.cards">Scan page <b>{{ onScreen.row?.label }}</b> — <b>{{ detected.cards }} vehicles</b> on its first page<template v-if="detected.advertised">, {{ detected.advertised }} listed</template>.</span>
                        <span v-else>Scan page <b>{{ onScreen.row?.label }}</b> shows <b class="text-amber-300">no vehicles</b> right now — check it is the page that lists them.</span>
                      </template>
                      <template v-else-if="!onScreen.canAdd">
                        <Ban class="size-4 text-rose-400 shrink-0" />
                        <span><b>{{ onScreen.problemShort }}</b> — the crawler never reads it. Open the inventory list (the menu below works, or <b>Site menu</b>).</span>
                      </template>
                      <template v-else>
                        <MousePointerClick class="size-4 text-amber-300 shrink-0" />
                        <span v-if="detected?.cards"><b>{{ detected.cards }} vehicles</b> here, but this page is <b class="text-amber-300">not in the crawl plan</b>. Press <b>Add as scan page</b> to include it.</span>
                        <span v-else>Not in the crawl plan, and no vehicles on it. Open the inventory list, then press <b>Add as scan page</b>.</span>
                      </template>
                    </div>
                    <!-- Last crawl -->
                    <div v-if="lastScan && !scanning && !previewing" class="absolute top-14 left-1/2 -translate-x-1/2 max-w-[92%] rounded-xl border border-white/10 bg-zinc-950/90 text-white text-xs pl-3 pr-1.5 py-1.5 shadow-lg flex items-center gap-2.5">
                      <History class="size-4 text-white/60 shrink-0" />
                      <template v-if="lastScan.status === 'running'"><Loader2 class="size-3.5 animate-spin" /> A crawl is running ({{ lastScan.progress.vehicles }} vehicles so far)…</template>
                      <template v-else-if="lastScan.status === 'interrupted' || lastScan.status === 'failed'"><span class="text-amber-300 shrink-0">Last crawl {{ ago(lastScan.createdAt) }} did not finish</span><span class="text-white/60 truncate">{{ lastScan.error || 'it was cut off' }}</span></template>
                      <template v-else-if="results">
                        <span>Last crawl {{ ago(results.finishedAt || lastScan.createdAt) }}: <b class="tabular-nums">{{ results.summary.total }}</b> vehicles · <b class="tabular-nums text-rose-300">{{ results.summary.withoutReal }}</b> without a real photo ({{ results.summary.withoutRealPct ?? 0 }}%)</span>
                        <span v-if="lastScan.status === 'saved'" class="rounded-full bg-emerald-500/20 text-emerald-300 px-1.5 text-[10px] font-semibold">Saved</span>
                        <Button size="sm" variant="secondary" class="h-7 text-xs" @click="tab = 'results'">View results</Button>
                      </template>
                    </div>
                    <div v-if="error && !scanning" class="absolute top-3 left-1/2 -translate-x-1/2 w-[min(640px,92%)] rounded-xl bg-rose-600 text-white text-sm px-4 py-2.5 shadow-lg flex items-start gap-2" role="alert"><AlertTriangle class="size-4 shrink-0 mt-0.5" /> <span>{{ error }}</span></div>

                    <!-- Crawl progress -->
                    <Transition enter-from-class="opacity-0 translate-y-4" enter-active-class="transition duration-300" leave-to-class="opacity-0 translate-y-4" leave-active-class="transition duration-200">
                      <div v-if="scanning" class="absolute bottom-5 left-1/2 -translate-x-1/2 w-[min(720px,94%)] rounded-2xl border border-white/10 bg-zinc-950/90 text-white shadow-2xl p-4 space-y-3">
                        <div class="flex items-center gap-3">
                          <div class="size-10 shrink-0 rounded-xl bg-red-600 flex items-center justify-center shadow-lg shadow-red-600/40"><ScanLine class="size-5" /></div>
                          <div class="min-w-0 flex-1">
                            <p class="text-sm font-semibold truncate">{{ progress?.phase === 'analyzing' ? 'Checking every photo' : livePage ? `${livePos} · ${livePage.label || pagePath(livePage.url)}` : 'Reading the scan pages' }}</p>
                            <p class="text-xs text-white/70 truncate">{{ lastLog || progress?.message }}</p>
                          </div>
                          <div class="text-right"><p class="text-2xl font-bold tabular-nums leading-none">{{ progress?.vehicles || 0 }}</p><p class="text-[10px] uppercase tracking-wider text-white/60">vehicles</p></div>
                          <div class="text-right pl-3 border-l border-white/10"><p class="text-lg font-semibold tabular-nums leading-none">{{ mmss(elapsed) }}</p><p class="text-[10px] uppercase tracking-wider text-white/60">elapsed</p></div>
                        </div>
                        <div class="h-1.5 rounded-full bg-white/10 overflow-hidden"><div class="h-full rounded-full bg-red-500 transition-[width] duration-500" :style="{ width: `${pctDone}%` }" /></div>
                        <ol class="grid grid-cols-3 gap-2">
                          <li v-for="st in steps" :key="st.key" class="flex items-center gap-2 rounded-lg px-2 py-1.5" :class="st.state === 'active' ? 'bg-white/10' : ''">
                            <span class="size-6 rounded-full flex items-center justify-center shrink-0" :class="st.state === 'done' ? 'bg-emerald-500' : st.state === 'active' ? 'bg-red-600' : 'bg-white/10'">
                              <CheckCircle2 v-if="st.state === 'done'" class="size-3.5" /><Loader2 v-else-if="st.state === 'active'" class="size-3.5 animate-spin" /><component :is="st.icon" v-else class="size-3.5 text-white/60" />
                            </span>
                            <div class="min-w-0"><p class="text-xs font-medium truncate" :class="st.state === 'todo' && 'text-white/60'">{{ st.label }}</p><p v-if="st.state === 'active' && st.detail" class="text-[10px] text-white/70 truncate tabular-nums">{{ st.detail }}</p></div>
                          </li>
                        </ol>
                      </div>
                    </Transition>
                  </CrmScannerViewport>
                </div>
              </div>
            </div>
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
                <span v-if="results.finishedAt" class="hidden md:inline">· crawled {{ ago(results.finishedAt) }}</span>
              </div>
              <div class="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" class="h-8 gap-1.5" @click="tab = 'site'"><MonitorPlay class="size-4" /> Back to the crawl plan</Button>
                <template v-if="results.savedAuditId">
                  <Button variant="outline" size="sm" class="h-8 gap-1.5" @click="open = false"><CheckCircle2 class="size-4 text-emerald-600" /> Saved — close</Button>
                  <Button size="sm" class="h-8 gap-1.5" @click="emailAudit"><Mail class="size-4" /> Email this audit</Button>
                </template>
                <Button v-else size="sm" class="h-8 gap-1.5" :disabled="saving" @click="save"><Loader2 v-if="saving" class="size-4 animate-spin" /><Save v-else class="size-4" /> Save to CRM</Button>
              </div>
            </footer>
          </div>
        </div>

        <!-- Status bar -->
        <div v-if="phase === 'ready' && tab === 'site'" class="shrink-0 h-6 px-3 border-t bg-muted/40 text-[10px] text-muted-foreground flex items-center gap-3">
          <span class="truncate">{{ preview?.title || shownUrl }}</span>
          <span v-if="hoverHref" class="truncate text-foreground">→ {{ hoverHref }}</span>
          <span v-else-if="preview && !scanning" class="hidden md:inline shrink-0">· Looking around never crawls anything — only the scan pages on the left are read</span>
          <a v-if="preview?.url" :href="preview.url" target="_blank" rel="noopener" class="ml-auto inline-flex items-center gap-1 hover:text-foreground shrink-0">Open in my browser <ExternalLink class="size-3" /></a>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
@keyframes scanner-load { 0% { transform: translateX(-100%) } 100% { transform: translateX(300%) } }
@keyframes scanner-sweep { 0% { top: -6rem } 100% { top: 100% } }
@media (prefers-reduced-motion: reduce) {
  .scanner [class*="animate-[scanner-"], .scanner .animate-ping { animation: none }
}
</style>
