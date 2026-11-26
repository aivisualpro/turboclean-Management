<script setup lang="ts">
import { RefreshCw, Loader2, Search, Send, Phone, Footprints, RefreshCcw, MessagesSquare, CalendarCheck, Store, FileText, Trophy, XCircle, DollarSign, TrendingUp, Clock, Gauge, Target, ArrowRight, Users } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { endOfDay, format, parseISO, startOfDay, startOfMonth, startOfQuarter, startOfWeek } from 'date-fns'
import { money } from '~/composables/useCrmWon'
import { localDay } from '~/composables/useCrmDealerships'
import { STAGE_STYLE } from '~/constants/crm'

/**
 * Main CRM dashboard — what was done, how far new dealerships got, what it earned, for a chosen period.
 * Every number has an "i" that says exactly what it counts. "Researched for the first time" is one
 * group used in three places (Activity, funnel start, funnel's Researched row), so they always match.
 */
const { setHeader } = usePageHeader()
setHeader({ title: 'CRM Dashboard', icon: 'i-lucide-layout-dashboard' })
const { user: me } = useAuth()

const RANGES = [{ key: 'today', label: 'Today' }, { key: 'week', label: 'This week' }, { key: 'month', label: 'This month' }, { key: 'quarter', label: 'This quarter' }, { key: 'custom', label: 'Custom' }] as const
const range = useLocalStorage<string>('crm-dash-range', 'week')
const customFrom = useLocalStorage<string>('crm-dash-from', localDay(startOfMonth(new Date())))
const customTo = useLocalStorage<string>('crm-dash-to', localDay(new Date()))
const scope = useLocalStorage<string>('crm-dash-scope', 'all')
const funnelMode = useLocalStorage<'cohort' | 'period'>('crm-dash-funnel', 'cohort')
const users = ref<{ id: string, name: string }[]>([])
onMounted(async () => { try { const res = await $fetch<any[]>('/api/users'); users.value = (res || []).filter(u => u.status !== 'Inactive').map(u => ({ id: u.id, name: u.name || u.email })).sort((a, b) => a.name.localeCompare(b.name)) } catch {} })

const window_ = computed(() => {
  const now = new Date()
  let a: Date, b: Date = endOfDay(now)
  switch (range.value) {
    case 'today': a = startOfDay(now); break
    case 'month': a = startOfMonth(now); break
    case 'quarter': a = startOfQuarter(now); break
    case 'custom': a = startOfDay(parseISO(customFrom.value || localDay(now))); b = endOfDay(parseISO(customTo.value || localDay(now))); break
    default: a = startOfWeek(now, { weekStartsOn: 1 })
  }
  if (b < a) b = endOfDay(a)
  return { from: localDay(a), to: localDay(b), fromTs: a.toISOString(), toTs: b.toISOString() }
})
const label = computed(() => window_.value.from === window_.value.to ? format(parseISO(window_.value.from), 'EEE, MMM d, yyyy') : `${format(parseISO(window_.value.from), 'MMM d')} – ${format(parseISO(window_.value.to), 'MMM d, yyyy')}`)
/** Who the numbers are about, when one person is picked. */
const person = computed(() => scope.value === 'all' ? '' : scope.value === 'mine' ? 'you' : (users.value.find(u => u.id === scope.value)?.name || 'this person'))

