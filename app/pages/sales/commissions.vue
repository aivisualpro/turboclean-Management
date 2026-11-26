<script setup lang="ts">
import { toast } from 'vue-sonner'
import {
  ChevronLeft, ChevronRight, CalendarDays, RefreshCw, Loader2, Download, MoreHorizontal, FileText, CheckCircle2, LockOpen,
  BadgeCheck, TriangleAlert, FileSpreadsheet, History, Receipt, Scale, TrendingUp, Wallet, HandCoins, Building2, CalendarClock, ChevronDown,
} from 'lucide-vue-next'

/**
 * Commissions — replaces the weekly "DEALER COMISSIONS" spreadsheet.
 * Week: one pay day's statement worked out from the invoices (dealers → payouts → deductions → balance,
 * plus the company result and taxes). Year: every pay day and dealer. Plan: the rules behind it all.
 */
const { setHeader } = usePageHeader()
setHeader({ title: 'Commissions', icon: 'i-lucide-percent' })

const route = useRoute()
const router = useRouter()

type Tab = 'week' | 'year' | 'plan'
const tab = ref<Tab>((['week', 'year', 'plan'].includes(String(route.query.tab)) ? route.query.tab : 'week') as Tab)
const currentPayDate = payDayFor()
const payDate = ref(/^\d{4}-\d{2}-\d{2}$/.test(String(route.query.week || '')) ? payDayFor(new Date(`${route.query.week}T12:00:00`)) : currentPayDate)
const year = computed(() => Number(payDate.value.slice(0, 4)))

watch([tab, payDate], () => {
  const query: Record<string, string> = {}
  if (tab.value !== 'week') query.tab = tab.value
  if (payDate.value !== currentPayDate) query.week = payDate.value
  router.replace({ query })
})

// ── Data
const data = ref<any>(null)
const week = computed(() => data.value?.week || null)
const overview = ref<any>(null)
const loading = ref(false)
const loadingYear = ref(false)
let seq = 0

async function loadWeek(quiet = true) {
  const my = ++seq
  loading.value = true
  try {
    const res = await $fetch<any>('/api/commissions/week', { query: { payDate: payDate.value } })
    if (my === seq) data.value = res
    if (!quiet) toast.success('Up to date')
  }
  catch (e: any) { if (my === seq) toast.error(commissionError(e, 'Could not load this week')) }
  finally { if (my === seq) loading.value = false }
}
async function loadYear() {
  loadingYear.value = true
  try { overview.value = await $fetch<any>('/api/commissions/overview', { query: { year: year.value } }) }
  catch (e: any) { toast.error(commissionError(e, 'Could not load the year')) }
  finally { loadingYear.value = false }
}
onMounted(() => {
  watch(payDate, () => loadWeek(), { immediate: true })
  watch(year, () => loadYear(), { immediate: true })
})
function onWeekUpdate(w: any) {
  if (data.value) data.value = { ...data.value, week: w }
  refreshYearSoon()
}
let yearTimer: any
function refreshYearSoon() { clearTimeout(yearTimer); yearTimer = setTimeout(loadYear, 600) }
function refreshAll() { loadWeek(false); loadYear() }

// ── Week navigation
const go = (n: number) => { payDate.value = shiftDay(payDate.value, 7 * n) }
const pickerOpen = ref(false)
const pickerYear = ref(year.value)
watch(pickerOpen, (o) => { if (o) pickerYear.value = year.value })
const pickerDays = computed(() => {
  const out: string[] = []
  const d = new Date(Date.UTC(pickerYear.value, 0, 1))
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1)
  while (d.getUTCFullYear() === pickerYear.value) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7) }
  return out
})
const statusByDay = computed(() => new Map<string, any>((overview.value?.weeks || []).map((w: any) => [w.payDate, w])))
function pickDay(d: string) { payDate.value = d; pickerOpen.value = false; if (tab.value === 'plan') tab.value = 'week' }
function openWeek(d: string) { payDate.value = d; tab.value = 'week' }

