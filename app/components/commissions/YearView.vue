<script setup lang="ts">
import { FileSpreadsheet, TriangleAlert, TrendingUp, Wallet, Building2, Percent, Receipt, Scale } from 'lucide-vue-next'

/** The year at a glance: totals, a weekly chart, every pay day, and the dealers that bring the money in. */
const props = defineProps<{ overview: any | null, loading: boolean, currentPayDate: string }>()
const emit = defineEmits<{ (e: 'open-week', payDate: string): void }>()

const weeks = computed(() => props.overview?.weeks || [])
const t = computed(() => props.overview?.totals)

// ── Chart: net revenue per pay day, split into contractors vs what the company keeps (one $ axis)
const hover = ref<number | null>(null)
const chart = computed(() => {
  const list = weeks.value
  const max = Math.max(1, ...list.map((w: any) => Math.max(w.net, w.paidToContractors + Math.max(0, w.grossMargin))))
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); const m = max / p; return (m <= 2 ? 2 : m <= 5 ? 5 : 10) * p })()
  const ticks = [0, nice / 4, nice / 2, (nice * 3) / 4, nice]
  return { max: nice, ticks }
})
const avg = computed(() => t.value?.avgWeeklyNet || 0)
const tip = computed(() => hover.value == null ? null : weeks.value[hover.value])
const monthLabel = (w: any, i: number) => {
  const m = w.payDate.slice(5, 7)
  return i === 0 || weeks.value[i - 1].payDate.slice(5, 7) !== m ? new Date(`${w.payDate}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' }) : ''
}

// ── Dealers
const dealerSort = ref<'net' | 'payout' | 'margin' | 'effectivePct'>('net')
const dealers = computed(() => [...(props.overview?.dealers || [])].sort((a: any, b: any) => b[dealerSort.value] - a[dealerSort.value]))
const topNet = computed(() => Math.max(1, ...dealers.value.map((d: any) => d.net)))
function sparkPoints(d: any) {
  const vals = weeks.value.map((w: any) => d.series[w.payDate] || 0)
  const max = Math.max(1, ...vals)
  return vals.map((v: number, i: number) => `${(i / Math.max(1, vals.length - 1)) * 100},${(22 - (v / max) * 20).toFixed(1)}`).join(' ')
}

const sheetWeeks = computed(() => weeks.value.filter((w: any) => w.sheet))
const sheetDiffWeeks = computed(() => sheetWeeks.value.filter((w: any) => Math.abs(w.sheet.net - w.invoicesNet) > 1))

const KPIS = computed(() => !t.value ? [] : [
  { label: 'Billed this year', hint: 'Every pay day so far this year: invoice totals including sales tax.', value: t.value.billed, icon: Receipt },
  { label: 'Net revenue', hint: 'Billed minus sales tax.', value: t.value.net, icon: TrendingUp, sub: `${usdShort(t.value.avgWeeklyNet)} a week on average` },
  { label: 'Paid to contractors', hint: 'Commission plus/minus the contractors’ deductions and additions.', value: t.value.paidToContractors, icon: Wallet, sub: `${pctText(t.value.effectivePct)} of net as commission` },
  { label: 'Company net profit', hint: 'Net revenue − paid to contractors − overhead − income-tax set-aside.', value: t.value.netProfit, icon: Building2, tone: 'good', sub: `${pctText(t.value.marginPct)} margin` },
  { label: 'Sales tax collected', hint: 'Owed to the state.', value: t.value.tax, icon: Scale },
  { label: 'Still to pay', hint: 'Balance not yet paid to contractors across all pay days.', value: t.value.balance, icon: Percent, tone: t.value.balance > 0.5 ? 'warn' : 'default' },
])
</script>

<template>
  <div class="cm-root space-y-2">
    <div v-if="!overview" class="grid grid-cols-2 gap-2 lg:grid-cols-6">
      <Skeleton v-for="i in 6" :key="i" class="h-[92px] rounded-xl" />
      <Skeleton class="col-span-full h-72 rounded-xl" />
    </div>
    <template v-else>
      <div class="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <CommissionsKpi v-for="k in KPIS" :key="k.label" :label="k.label" :hint="k.hint" :value="k.value" :sub="k.sub" :tone="(k.tone as any)">
          <template #icon><component :is="k.icon" class="size-3.5 shrink-0" /></template>
        </CommissionsKpi>
      </div>

      <!-- Weekly chart -->
      <section class="rounded-xl border bg-card px-3 pb-2 pt-2.5" data-testid="year-chart">
        <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 class="flex items-center gap-1.5 text-sm font-semibold">Net revenue per pay day <CrmHint text="Each bar is one pay day's net revenue, split into what went to contractors and what the company kept before overhead and tax. Click a bar to open that week." /></h3>
          <span class="text-[11px] text-muted-foreground tabular-nums">{{ weeks.length }} pay days · dashed line = weekly average {{ usdShort(avg) }}</span>
          <div class="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
            <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-sm" style="background: var(--cm-s1)" />Paid to contractors</span>
            <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-sm" style="background: var(--cm-s2)" />Company kept</span>
          </div>
        </div>
        <div class="relative mt-3 flex gap-2">
          <div class="relative h-56 w-10 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
            <span v-for="tk in chart.ticks" :key="tk" class="absolute right-0 -translate-y-1/2" :style="{ bottom: `${(tk / chart.max) * 100}%`, transform: 'translateY(50%)' }">{{ usdShort(tk) }}</span>
          </div>
          <div class="relative h-56 min-w-0 flex-1" @mouseleave="hover = null">
            <div v-for="tk in chart.ticks" :key="tk" class="pointer-events-none absolute inset-x-0 border-t border-border/60" :style="{ bottom: `${(tk / chart.max) * 100}%` }" />
            <div v-if="avg" class="pointer-events-none absolute inset-x-0 z-[1] border-t border-dashed border-foreground/40" :style="{ bottom: `${(avg / chart.max) * 100}%` }" />
            <div class="absolute inset-0 flex items-end gap-[2px]">
              <button
                v-for="(w, i) in weeks" :key="w.payDate" type="button"
                class="group relative flex h-full min-w-0 flex-1 flex-col justify-end outline-none"
                :aria-label="`${dayLong(w.payDate)}: net ${usd(w.net)}, contractors ${usd(w.paidToContractors)}`"
                @mouseenter="hover = i" @focus="hover = i" @click="emit('open-week', w.payDate)"
              >
                <div class="mx-auto flex w-full max-w-7 flex-col gap-[2px] transition-opacity" :class="hover != null && hover !== i && 'opacity-50'" :style="{ height: `${((w.paidToContractors + Math.max(0, w.grossMargin)) / chart.max) * 100}%` }">
                  <div class="w-full rounded-t-[4px]" :style="{ flex: `${Math.max(0, w.grossMargin)} 0 0`, background: 'var(--cm-s2)' }" />
                  <div class="w-full rounded-b-[2px]" :style="{ flex: `${Math.max(0, w.paidToContractors)} 0 0`, background: 'var(--cm-s1)' }" />
                </div>
                <span v-if="w.payDate === currentPayDate" class="absolute -bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-foreground" />
              </button>
            </div>
            <!-- tooltip -->
            <div
              v-if="tip" class="pointer-events-none absolute top-0 z-20 w-56 rounded-lg border bg-popover p-2 text-[12px] shadow-lg"
              :style="{ left: `min(calc(${((hover! + 0.5) / weeks.length) * 100}% + 8px), calc(100% - 14rem))` }"
            >
              <p class="font-semibold">{{ dayLong(tip.payDate) }}</p>
              <p class="mb-1 text-[11px] text-muted-foreground">Work {{ dayShort(tip.workStart) }} – {{ dayShort(tip.workEnd) }} · {{ STATUS_META[tip.status]?.label }}{{ tip.source === 'sheet' ? ' (spreadsheet)' : '' }}</p>
              <div class="space-y-0.5 tabular-nums">
                <div class="flex justify-between"><span>Net revenue</span><b>{{ usd(tip.net) }}</b></div>
                <div class="flex justify-between"><span class="flex items-center gap-1"><span class="size-2 rounded-sm" style="background: var(--cm-s1)" />Contractors</span><span>{{ usd(tip.paidToContractors) }}</span></div>
                <div class="flex justify-between"><span class="flex items-center gap-1"><span class="size-2 rounded-sm" style="background: var(--cm-s2)" />Company kept</span><span>{{ usd(tip.grossMargin) }}</span></div>
                <div class="flex justify-between border-t pt-0.5"><span>Net profit</span><span>{{ usd(tip.netProfit) }} · {{ pctText(tip.marginPct) }}</span></div>
              </div>
            </div>
          </div>
        </div>
        <div class="ml-12 mt-1 flex gap-[2px]">
          <span v-for="(w, i) in weeks" :key="w.payDate" class="min-w-0 flex-1 overflow-visible whitespace-nowrap text-[10px] text-muted-foreground">{{ monthLabel(w, i) }}</span>
        </div>
      </section>

      <div v-if="sheetWeeks.length" class="flex items-start gap-2 rounded-xl border bg-card px-3 py-2 text-[12px]">
        <FileSpreadsheet class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p>
          <b class="font-medium">Spreadsheet check:</b> {{ sheetWeeks.length }} pay days have spreadsheet numbers.
          <template v-if="sheetDiffWeeks.length"><span class="text-amber-700 dark:text-amber-400">{{ sheetDiffWeeks.length }} of them don't match the invoices in the system</span> by more than $1 of net revenue — they are marked below. Open one to see which dealer differs.</template>
          <template v-else><span class="text-emerald-700 dark:text-emerald-400">Every one matches the invoices in the system.</span></template>
        </p>
      </div>

      <div class="grid grid-cols-1 items-stretch gap-2 2xl:grid-cols-5">
        <!-- Pay days -->
        <section class="flex max-h-[560px] flex-col overflow-hidden rounded-xl border bg-card 2xl:col-span-3">
          <h3 class="border-b px-3 py-2.5 text-sm font-semibold">Pay days</h3>
          <div class="min-h-0 flex-1 overflow-auto">
            <table class="w-full">
              <thead class="sticky top-0 z-10">
                <tr><th class="text-left">Pay day</th><th class="text-left">Status</th><th class="text-right">Net</th><th class="text-right">Contractors</th><th class="text-right">Net profit</th><th class="text-right">Margin</th><th class="text-right">Still to pay</th><th v-if="sheetWeeks.length" class="text-right" title="Spreadsheet net revenue compared with the invoices in the system">Sheet vs invoices</th></tr>
              </thead>
              <tbody>
                <tr v-for="w in [...weeks].reverse()" :key="w.payDate" class="cursor-pointer hover:bg-muted/50" tabindex="0" @click="emit('open-week', w.payDate)" @keydown.enter="emit('open-week', w.payDate)">
                  <td class="whitespace-nowrap font-medium">{{ dayMed(w.payDate) }}<span v-if="w.payDate === currentPayDate" class="ml-1.5 rounded bg-primary/10 px-1 text-[10px] font-medium text-primary">this week</span></td>
                  <td><span class="inline-flex h-5 items-center gap-1 rounded border px-1.5 text-[10px] font-medium" :class="STATUS_META[w.status]?.cls"><span class="size-1.5 rounded-full" :class="STATUS_META[w.status]?.dot" />{{ STATUS_META[w.status]?.label }}</span><span v-if="w.source === 'sheet'" class="ml-1 text-[10px] text-muted-foreground">sheet</span></td>
                  <td class="text-right tabular-nums">{{ usd(w.net) }}</td>
                  <td class="text-right tabular-nums">{{ usd(w.paidToContractors) }}</td>
                  <td class="text-right font-medium tabular-nums">{{ usd(w.netProfit) }}</td>
                  <td class="text-right tabular-nums text-muted-foreground">{{ pctText(w.marginPct) }}</td>
                  <td class="text-right tabular-nums" :class="w.balance > 0.5 ? 'text-primary font-medium' : 'text-muted-foreground'">{{ w.balance > 0.5 ? usd(w.balance) : '—' }}</td>
                  <td v-if="sheetWeeks.length" class="text-right tabular-nums">
                    <template v-if="w.sheet"><span v-if="Math.abs(w.sheet.net - w.invoicesNet) <= 1" class="text-[11px] text-emerald-700 dark:text-emerald-400">✓ match</span><span v-else class="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400" :title="`Spreadsheet ${usd(w.sheet.net)} · invoices ${usd(w.invoicesNet)}`"><TriangleAlert class="size-3" />{{ w.invoicesNet - w.sheet.net > 0 ? '+' : '' }}{{ usd(w.invoicesNet - w.sheet.net) }}</span></template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Dealers -->
        <section class="flex max-h-[560px] flex-col overflow-hidden rounded-xl border bg-card 2xl:col-span-2">
          <header class="flex items-center gap-2 border-b px-3 py-2">
            <h3 class="mr-auto text-sm font-semibold">Dealers this year</h3>
            <Select v-model="dealerSort"><SelectTrigger size="sm" class="h-7 w-[150px] text-xs" aria-label="Sort dealers"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="net">By net revenue</SelectItem><SelectItem value="margin">By company margin</SelectItem><SelectItem value="payout">By payout</SelectItem><SelectItem value="effectivePct">By payout %</SelectItem></SelectContent>
            </Select>
          </header>
          <ul class="min-h-0 flex-1 divide-y overflow-auto">
            <li v-for="d in dealers" :key="d.dealerId" class="grid grid-cols-[minmax(0,1fr)_72px_88px] items-center gap-2 px-3 py-1.5 text-[12px]">
              <div class="min-w-0">
                <p class="truncate font-medium">{{ d.dealerName }}</p>
                <div class="mt-0.5 h-1 overflow-hidden rounded-full bg-muted"><div class="h-full rounded-full" :style="{ width: `${(d.net / topNet) * 100}%`, background: 'var(--cm-s1)' }" /></div>
                <p class="mt-0.5 text-[10px] text-muted-foreground tabular-nums">payout {{ pctText(d.effectivePct) }} · company {{ usdShort(d.margin) }} · {{ d.weeks }} wk</p>
              </div>
              <svg viewBox="0 0 100 24" preserveAspectRatio="none" class="h-6 w-full text-primary" aria-hidden="true"><polyline :points="sparkPoints(d)" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" /></svg>
              <p class="text-right font-semibold tabular-nums">{{ usdShort(d.net) }}</p>
            </li>
            <li v-if="!dealers.length" class="px-3 py-6 text-center text-xs text-muted-foreground">No revenue yet this year.</li>
          </ul>
        </section>
      </div>

      <section v-if="overview.payees?.length" class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
        <div v-for="p in overview.payees" :key="p.id" class="rounded-xl border bg-card px-3 py-2.5">
          <p class="text-[11px] text-muted-foreground">{{ p.name }}{{ p.fundedBy ? ' · paid by another payee' : '' }} · this year</p>
          <p class="text-xl font-bold tabular-nums">{{ usd(p.netPayable) }}</p>
          <p class="text-[11px] text-muted-foreground tabular-nums">commission {{ usd(p.commission) }} · adjustments {{ signedUsd(p.adjustments) }} · paid {{ usd(p.paid) }}</p>
        </div>
      </section>
    </template>
  </div>
</template>
