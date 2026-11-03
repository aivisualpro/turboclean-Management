<script setup lang="ts">
import { ago } from '~/composables/useAutomations'
import { RefreshCw, Loader2, ThumbsUp, ThumbsDown, Info, Sparkles, HelpCircle, ArrowRight, Bot, AlertTriangle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * Insights — automation 14: which strategies produce dealership contracts.
 * Built weekly by the scheduler (or now, with Refresh) from everything the CRM recorded.
 */
const { setHeader } = usePageHeader()
setHeader({ title: 'Insights', description: 'Automations · what actually produces dealership contracts and revenue', icon: 'i-lucide-lightbulb' })

const { loadInsights } = useAutomations()
const report = ref<any>(null)
const live = ref<any>(null)
const loading = ref(false)
const refreshing = ref(false)
async function load(refresh = false) {
  refresh ? (refreshing.value = true) : (loading.value = true)
  try {
    const r = await loadInsights(refresh)
    report.value = r.report
    live.value = r.liveAutomation
    if (refresh) toast.success('Insights rebuilt from the latest data')
  }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not load insights') }
  finally { loading.value = false; refreshing.value = false }
}
onMounted(() => load())

const period = ref<'all' | '90'>('all')
const questions = computed(() => (period.value === 'all' ? report.value?.questions : report.value?.questions90) || [])
const base = computed(() => (period.value === 'all' ? report.value?.base?.allTime : report.value?.base?.last90) || null)
const auto = computed(() => report.value?.automation || live.value)
const findings = computed(() => report.value?.findings || [])
const doMore = computed(() => findings.value.filter((f: any) => f.kind === 'do_more'))
const doLess = computed(() => findings.value.filter((f: any) => f.kind === 'do_less'))
const notes = computed(() => findings.value.filter((f: any) => f.kind === 'info'))
const money = (n: number | null | undefined) => n == null ? '—' : `$${Math.round(n).toLocaleString()}`
const pctOr = (n: number | null | undefined) => n == null ? '—' : `${n}%`
</script>

<template>
  <div class="space-y-5">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <span v-if="report" class="text-[11px] text-muted-foreground hidden md:inline">Updated {{ ago(report.generatedAt) }}</span>
        <Button variant="outline" size="sm" class="h-8 gap-1.5" :disabled="refreshing" @click="load(true)"><RefreshCw class="size-4" :class="refreshing && 'animate-spin'" /> Rebuild now</Button>
      </Teleport>
    </ClientOnly>

    <div v-if="loading" class="flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Loading insights…</div>

    <div v-else-if="!report" class="rounded-xl border bg-card px-6 py-14 text-center space-y-3">
      <Bot class="size-8 text-muted-foreground mx-auto" />
      <p class="text-sm font-medium">No strategy report yet</p>
      <p class="text-xs text-muted-foreground max-w-md mx-auto">It is built automatically once a week. Build the first one now — it reads every email, reply, meeting, win, loss and hour tracked in the CRM.</p>
      <Button size="sm" :disabled="refreshing" @click="load(true)"><Loader2 v-if="refreshing" class="size-4 animate-spin mr-1" /> Build it now</Button>
    </div>

    <template v-else>
      <!-- Headline numbers -->
      <div class="flex flex-wrap items-center gap-2">
        <button v-for="p in [{ k: 'all', l: 'All time' }, { k: '90', l: 'Last 90 days' }]" :key="p.k" type="button" class="rounded-full border px-3 py-1 text-xs" :class="period === p.k ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'" @click="period = p.k as any">{{ p.l }}</button>
        <span v-if="base" class="text-xs text-muted-foreground ml-2">{{ base.contacted }} dealerships contacted · {{ base.emails }} emails · {{ base.meetings }} first meetings · <span class="font-semibold text-foreground">{{ base.wins }} won</span></span>
      </div>

      <!-- AI summary -->
      <section v-if="report.aiSummary" class="rounded-xl border border-violet-500/30 bg-violet-500/5 px-5 py-4 grid md:grid-cols-2 gap-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300 flex items-center gap-1.5 mb-2"><Sparkles class="size-4" /> Do more of</p>
          <ul class="space-y-1.5 text-sm list-disc pl-5"><li v-for="x in report.aiSummary.doMore" :key="x">{{ x }}</li></ul>
        </div>
        <div>
          <p class="text-xs font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300 flex items-center gap-1.5 mb-2"><Sparkles class="size-4" /> Do less of</p>
          <ul class="space-y-1.5 text-sm list-disc pl-5"><li v-for="x in report.aiSummary.doLess" :key="x">{{ x }}</li></ul>
        </div>
      </section>

      <!-- Findings -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <section class="rounded-xl border bg-card overflow-hidden">
          <header class="px-4 py-2.5 border-b flex items-center gap-2"><ThumbsUp class="size-4 text-emerald-600" /><h3 class="text-sm font-semibold">Producing contracts</h3></header>
          <ul v-if="doMore.length" class="divide-y"><li v-for="f in doMore" :key="f.title" class="px-4 py-2.5"><p class="text-sm font-medium">{{ f.title }}</p><p class="text-xs text-muted-foreground">{{ f.detail }}</p></li></ul>
          <p v-else class="px-4 py-4 text-xs text-muted-foreground">Not enough data yet — comparisons need 10+ dealerships per group (20+ emails per email style).</p>
        </section>
        <section class="rounded-xl border bg-card overflow-hidden">
          <header class="px-4 py-2.5 border-b flex items-center gap-2"><ThumbsDown class="size-4 text-rose-600" /><h3 class="text-sm font-semibold">Underperforming</h3></header>
          <ul v-if="doLess.length || notes.length" class="divide-y">
            <li v-for="f in doLess" :key="f.title" class="px-4 py-2.5"><p class="text-sm font-medium">{{ f.title }}</p><p class="text-xs text-muted-foreground">{{ f.detail }}</p></li>
            <li v-for="f in notes" :key="f.title" class="px-4 py-2.5"><p class="text-sm font-medium flex items-center gap-1.5"><Info class="size-3.5 text-muted-foreground" />{{ f.title }}</p><p class="text-xs text-muted-foreground">{{ f.detail }}</p></li>
          </ul>
          <p v-else class="px-4 py-4 text-xs text-muted-foreground">Nothing clearly underperforming yet.</p>
        </section>
      </div>

      <!-- Standing questions -->
      <section class="rounded-xl border bg-card overflow-hidden">
        <header class="px-4 py-2.5 border-b flex items-center gap-2"><HelpCircle class="size-4 text-muted-foreground" /><h3 class="text-sm font-semibold">Your questions, answered</h3>
          <NuxtLink to="/crm/analytics" class="ml-auto text-xs text-primary inline-flex items-center gap-1">Compare anything in Analytics <ArrowRight class="size-3" /></NuxtLink>
        </header>
        <ul class="divide-y">
          <li v-for="q in questions" :key="q.question" class="px-4 py-2.5 grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-0.5">
            <p class="text-sm font-medium">{{ q.question }}</p>
            <p class="text-sm" :class="!q.enough && 'text-muted-foreground'">{{ q.answer }}<span v-if="!q.enough" class="ml-1 inline-flex items-center gap-0.5 text-[10px] text-amber-600"><AlertTriangle class="size-3" /> small sample</span></p>
          </li>
        </ul>
      </section>

      <!-- Channels -->
      <section v-if="report.channels?.length" class="rounded-xl border bg-card overflow-x-auto">
        <header class="px-4 py-2.5 border-b"><h3 class="text-sm font-semibold">Email vs call vs walk-in (all time)</h3></header>
        <table class="w-full text-sm">
          <thead class="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/30">
            <tr><th class="text-left font-medium px-4 py-2">Channel</th><th class="text-right font-medium px-2 py-2">Touches</th><th class="text-right font-medium px-2 py-2">Hours</th><th class="text-right font-medium px-2 py-2">Meetings</th><th class="text-right font-medium px-2 py-2">Wins</th><th class="text-right font-medium px-2 py-2">Annual revenue</th><th class="text-right font-medium px-4 py-2">Revenue / hour</th></tr>
          </thead>
          <tbody class="divide-y">
            <tr v-for="c in report.channels" :key="c.key">
              <td class="px-4 py-2 font-medium">{{ c.label }}</td><td class="px-2 py-2 text-right tabular-nums">{{ c.touches }}</td><td class="px-2 py-2 text-right tabular-nums">{{ c.hours }}</td>
              <td class="px-2 py-2 text-right tabular-nums">{{ c.meetings }}</td><td class="px-2 py-2 text-right tabular-nums">{{ c.wins }}</td><td class="px-2 py-2 text-right tabular-nums">{{ money(c.annualRevenue) }}</td><td class="px-4 py-2 text-right tabular-nums">{{ money(c.revenuePerHour) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Automation results -->
      <section v-if="auto" class="rounded-xl border bg-card overflow-hidden">
        <header class="px-4 py-2.5 border-b flex items-center gap-2"><Bot class="size-4 text-muted-foreground" /><h3 class="text-sm font-semibold">How the automated outreach is doing</h3></header>
        <div class="px-4 py-3 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <div><p class="text-[11px] uppercase tracking-wider text-muted-foreground">Drafts</p><p class="text-xl font-bold tabular-nums">{{ auto.drafts.created }}</p></div>
          <div><p class="text-[11px] uppercase tracking-wider text-muted-foreground">Sent</p><p class="text-xl font-bold tabular-nums">{{ auto.drafts.sent }}</p></div>
          <div><p class="text-[11px] uppercase tracking-wider text-muted-foreground">Approved</p><p class="text-xl font-bold tabular-nums">{{ pctOr(auto.drafts.approvalRate) }}</p></div>
          <div><p class="text-[11px] uppercase tracking-wider text-muted-foreground">Edited before sending</p><p class="text-xl font-bold tabular-nums">{{ pctOr(auto.drafts.editRate) }}</p></div>
          <div><p class="text-[11px] uppercase tracking-wider text-muted-foreground">Stopped (replied etc.)</p><p class="text-xl font-bold tabular-nums">{{ auto.drafts.cancelled }}</p></div>
        </div>
        <div class="grid lg:grid-cols-2 gap-0 border-t">
          <div class="overflow-x-auto lg:border-r">
            <table class="w-full text-xs">
              <thead class="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/30"><tr><th class="text-left font-medium px-4 py-2">Email style</th><th class="text-right font-medium px-2 py-2">Sent</th><th class="text-right font-medium px-2 py-2">Replied</th><th class="text-right font-medium px-2 py-2">Positive</th><th class="text-right font-medium px-4 py-2">Meeting</th></tr></thead>
              <tbody class="divide-y">
                <tr v-for="s in auto.byStyle" :key="s.key" :class="!s.enough && 'text-muted-foreground'"><td class="px-4 py-2">{{ s.key }}</td><td class="px-2 py-2 text-right tabular-nums">{{ s.n }}</td><td class="px-2 py-2 text-right tabular-nums">{{ pctOr(s.replyRate) }}</td><td class="px-2 py-2 text-right tabular-nums">{{ pctOr(s.positiveRate) }}</td><td class="px-4 py-2 text-right tabular-nums">{{ pctOr(s.meetingRate) }}</td></tr>
                <tr v-if="!auto.byStyle.length"><td colspan="5" class="px-4 py-4 text-center text-muted-foreground">No automated emails sent yet.</td></tr>
              </tbody>
            </table>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead class="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/30"><tr><th class="text-left font-medium px-4 py-2">Step</th><th class="text-right font-medium px-2 py-2">Sent</th><th class="text-right font-medium px-4 py-2">Reply rate</th></tr></thead>
              <tbody class="divide-y">
                <tr v-for="f in auto.byFollowUp" :key="f.key" :class="!f.enough && 'text-muted-foreground'"><td class="px-4 py-2">{{ f.key }}</td><td class="px-2 py-2 text-right tabular-nums">{{ f.n }}</td><td class="px-4 py-2 text-right tabular-nums">{{ pctOr(f.replyRate) }}</td></tr>
                <tr v-if="!auto.byFollowUp.length"><td colspan="3" class="px-4 py-4 text-center text-muted-foreground">—</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <p v-if="auto.skipReasons?.length" class="px-4 py-2.5 border-t text-xs text-muted-foreground">Why drafts get skipped: <span v-for="(r, i) in auto.skipReasons" :key="r.reason">{{ i ? ' · ' : '' }}{{ r.reason }} ({{ r.n }})</span></p>
        <p class="px-4 py-2 border-t text-[11px] text-muted-foreground">Rows in grey have fewer than 20 emails — treat them as early signals.</p>
      </section>
    </template>
  </div>
</template>