// ── KPI comparisons from the year overview
const weekIndex = computed(() => (overview.value?.weeks || []).findIndex((w: any) => w.payDate === payDate.value))
const prevWeek = computed(() => weekIndex.value > 0 ? overview.value.weeks[weekIndex.value - 1] : null)
const series = (k: string) => {
  const list = overview.value?.weeks || []
  const end = weekIndex.value >= 0 ? weekIndex.value + 1 : list.length
  return list.slice(Math.max(0, end - 12), end).map((w: any) => w[k] || 0)
}
const mainPayee = computed(() => (week.value?.payees || []).find((p: any) => !p.fundedBy))
const kpis = computed(() => {
  if (!week.value) return []
  const t = week.value.totals
  const p = prevWeek.value
  return [
    { label: 'Billed', hint: 'Invoice totals for the work week, including sales tax (the sheet’s “Before tax”).', value: t.billed, previous: p?.billed ?? null, series: series('billed'), icon: Receipt, sub: `${t.dealers} dealers` },
    { label: 'Sales tax', hint: 'Sales tax on those invoices — owed to the state, not company money.', value: t.tax, previous: p?.tax ?? null, series: series('tax'), icon: Scale, goodWhenUp: false },
    { label: 'Net revenue', hint: 'Billed minus sales tax (the sheet’s “After tax”). Commissions are worked out on this.', value: t.net, previous: p?.net ?? null, series: series('net'), icon: TrendingUp, tone: 'primary' as const },
    { label: mainPayee.value ? `${mainPayee.value.name}'s commission` : 'Commission', hint: 'What contractors earned on the dealers this week, before their deductions and additions.', value: t.commission, previous: p?.commission ?? null, series: series('commission'), icon: HandCoins, sub: `${pctText(t.effectivePct)} of net`, goodWhenUp: false },
    { label: 'Balance to pay', hint: 'Net payable to contractors (commission ± deductions/additions) minus what has already been paid, e.g. the 1st check.', value: Math.max(0, t.balance), previous: null, series: [], icon: Wallet, sub: t.paid ? `${usdShort(t.paid)} already paid` : 'nothing paid yet', tone: t.balance > 0.005 ? 'warn' as const : 'good' as const },
    { label: 'Company net profit', hint: 'Net revenue − paid to contractors − weekly overhead − income-tax set-aside.', value: t.netProfit, previous: p?.netProfit ?? null, series: series('netProfit'), icon: Building2, sub: `${pctText(t.marginPct)} margin`, tone: 'good' as const },
  ]
})

// ── Warnings
const showAllWarnings = ref(false)
const warnings = computed(() => week.value?.warnings || [])
const liveDiff = computed(() => {
  const w = week.value
  if (!w?.live) return null
  const d = Math.round((w.live.net - w.totals.net) * 100) / 100
  return Math.abs(d) > 0.01 ? { net: w.live.net, diff: d } : null
})
const sheetMissing = computed(() => week.value?.source === 'sheet' ? [] : (week.value?.sheet?.missing || []))
const notInSheet = computed(() => week.value?.source === 'sheet' && week.value?.live ? week.value.live.lines.filter((x: any) => (x.net || x.billed) && !week.value.lines.some((l: any) => l.dealerId === x.dealerId)) : [])

// ── Status actions
const acting = ref(false)
async function act(op: string, fields: Record<string, any> = {}, ok?: string) {
  acting.value = true
  try { onWeekUpdate(await patchCommissionWeek(payDate.value, op, fields, ok)) }
  catch (e: any) {
    if (e?.statusCode === 422 || e?.data?.statusCode === 422) highlightManual.value = true
  }
  finally { acting.value = false }
}
const highlightManual = ref(false)
const approveOpen = ref(false)
const reopenOpen = ref(false)

// ── Dealer panel + rule dialog
const openLineId = ref<string | null>(null)
const openLine = computed(() => week.value?.lines.find((l: any) => l.dealerId === openLineId.value) || null)
const ruleTarget = ref<any>(null)

