<script setup lang="ts">
/**
 * "Search Web" — discover dealerships around our base (Google Places) and add the new ones to the CRM.
 * Opened from the Dealerships header (or /crm/dealership?discover=1). Scans run as resumable server jobs
 * driven by short step calls, so the map and counters fill in live; closing the dialog pauses the scan.
 */
import NumberFlow from '@number-flow/vue'
import { toast } from 'vue-sonner'
import { format, formatDistanceToNow } from 'date-fns'
import {
  ArrowDownWideNarrow, Binoculars, CheckCircle2, ChevronDown, CircleSlash, Columns2, ExternalLink, EyeOff, Globe, History,
  List, Loader2, Map as MapIcon, MapPin, Phone, Play, Plus, Radar, RotateCcw, Search, Settings2, ShieldAlert, Sparkles, Square, Star, Target, Undo2, UserCheck, X,
} from 'lucide-vue-next'
import { OPEN_STAGES, STAGE_STYLE } from '~/constants/crm'
import type { Prospect, ProspectingConfigResponse, ScanSummary, ScansResponse } from '~/composables/useProspecting'
import { apiError, formatMiles, formatUsd, useProspecting } from '~/composables/useProspecting'
import type { MapPoint } from './Map.vue'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ (e: 'imported', count: number): void }>()

const api = useProspecting()
const now = useNow({ interval: 1000 })

// ─── Server state ───
const booting = ref(false)
const cfg = ref<ProspectingConfigResponse | null>(null)
const history = ref<ScansResponse | null>(null)
const scan = ref<ScanSummary | null>(null)
const places = ref<Prospect[]>([])
const expired = ref(0)
const driving = ref(false)
const starting = ref(false)
let runToken = 0

const origin = computed(() => scan.value?.params.origin ?? cfg.value?.config.origin ?? { lat: 41.826485, lng: -72.52834, city: '', address: '', state: '', postalCode: '', country: '' })
const configRadius = computed(() => cfg.value?.config.radiusMiles ?? 75)
const radiusOverride = ref<number | null>(null)
const plannedRadius = computed(() => radiusOverride.value ?? configRadius.value)
const mapRadius = computed(() => (scan.value && !radiusOverride.value ? scan.value.params.radiusMiles : plannedRadius.value))
const running = computed(() => scan.value?.status === 'running')

async function boot() {
  booting.value = true
  try {
    const [c, h] = await Promise.all([api.getConfig(), api.listScans()])
    cfg.value = c
    history.value = h
    stageForImport.value = c.config.defaultStage
    const latest = h.scans[0]
    if (latest) await loadScan(latest.id, latest.status === 'running')
  }
  catch (e) { toast.error(`Couldn't load discovery: ${apiError(e)}`) }
  finally { booting.value = false }
}
async function loadScan(id: string, resume = false) {
  runToken++
  const r = await api.getScan(id)
  scan.value = r.scan
  places.value = r.places
  expired.value = r.expired
  selected.value = new Set()
  if (resume && r.scan.status === 'running') drive(r.scan.id)
}
async function refreshHistory() { try { history.value = await api.listScans() } catch {} }

watch(open, (v) => {
  if (v) { if (!cfg.value) boot(); else if (scan.value?.status === 'running') drive(scan.value.id) }
  else { runToken++ } // closing pauses the scan; reopening resumes it
}, { immediate: true })

// ─── Scanning ───
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function runScan() {
  if (!cfg.value?.apiKeyConfigured) return toast.error('Add the Google Places API key first')
  starting.value = true
  try {
    const { scan: s } = await api.startScan({ radiusMiles: plannedRadius.value })
    scan.value = s
    places.value = []
    expired.value = 0
    selected.value = new Set()
    tab.value = 'new'
    radiusOverride.value = null
    drive(s.id)
  }
  catch (e) { toast.error(apiError(e, 'Could not start the scan')) }
  finally { starting.value = false }
}
async function drive(id: string) {
  const token = ++runToken
  driving.value = true
  let failures = 0
  try {
    while (token === runToken && open.value) {
      let r: Awaited<ReturnType<typeof api.stepScan>>
      try { r = await api.stepScan(id); failures = 0 }
      catch (e) {
        if (++failures >= 3) { toast.error(`Scan paused — ${apiError(e)}`, { action: { label: 'Resume', onClick: () => drive(id) } }); break }
        await sleep(1500 * failures)
        continue
      }
      if (token !== runToken) break
      scan.value = r.scan
      if (r.places.length) mergePlaces(r.places)
      if (r.scan.status !== 'running') { driving.value = false; await finished(r.scan); break }
      if (r.busy) await sleep(1500)
    }
  }
  finally { if (token === runToken) driving.value = false }
}
function mergePlaces(incoming: Prospect[]) {
  const have = new Set(places.value.map(p => p.placeId))
  const add = incoming.filter(p => !have.has(p.placeId))
  if (add.length) places.value = [...places.value, ...add]
}
async function finished(s: ScanSummary) {
  await Promise.all([refreshHistory(), loadScan(s.id).catch(() => {})])
  const n = places.value.filter(p => p.status === 'new').length
  if (s.status === 'completed') toast.success(`Scan complete — ${s.found.toLocaleString()} dealerships, ${n.toLocaleString()} new`, { description: `${s.apiCalls} API calls · ≈ ${formatUsd(s.estCostUsd)}` })
  else if (s.status === 'budget') toast.warning('Scan stopped at the API-call budget', { description: 'Raise the budget in Settings › General to cover the whole area.' })
  else if (s.status === 'failed') toast.error('Scan failed', { description: s.error })
}
async function cancel() {
  if (!scan.value) return
  runToken++
  try { scan.value = (await api.cancelScan(scan.value.id)).scan; refreshHistory() }
  catch (e) { toast.error(apiError(e)) }
  driving.value = false
}

