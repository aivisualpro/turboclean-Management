<script setup lang="ts">
import { RefreshCw, Loader2, Search, Send, Phone, Footprints, RefreshCcw, MessagesSquare, CalendarCheck, Store, FileText, Trophy, XCircle, DollarSign, TrendingUp, Clock, Gauge, Target, ArrowRight } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { endOfDay, format, parseISO, startOfDay, startOfMonth, startOfQuarter, startOfWeek } from 'date-fns'
import { money } from '~/composables/useCrmWon'
import { localDay } from '~/composables/useCrmDealerships'
import { STAGE_STYLE } from '~/constants/crm'

/** Main CRM dashboard — activity, funnel, results, efficiency for a chosen period. */
const { setHeader } = usePageHeader()
setHeader({ title: 'CRM Dashboard', description: 'Activity, funnel, results and efficiency', icon: 'i-lucide-layout-dashboard' })
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

const data = ref<any>(null)
const loading = ref(false)
async function load(quiet = true) {
  loading.value = true
  try {
    data.value = await $fetch('/api/crm/dashboard', { query: { ...window_.value, scope: scope.value } })
    if (!quiet) toast.success('Dashboard refreshed')
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not load the dashboard') } finally { loading.value = false }
}
watch([window_, scope], () => load(), { immediate: true })

const d = computed(() => data.value)
const activityTiles = computed(() => d.value ? [
  { label: 'Dealerships researched', value: d.value.activity.researched, icon: Search },
  { label: 'Dealerships contacted', value: d.value.activity.contacted, icon: Store, sub: `${d.value.activity.newlyContacted} for the first time` },
  { label: 'Emails sent', value: d.value.activity.emails, icon: Send },
  { label: 'Calls', value: d.value.activity.calls, icon: Phone, sub: `${d.value.activity.connectedCalls} connected` },
  { label: 'Walk-ins', value: d.value.activity.walkIns, icon: Footprints },
  { label: 'Follow-ups', value: d.value.activity.followUps, icon: RefreshCcw },
  { label: 'Conversations', value: d.value.activity.conversations, icon: MessagesSquare },
  { label: 'Meetings', value: d.value.activity.meetingsHeld, icon: CalendarCheck, sub: `${d.value.activity.meetingsScheduled} scheduled` },
] : [])
const funnel = computed(() => d.value?.funnel?.[funnelMode.value] || [])
const funnelMax = computed(() => Math.max(1, ...funnel.value.map((r: any) => r.count)))
const seriesMax = computed(() => Math.max(1, ...(d.value?.series || []).map((s: any) => s.total)))
const seriesTitle = (s: any) => `${d.value?.range.bucket === 'week' ? 'Week of ' : ''}${format(parseISO(s.key), 'EEE, MMM d')}: ${s.total} touches\nEmails ${s.emails} · Calls ${s.calls} · Walk-ins ${s.visits} · Other ${s.other}`
const fmt = (v: number | null | undefined, suffix = '') => v == null ? '—' : `${v.toLocaleString()}${suffix}`
</script>

<template>
  <div class="space-y-5">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <Button variant="outline" size="icon" class="size-9" aria-label="Refresh" :disabled="loading" @click="load(false)"><RefreshCw class="size-4" :class="loading && 'animate-spin'" /></Button>
      </Teleport>
    </ClientOnly>

    <!-- Period -->
    <div class="flex flex-wrap items-center gap-2">
      <div class="inline-flex rounded-lg border bg-muted/40 p-0.5" role="tablist" aria-label="Date range">
        <button v-for="r in RANGES" :key="r.key" type="button" role="tab" :aria-selected="range === r.key" class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors" :class="range === r.key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'" @click="range = r.key">{{ r.label }}</button>
      </div>
      <template v-if="range === 'custom'">
        <Input v-model="customFrom" type="date" class="h-9 w-40 text-xs" aria-label="From" />
        <span class="text-xs text-muted-foreground">to</span>
        <Input v-model="customTo" type="date" class="h-9 w-40 text-xs" aria-label="To" />
      </template>
      <Select v-model="scope">
        <SelectTrigger class="h-9 w-[170px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent class="max-h-72">
          <SelectItem value="all">Everyone</SelectItem>
          <SelectItem value="mine">Mine{{ (me as any)?.name ? ` (${(me as any).name})` : '' }}</SelectItem>
          <SelectItem v-for="u in users.filter(u => u.id !== (me as any)?.id)" :key="u.id" :value="u.id">{{ u.name }}</SelectItem>
        </SelectContent>
      </Select>
      <span class="text-xs text-muted-foreground ml-1">{{ label }}</span>
      <Loader2 v-if="loading && d" class="size-4 animate-spin text-muted-foreground" />
    </div>

    <div v-if="!d" class="flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Loading dashboard…</div>

    <template v-else>
      <!-- Activity -->
      <section class="space-y-2.5">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Activity</h2>
        <div class="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
          <div v-for="t in activityTiles" :key="t.label" class="rounded-xl border bg-card px-3.5 py-3">
            <p class="text-[11px] text-muted-foreground flex items-center gap-1.5"><component :is="t.icon" class="size-3.5" /> {{ t.label }}</p>
            <p class="text-2xl font-bold tabular-nums mt-1">{{ t.value.toLocaleString() }}</p>
            <p v-if="t.sub" class="text-[10px] text-muted-foreground">{{ t.sub }}</p>
          </div>
        </div>
        <div v-if="d.series.length > 1" class="rounded-xl border bg-card px-4 pt-3 pb-2">
          <p class="text-[11px] text-muted-foreground mb-2">Outreach per {{ d.range.bucket }} (emails, calls, walk-ins, follow-ups) — hover for the breakdown</p>
          <div class="flex items-end gap-1 h-20">
            <div v-for="s in d.series" :key="s.key" class="flex-1 min-w-0 h-full flex items-end group" :title="seriesTitle(s)">
              <div class="w-full rounded-t bg-primary/70 group-hover:bg-primary transition-colors" :style="{ height: `${Math.max(3, (s.total / seriesMax) * 100)}%` }" />
            </div>
          </div>
          <div class="flex justify-between text-[10px] text-muted-foreground mt-1"><span>{{ format(parseISO(d.series[0].key), 'MMM d') }}</span><span>{{ format(parseISO(d.series[d.series.length - 1].key), 'MMM d') }}</span></div>
        </div>
      </section>

      <div class="grid grid-cols-1 xl:grid-cols-5 gap-5 items-start">
        <!-- Funnel -->
        <section class="xl:col-span-3 rounded-xl border bg-card overflow-hidden">
          <header class="px-4 py-2.5 border-b flex flex-wrap items-center gap-2">
            <div class="mr-auto">
              <h3 class="text-sm font-semibold">Funnel</h3>
              <p class="text-[11px] text-muted-foreground">{{ funnelMode === 'cohort' ? 'Dealerships that entered the funnel in this period — how far they have got so far.' : 'Dealerships that reached each step for the first time in this period.' }}</p>
            </div>
            <div class="inline-flex rounded-md border p-0.5 bg-muted/40 text-[11px]">
              <button type="button" class="px-2 py-0.5 rounded" :class="funnelMode === 'cohort' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'" @click="funnelMode = 'cohort'">Entered this period</button>
              <button type="button" class="px-2 py-0.5 rounded" :class="funnelMode === 'period' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'" @click="funnelMode = 'period'">Reached this period</button>
            </div>
          </header>
          <div class="p-4 space-y-1.5">
            <div v-for="(r, i) in funnel" :key="r.key" class="grid grid-cols-[96px_1fr_118px] items-center gap-3">
              <span class="text-xs font-medium">{{ r.label }}</span>
              <div class="h-7 rounded-md bg-muted/50 overflow-hidden relative">
                <div class="h-full rounded-md transition-all" :class="r.key === 'won' ? 'bg-emerald-500' : 'bg-primary'" :style="{ width: `${Math.max(r.count ? 2 : 0, (r.count / funnelMax) * 100)}%`, opacity: 1 - i * 0.07 }" />
                <span class="absolute inset-y-0 left-2 flex items-center text-xs font-semibold tabular-nums" :class="r.count / funnelMax > 0.12 ? 'text-primary-foreground' : ''">{{ r.count.toLocaleString() }}</span>
              </div>
              <span class="text-[11px] text-muted-foreground tabular-nums text-right">
                <template v-if="i"><span class="text-foreground font-semibold">{{ fmt(r.ofPrevious, '%') }}</span> of previous<br>{{ fmt(r.ofFirst, '%') }} of researched</template>
              </span>
            </div>
          </div>
        </section>

        <!-- Results -->
        <section class="xl:col-span-2 rounded-xl border bg-card overflow-hidden">
          <header class="px-4 py-2.5 border-b"><h3 class="text-sm font-semibold">Results</h3></header>
          <div class="grid grid-cols-2 divide-x divide-y">
            <div class="p-3"><p class="text-[11px] text-muted-foreground flex items-center gap-1"><CalendarCheck class="size-3" /> Meetings generated</p><p class="text-xl font-bold tabular-nums">{{ d.results.meetingsGenerated }}</p></div>
            <div class="p-3"><p class="text-[11px] text-muted-foreground flex items-center gap-1"><FileText class="size-3" /> Proposals generated</p><p class="text-xl font-bold tabular-nums">{{ d.results.proposalsGenerated }}</p></div>
            <div class="p-3"><p class="text-[11px] text-muted-foreground flex items-center gap-1"><Trophy class="size-3 text-emerald-600" /> Accounts won</p><p class="text-xl font-bold tabular-nums">{{ d.results.won }}</p><p v-if="d.results.wonWithoutDetails" class="text-[10px] text-amber-600">+{{ d.results.wonWithoutDetails }} without deal details</p></div>
            <div class="p-3"><p class="text-[11px] text-muted-foreground flex items-center gap-1"><XCircle class="size-3 text-rose-600" /> Accounts lost</p><p class="text-xl font-bold tabular-nums">{{ d.results.lost }}</p></div>
            <div class="p-3"><p class="text-[11px] text-muted-foreground flex items-center gap-1"><DollarSign class="size-3" /> Monthly revenue won</p><p class="text-xl font-bold tabular-nums">{{ money(d.results.monthlyRevenueWon) }}</p></div>
            <div class="p-3"><p class="text-[11px] text-muted-foreground flex items-center gap-1"><TrendingUp class="size-3" /> Annualized revenue won</p><p class="text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{{ money(d.results.annualRevenueWon) }}</p></div>
          </div>
          <div class="border-t p-3">
            <div class="flex items-baseline justify-between">
              <p class="text-[11px] text-muted-foreground">Pipeline value (open deals from meeting stage on, annualized)</p>
              <p class="text-xs text-muted-foreground">{{ d.results.pipeline.deals }} deals</p>
            </div>
            <p class="mt-0.5"><span class="text-xl font-bold tabular-nums">{{ money(d.results.pipeline.weightedAnnualValue) }}</span> <span class="text-xs text-muted-foreground">weighted · {{ money(d.results.pipeline.annualValue) }} total</span></p>
            <div class="mt-2 space-y-1">
              <div v-for="s in d.results.pipeline.byStage" :key="s.stage" class="flex items-center gap-2 text-[11px]" :title="`${s.stage}: ${s.deals} deals, ${money(s.value)} total, counted at ${Math.round(s.weight * 100)}%`">
                <span class="size-1.5 rounded-full shrink-0" :class="STAGE_STYLE[s.stage]?.dot" /><span class="flex-1 truncate">{{ s.stage }} <span class="text-muted-foreground">× {{ Math.round(s.weight * 100) }}%</span></span>
                <span class="tabular-nums text-muted-foreground">{{ s.deals }}</span><span class="tabular-nums w-20 text-right font-medium">{{ money(s.weighted) }}</span>
              </div>
            </div>
            <p class="text-[10px] text-muted-foreground mt-2">{{ d.results.pipeline.estimated }} of {{ d.results.pipeline.deals }} deals have an estimate; the rest use your average won deal ({{ money(d.results.pipeline.avgWonAnnual) }}/yr).</p>
          </div>
        </section>
      </div>

      <!-- Efficiency -->
      <section class="space-y-2.5">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Efficiency</h2>
        <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <div class="rounded-xl border bg-card px-3.5 py-3"><p class="text-[11px] text-muted-foreground flex items-center gap-1.5"><Clock class="size-3.5" /> Hours prospecting</p><p class="text-2xl font-bold tabular-nums mt-1">{{ fmt(d.efficiency.hours) }}</p><NuxtLink to="/crm/time" class="text-[10px] text-primary hover:underline">Time &amp; ROI</NuxtLink></div>
          <div class="rounded-xl border bg-card px-3.5 py-3"><p class="text-[11px] text-muted-foreground flex items-center gap-1.5"><CalendarCheck class="size-3.5" /> Meetings / 100 contacted</p><p class="text-2xl font-bold tabular-nums mt-1">{{ fmt(d.efficiency.meetingsPer100Contacted) }}</p><p class="text-[10px] text-muted-foreground">{{ d.efficiency.contacted }} contacted</p></div>
          <div class="rounded-xl border bg-card px-3.5 py-3"><p class="text-[11px] text-muted-foreground flex items-center gap-1.5"><Trophy class="size-3.5" /> Won / 100 contacted</p><p class="text-2xl font-bold tabular-nums mt-1">{{ fmt(d.efficiency.wonPer100Contacted) }}</p></div>
          <div class="rounded-xl border bg-card px-3.5 py-3"><p class="text-[11px] text-muted-foreground flex items-center gap-1.5"><Gauge class="size-3.5" /> Hours per meeting</p><p class="text-2xl font-bold tabular-nums mt-1">{{ fmt(d.efficiency.hoursPerMeeting) }}</p></div>
          <div class="rounded-xl border bg-card px-3.5 py-3"><p class="text-[11px] text-muted-foreground flex items-center gap-1.5"><Target class="size-3.5" /> Hours per account</p><p class="text-2xl font-bold tabular-nums mt-1">{{ fmt(d.efficiency.hoursPerAccount) }}</p></div>
          <div class="rounded-xl border bg-card px-3.5 py-3 bg-emerald-500/5"><p class="text-[11px] text-muted-foreground flex items-center gap-1.5"><DollarSign class="size-3.5" /> Revenue per hour</p><p class="text-2xl font-bold tabular-nums mt-1">{{ d.efficiency.annualRevenuePerHour == null ? '—' : money(d.efficiency.annualRevenuePerHour) }}</p><p class="text-[10px] text-muted-foreground">annualized revenue won ÷ hours</p></div>
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
</template>