// ── Export
function exportCsv() {
  const w = week.value
  if (!w) return
  const payees = data.value.payees.filter((p: any) => w.lines.some((l: any) => l.payouts[p.id]))
  const rows: any[][] = [
    [`Commissions — pay day ${w.payDate} (work ${w.workStart} to ${w.workEnd}) — ${STATUS_META[w.status]?.label}`],
    [],
    ['Dealer', 'Billed (incl. tax)', 'Sales tax', 'Net', ...payees.flatMap((p: any) => [`${p.name} rule`, `${p.name} payout`]), 'Company keeps', 'Check'],
    ...w.lines.map((l: any) => [l.dealerName, l.billed, l.tax, l.net, ...payees.flatMap((p: any) => [l.payouts[p.id] ? ruleText(l.payouts[p.id].rule) : '', l.payouts[p.id]?.amount ?? '']), l.margin, l.deposited ? 'Deposited' : DEPOSIT_META[l.deposit]?.label]),
    ['Total', w.totals.billed, w.totals.tax, w.totals.net, ...payees.flatMap((p: any) => ['', w.payees.find((x: any) => x.id === p.id)?.commission ?? '']), w.totals.grossMargin],
    [],
  ]
  for (const p of w.payees) {
    rows.push([`${p.name} — statement`], ['Commission earned', p.commission])
    for (const a of p.adjustments.filter((x: any) => !x.skipped)) rows.push([a.label, a.amount])
    rows.push(['Net payable', p.netPayable])
    for (const x of p.payments) rows.push([`Paid ${x.date}${x.note ? ` (${x.note})` : ''}`, -x.amount])
    rows.push(['Balance to pay', p.balance], [])
  }
  const t = w.totals
  rows.push(['Company result'], ['Net revenue', t.net], ['Paid to contractors', -t.paidToContractors], ...t.overheadItems.map((o: any) => [`Overhead: ${o.label}`, -o.amount]), ...t.setAsides.map((s: any) => [`${s.label} set-aside`, -s.amount]), ['Net profit', t.netProfit], ...t.reserves.map((r: any) => [r.label, r.amount]))
  downloadCsv(`commissions-${w.payDate}.csv`, rows)
}
async function exportPdf(includeCompany: boolean) {
  try { await downloadCommissionPdf(week.value, { payeeId: mainPayee.value?.id, includeCompany }) }
  catch (e) { console.error(e); toast.error('Could not build the PDF') }
}
function exportYearCsv() {
  const o = overview.value
  if (!o) return
  downloadCsv(`commissions-${o.year}.csv`, [
    ['Pay day', 'Work from', 'Work to', 'Status', 'Source', 'Billed', 'Sales tax', 'Net', 'Commission', 'Adjustments', 'Paid to contractors', 'Overhead', 'Tax set-aside', 'Net profit', 'Margin %', 'Still to pay'],
    ...o.weeks.map((w: any) => [w.payDate, w.workStart, w.workEnd, w.status, w.source, w.billed, w.tax, w.net, w.commission, w.adjustments, w.paidToContractors, w.overhead, w.setAsideTotal, w.netProfit, w.marginPct, w.balance]),
  ])
}
const TABS = [{ key: 'week', label: 'Week' }, { key: 'year', label: 'Year' }, { key: 'plan', label: 'Plan & rules' }] as const
</script>

