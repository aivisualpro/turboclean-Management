<script setup lang="ts">
import type { LostDeal, LostBreakdownRow } from '~/composables/useCrmLost'
import { RefreshCw, Download, Loader2, CircleX, Handshake, Undo2, AlertTriangle, Pencil, ChevronRight, X, Swords } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format, subDays, startOfYear, parseISO } from 'date-fns'
import { OPEN_STAGES, NURTURE_STAGE, STAGE_STYLE } from '~/constants/crm'

/**
 * Lost deals — "after hundreds of dealerships, see exactly why we lose".
 * Every loss is logged with a standard reason, the stage it was lost at, owner, source, and more.
 */
const { setHeader } = usePageHeader()
setHeader({ title: 'Lost deals', description: 'CRM · why we lose dealerships, where in the pipeline, and for whom', icon: 'i-lucide-circle-x' })

const { report, loading, load, updateReason } = useCrmLost()
const { isActionAllowed } = usePermissions()
const canEdit = computed(() => isActionAllowed('crm_dealership', 'Edit'))

// ─── Filters ───
const RANGES = [
  { key: '30', label: 'Last 30 days' }, { key: '90', label: 'Last 90 days' }, { key: '365', label: 'Last 12 months' },
  { key: 'ytd', label: 'This year' }, { key: 'all', label: 'All time' },
] as const
const range = useLocalStorage<string>('crm-lost-range', 'all')
const ownerId = ref('all')
const stage = ref('all')
const includeReopened = ref(false)
const users = ref<{ id: string, name: string }[]>([])
onMounted(async () => {
  try { const res = await $fetch<any[]>('/api/users'); users.value = (res || []).map(u => ({ id: u.id, name: u.name || u.email })).sort((a, b) => a.name.localeCompare(b.name)) } catch {}
})
const fromDate = computed(() => {
  const now = new Date()
  if (range.value === 'all') return undefined
  if (range.value === 'ytd') return format(startOfYear(now), 'yyyy-MM-dd')
  return format(subDays(now, Number(range.value)), 'yyyy-MM-dd')
})
async function reload(quiet = true) {
  try {
    await load({ from: fromDate.value, ownerId: ownerId.value === 'all' ? '' : ownerId.value, stage: stage.value === 'all' ? '' : stage.value, includeReopened: includeReopened.value })
    if (!quiet) toast.success('Report refreshed')
  } catch { toast.error('Could not load lost deals') }
}
watch([range, ownerId, stage, includeReopened], () => reload(), { immediate: true })

const r = computed(() => report.value)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const pctOf = (n: number) => r.value?.total ? Math.round((n / r.value.total) * 100) : 0
const top = computed(() => r.value?.byReason.find(x => x.count && x.reason !== 'Not recorded') || null)
const maxReason = computed(() => Math.max(1, ...(r.value?.byReason.map(x => x.count) || [1])))

// ─── Stage × reason heat table ───
const heatReasons = computed(() => (r.value?.byReason || []).filter(x => x.count).map(x => x.reason))
const heatRows = computed(() => (r.value?.byStage || []).filter(x => x.count))
const heatMax = computed(() => Math.max(1, ...heatRows.value.flatMap(row => Object.values(row.reasons))))
function heatStyle(n: number) {
  if (!n) return {}
  const a = 0.12 + 0.78 * (n / heatMax.value)
  return { backgroundColor: `rgba(225, 29, 72, ${a.toFixed(2)})`, color: a > 0.55 ? '#fff' : undefined }
}

// ─── Breakdowns ───
const DIMENSIONS = [
  { key: 'byOwner', label: 'Owner' }, { key: 'byLeadSource', label: 'Lead source' }, { key: 'byGroup', label: 'Dealer group' },
  { key: 'byState', label: 'State' }, { key: 'byMonth', label: 'Month' },
] as const
const dim = useLocalStorage<string>('crm-lost-dim', 'byOwner')
const dimRows = computed<LostBreakdownRow[]>(() => ((r.value as any)?.[dim.value] || []) as LostBreakdownRow[])
const dimMax = computed(() => Math.max(1, ...dimRows.value.map(x => x.count)))
const monthLabel = (k: string) => /^\d{4}-\d{2}$/.test(k) ? format(parseISO(`${k}-01`), 'MMM yyyy') : k
const topReasonsOf = (row: LostBreakdownRow) => Object.entries(row.reasons).sort((a, b) => b[1] - a[1]).slice(0, 3)