// ─── Filtering ───
type Tab = 'new' | 'in_crm' | 'dismissed' | 'all'
const tab = ref<Tab>('new')
const search = ref('')
const q = refDebounced(search, 150)
const brand = ref('all')
const minRating = ref('0')
type SortKey = 'distance' | 'rating' | 'reviews' | 'name' | 'city'
const sortKey = ref<SortKey>('distance')
const SORTS: { v: SortKey, l: string }[] = [{ v: 'distance', l: 'Closest first' }, { v: 'reviews', l: 'Most reviews' }, { v: 'rating', l: 'Highest rated' }, { v: 'name', l: 'Name A–Z' }, { v: 'city', l: 'City A–Z' }]
const counts = computed(() => {
  const c = { all: places.value.length, new: 0, in_crm: 0, dismissed: 0 }
  for (const p of places.value) c[p.status]++
  return c
})
const TABS = computed(() => [
  { key: 'new' as Tab, label: 'New', count: counts.value.new },
  { key: 'in_crm' as Tab, label: 'Already in CRM', count: counts.value.in_crm },
  { key: 'dismissed' as Tab, label: 'Dismissed', count: counts.value.dismissed },
  { key: 'all' as Tab, label: 'All', count: counts.value.all },
])
const brandOptions = computed(() => [...new Set(places.value.flatMap(p => p.brands))].sort())
const visible = computed(() => {
  const needle = q.value.trim().toLowerCase()
  const min = Number(minRating.value)
  const list = places.value.filter((p) => {
    if (tab.value !== 'all' && p.status !== tab.value) return false
    if (brand.value === '__none' ? p.brands.length : brand.value !== 'all' && !p.brands.includes(brand.value)) return false
    if (min && (p.rating ?? 0) < min) return false
    if (needle && !`${p.name} ${p.city} ${p.state} ${p.zip} ${p.brands.join(' ')} ${p.phone} ${p.website}`.toLowerCase().includes(needle)) return false
    return true
  })
  const by: Record<SortKey, (a: Prospect, b: Prospect) => number> = {
    distance: (a, b) => a.distanceMiles - b.distanceMiles,
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.reviews - a.reviews,
    reviews: (a, b) => b.reviews - a.reviews,
    name: (a, b) => a.name.localeCompare(b.name),
    city: (a, b) => a.city.localeCompare(b.city) || a.distanceMiles - b.distanceMiles,
  }
  return list.sort(by[sortKey.value])
})
const filterActive = computed(() => !!(q.value || brand.value !== 'all' || minRating.value !== '0'))
function clearFilters() { search.value = ''; brand.value = 'all'; minRating.value = '0' }

// Incremental rendering (batches of 100) — the map always shows every match.
const BATCH = 100
const limit = ref(BATCH)
const rows = computed(() => visible.value.slice(0, limit.value))
watch([tab, q, brand, minRating, sortKey], () => { limit.value = BATCH; scroller.value?.scrollTo({ top: 0 }) })
const scroller = ref<HTMLElement | null>(null)
useInfiniteScroll(scroller, () => { if (limit.value < visible.value.length) limit.value += BATCH }, { distance: 300 })