<template>
  <div class="cm-root space-y-2">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <Loader2 v-if="loading || loadingYear" class="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Loading" />
        <!-- Pay-day navigator -->
        <div class="flex items-center">
          <Button variant="outline" size="icon" class="size-8 rounded-r-none" aria-label="Previous pay day" @click="go(-1)"><ChevronLeft class="size-4" /></Button>
          <Popover v-model:open="pickerOpen">
            <PopoverTrigger as-child>
              <Button variant="outline" size="sm" class="h-8 gap-1.5 rounded-none border-x-0 px-2.5 text-xs font-semibold" aria-label="Pick a pay day">
                <CalendarDays class="size-3.5 text-muted-foreground" />
                <span class="whitespace-nowrap">Pay day {{ dayMed(payDate) }}</span>
                <span v-if="week" class="hidden size-1.5 rounded-full sm:inline-block" :class="STATUS_META[week.status]?.dot" />
                <ChevronDown class="size-3 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" class="w-[300px] p-2">
              <div class="mb-2 flex items-center justify-between">
                <Button variant="ghost" size="icon" class="size-7" aria-label="Previous year" @click="pickerYear--"><ChevronLeft class="size-4" /></Button>
                <span class="text-sm font-semibold tabular-nums">{{ pickerYear }}</span>
                <Button variant="ghost" size="icon" class="size-7" aria-label="Next year" @click="pickerYear++"><ChevronRight class="size-4" /></Button>
              </div>
              <div class="grid max-h-72 grid-cols-4 gap-1 overflow-y-auto">
                <button
                  v-for="d in pickerDays" :key="d" type="button"
                  class="relative flex h-9 flex-col items-center justify-center rounded-md border text-[11px] leading-tight transition-colors"
                  :class="d === payDate ? 'border-primary bg-primary text-primary-foreground' : d === currentPayDate ? 'border-primary/50 hover:bg-muted' : 'border-transparent hover:bg-muted'"
                  :title="statusByDay.get(d) ? `${STATUS_META[statusByDay.get(d).status]?.label} · net ${usd(statusByDay.get(d).net)}` : ''"
                  @click="pickDay(d)"
                >
                  <span class="font-medium">{{ dayShort(d) }}</span>
                  <span v-if="statusByDay.get(d)" class="mt-0.5 size-1.5 rounded-full" :class="STATUS_META[statusByDay.get(d).status]?.dot" />
                </button>
              </div>
              <div class="mt-2 flex items-center gap-3 border-t pt-2 text-[10px] text-muted-foreground">
                <span v-for="(m, k) in STATUS_META" :key="k" class="inline-flex items-center gap-1"><span class="size-1.5 rounded-full" :class="m.dot" />{{ m.label }}</span>
                <Button variant="ghost" size="sm" class="ml-auto h-6 px-2 text-[11px]" @click="pickDay(currentPayDate)">This week</Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="icon" class="size-8 rounded-l-none" aria-label="Next pay day" @click="go(1)"><ChevronRight class="size-4" /></Button>
        </div>

        <!-- Main action for the week -->
        <template v-if="tab === 'week' && week">
          <Button v-if="week.status === 'draft'" size="sm" class="h-8 gap-1.5" :disabled="acting" @click="approveOpen = true"><BadgeCheck class="size-4" /><span class="hidden lg:inline">Approve week</span></Button>
          <Button v-else-if="week.status === 'approved'" size="sm" variant="outline" class="h-8 gap-1.5" :disabled="acting" @click="act('markPaid', {}, 'Week marked paid')"><CheckCircle2 class="size-4" /><span class="hidden lg:inline">Mark paid</span></Button>
        </template>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline" size="sm" class="h-8 gap-1.5"><Download class="size-4" /><span class="hidden lg:inline">Export</span></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-60">
            <DropdownMenuItem :disabled="!week" @click="exportPdf(false)"><FileText class="size-4" />Payout statement (PDF) — for {{ mainPayee?.name || 'the payee' }}</DropdownMenuItem>
            <DropdownMenuItem :disabled="!week" @click="exportPdf(true)"><FileText class="size-4" />Owner's copy (PDF, with company result)</DropdownMenuItem>
            <DropdownMenuItem :disabled="!week" @click="exportCsv"><Download class="size-4" />This week (CSV)</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem :disabled="!overview" @click="exportYearCsv"><Download class="size-4" />Every pay day of {{ year }} (CSV)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu v-if="tab === 'week' && week && week.status !== 'draft'">
          <DropdownMenuTrigger as-child><Button variant="outline" size="icon" class="size-8" aria-label="More"><MoreHorizontal class="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-56">
            <DropdownMenuItem @click="reopenOpen = true"><LockOpen class="size-4" />Reopen this week…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" size="icon" class="hidden size-8 sm:inline-flex" aria-label="Refresh" :disabled="loading" @click="refreshAll"><RefreshCw class="size-4" :class="loading && 'animate-spin'" /></Button>
      </Teleport>
    </ClientOnly>

    <!-- Tabs -->
    <div class="flex w-full rounded-lg border bg-muted/40 p-0.5" role="tablist" aria-label="Commissions view">
      <button
        v-for="t in TABS" :key="t.key" type="button" role="tab" :aria-selected="tab === t.key"
        class="h-8 flex-1 rounded-md text-[13px] font-medium transition-colors"
        :class="tab === t.key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
        @click="tab = t.key"
      >{{ t.label }}</button>
    </div>

    <!-- ═════════════ WEEK ═════════════ -->
    <template v-if="tab === 'week'">
      <div v-if="!week" class="space-y-2">
        <Skeleton class="h-12 rounded-xl" />
        <div class="grid grid-cols-2 gap-2 lg:grid-cols-6"><Skeleton v-for="i in 6" :key="i" class="h-[104px] rounded-xl" /></div>
        <Skeleton class="h-96 rounded-xl" />
      </div>
      <template v-else>
        <!-- Status strip -->
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border bg-card px-3 py-2" data-testid="week-status">
          <span class="inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold" :class="STATUS_META[week.status]?.cls">
            <span class="size-1.5 rounded-full" :class="STATUS_META[week.status]?.dot" />{{ STATUS_META[week.status]?.label }}
          </span>
          <p class="flex items-center gap-1.5 text-[13px]">
            <CalendarClock class="size-4 text-muted-foreground" />
            <span><b class="font-semibold">{{ dayLong(week.payDate) }}</b> pays for work <b class="font-medium">{{ dayMed(week.workStart) }} – {{ dayMed(week.workEnd) }}</b></span>
            <CrmHint text="Like the spreadsheet: each Friday pays for the work week that ended the Sunday before — the Weekly invoices dated that Sunday. Monthly invoices are spread over the weeks of their month." />
          </p>
          <span class="text-[12px] text-muted-foreground">
            <template v-if="week.source === 'sheet'"><FileSpreadsheet class="mr-1 inline size-3.5" />Amounts from the spreadsheet tab “{{ week.sheet?.tab }}”</template>
            <template v-else-if="week.status === 'draft'">Updates live from the invoices until you approve it</template>
            <template v-else>Frozen — approved by {{ week.approvedBy }} {{ week.approvedAt ? new Date(week.approvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '' }}</template>
          </span>
        </div>

        <!-- Things to look at -->
        <div v-if="warnings.length || liveDiff || sheetMissing.length || notInSheet.length" class="space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-[12px]" data-testid="week-warnings" :class="highlightManual && 'ring-2 ring-amber-500/60'">
          <p v-if="liveDiff && week.source === 'sheet'" class="flex items-start gap-1.5"><FileSpreadsheet class="mt-0.5 size-3.5 shrink-0 text-amber-600" /><span>The invoices in the system for this week add up to <b class="font-semibold">{{ usd(liveDiff.net) }}</b> net — {{ usd(Math.abs(liveDiff.diff)) }} {{ liveDiff.diff > 0 ? 'more' : 'less' }} than the spreadsheet. The <b class="font-medium">Invoices</b> column shows which dealers differ.</span></p>
          <p v-else-if="liveDiff" class="flex items-start gap-1.5"><TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-amber-600" /><span>The invoices for this week changed since it was approved: net revenue in the system is now <b class="font-semibold">{{ usd(liveDiff.net) }}</b> ({{ liveDiff.diff > 0 ? '+' : '' }}{{ usd(liveDiff.diff) }}). Reopen the week to use the new numbers.</span></p>
          <p v-if="notInSheet.length" class="flex items-start gap-1.5"><FileSpreadsheet class="mt-0.5 size-3.5 shrink-0 text-amber-600" /><span>Invoiced in the system but not in the spreadsheet: <b class="font-medium">{{ notInSheet.map((l: any) => `${l.dealerName} (${usd(l.net)} net)`).join(', ') }}</b>.</span></p>
          <p v-if="sheetMissing.length" class="flex items-start gap-1.5"><FileSpreadsheet class="mt-0.5 size-3.5 shrink-0 text-amber-600" /><span>In the spreadsheet but no invoice in the system for this week: <b class="font-medium">{{ sheetMissing.map((m: any) => `${m.names[0]} (${usd(m.billed)})`).join(', ') }}</b>.</span></p>
          <p v-for="(w, i) in (showAllWarnings ? warnings : warnings.slice(0, 3))" :key="i" class="flex items-start gap-1.5">
            <TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            <button v-if="w.dealerId" type="button" class="text-left hover:underline" @click="openLineId = w.dealerId">{{ w.message }}</button>
            <span v-else>{{ w.message }}</span>
          </p>
          <button v-if="warnings.length > 3" type="button" class="pl-5 text-[11px] font-medium text-amber-800 hover:underline dark:text-amber-300" @click="showAllWarnings = !showAllWarnings">{{ showAllWarnings ? 'Show fewer' : `Show all ${warnings.length}` }}</button>
        </div>

        <!-- KPIs -->
        <div class="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
          <CommissionsKpi v-for="k in kpis" :key="k.label" :label="k.label" :hint="k.hint" :value="k.value" :previous="k.previous" :series="k.series" :sub="k.sub" :tone="k.tone" :good-when-up="k.goodWhenUp ?? true">
            <template #icon><component :is="k.icon" class="size-3.5 shrink-0" /></template>
          </CommissionsKpi>
        </div>

        <!-- Statement + side column -->
        <div class="grid grid-cols-1 items-start gap-2 xl:grid-cols-[minmax(0,1fr)_380px]">
          <CommissionsStatementTable class="max-h-[calc(100dvh-240px)] min-h-[420px]" :week="week" :payees="data.payees" @open="(l: any) => openLineId = l.dealerId" @update="onWeekUpdate" />
          <div class="space-y-2">
            <CommissionsPayeeCard v-for="p in week.payees" :key="p.id" :payee="p" :pay-date="week.payDate" :locked="week.status !== 'draft'" :presets="data.presets" @update="onWeekUpdate" />
            <CommissionsCompanyCard :week="week" @update="onWeekUpdate" />
            <details v-if="week.history.length" class="group rounded-xl border bg-card">
              <summary class="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-sm font-semibold">
                <History class="size-4 text-muted-foreground" />Changes this week <span class="text-[11px] font-normal text-muted-foreground">({{ week.history.length }})</span>
                <ChevronDown class="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <ol class="max-h-64 space-y-1.5 overflow-y-auto border-t px-3 py-2 text-[12px]">
                <li v-for="(h, i) in week.history" :key="i">
                  <p><b class="font-medium">{{ h.action }}</b><template v-if="h.detail"> — {{ h.detail }}</template></p>
                  <p class="text-[11px] text-muted-foreground">{{ h.by }} · {{ new Date(h.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }}</p>
                </li>
              </ol>
            </details>
          </div>
        </div>
      </template>
    </template>

    <!-- ═════════════ YEAR ═════════════ -->
    <CommissionsYearView v-else-if="tab === 'year'" :overview="overview" :loading="loadingYear" :current-pay-date="currentPayDate" @open-week="openWeek" />

    <!-- ═════════════ PLAN ═════════════ -->
    <CommissionsPlanEditor v-else :pay-date="payDate" @saved="refreshAll" />

    <!-- Dealer panel / rule dialog -->
    <CommissionsDealerSheet v-if="week" :line="openLine" :week="week" :payees="data.payees" @close="openLineId = null" @update="onWeekUpdate" @edit-rule="(t: any) => ruleTarget = t" />
    <CommissionsRuleDialog :target="ruleTarget" :from="payDate" @close="ruleTarget = null" @saved="refreshAll" />

    <!-- Approve -->
    <AlertDialog v-model:open="approveOpen">
      <AlertDialogContent v-if="week">
        <AlertDialogHeader>
          <AlertDialogTitle>Approve pay day {{ dayMed(week.payDate) }}?</AlertDialogTitle>
          <AlertDialogDescription>
            The amounts are frozen as they are now: {{ usd(week.totals.paidToContractors) }} to contractors, {{ usd(week.totals.netProfit) }} company net profit.
            Later invoice changes won't move them (you'll see a note if they happen). Payments and tax ticks can still be recorded.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p v-if="warnings.some((w: any) => w.kind === 'manual')" class="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-900 dark:text-amber-200">Some dealers still need this week's amount typed in. Approving now uses the suggested amounts.</p>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="act('approve', { force: true }, 'Week approved')">Approve</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Reopen -->
    <AlertDialog v-model:open="reopenOpen">
      <AlertDialogContent v-if="week">
        <AlertDialogHeader>
          <AlertDialogTitle>Reopen pay day {{ dayMed(week.payDate) }}?</AlertDialogTitle>
          <AlertDialogDescription>
            The week goes back to Draft and is worked out again from the current invoices and plan. Payments, deductions and notes recorded for it are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:gap-2">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction v-if="week.source === 'sheet'" class="bg-secondary text-secondary-foreground hover:bg-secondary/80" @click="act('reopen', { useInvoices: true }, 'Now using the invoices')">Reopen using the invoices</AlertDialogAction>
          <AlertDialogAction @click="act('reopen', {}, 'Week reopened')">{{ week.source === 'sheet' ? 'Reopen (keep sheet amounts)' : 'Reopen' }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<style>
/* Chart series colours (validated categorical slots 1–4, light and dark). */
.cm-root { --cm-s1: #257de0; --cm-s2: #f47230; --cm-s3: #00b894; --cm-s4: #f2a600; }
.dark .cm-root { --cm-s1: #338ced; --cm-s2: #e76624; --cm-s3: #00a888; --cm-s4: #d28e05; }
</style>