const data = ref<any>(null)
const loading = ref(false)
async function load(quiet = true) {
  loading.value = true
  try {
    data.value = await $fetch('/api/crm/dashboard', { query: { ...window_.value, scope: scope.value } })
    if (!quiet) toast.success('Dashboard refreshed')
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not load the dashboard') } finally { loading.value = false }
}
// The period and person are remembered in this browser, so the page is drawn and loaded in the browser only
// (the server can't see them — drawing it there first showed the wrong period for a moment).
onMounted(() => watch([window_, scope], () => load(), { immediate: true }))

const d = computed(() => data.value)
const fmt = (v: number | null | undefined, suffix = '') => v == null ? '—' : `${v.toLocaleString()}${suffix}`
const firstTimeSplit = (total: number, first: number | undefined) => first == null ? '' : `${first.toLocaleString()} first time · ${(total - first).toLocaleString()} again`

interface Tile { label: string, value: string, unit?: string, icon: any, hint: string, sub?: string, subTone?: 'warn', to?: string, toLabel?: string, tone?: 'good' }
const activityTiles = computed<Tile[]>(() => {
  const a = d.value?.activity
  if (!a) return []
  return [
    { label: 'Researched', value: fmt(a.researched), unit: 'dealerships', icon: Search, sub: firstTimeSplit(a.researched, a.newlyResearched),
      hint: 'Dealerships worked on in this period: research logged, an inventory audit (by hand or an automatic scan), or moved to Researched.\n\nFirst time = never researched before. These are the dealerships the funnel below starts with.\nAgain = researched before and worked on again now.\n\nOnly dealerships still in the CRM count (not archived or merged).' },
    { label: 'Contacted', value: fmt(a.contacted), unit: 'dealerships', icon: Store, sub: firstTimeSplit(a.contacted, a.newlyContacted),
      hint: 'Dealerships reached by email, call, text, walk-in or follow-up in this period.\n\nFirst time = never contacted before.\nAgain = contacted before and contacted again now.' },
    { label: 'Emails sent', value: fmt(a.emails), icon: Send, hint: 'Every email sent in this period. One dealership can get several.' },
    { label: 'Calls', value: fmt(a.calls), icon: Phone, sub: `${fmt(a.connectedCalls)} connected`, hint: 'Calls, voicemails and texts logged in this period.\nConnected = you actually spoke to someone.' },
    { label: 'Walk-ins', value: fmt(a.walkIns), icon: Footprints, hint: 'In-person visits logged in this period.' },
    { label: 'Follow-ups', value: fmt(a.followUps), icon: RefreshCcw, hint: 'Follow-ups logged in this period.' },
    { label: 'Conversations', value: fmt(a.conversations), icon: MessagesSquare, hint: 'Real two-way conversations: connected calls plus conversations logged.' },
    { label: 'Meetings held', value: fmt(a.meetingsHeld), icon: CalendarCheck, sub: `${fmt(a.meetingsScheduled)} booked`, hint: 'Meetings that took place in this period.\nBooked = meetings scheduled in this period (they may happen later).' },
  ]
})
const resultTiles = computed<Tile[]>(() => {
  const r = d.value?.results
  if (!r) return []
  return [
    { label: 'New meetings', value: fmt(r.meetingsGenerated), icon: CalendarCheck, hint: 'Dealerships that got their first meeting (booked or held) in this period.' },
    { label: 'New proposals', value: fmt(r.proposalsGenerated), icon: FileText, hint: 'Dealerships sent their first proposal in this period.' },
    { label: 'Accounts won', value: fmt(r.won), icon: Trophy, sub: r.wonWithoutDetails ? `+${r.wonWithoutDetails} won without deal details` : undefined, subTone: 'warn', hint: 'Deals marked won in this period.\n\nWon without deal details = marked Won but the deal value was never filled in, so it is not in the revenue.' },
    { label: 'Accounts lost', value: fmt(r.lost), icon: XCircle, hint: 'Deals marked lost in this period (re-opened ones are not counted).' },
    { label: 'Monthly revenue won', value: money(r.monthlyRevenueWon), icon: DollarSign, hint: 'Monthly value of the deals won in this period.' },
    { label: 'Yearly revenue won', value: money(r.annualRevenueWon), icon: TrendingUp, tone: 'good', hint: 'The same deals\' value over a full year (monthly × 12, or the yearly figure entered on the deal).' },
  ]
})
const efficiencyTiles = computed<Tile[]>(() => {
  const e = d.value?.efficiency
  if (!e) return []
  return [
    { label: 'Hours prospecting', value: fmt(e.hours), icon: Clock, to: '/crm/time', toLabel: 'Time & ROI', hint: 'Time logged on the Time page in this period.' },
    { label: 'Meetings per 100 contacted', value: fmt(e.meetingsPer100Contacted), icon: CalendarCheck, sub: `${fmt(e.contacted)} dealerships contacted`, hint: 'New meetings ÷ dealerships contacted, × 100.\nExample: 5 = one meeting for every 20 dealerships contacted.' },
    { label: 'Wins per 100 contacted', value: fmt(e.wonPer100Contacted), icon: Trophy, hint: 'Accounts won ÷ dealerships contacted, × 100.' },
    { label: 'Hours per meeting', value: fmt(e.hoursPerMeeting), icon: Gauge, hint: 'Hours prospecting ÷ new meetings.' },
    { label: 'Hours per won account', value: fmt(e.hoursPerAccount), icon: Target, hint: 'Hours prospecting ÷ accounts won.' },
    { label: 'Revenue per hour', value: e.annualRevenuePerHour == null ? '—' : money(e.annualRevenuePerHour), icon: DollarSign, tone: 'good', hint: 'Yearly revenue won ÷ hours prospecting.' },
  ]
})

// ─── Funnel ───
const funnel = computed<any[]>(() => d.value?.funnel?.[funnelMode.value] || [])
const funnelMax = computed(() => Math.max(1, ...funnel.value.map((r: any) => r.count)))
const startCount = computed(() => funnel.value[0]?.count ?? 0)
const funnelTitle = (r: any, i: number) => {
  if (funnelMode.value !== 'cohort' || !i) return `${r.label}: ${r.count.toLocaleString()} dealerships`
  const prev = funnel.value[i - 1]
  return `${r.count.toLocaleString()} of the ${prev.count.toLocaleString()} that got to ${prev.label} moved on to ${r.label}` + (r.ofFirst != null ? ` (${r.ofFirst}% of all ${startCount.value.toLocaleString()} researched)` : '')
}

// ─── Outreach chart ───
const series = computed<any[]>(() => d.value?.series || [])
const showChart = computed(() => (d.value?.range?.days ?? 1) > 1 && series.value.length > 1)
const seriesTotal = computed(() => series.value.reduce((n, s) => n + s.total, 0))
const seriesMax = computed(() => Math.max(1, ...series.value.map((s: any) => s.total)))
const PARTS = [
  { key: 'emails', label: 'Emails', cls: 'bg-primary' },
  { key: 'calls', label: 'Calls', cls: 'bg-sky-500' },
  { key: 'visits', label: 'Walk-ins', cls: 'bg-amber-500' },
  { key: 'other', label: 'Follow-ups & other', cls: 'bg-zinc-400 dark:bg-zinc-500' },
] as const
const bucketLabel = (s: any, long = false) => d.value?.range.bucket === 'week' ? `${long ? 'Week of ' : ''}${format(parseISO(s.key), 'MMM d')}` : format(parseISO(s.key), long ? 'EEE, MMM d' : 'MMM d')
const seriesTitle = (s: any) => `${bucketLabel(s, true)}: ${s.total} touch${s.total === 1 ? '' : 'es'}\nEmails ${s.emails} · Calls ${s.calls} · Walk-ins ${s.visits} · Follow-ups & other ${s.other}`
/** Date labels under the bars: about eight of them, always including the last one. */
const labelEvery = computed(() => Math.max(1, Math.ceil(series.value.length / 8)))
const showLabel = (i: number) => i === series.value.length - 1 || (i % labelEvery.value === 0 && series.value.length - 1 - i >= labelEvery.value / 2)
</script>

<template>
  <ClientOnly>
  <div class="space-y-2">
    <!-- Filters live in the main header -->
    <Teleport to="#page-header-actions">
      <Loader2 v-if="loading && d" class="size-4 shrink-0 animate-spin text-muted-foreground" />
      <PeriodPicker v-model="range" v-model:from="customFrom" v-model:to="customTo" :ranges="RANGES" :label="label" />
      <Select v-model="scope">
        <SelectTrigger size="sm" class="h-8 w-[150px] text-xs" aria-label="Whose numbers"><SelectValue /></SelectTrigger>
        <SelectContent class="max-h-72">
          <SelectItem value="all">Everyone</SelectItem>
          <SelectItem value="mine">Mine{{ (me as any)?.name ? ` (${(me as any).name})` : '' }}</SelectItem>
          <SelectItem v-for="u in users.filter(u => u.id !== (me as any)?.id)" :key="u.id" :value="u.id">{{ u.name }}</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="outline" size="icon" class="size-8" aria-label="Refresh" :disabled="loading" @click="load(false)"><RefreshCw class="size-4" :class="loading && 'animate-spin'" /></Button>
    </Teleport>

    <p v-if="person" class="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="person-note">
      <Users class="size-3.5 shrink-0" />
      <span><b class="font-medium text-foreground">Activity</b> counts the work {{ person }} logged. <b class="font-medium text-foreground">Funnel, results and pipeline</b> count the dealerships {{ person === 'you' ? 'you own' : `${person} owns` }}.</span>
    </p>

    <div v-if="!d" class="flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Loading dashboard…</div>

    <template v-else>
      <!-- 1. Activity -->
      <section class="space-y-2" aria-labelledby="dash-activity">
        <h2 id="dash-activity" class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Activity <span class="normal-case tracking-normal font-normal">— what was done {{ label }}</span></h2>
        <div class="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
          <div v-for="t in activityTiles" :key="t.label" class="rounded-xl border bg-card px-3 py-2.5 min-w-0" :data-testid="`tile-${t.label}`">
            <p class="text-[11px] text-muted-foreground flex items-center gap-1.5"><component :is="t.icon" class="size-3.5 shrink-0" /><span class="truncate">{{ t.label }}</span><CrmHint :text="t.hint" :label="t.label" /></p>
            <p class="text-2xl font-bold tabular-nums mt-1">{{ t.value }}<span v-if="t.unit" class="ml-1 text-xs font-normal text-muted-foreground">{{ t.unit }}</span></p>
            <p v-if="t.sub" class="text-[11px] text-muted-foreground tabular-nums">{{ t.sub }}</p>
          </div>
        </div>

        <div v-if="showChart" class="rounded-xl border bg-card px-3 pt-2.5 pb-2" data-testid="outreach-chart">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
            <p class="text-xs font-medium flex items-center gap-1.5">Outreach per {{ d.range.bucket }}
              <CrmHint text="Every email, call, walk-in and follow-up logged, per day (per week for long periods). Hover a bar for the breakdown." label="Outreach per day" />
            </p>
            <span class="text-[11px] text-muted-foreground tabular-nums">{{ seriesTotal.toLocaleString() }} in total</span>
            <div class="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
              <span v-for="p in PARTS" :key="p.key" class="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><span class="size-2 rounded-sm" :class="p.cls" />{{ p.label }}</span>
            </div>
          </div>
          <p v-if="!seriesTotal" class="py-6 text-center text-xs text-muted-foreground">No emails, calls or walk-ins logged in this period.</p>
          <template v-else>
            <div class="relative h-28 border-b border-border">
              <span class="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border/70" />
              <span class="pointer-events-none absolute -top-2 right-0 bg-card pl-1 text-[10px] tabular-nums text-muted-foreground">{{ seriesMax }}</span>
              <div class="absolute inset-0 flex items-end gap-1 pt-4">
                <div v-for="s in series" :key="s.key" class="group relative flex h-full min-w-0 flex-1 flex-col justify-end" :title="seriesTitle(s)" :data-total="s.total">
                  <span v-if="s.total && series.length <= 31" class="mb-0.5 text-center text-[10px] font-medium tabular-nums text-muted-foreground group-hover:text-foreground">{{ s.total }}</span>
                  <div class="mx-auto flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-t transition-opacity group-hover:opacity-80" :style="{ height: `${(s.total / seriesMax) * 100}%` }">
                    <div v-for="p in PARTS" :key="p.key" :class="p.cls" :style="{ height: s.total ? `${(s[p.key] / s.total) * 100}%` : '0' }" />
                  </div>
                </div>
              </div>
            </div>
            <div class="mt-1 flex gap-1">
              <span v-for="(s, i) in series" :key="s.key" class="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-[10px] text-muted-foreground"><template v-if="showLabel(i)">{{ bucketLabel(s) }}</template></span>
            </div>
          </template>
        </div>
      </section>

      <!-- Funnel and Results sit side by side at the same height -->
      <div class="grid grid-cols-1 xl:grid-cols-5 gap-2 items-stretch">
        <!-- 2. Funnel -->
        <section class="xl:col-span-3 rounded-xl border bg-card overflow-hidden flex flex-col" data-testid="funnel">
          <header class="px-3 py-2.5 border-b flex flex-wrap items-start gap-2">
            <div class="mr-auto min-w-0">
              <h3 class="text-sm font-semibold flex items-center gap-1.5">Funnel
                <CrmHint text="Each step counts a dealership once, the first time it got there. Reaching a later step counts the earlier ones too (a meeting means it was contacted)." label="the funnel" />
              </h3>
              <p v-if="funnelMode === 'cohort'" class="text-[11px] text-muted-foreground">The <b class="font-medium text-foreground">{{ startCount.toLocaleString() }}</b> dealerships researched for the first time in this period, and how far they have got so far.</p>
              <p v-else class="text-[11px] text-muted-foreground">How many dealerships reached each step for the first time in this period — including ones first researched earlier.</p>
            </div>
            <div class="inline-flex rounded-md border p-0.5 bg-muted/40 text-[11px]" role="tablist" aria-label="Funnel view">
              <button type="button" role="tab" :aria-selected="funnelMode === 'cohort'" class="px-2 py-0.5 rounded" :class="funnelMode === 'cohort' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'" title="Follow the dealerships first researched in this period" @click="funnelMode = 'cohort'">New dealerships</button>
              <button type="button" role="tab" :aria-selected="funnelMode === 'period'" class="px-2 py-0.5 rounded" :class="funnelMode === 'period' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'" title="Every dealership that reached a step in this period" @click="funnelMode = 'period'">All dealerships</button>
            </div>
          </header>
          <div class="p-3 flex flex-1 flex-col">
            <div class="grid grid-cols-[96px_1fr_92px] items-end gap-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <span>Step</span><span>Dealerships</span><span class="text-right">{{ funnelMode === 'cohort' ? 'Moved on' : '' }}</span>
            </div>
            <div class="flex flex-1 flex-col gap-1.5">
              <div v-for="(r, i) in funnel" :key="r.key" class="grid flex-1 grid-cols-[96px_1fr_92px] items-center gap-3" :title="funnelTitle(r, i)" :data-step="r.key">
                <span class="text-xs font-medium">{{ r.label }}</span>
                <div class="h-7 rounded-md bg-muted/50 overflow-hidden relative">
                  <div class="h-full rounded-md transition-all" :class="r.key === 'won' ? 'bg-emerald-500' : 'bg-primary'" :style="{ width: `${Math.max(r.count ? 2 : 0, (r.count / funnelMax) * 100)}%`, opacity: 1 - i * 0.07 }" />
                  <span class="absolute inset-y-0 flex items-center text-xs font-semibold tabular-nums" :class="r.count / funnelMax > 0.12 ? 'text-primary-foreground' : ''" :style="{ left: r.count / funnelMax > 0.12 ? '8px' : `calc(${Math.max(r.count ? 2 : 0, (r.count / funnelMax) * 100)}% + 8px)` }">{{ r.count.toLocaleString() }}</span>
                </div>
                <span class="text-right text-xs tabular-nums">
                  <template v-if="funnelMode === 'cohort' && i">
                    <span class="font-semibold">{{ fmt(r.ofPrevious, '%') }}</span>
                  </template>
                </span>
              </div>
            </div>
            <p class="mt-2.5 pt-2 border-t text-[11px] text-muted-foreground">
              <template v-if="funnelMode === 'cohort'">
                <template v-if="!startCount">No dealerships were researched for the first time in this period.</template>
                <template v-else><b class="font-medium text-foreground">Moved on</b> = share of the step above that got to this step. Researched here is the same {{ startCount.toLocaleString() }} as “first time” under Researched in Activity.</template>
              </template>
              <template v-else>No percentages here: each step can be a different set of dealerships, so they can’t be compared.</template>
            </p>
          </div>
        </section>

        <!-- 3. Results + pipeline -->
        <section class="xl:col-span-2 rounded-xl border bg-card overflow-hidden flex flex-col" data-testid="results">
          <header class="px-3 py-2.5 border-b"><h3 class="text-sm font-semibold">Results in this period</h3></header>
          <div class="grid grid-cols-2 divide-x divide-y">
            <div v-for="t in resultTiles" :key="t.label" class="p-3 min-w-0">
              <p class="text-[11px] text-muted-foreground flex items-center gap-1"><component :is="t.icon" class="size-3 shrink-0" /><span class="truncate">{{ t.label }}</span><CrmHint :text="t.hint" :label="t.label" /></p>
              <p class="text-xl font-bold tabular-nums" :class="t.tone === 'good' && 'text-emerald-700 dark:text-emerald-400'">{{ t.value }}</p>
              <p v-if="t.sub" class="text-[10px]" :class="t.subTone === 'warn' ? 'text-amber-600' : 'text-muted-foreground'">{{ t.sub }}</p>
            </div>
          </div>
          <div class="border-t p-3 flex-1">
            <div class="flex items-baseline justify-between gap-2">
              <p class="text-xs font-medium flex items-center gap-1.5">Pipeline right now
                <CrmHint :text="`Open deals from Meeting Scheduled to Negotiating, as of today — the dates above don't change it.\n\nLikely value counts each deal at its stage's chance of closing (Meeting Scheduled 15% … Negotiating 70%).\n\nDeals without an estimated monthly value use your average won deal (${money(d.results.pipeline.avgWonAnnual)} a year).`" label="pipeline" />
              </p>
              <p class="text-[11px] text-muted-foreground">{{ d.results.pipeline.deals }} open deal{{ d.results.pipeline.deals === 1 ? '' : 's' }}</p>
            </div>
            <p class="mt-0.5"><span class="text-xl font-bold tabular-nums">{{ money(d.results.pipeline.weightedAnnualValue) }}</span> <span class="text-xs text-muted-foreground">likely a year · {{ money(d.results.pipeline.annualValue) }} if every deal closes</span></p>
            <div class="mt-2 space-y-1">
              <div class="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground"><span class="flex-1">Stage · chance of closing</span><span>Deals</span><span class="w-20 text-right">Likely</span></div>
              <div v-for="s in d.results.pipeline.byStage" :key="s.stage" class="flex items-center gap-2 text-[11px]" :title="`${s.stage}: ${s.deals} deals worth ${money(s.value)} a year, counted at ${Math.round(s.weight * 100)}%`">
                <span class="size-1.5 rounded-full shrink-0" :class="STAGE_STYLE[s.stage]?.dot" /><span class="flex-1 truncate">{{ s.stage }} <span class="text-muted-foreground">· {{ Math.round(s.weight * 100) }}%</span></span>
                <span class="tabular-nums text-muted-foreground">{{ s.deals }}</span><span class="tabular-nums w-20 text-right font-medium">{{ money(s.weighted) }}</span>
              </div>
            </div>
            <p v-if="d.results.pipeline.deals" class="text-[10px] text-muted-foreground mt-2">{{ d.results.pipeline.estimated }} of {{ d.results.pipeline.deals }} deals have their own estimate.</p>
          </div>
        </section>
      </div>

      <!-- 4. Efficiency -->
      <section class="space-y-2" aria-labelledby="dash-efficiency">
        <h2 id="dash-efficiency" class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Efficiency <span class="normal-case tracking-normal font-normal">— what the time spent produced</span></h2>
        <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          <div v-for="t in efficiencyTiles" :key="t.label" class="rounded-xl border bg-card px-3 py-2.5 min-w-0" :class="t.tone === 'good' && 'bg-emerald-500/5'">
            <p class="text-[11px] text-muted-foreground flex items-center gap-1.5"><component :is="t.icon" class="size-3.5 shrink-0" /><span class="truncate">{{ t.label }}</span><CrmHint :text="t.hint" :label="t.label" /></p>
            <p class="text-2xl font-bold tabular-nums mt-1">{{ t.value }}</p>
            <p v-if="t.sub" class="text-[11px] text-muted-foreground">{{ t.sub }}</p>
            <NuxtLink v-if="t.to" :to="t.to" class="text-[11px] text-primary hover:underline">{{ t.toLabel }}</NuxtLink>
          </div>
        </div>
      </section>

      <div class="flex flex-wrap gap-2 text-xs">
        <NuxtLink to="/crm/analytics" class="inline-flex items-center gap-1 text-primary hover:underline">Performance analytics <ArrowRight class="size-3" /></NuxtLink>
        <span class="text-muted-foreground">·</span>
        <NuxtLink to="/crm/won" class="inline-flex items-center gap-1 text-primary hover:underline">Won deals <ArrowRight class="size-3" /></NuxtLink>
        <span class="text-muted-foreground">·</span>
        <NuxtLink to="/crm/lost" class="inline-flex items-center gap-1 text-primary hover:underline">Lost deals <ArrowRight class="size-3" /></NuxtLink>
      </div>
    </template>
  </div>
  <template #fallback>
    <div class="flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Loading dashboard…</div>
  </template>
  </ClientOnly>
</template>