// ─── Stats ───
const newOnes = computed(() => places.value.filter(p => p.status === 'new'))
const coveragePct = computed(() => (places.value.length ? Math.round((counts.value.in_crm / places.value.length) * 100) : 0))
const avgRatingNew = computed(() => {
  const r = newOnes.value.map(p => p.rating).filter((x): x is number => x != null)
  return r.length ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 10) / 10 : null
})
const elapsed = computed(() => {
  if (!scan.value) return ''
  const end = scan.value.finishedAt ? new Date(scan.value.finishedAt).getTime() : now.value.getTime()
  const s = Math.max(0, Math.round((end - new Date(scan.value.startedAt).getTime()) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
})
const STATUS_META: Record<ScanSummary['status'], { label: string, cls: string }> = {
  running: { label: 'Scanning', cls: 'bg-primary/10 text-primary border-primary/30' },
  completed: { label: 'Complete', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  budget: { label: 'Stopped at budget', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30' },
  cancelled: { label: 'Cancelled', cls: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 border-zinc-500/30' },
  failed: { label: 'Failed', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30' },
}
const estCalls = computed(() => {
  // Rough planning estimate: ~1.7 calls per 25-mile cell in the circle, plus splits in dense metros.
  const r = plannedRadius.value
  const cells = Math.max(1, Math.round(Math.PI * (r / 25) ** 2)) * (cfg.value?.config.queries.length || 1)
  return { low: Math.round(cells * 1.6), high: Math.min(cfg.value?.config.maxApiCalls ?? 400, Math.round(cells * 5)) }
})
const lastLog = computed(() => (scan.value?.log || []).slice(-4).reverse())

// ─── Selection & map focus ───
const selected = ref<Set<string>>(new Set())
const focusedId = ref<string | null>(null)
const mapRef = ref<{ flyTo: (id: string) => void } | null>(null)
const selectableVisible = computed(() => visible.value.filter(p => p.status === 'new'))
const allVisibleSelected = computed(() => selectableVisible.value.length > 0 && selectableVisible.value.every(p => selected.value.has(p.placeId)))
const someVisibleSelected = computed(() => selectableVisible.value.some(p => selected.value.has(p.placeId)))
function toggle(id: string) {
  const p = places.value.find(x => x.placeId === id)
  if (!p || p.status !== 'new') return
  const s = new Set(selected.value); s.has(id) ? s.delete(id) : s.add(id); selected.value = s
}
function toggleAllVisible() {
  const s = new Set(selected.value)
  if (allVisibleSelected.value) selectableVisible.value.forEach(p => s.delete(p.placeId))
  else selectableVisible.value.forEach(p => s.add(p.placeId))
  selected.value = s
}
function onMapSelect(id: string) {
  const p = places.value.find(x => x.placeId === id)
  if (!p) return
  if (tab.value !== 'all' && p.status !== tab.value) tab.value = p.status
  toggle(id)
  nextTick(() => {
    const i = visible.value.findIndex(x => x.placeId === id)
    if (i >= limit.value) limit.value = i + BATCH
    nextTick(() => document.getElementById(`prospect-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  })
}
const mapPoints = computed<MapPoint[]>(() => visible.value.map(p => ({ id: p.placeId, lat: p.lat, lng: p.lng, name: p.name, status: p.status, sub: [p.city, formatMiles(p.distanceMiles), p.rating != null ? `★ ${p.rating.toFixed(1)}` : ''].filter(Boolean).join(' · ') })))

// ─── View mode ───
const view = useLocalStorage<'split' | 'list' | 'map'>('crm-discover-view', 'split')
function showOnMap(id: string) {
  if (view.value === 'list') view.value = 'split'
  focusedId.value = id
  nextTick(() => setTimeout(() => mapRef.value?.flyTo(id), 60))
}

// ─── Import / dismiss ───
const stageForImport = ref('Research Needed')
interface UserOpt { id: string, name: string }
const users = ref<UserOpt[]>([])
const owner = ref('__none')
async function loadUsers() {
  if (users.value.length) return
  try { const res = await $fetch<any[]>('/api/users'); users.value = (res || []).filter(u => u.status !== 'Inactive').map(u => ({ id: u.id, name: u.name || u.email })) } catch {}
}
watch(open, v => v && loadUsers(), { immediate: true })
const importing = ref(false)
async function importIds(ids: string[]) {
  if (!ids.length) return
  importing.value = true
  try {
    const u = users.value.find(x => x.id === owner.value)
    const r = await api.importPlaces({ placeIds: ids, stage: stageForImport.value, assignedUserId: u?.id || '', assignedUserName: u?.name || '', scanId: scan.value?.id })
    const byId = new Map(places.value.map(p => [p.placeId, p]))
    for (const c of r.created) {
      const p = byId.get(c.placeId)
      if (p) { p.status = 'in_crm'; p.match = { id: c.id, dealershipId: c.dealershipId, name: c.name, stage: stageForImport.value, archived: false, assignedUserName: u?.name || '', reason: 'Added from this scan' } }
    }
    for (const s of r.skipped) {
      const p = byId.get(s.placeId)
      if (p && s.match) { p.status = 'in_crm'; p.match = s.match }
    }
    places.value = [...places.value]
    const s = new Set(selected.value); ids.forEach(id => s.delete(id)); selected.value = s
    if (r.created.length) {
      emit('imported', r.created.length)
      toast.success(`Added ${r.created.length} dealership${r.created.length === 1 ? '' : 's'} to the CRM`, {
        description: `${stageForImport.value}${u ? ` · ${u.name}` : ''}${r.skipped.length ? ` · ${r.skipped.length} skipped` : ''}`,
        action: r.created.length === 1 ? { label: 'Open', onClick: () => navigateTo(`/crm/dealership/${r.created[0]!.id}`) } : undefined,
      })
    }
    else if (r.skipped.length) { toast.warning(`Nothing added — ${r.skipped[0]!.reason}`) }
  }
  catch (e) { toast.error(apiError(e, 'Import failed')) }
  finally { importing.value = false }
}
const dismissing = ref(false)
async function dismissIds(ids: string[], undo = false) {
  if (!ids.length) return
  dismissing.value = true
  try {
    await api.dismissPlaces(ids, undo ? '' : 'Not a fit', undo)
    const set = new Set(ids)
    places.value = places.value.map((p): Prospect => (set.has(p.placeId) && p.status !== 'in_crm' ? { ...p, status: undo ? 'new' : 'dismissed', dismissed: undo ? null : { reason: 'Not a fit', at: new Date().toISOString(), by: '' } } : p))
    const s = new Set(selected.value); ids.forEach(id => s.delete(id)); selected.value = s
    if (!undo) toast(`${ids.length} dismissed — hidden from future scans`, { action: { label: 'Undo', onClick: () => dismissIds(ids, true) } })
  }
  catch (e) { toast.error(apiError(e)) }
  finally { dismissing.value = false }
}

function hostOf(url: string) { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
function exportCsv() {
  const data = visible.value
  if (!data.length) return toast.error('Nothing to export')
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['Name', 'Brands', 'Address', 'City', 'State', 'ZIP', 'Distance (mi)', 'Rating', 'Reviews', 'Phone', 'Website', 'Google Maps', 'Status', 'CRM record']
  const lines = data.map(p => [p.name, p.brands.join(' / '), p.address, p.city, p.state, p.zip, p.distanceMiles, p.rating ?? '', p.reviews, p.phone, p.website, p.mapsUrl, p.status === 'in_crm' ? 'In CRM' : p.status === 'new' ? 'New' : 'Dismissed', p.match?.dealershipId || ''].map(esc).join(','))
  const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `discovered_dealerships_${new Date().toISOString().slice(0, 10)}.csv` })
  a.click(); URL.revokeObjectURL(a.href)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex h-[calc(100dvh-16px)] w-[calc(100vw-16px)] max-w-[calc(100vw-16px)] flex-col gap-0 overflow-hidden border-2 border-primary p-0 sm:max-w-[calc(100vw-16px)]" @interact-outside.prevent>
      <!-- ═══ Header ═══ -->
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b-2 border-primary bg-muted/30 px-2 py-2 pr-10">
        <div class="relative grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Binoculars class="size-5" />
          <span v-if="running" class="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-background animate-pulse" />
        </div>
        <div class="min-w-0 mr-auto">
          <DialogTitle class="text-base font-semibold leading-tight">Discover dealerships</DialogTitle>
          <DialogDescription class="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <MapPin class="size-3 shrink-0" />
            <span class="truncate">{{ [origin.address, origin.city, origin.state].filter(Boolean).join(', ') || 'Base location' }}</span>
            <span aria-hidden="true">·</span>
            <span>Google Places</span>
          </DialogDescription>
        </div>

        <!-- Range for the next scan -->
        <Popover>
          <PopoverTrigger as-child>
            <Button variant="outline" size="sm" class="h-8 gap-1.5" :disabled="running">
              <Target class="size-4" /><span class="tabular-nums">{{ plannedRadius }} mi</span><ChevronDown class="size-3.5 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-72 space-y-2 p-2">
            <p class="text-sm font-semibold">Range for the next scan</p>
            <Slider :model-value="[plannedRadius]" :min="5" :max="200" :step="5" @update:model-value="v => radiusOverride = v?.[0] ?? null" />
            <div class="flex flex-wrap gap-1">
              <Button v-for="r in [25, 50, 75, 100, 150]" :key="r" size="sm" :variant="plannedRadius === r ? 'default' : 'outline'" class="h-7 px-2 text-xs tabular-nums" @click="radiusOverride = r">{{ r }} mi</Button>
            </div>
            <p class="text-[11px] text-muted-foreground">The saved default ({{ configRadius }} mi) and base location live in <NuxtLink to="/settings/general" class="underline underline-offset-2 hover:text-foreground" @click="open = false">Settings › General</NuxtLink>.</p>
            <Button v-if="radiusOverride !== null" variant="ghost" size="sm" class="h-7 w-full text-xs" @click="radiusOverride = null"><RotateCcw class="size-3.5" /> Back to {{ configRadius }} mi</Button>
          </PopoverContent>
        </Popover>

        <!-- History -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline" size="sm" class="h-8 gap-1.5" :disabled="!history?.scans.length">
              <History class="size-4" /><span class="hidden md:inline">History</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-80">
            <DropdownMenuLabel class="flex items-center justify-between text-xs">
              <span>Recent scans</span>
              <span v-if="history" class="font-normal text-muted-foreground tabular-nums">{{ history.usage.monthCalls.toLocaleString() }} / {{ history.usage.freeCalls.toLocaleString() }} free calls this month</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem v-for="s in history?.scans || []" :key="s.id" class="flex items-start gap-2" @click="loadScan(s.id, s.status === 'running')">
              <Radar class="mt-0.5 size-4 shrink-0" :class="s.id === scan?.id ? 'text-primary' : 'text-muted-foreground'" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2 text-xs">
                  <span class="font-medium">{{ format(new Date(s.startedAt), 'MMM d, h:mm a') }}</span>
                  <span class="rounded border px-1 text-[10px]" :class="STATUS_META[s.status].cls">{{ STATUS_META[s.status].label }}</span>
                </div>
                <div class="text-[11px] text-muted-foreground tabular-nums">{{ s.params.radiusMiles }} mi · {{ s.found.toLocaleString() }} found · {{ s.apiCalls }} calls{{ s.startedBy ? ` · ${s.startedBy}` : '' }}</div>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" size="icon" class="size-8" title="Search area settings" @click="open = false; navigateTo('/settings/general')"><Settings2 class="size-4" /></Button>

        <Button v-if="running" variant="outline" size="sm" class="h-8 gap-1.5 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400" @click="cancel">
          <Square class="size-3.5 fill-current" /> Stop
        </Button>
        <Button v-else size="sm" class="h-8 gap-1.5" :disabled="starting || booting || !cfg?.apiKeyConfigured" @click="runScan">
          <Loader2 v-if="starting" class="size-4 animate-spin" /><Play v-else class="size-4 fill-current" />
          {{ scan ? 'Run new scan' : 'Run scan' }}
        </Button>
      </div>

      <!-- ═══ Booting ═══ -->
      <div v-if="booting && !cfg" class="grid flex-1 place-items-center"><Loader2 class="size-6 animate-spin text-primary" /></div>

      <!-- ═══ No API key ═══ -->
      <div v-else-if="cfg && !cfg.apiKeyConfigured" class="grid flex-1 place-items-center p-2">
        <div class="max-w-lg space-y-2 rounded-xl border-2 border-amber-500/40 bg-amber-500/5 p-2 text-sm">
          <div class="flex items-center gap-2 font-semibold"><ShieldAlert class="size-5 text-amber-500" /> Connect Google Places to start discovering</div>
          <ol class="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Google Cloud Console → enable <b class="text-foreground">Places API (New)</b> on a project with billing.</li>
            <li>Create an API key, restrict it to <b class="text-foreground">Places API (New)</b>.</li>
            <li>Add <code class="rounded bg-muted px-1 font-mono text-foreground">GOOGLE_PLACES_API_KEY=…</code> to <code class="font-mono">.env</code> and to Vercel's environment variables.</li>
            <li>Restart <code class="font-mono">pnpm dev</code> / redeploy, then open this again.</li>
          </ol>
        </div>
      </div>

      <template v-else-if="cfg">
        <!-- ═══ Stat strip ═══ -->
        <div class="grid shrink-0 grid-cols-2 gap-2 border-b bg-background p-2 sm:grid-cols-3 xl:grid-cols-5">
          <div class="rounded-lg border bg-card px-2 py-1.5">
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Dealerships found</p>
            <p class="text-xl font-semibold tabular-nums"><NumberFlow :value="places.length" /></p>
            <p class="text-[11px] text-muted-foreground truncate">within {{ mapRadius }} mi<span v-if="scan?.excluded"> · {{ scan.excluded }} filtered out</span></p>
          </div>
          <div class="rounded-lg border-2 border-primary/60 bg-primary/5 px-2 py-1.5">
            <p class="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-primary"><Sparkles class="size-3" /> New opportunities</p>
            <p class="text-xl font-semibold tabular-nums text-primary"><NumberFlow :value="counts.new" /></p>
            <p class="text-[11px] text-muted-foreground">not in the CRM yet</p>
          </div>
          <div class="rounded-lg border bg-card px-2 py-1.5">
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">CRM coverage</p>
            <p class="text-xl font-semibold tabular-nums"><NumberFlow :value="coveragePct" suffix="%" /></p>
            <div class="mt-0.5 h-1 overflow-hidden rounded-full bg-muted"><div class="h-full rounded-full bg-emerald-500 transition-all duration-700" :style="{ width: `${coveragePct}%` }" /></div>
          </div>
          <div class="rounded-lg border bg-card px-2 py-1.5">
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Avg rating · new</p>
            <p class="flex items-center gap-1 text-xl font-semibold tabular-nums"><Star class="size-4 fill-amber-400 text-amber-400" />{{ avgRatingNew?.toFixed(1) ?? '—' }}</p>
            <p class="text-[11px] text-muted-foreground">Google reviews</p>
          </div>
          <div class="rounded-lg border bg-card px-2 py-1.5 col-span-2 sm:col-span-1">
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">API usage · this scan</p>
            <p class="text-xl font-semibold tabular-nums"><NumberFlow :value="scan?.apiCalls ?? 0" /> <span class="text-xs font-normal text-muted-foreground">calls</span></p>
            <p class="text-[11px] text-muted-foreground tabular-nums">≈ {{ formatUsd(scan?.estCostUsd ?? 0) }}<span v-if="history"> · {{ history.usage.monthCalls.toLocaleString() }} this month</span></p>
          </div>
        </div>

        <!-- ═══ Scan status ═══ -->
        <div v-if="scan" class="shrink-0 border-b bg-muted/20 px-2 py-1.5">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium" :class="STATUS_META[scan.status].cls">
              <Loader2 v-if="running" class="size-3 animate-spin" /><CheckCircle2 v-else-if="scan.status === 'completed'" class="size-3" /><CircleSlash v-else class="size-3" />
              {{ STATUS_META[scan.status].label }}
            </span>
            <span class="text-muted-foreground tabular-nums">{{ scan.cellsDone }} area{{ scan.cellsDone === 1 ? '' : 's' }} scanned<span v-if="running"> · {{ scan.cellsQueued }} to go</span><span v-if="scan.splits"> · {{ scan.splits }} dense area{{ scan.splits === 1 ? '' : 's' }} zoomed</span> · {{ elapsed }}</span>
            <span class="ml-auto text-muted-foreground">{{ scan.finishedAt ? `Finished ${formatDistanceToNow(new Date(scan.finishedAt), { addSuffix: true })}` : `Started ${formatDistanceToNow(new Date(scan.startedAt), { addSuffix: true })}` }}{{ scan.startedBy ? ` by ${scan.startedBy}` : '' }}</span>
          </div>
          <div v-if="running" class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div class="h-full rounded-full bg-primary transition-all duration-500" :style="{ width: `${Math.max(3, Math.round(scan.progress * 100))}%` }" />
          </div>
          <TransitionGroup v-if="running && lastLog.length" tag="ul" name="feed" class="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
            <li v-for="(l, i) in lastLog.slice(0, 2)" :key="l.at + l.msg" class="flex items-center gap-1.5 truncate" :class="i === 0 ? 'text-foreground' : ''">
              <span class="size-1 shrink-0 rounded-full" :class="i === 0 ? 'bg-primary' : 'bg-muted-foreground/40'" />{{ l.msg }}
            </li>
          </TransitionGroup>
          <p v-if="scan.status === 'failed'" class="mt-1 text-xs text-rose-600 dark:text-rose-400">{{ scan.error }}</p>
          <p v-if="expired" class="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{{ expired }} result{{ expired === 1 ? '' : 's' }} expired (Google allows caching for 30 days) — run a new scan to refresh.</p>
        </div>

        <!-- ═══ Body ═══ -->
        <div class="flex min-h-0 flex-1">
          <!-- List -->
          <div v-show="view !== 'map'" class="flex min-w-0 flex-col" :class="view === 'split' ? 'w-full lg:w-[58%] lg:border-r-2 lg:border-primary' : 'w-full'">
            <!-- Toolbar -->
            <div class="shrink-0 space-y-2 border-b p-2">
              <div class="flex w-full items-center overflow-x-auto rounded-lg border bg-muted/40 p-0.5 gap-0.5" role="tablist" aria-label="Result groups">
                <button
                  v-for="t in TABS" :key="t.key" type="button" role="tab" :aria-selected="tab === t.key"
                  class="inline-flex flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-all"
                  :class="tab === t.key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
                  @click="tab = t.key"
                >
                  {{ t.label }}<span class="rounded-full px-1.5 text-[10px] tabular-nums" :class="tab === t.key ? 'bg-primary text-primary-foreground' : 'bg-muted'">{{ t.count.toLocaleString() }}</span>
                </button>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <div class="relative min-w-40 flex-1">
                  <Search class="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input v-model="search" placeholder="Search name, city, brand, phone…" class="h-8 pl-8" />
                </div>
                <Select v-model="brand">
                  <SelectTrigger class="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent class="max-h-72"><SelectItem value="all">All brands</SelectItem><SelectItem value="__none">No brand in name</SelectItem><SelectItem v-for="b in brandOptions" :key="b" :value="b">{{ b }}</SelectItem></SelectContent>
                </Select>
                <Select v-model="minRating">
                  <SelectTrigger class="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="0">Any rating</SelectItem><SelectItem v-for="r in ['3', '3.5', '4', '4.5']" :key="r" :value="r">★ {{ r }}+</SelectItem></SelectContent>
                </Select>
                <Select v-model="sortKey">
                  <SelectTrigger class="h-8 w-36 text-xs"><ArrowDownWideNarrow class="size-3.5" /><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem v-for="s in SORTS" :key="s.v" :value="s.v">{{ s.l }}</SelectItem></SelectContent>
                </Select>
                <Button v-if="filterActive" variant="ghost" size="sm" class="h-8 gap-1 text-xs" @click="clearFilters"><X class="size-3.5" /> Clear</Button>
                <div class="ml-auto flex items-center rounded-md border p-0.5" role="tablist" aria-label="Layout">
                  <button v-for="v in ([{ k: 'list', i: List, t: 'List' }, { k: 'split', i: Columns2, t: 'List + map' }, { k: 'map', i: MapIcon, t: 'Map' }] as const)" :key="v.k" type="button" role="tab" :aria-selected="view === v.k" :title="v.t" class="grid size-7 place-items-center rounded" :class="view === v.k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'" @click="view = v.k">
                    <component :is="v.i" class="size-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <!-- Empty: never scanned -->
            <div v-if="!scan" class="grid flex-1 place-items-center overflow-y-auto p-2">
              <div class="max-w-md space-y-2 text-center">
                <div class="relative mx-auto grid size-20 place-items-center">
                  <span class="absolute inset-0 rounded-full bg-primary/15 animate-ping" />
                  <span class="absolute inset-2 rounded-full bg-primary/20" />
                  <Radar class="relative size-9 text-primary" />
                </div>
                <h3 class="text-lg font-semibold">Find every dealership within {{ plannedRadius }} miles</h3>
                <p class="text-sm text-muted-foreground">We sweep the whole area around {{ origin.city || 'base' }} on Google Maps, zoom into dense metros so nothing is missed, and flag which dealers are already in your CRM.</p>
                <p class="text-xs text-muted-foreground tabular-nums">Estimated {{ estCalls.low }}–{{ estCalls.high }} API calls (≈ {{ formatUsd(estCalls.low * (cfg.pricing.pricePer1000 / 1000)) }}–{{ formatUsd(estCalls.high * (cfg.pricing.pricePer1000 / 1000)) }}; first {{ cfg.pricing.freeMonthlyCalls.toLocaleString() }} calls each month are free).</p>
                <Button class="gap-1.5" :disabled="starting" @click="runScan"><Loader2 v-if="starting" class="size-4 animate-spin" /><Play v-else class="size-4 fill-current" /> Run first scan</Button>
              </div>
            </div>

            <!-- Table -->
            <div v-else ref="scroller" class="min-h-0 flex-1 overflow-auto">
              <table class="w-full border-collapse text-sm">
                <thead class="sticky top-0 z-10">
                  <tr>
                    <th class="w-9 px-2 text-left">
                      <Checkbox :model-value="allVisibleSelected ? true : (someVisibleSelected ? 'indeterminate' : false)" :disabled="!selectableVisible.length" aria-label="Select all new dealerships shown" class="border-white/60 data-[state=checked]:border-white" @update:model-value="toggleAllVisible" />
                    </th>
                    <th class="px-2 text-left">Dealership</th>
                    <th class="px-2 text-left">Brands</th>
                    <th class="px-2 text-left">City</th>
                    <th class="px-2 text-left">State</th>
                    <th class="px-2 text-right">Distance</th>
                    <th class="px-2 text-right">Rating</th>
                    <th class="px-2 text-right">Reviews</th>
                    <th class="px-2 text-left">Phone</th>
                    <th class="px-2 text-left">Website</th>
                    <th class="px-2 text-left">Status</th>
                    <th class="px-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!rows.length">
                    <td colspan="12" class="p-2">
                      <div class="py-10 text-center text-sm text-muted-foreground">
                        <template v-if="running && !places.length"><Loader2 class="mx-auto mb-2 size-5 animate-spin text-primary" />Sweeping the map — dealerships appear here as they're found…</template>
                        <template v-else-if="filterActive">No dealerships match these filters. <button class="underline underline-offset-2" @click="clearFilters">Clear filters</button></template>
                        <template v-else-if="tab === 'new' && places.length">Every dealership in range is already in the CRM or dismissed. Nice coverage.</template>
                        <template v-else>Nothing here yet.</template>
                      </div>
                    </td>
                  </tr>
                  <tr
                    v-for="p in rows" :id="`prospect-${p.placeId}`" :key="p.placeId"
                    class="group cursor-pointer transition-colors"
                    :class="[selected.has(p.placeId) ? 'bg-primary/10' : focusedId === p.placeId ? 'bg-muted/70' : 'hover:bg-muted/50', p.status === 'dismissed' && 'opacity-60']"
                    @click="toggle(p.placeId)" @mouseenter="focusedId = p.placeId" @mouseleave="focusedId = null"
                  >
                    <td class="px-2" @click.stop>
                      <Checkbox :model-value="selected.has(p.placeId)" :disabled="p.status !== 'new'" :aria-label="`Select ${p.name}`" @update:model-value="toggle(p.placeId)" />
                    </td>
                    <td class="max-w-72 px-2">
                      <div class="truncate font-medium" :title="p.formattedAddress">{{ p.name }}</div>
                    </td>
                    <td class="px-2 whitespace-nowrap">
                      <span v-if="p.brands.length" class="flex gap-1">
                        <span v-for="b in p.brands.slice(0, 2)" :key="b" class="rounded border bg-muted/60 px-1 text-[11px]">{{ b }}</span>
                        <span v-if="p.brands.length > 2" class="text-[11px] text-muted-foreground" :title="p.brands.join(', ')">+{{ p.brands.length - 2 }}</span>
                      </span>
                      <span v-else class="text-muted-foreground/50">—</span>
                    </td>
                    <td class="px-2 whitespace-nowrap">{{ p.city || '—' }}</td>
                    <td class="px-2 whitespace-nowrap">{{ p.state || '—' }}</td>
                    <td class="px-2 whitespace-nowrap text-right tabular-nums">{{ formatMiles(p.distanceMiles) }}</td>
                    <td class="px-2 whitespace-nowrap text-right tabular-nums">
                      <span v-if="p.rating != null" class="inline-flex items-center gap-0.5"><Star class="size-3 fill-amber-400 text-amber-400" />{{ p.rating.toFixed(1) }}</span>
                      <span v-else class="text-muted-foreground/50">—</span>
                    </td>
                    <td class="px-2 whitespace-nowrap text-right tabular-nums text-muted-foreground">{{ p.reviews ? p.reviews.toLocaleString() : '—' }}</td>
                    <td class="px-2 whitespace-nowrap tabular-nums" @click.stop>
                      <a v-if="p.phone" :href="`tel:${p.phone.replace(/[^\d+]/g, '')}`" class="inline-flex items-center gap-1 hover:text-primary"><Phone class="size-3 text-muted-foreground" />{{ p.phone }}</a>
                      <span v-else class="text-muted-foreground/50">—</span>
                    </td>
                    <td class="max-w-44 px-2 whitespace-nowrap" @click.stop>
                      <a v-if="p.website" :href="p.website" target="_blank" rel="noopener" class="inline-flex max-w-full items-center gap-1 truncate hover:text-primary"><Globe class="size-3 shrink-0 text-muted-foreground" /><span class="truncate">{{ hostOf(p.website) }}</span></a>
                      <span v-else class="text-muted-foreground/50">—</span>
                    </td>
                    <td class="px-2 whitespace-nowrap" @click.stop>
                      <span v-if="p.status === 'new'" class="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"><Sparkles class="size-3" /> New</span>
                      <NuxtLink v-else-if="p.status === 'in_crm' && p.match" :to="`/crm/dealership/${p.match.id}`" target="_blank" :title="`${p.match.reason} — ${p.match.name}${p.match.assignedUserName ? ` · ${p.match.assignedUserName}` : ''}`" class="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 hover:underline dark:text-emerald-300">
                        <CheckCircle2 class="size-3" /> {{ p.match.dealershipId || 'In CRM' }}<span class="font-normal opacity-80">· {{ p.match.stage }}</span>
                      </NuxtLink>
                      <span v-else class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground" :title="p.dismissed?.reason"><EyeOff class="size-3" /> Dismissed</span>
                    </td>
                    <td class="px-2 whitespace-nowrap text-right" @click.stop>
                      <div class="inline-flex items-center gap-0.5">
                        <Button variant="ghost" size="icon" class="size-7" title="Show on map" @click="showOnMap(p.placeId)"><MapPin class="size-3.5" /></Button>
                        <Button v-if="p.mapsUrl" variant="ghost" size="icon" class="size-7" title="Open in Google Maps" as-child>
                          <a :href="p.mapsUrl" target="_blank" rel="noopener"><ExternalLink class="size-3.5" /></a>
                        </Button>
                        <template v-if="p.status === 'new'">
                          <Button variant="ghost" size="icon" class="size-7" title="Dismiss — hide from future scans" :disabled="dismissing" @click="dismissIds([p.placeId])"><EyeOff class="size-3.5" /></Button>
                          <Button variant="ghost" size="icon" class="size-7 text-primary hover:bg-primary/10 hover:text-primary" title="Add to CRM" :disabled="importing" @click="importIds([p.placeId])"><Plus class="size-4" /></Button>
                        </template>
                        <Button v-else-if="p.status === 'dismissed'" variant="ghost" size="icon" class="size-7" title="Restore" :disabled="dismissing" @click="dismissIds([p.placeId], true)"><Undo2 class="size-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-if="rows.length < visible.length" class="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 class="size-3.5 animate-spin" /> Loading more…
                <Button variant="ghost" size="sm" class="h-7 text-xs" @click="limit += BATCH">Load more</Button>
              </div>
            </div>
          </div>

          <!-- Map -->
          <div v-show="view !== 'list'" class="relative min-w-0 flex-1" :class="view === 'split' ? 'hidden lg:block' : 'block'">
            <ClientOnly>
              <CrmDiscoverMap
                ref="mapRef"
                :origin="{ lat: origin.lat, lng: origin.lng }"
                :radius-miles="mapRadius"
                :points="mapPoints"
                :selected="selected"
                :focused-id="focusedId"
                :scanning="running"
                :counts="{ new: counts.new, in_crm: counts.in_crm, dismissed: counts.dismissed }"
                @select="onMapSelect"
                @focus="id => focusedId = id"
              />
            </ClientOnly>
          </div>
        </div>

        <!-- ═══ Action bar ═══ -->
        <div class="flex shrink-0 flex-wrap items-center gap-2 border-t-2 border-primary bg-muted/40 px-2 py-2">
          <span class="text-xs text-muted-foreground tabular-nums">
            <template v-if="selected.size"><b class="text-foreground">{{ selected.size }}</b> selected</template>
            <template v-else>Showing {{ rows.length.toLocaleString() }} of {{ visible.length.toLocaleString() }}</template>
          </span>
          <Button v-if="selected.size" variant="ghost" size="sm" class="h-7 text-xs" @click="selected = new Set()">Clear</Button>
          <Button v-if="scan" variant="ghost" size="sm" class="h-7 text-xs" @click="exportCsv">Export CSV</Button>
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <label class="flex items-center gap-1.5 text-xs text-muted-foreground">Stage
              <Select v-model="stageForImport">
                <SelectTrigger class="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent class="max-h-72"><SelectItem v-for="s in OPEN_STAGES" :key="s" :value="s"><span class="flex items-center gap-2"><span class="size-1.5 rounded-full" :class="STAGE_STYLE[s]?.dot" />{{ s }}</span></SelectItem></SelectContent>
              </Select>
            </label>
            <label class="flex items-center gap-1.5 text-xs text-muted-foreground"><UserCheck class="size-3.5" />Owner
              <Select v-model="owner">
                <SelectTrigger class="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent class="max-h-72"><SelectItem value="__none">Unassigned</SelectItem><SelectItem v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</SelectItem></SelectContent>
              </Select>
            </label>
            <Button variant="outline" size="sm" class="h-8 gap-1.5" :disabled="!selected.size || dismissing" @click="dismissIds([...selected])"><EyeOff class="size-4" /> Dismiss</Button>
            <Button size="sm" class="h-8 gap-1.5" :disabled="!selected.size || importing" @click="importIds([...selected])">
              <Loader2 v-if="importing" class="size-4 animate-spin" /><Plus v-else class="size-4" />
              Add {{ selected.size || '' }} to CRM
            </Button>
          </div>
        </div>
      </template>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.feed-enter-active, .feed-leave-active { transition: all .25s ease; }
.feed-enter-from { opacity: 0; transform: translateY(-4px); }
.feed-leave-to { opacity: 0; }
.feed-leave-active { position: absolute; }
</style>