// ─── Deals ───
const reasonFilter = ref<string | null>(null)
const q = ref('')
const deals = computed(() => {
  const s = q.value.trim().toLowerCase()
  return (r.value?.deals || []).filter(d => (!reasonFilter.value || d.reason === reasonFilter.value)
    && (!s || `${d.dealershipName} ${d.dealershipCode} ${d.notes} ${d.competitor} ${d.ownerName} ${d.dealerGroup} ${d.city} ${d.state}`.toLowerCase().includes(s)))
})
const DEAL_LIMIT = 50
const showAll = ref(false)
const shownDeals = computed(() => showAll.value ? deals.value : deals.value.slice(0, DEAL_LIMIT))
function pickReason(reason: string) {
  reasonFilter.value = reasonFilter.value === reason ? null : reason
  showAll.value = false
  nextTick(() => document.getElementById('lost-deals')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}
const openDeal = (d: LostDeal) => navigateTo(`/crm/dealership/${d.dealershipId}?tab=history`)
const fmtDate = (iso?: string | null) => iso ? format(new Date(iso), 'MMM d, yyyy') : '—'

// ─── Fix a reason ───
const editing = ref<LostDeal | null>(null)
const editForm = ref({ lostReason: '', lostNotes: '', lostCompetitor: '' })
const editError = ref('')
const saving = ref(false)
function editReason(d: LostDeal) {
  editing.value = d
  editForm.value = { lostReason: d.reason === 'Not recorded' ? '' : d.reason, lostNotes: d.notes || '', lostCompetitor: d.competitor || '' }
  editError.value = ''
}
async function saveReason() {
  const d = editing.value, f = editForm.value
  if (!d) return
  if (!f.lostReason) { editError.value = 'Pick a reason'; return }
  if (f.lostReason === 'Other' && !f.lostNotes.trim()) { editError.value = 'Describe the reason in the notes'; return }
  saving.value = true
  try {
    await updateReason(d, { lostReason: f.lostReason, lostNotes: f.lostNotes.trim(), lostCompetitor: f.lostCompetitor.trim() })
    toast.success(`Reason saved for ${d.dealershipName}`)
    editing.value = null
    await reload()
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save the reason') } finally { saving.value = false }
}

// ─── CSV ───
function exportCsv() {
  const rows = deals.value
  if (!rows.length) return
  const cols: [string, (d: LostDeal) => any][] = [
    ['Dealership ID', d => d.dealershipCode], ['Dealership', d => d.dealershipName], ['Reason', d => d.reason], ['Competitor', d => d.competitor],
    ['Notes', d => d.notes], ['Lost at stage', d => d.fromStage], ['Furthest stage', d => d.furthestStage], ['Had meeting', d => d.hadMeeting ? 'Yes' : 'No'],
    ['Lost date', d => d.lostAt ? format(new Date(d.lostAt), 'yyyy-MM-dd') : ''], ['Lost by', d => d.lostBy?.name || ''], ['Owner', d => d.ownerName],
    ['Lead source', d => d.leadSource], ['Dealer group', d => d.dealerGroup], ['Brands', d => (d.brands || []).join('; ')], ['City', d => d.city], ['State', d => d.state],
    ['Territory', d => d.territory], ['Days in pipeline', d => d.daysInPipeline ?? ''], ['Last template', d => d.lastEmail ? `${d.lastEmail.templateName}${d.lastEmail.version ? ` (${d.lastEmail.version})` : ''}` : ''],
    ['Reopened', d => d.reopenedAt ? format(new Date(d.reopenedAt), 'yyyy-MM-dd') : ''],
  ]
  const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = [cols.map(c => c[0]).join(','), ...rows.map(d => cols.map(c => esc(c[1](d))).join(','))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `lost-deals-${format(new Date(), 'yyyy-MM-dd')}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<template>
  <div class="space-y-5">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <Button variant="outline" size="sm" class="h-9 gap-1.5" :disabled="!deals.length" @click="exportCsv"><Download class="size-4" /> Export CSV</Button>
        <Button variant="outline" size="icon" class="size-9" aria-label="Refresh" :disabled="loading" @click="reload(false)"><RefreshCw class="size-4" :class="loading && 'animate-spin'" /></Button>
      </Teleport>
    </ClientOnly>

    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-2">
      <Select v-model="range">
        <SelectTrigger class="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem v-for="o in RANGES" :key="o.key" :value="o.key">{{ o.label }}</SelectItem></SelectContent>
      </Select>
      <Select v-model="ownerId">
        <SelectTrigger class="h-9 w-[170px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent class="max-h-72"><SelectItem value="all">All owners</SelectItem><SelectItem v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</SelectItem></SelectContent>
      </Select>
      <Select v-model="stage">
        <SelectTrigger class="h-9 w-[210px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent class="max-h-72">
          <SelectItem value="all">Lost at any stage</SelectItem>
          <SelectItem v-for="s in [...OPEN_STAGES, NURTURE_STAGE]" :key="s" :value="s"><span class="flex items-center gap-2"><span class="size-1.5 rounded-full" :class="STAGE_STYLE[s]?.dot" />Lost at {{ s }}</span></SelectItem>
        </SelectContent>
      </Select>
      <label class="h-9 inline-flex items-center gap-2 rounded-md border px-3 text-xs cursor-pointer select-none" title="Count deals that were lost and later re-opened">
        <Switch v-model="includeReopened" /> Include re-opened
      </label>
      <Loader2 v-if="loading && r" class="size-4 animate-spin text-muted-foreground" />
    </div>

    <div v-if="!r" class="flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Loading lost deals…</div>

    <div v-else-if="r && !r.total" class="rounded-xl border bg-card px-6 py-16 text-center">
      <CircleX class="size-8 mx-auto text-muted-foreground/50" />
      <p class="mt-3 font-medium">No lost deals in this view</p>
      <p class="text-sm text-muted-foreground mt-1">When a dealership is moved to Lost, the reason is required and it shows up here.</p>
    </div>

    <template v-else-if="r">
      <!-- Headline -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="rounded-xl border bg-card px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground">Lost deals</p>
          <p class="text-2xl font-bold tabular-nums mt-0.5">{{ r.total }}</p>
          <p class="text-[11px] text-muted-foreground">{{ r.reopened }} re-opened later{{ includeReopened ? ' (included)' : '' }}</p>
        </div>
        <div class="rounded-xl border bg-card px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground">Top reason</p>
          <p class="text-base font-semibold mt-1 truncate" :title="top?.reason">{{ top?.reason || '—' }}</p>
          <p class="text-[11px] text-muted-foreground">{{ top ? `${plural(top.count, 'deal')} · ${top.pct}% of losses` : 'No reasons recorded yet' }}</p>
        </div>
        <div class="rounded-xl border bg-card px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Handshake class="size-3" /> Lost after a meeting</p>
          <p class="text-2xl font-bold tabular-nums mt-0.5">{{ r.afterMeeting }} <span class="text-sm font-medium text-muted-foreground">{{ pctOf(r.afterMeeting) }}%</span></p>
          <p class="text-[11px] text-muted-foreground">We got in the room and still lost</p>
        </div>
        <button type="button" class="rounded-xl border bg-card px-4 py-3 text-left transition-colors" :class="r.unrecorded ? 'border-amber-500/40 hover:bg-amber-500/5' : 'cursor-default'" :disabled="!r.unrecorded" @click="pickReason('Not recorded')">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><AlertTriangle class="size-3" :class="r.unrecorded && 'text-amber-500'" /> No reason recorded</p>
          <p class="text-2xl font-bold tabular-nums mt-0.5" :class="r.unrecorded && 'text-amber-600 dark:text-amber-400'">{{ r.unrecorded }}</p>
          <p class="text-[11px] text-muted-foreground">{{ r.unrecorded ? 'Lost before tracking — click to fix' : 'Every loss has a reason' }}</p>
        </button>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-5 gap-5 items-start">
        <!-- Why we lose -->
        <section class="xl:col-span-2 rounded-xl border bg-card overflow-hidden">
          <header class="px-4 py-2.5 border-b">
            <h3 class="text-sm font-semibold">Why we lose</h3>
            <p class="text-[11px] text-muted-foreground">Share of all lost deals. Click a reason to see those deals.</p>
          </header>
          <ul class="py-1.5">
            <li v-for="x in r.byReason" :key="x.reason">
              <button type="button" class="w-full px-4 py-1.5 text-left hover:bg-muted/40 transition-colors" :class="reasonFilter === x.reason && 'bg-muted/60'" :disabled="!x.count"
                :title="`${x.reason}: ${x.count} deals (${x.pct}%) · ${x.afterMeeting} after a meeting${x.avgDaysInPipeline != null ? ` · avg ${x.avgDaysInPipeline} days in pipeline` : ''}`" @click="pickReason(x.reason)">
                <div class="flex items-baseline justify-between gap-2 text-xs">
                  <span :class="[x.count ? 'font-medium' : 'text-muted-foreground', x.reason === 'Not recorded' && 'italic text-amber-700 dark:text-amber-400']">{{ x.reason }}</span>
                  <span class="tabular-nums text-muted-foreground shrink-0"><span class="text-foreground font-semibold">{{ x.count }}</span> · {{ x.pct }}%</span>
                </div>
                <div class="mt-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div class="h-full rounded-full transition-all" :class="x.reason === 'Not recorded' ? 'bg-amber-400' : 'bg-rose-500'" :style="{ width: `${(x.count / maxReason) * 100}%` }" />
                </div>
              </button>
            </li>
          </ul>
        </section>

        <!-- Where in the pipeline -->
        <section class="xl:col-span-3 rounded-xl border bg-card overflow-hidden">
          <header class="px-4 py-2.5 border-b">
            <h3 class="text-sm font-semibold">Where in the pipeline we lose them</h3>
            <p class="text-[11px] text-muted-foreground">Stage the deal was in when it was lost × reason. Darker = more deals.</p>
          </header>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b">
                  <th class="text-left font-medium text-muted-foreground px-3 py-2 sticky left-0 bg-card">Lost at stage</th>
                  <th class="text-right font-medium text-muted-foreground px-2 py-2">Total</th>
                  <th v-for="reason in heatReasons" :key="reason" class="font-medium text-muted-foreground px-1 py-2 align-bottom">
                    <span class="block w-16 mx-auto text-center leading-tight text-[10px]">{{ reason }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in heatRows" :key="row.key" class="border-b last:border-0">
                  <td class="px-3 py-1.5 whitespace-nowrap sticky left-0 bg-card"><span class="inline-flex items-center gap-1.5"><span class="size-1.5 rounded-full" :class="STAGE_STYLE[row.key]?.dot || 'bg-muted-foreground'" />{{ row.key }}</span></td>
                  <td class="px-2 py-1.5 text-right tabular-nums font-semibold">{{ row.count }}</td>
                  <td v-for="reason in heatReasons" :key="reason" class="p-0.5">
                    <div class="h-7 rounded flex items-center justify-center tabular-nums" :class="!row.reasons[reason] && 'text-muted-foreground/30'" :style="heatStyle(row.reasons[reason] || 0)"
                      :title="`${row.key} · ${reason}: ${row.reasons[reason] || 0} deals`">{{ row.reasons[reason] || '·' }}</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="r.competitors.length" class="border-t px-4 py-3">
            <p class="text-xs font-semibold flex items-center gap-1.5 mb-2"><Swords class="size-3.5 text-muted-foreground" /> Lost to competitors</p>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="c in r.competitors" :key="c.name" class="rounded-full border px-2.5 py-0.5 text-xs">{{ c.name }} <span class="font-semibold tabular-nums">{{ c.count }}</span></span>
            </div>
          </div>
        </section>
      </div>

      <!-- Breakdown by dimension -->
      <section class="rounded-xl border bg-card overflow-hidden">
        <header class="px-4 py-2.5 border-b flex flex-wrap items-center gap-3">
          <div class="mr-auto">
            <h3 class="text-sm font-semibold">Losses by {{ DIMENSIONS.find(d => d.key === dim)?.label.toLowerCase() }}</h3>
            <p class="text-[11px] text-muted-foreground">Count, share of all losses, and the main reasons in each group.</p>
          </div>
          <div class="inline-flex rounded-lg border p-0.5 bg-muted/40">
            <button v-for="d in DIMENSIONS" :key="d.key" type="button" class="px-2.5 py-1 rounded-md text-xs transition-colors" :class="dim === d.key ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'" @click="dim = d.key">{{ d.label }}</button>
          </div>
        </header>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="border-b text-muted-foreground">
                <th class="text-left font-medium px-4 py-2">{{ DIMENSIONS.find(d => d.key === dim)?.label }}</th>
                <th class="text-right font-medium px-2 py-2 w-16">Lost</th>
                <th class="text-left font-medium px-2 py-2 w-[30%]">Share</th>
                <th class="text-left font-medium px-4 py-2">Main reasons</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in dimRows" :key="row.key" class="border-b last:border-0 hover:bg-muted/30">
                <td class="px-4 py-2 font-medium whitespace-nowrap">{{ dim === 'byMonth' ? monthLabel(row.key) : row.key }}</td>
                <td class="px-2 py-2 text-right tabular-nums font-semibold">{{ row.count }}</td>
                <td class="px-2 py-2">
                  <div class="flex items-center gap-2">
                    <div class="h-2 flex-1 rounded-full bg-muted overflow-hidden"><div class="h-full rounded-full bg-rose-500" :style="{ width: `${(row.count / dimMax) * 100}%` }" /></div>
                    <span class="tabular-nums text-muted-foreground w-10 text-right">{{ row.pct }}%</span>
                  </div>
                </td>
                <td class="px-4 py-2">
                  <span v-for="([reason, n], i) in topReasonsOf(row)" :key="reason" class="text-muted-foreground"><span v-if="i">, </span><span class="text-foreground">{{ reason }}</span> {{ n }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Deals -->
      <section id="lost-deals" class="rounded-xl border bg-card overflow-hidden scroll-mt-4">
        <header class="px-4 py-2.5 border-b flex flex-wrap items-center gap-2">
          <h3 class="text-sm font-semibold mr-1">Lost deals</h3>
          <span class="rounded-full px-1.5 py-0.5 text-[10px] tabular-nums leading-none font-semibold bg-muted">{{ deals.length }}</span>
          <button v-if="reasonFilter" type="button" class="inline-flex items-center gap-1 rounded-full bg-rose-500/10 text-rose-700 dark:text-rose-300 px-2 py-0.5 text-xs" @click="reasonFilter = null">{{ reasonFilter }} <X class="size-3" /></button>
          <Input v-model="q" placeholder="Search dealership, notes, competitor…" class="h-8 w-64 ml-auto text-xs" />
        </header>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="border-b text-muted-foreground">
                <th class="text-left font-medium px-4 py-2">Dealership</th>
                <th class="text-left font-medium px-2 py-2">Reason</th>
                <th class="text-left font-medium px-2 py-2 min-w-[220px]">Notes</th>
                <th class="text-left font-medium px-2 py-2">Lost at</th>
                <th class="text-left font-medium px-2 py-2">Owner</th>
                <th class="text-left font-medium px-2 py-2">Date</th>
                <th class="text-right font-medium px-2 py-2">Days</th>
                <th class="w-16" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in shownDeals" :key="`${d.id || 'legacy'}-${d.dealershipId}`" class="group border-b last:border-0 hover:bg-muted/30 cursor-pointer" @click="openDeal(d)">
                <td class="px-4 py-2">
                  <p class="font-medium group-hover:text-primary">{{ d.dealershipName }}</p>
                  <p class="text-[10px] text-muted-foreground"><span class="font-mono">{{ d.dealershipCode }}</span><template v-if="d.city || d.state"> · {{ [d.city, d.state].filter(Boolean).join(', ') }}</template><template v-if="d.dealerGroup"> · {{ d.dealerGroup }}</template></p>
                </td>
                <td class="px-2 py-2 whitespace-nowrap">
                  <span class="rounded-full px-2 py-0.5 text-[11px]" :class="d.reason === 'Not recorded' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 italic' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'">{{ d.reason }}</span>
                  <p v-if="d.competitor" class="text-[10px] text-muted-foreground mt-0.5">to {{ d.competitor }}</p>
                  <p v-if="d.reopenedAt" class="text-[10px] text-emerald-600 mt-0.5 inline-flex items-center gap-0.5"><Undo2 class="size-3" /> re-opened {{ fmtDate(d.reopenedAt) }}</p>
                </td>
                <td class="px-2 py-2 text-muted-foreground"><p class="line-clamp-2" :title="d.notes">{{ d.notes || '—' }}</p></td>
                <td class="px-2 py-2 whitespace-nowrap">
                  <span v-if="d.fromStage" class="inline-flex items-center gap-1"><span class="size-1.5 rounded-full" :class="STAGE_STYLE[d.fromStage]?.dot" />{{ d.fromStage }}</span>
                  <span v-else class="text-muted-foreground">Before tracking</span>
                  <p v-if="d.hadMeeting" class="text-[10px] text-muted-foreground">after a meeting</p>
                </td>
                <td class="px-2 py-2 whitespace-nowrap">{{ d.ownerName || '—' }}</td>
                <td class="px-2 py-2 whitespace-nowrap tabular-nums">{{ fmtDate(d.lostAt) }}</td>
                <td class="px-2 py-2 text-right tabular-nums">{{ d.daysInPipeline ?? '—' }}</td>
                <td class="px-2 py-2" @click.stop>
                  <div class="flex items-center justify-end gap-0.5">
                    <Button v-if="canEdit && !d.reopenedAt" variant="ghost" size="icon" class="size-7" :title="d.reason === 'Not recorded' ? 'Set reason' : 'Edit reason'" @click="editReason(d)"><Pencil class="size-3.5" :class="d.reason === 'Not recorded' && 'text-amber-600'" /></Button>
                    <ChevronRight class="size-4 text-muted-foreground/60 group-hover:text-primary" />
                  </div>
                </td>
              </tr>
              <tr v-if="!deals.length"><td colspan="8" class="px-4 py-8 text-center text-muted-foreground">No deals match.</td></tr>
            </tbody>
          </table>
        </div>
        <button v-if="deals.length > DEAL_LIMIT" type="button" class="w-full border-t px-4 py-2 text-xs text-primary hover:bg-muted/40" @click="showAll = !showAll">{{ showAll ? 'Show fewer' : `Show all ${deals.length}` }}</button>
      </section>
    </template>

    <Dialog :open="!!editing" @update:open="(o: boolean) => { if (!o) editing = null }">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Why was {{ editing?.dealershipName }} lost?</DialogTitle>
          <DialogDescription class="text-xs">Corrects the reason on this loss. The report updates right away.</DialogDescription>
        </DialogHeader>
        <CrmLostReasonFields v-model="editForm" :error="editError" />
        <DialogFooter>
          <Button variant="ghost" @click="editing = null">Cancel</Button>
          <Button :disabled="saving" @click="saveReason"><Loader2 v-if="saving" class="size-4 animate-spin" /> Save reason</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
