<script setup lang="ts">
import type { WonDeal, WonGroupRow } from '~/composables/useCrmWon'
import { money } from '~/composables/useCrmWon'
import { RefreshCw, Download, Loader2, Trophy, AlertTriangle, ChevronRight, Hourglass, Footprints, Receipt } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format, subDays, startOfYear, parseISO } from 'date-fns'

/**
 * Won deals — "measure the actual financial return from prospecting".
 * Revenue/profit are the estimates entered at win; "invoiced to date" is the real money from Dealers.
 */
const { setHeader } = usePageHeader()
setHeader({ title: 'Won deals', description: 'CRM · what each win is worth, how long it took, and what produced it', icon: 'i-lucide-trophy' })

const { report, loading, loadReport } = useCrmWon()

const RANGES = [
  { key: '30', label: 'Last 30 days' }, { key: '90', label: 'Last 90 days' }, { key: '365', label: 'Last 12 months' },
  { key: 'ytd', label: 'This year' }, { key: 'all', label: 'All time' },
] as const
const range = useLocalStorage<string>('crm-won-range', 'all')
const ownerId = ref('all')
const includeReverted = ref(false)
const users = ref<{ id: string, name: string }[]>([])
onMounted(async () => {
  try { const res = await $fetch<any[]>('/api/users'); users.value = (res || []).map(u => ({ id: u.id, name: u.name || u.email })).sort((a, b) => a.name.localeCompare(b.name)) } catch {}
})
const fromDate = computed(() => {
  if (range.value === 'all') return undefined
  if (range.value === 'ytd') return format(startOfYear(new Date()), 'yyyy-MM-dd')
  return format(subDays(new Date(), Number(range.value)), 'yyyy-MM-dd')
})
async function reload(quiet = true) {
  try {
    await loadReport({ from: fromDate.value, ownerId: ownerId.value === 'all' ? '' : ownerId.value, includeReverted: includeReverted.value })
    if (!quiet) toast.success('Report refreshed')
  } catch { toast.error('Could not load won deals') }
}
watch([range, ownerId, includeReverted], () => reload(), { immediate: true })
const r = computed(() => report.value)

const DIMENSIONS = [
  { key: 'bySource', label: 'Acquisition source' }, { key: 'byFirstTouch', label: 'First touch' }, { key: 'byTemplate', label: 'Template' },
  { key: 'byCampaign', label: 'Campaign' }, { key: 'byOwner', label: 'Owner' }, { key: 'byStructure', label: 'Contract' }, { key: 'byMonth', label: 'Month' },
] as const
const dim = useLocalStorage<string>('crm-won-dim', 'bySource')
const dimRows = computed<WonGroupRow[]>(() => ((r.value as any)?.[dim.value] || []) as WonGroupRow[])
const dimMax = computed(() => Math.max(1, ...dimRows.value.map(x => x.annualRevenue)))
const dimLabel = computed(() => DIMENSIONS.find(d => d.key === dim.value)?.label || '')
const keyLabel = (k: string) => dim.value === 'byMonth' && /^\d{4}-\d{2}$/.test(k) ? format(parseISO(`${k}-01`), 'MMM yyyy') : k
const serviceMax = computed(() => Math.max(1, ...(r.value?.byService.map(s => s.monthlyRevenue) || [1])))

const fmtDate = (d?: string | null) => d ? format(new Date(d.length === 10 ? `${d}T12:00:00` : d), 'MMM d, yyyy') : '—'
const open = (w: { dealershipId: string }) => navigateTo(`/crm/dealership/${w.dealershipId}`)

function exportCsv() {
  const rows = r.value?.wins || []
  if (!rows.length) return
  const cols: [string, (w: WonDeal) => any][] = [
    ['Dealership ID', w => w.dealershipCode], ['Dealership', w => w.dealershipName], ['Date won', w => w.wonAt],
    ['Services', w => w.services.map(s => `${s.name} $${s.price} x ${s.monthlyVolume}/mo`).join('; ')],
    ['Contract', w => w.contractStructure], ['Term', w => w.contractTerm],
    ['Monthly revenue', w => w.monthlyRevenue], ['Annual revenue', w => w.annualRevenue],
    ['Monthly profit', w => w.monthlyProfit ?? ''], ['Annual profit', w => w.annualProfit ?? ''], ['Margin %', w => w.marginPct ?? ''],
    ['Acquisition source', w => w.acquisitionSource], ['First touch', w => w.firstTouch?.label || ''], ['First touch date', w => w.firstTouch?.at?.slice(0, 10) || ''],
    ['Template', w => w.attribution?.template ? `${w.attribution.template.name} ${w.attribution.template.version || ''}`.trim() : ''], ['Campaign', w => w.attribution?.campaign?.name || ''],
    ['Touches', w => w.touches?.total ?? ''], ['Emails', w => w.touches?.emails ?? ''], ['Days to close', w => w.daysToClose ?? ''],
    ['Owner', w => w.ownerName], ['Invoiced to date', w => w.invoicedToDate ?? 0], ['Reverted', w => w.revertedAt ? w.revertedAt.slice(0, 10) : ''],
  ]
  const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = [cols.map(c => c[0]).join(','), ...rows.map(w => cols.map(c => esc(c[1](w))).join(','))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `won-deals-${format(new Date(), 'yyyy-MM-dd')}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<template>
  <div class="space-y-5">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <Button variant="outline" size="sm" class="h-9 gap-1.5" :disabled="!r?.wins.length" @click="exportCsv"><Download class="size-4" /> Export CSV</Button>
        <Button variant="outline" size="icon" class="size-9" aria-label="Refresh" :disabled="loading" @click="reload(false)"><RefreshCw class="size-4" :class="loading && 'animate-spin'" /></Button>
      </Teleport>
    </ClientOnly>

    <div class="flex flex-wrap items-center gap-2">
      <Select v-model="range">
        <SelectTrigger class="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem v-for="o in RANGES" :key="o.key" :value="o.key">{{ o.label }}</SelectItem></SelectContent>
      </Select>
      <Select v-model="ownerId">
        <SelectTrigger class="h-9 w-[170px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent class="max-h-72"><SelectItem value="all">All owners</SelectItem><SelectItem v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</SelectItem></SelectContent>
      </Select>
      <label class="h-9 inline-flex items-center gap-2 rounded-md border px-3 text-xs cursor-pointer select-none" title="Include wins that were later undone (dealer deleted)">
        <Switch v-model="includeReverted" /> Include undone wins
      </label>
      <Loader2 v-if="loading && r" class="size-4 animate-spin text-muted-foreground" />
    </div>

    <div v-if="!r" class="flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Loading won deals…</div>

    <template v-else>
      <!-- Wins missing details -->
      <div v-if="r.missing.length" class="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
        <p class="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200"><AlertTriangle class="size-4 text-amber-600" /> {{ r.missing.length }} won dealership{{ r.missing.length === 1 ? ' has' : 's have' }} no deal details yet</p>
        <p class="text-xs text-muted-foreground mt-0.5">They aren't counted below. Open each one and click “Record deal details”.</p>
        <div class="flex flex-wrap gap-1.5 mt-2">
          <button v-for="m in r.missing" :key="m.dealershipId" type="button" class="rounded-full border bg-background px-2.5 py-0.5 text-xs hover:border-primary hover:text-primary" @click="open(m)">{{ m.dealershipName }}</button>
        </div>
      </div>

      <div v-if="!r.total" class="rounded-xl border bg-card px-6 py-16 text-center">
        <Trophy class="size-8 mx-auto text-muted-foreground/50" />
        <p class="mt-3 font-medium">No won deals with details in this view</p>
        <p class="text-sm text-muted-foreground mt-1">“Mark as won” on a dealership now asks for the services sold, contract and revenue — those wins show up here.</p>
      </div>

      <template v-else>
        <!-- Headline -->
        <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div class="rounded-xl border bg-card px-4 py-3">
            <p class="text-[11px] uppercase tracking-wider text-muted-foreground">Dealerships won</p>
            <p class="text-2xl font-bold tabular-nums mt-0.5">{{ r.total }}</p>
          </div>
          <div class="rounded-xl border bg-card px-4 py-3">
            <p class="text-[11px] uppercase tracking-wider text-muted-foreground">Est. revenue won</p>
            <p class="text-2xl font-bold tabular-nums mt-0.5">{{ money(r.annualRevenue) }}<span class="text-sm font-medium text-muted-foreground">/yr</span></p>
            <p class="text-[11px] text-muted-foreground tabular-nums">{{ money(r.monthlyRevenue) }} per month</p>
          </div>
          <div class="rounded-xl border bg-card px-4 py-3">
            <p class="text-[11px] uppercase tracking-wider text-muted-foreground">Est. annual profit</p>
            <p class="text-2xl font-bold tabular-nums mt-0.5">{{ r.annualProfit == null ? '—' : money(r.annualProfit) }}</p>
            <p class="text-[11px] text-muted-foreground">{{ r.profitKnown }} of {{ r.total }} deals have costs</p>
          </div>
          <div class="rounded-xl border bg-card px-4 py-3">
            <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Hourglass class="size-3" /> To close (avg)</p>
            <p class="text-2xl font-bold tabular-nums mt-0.5">{{ r.avgDaysToClose ?? '—' }}<span class="text-sm font-medium text-muted-foreground"> days</span></p>
            <p class="text-[11px] text-muted-foreground tabular-nums"><Footprints class="size-3 inline -mt-0.5" /> {{ r.avgTouches ?? '—' }} touches · {{ r.avgEmails ?? '—' }} emails</p>
          </div>
          <div class="rounded-xl border bg-card px-4 py-3">
            <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Receipt class="size-3" /> Invoiced to date</p>
            <p class="text-2xl font-bold tabular-nums mt-0.5">{{ money(r.invoicedToDate) }}</p>
            <p class="text-[11px] text-muted-foreground">Actual billing from Dealers (pre-tax)</p>
          </div>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
          <!-- Where wins come from -->
          <section class="xl:col-span-2 rounded-xl border bg-card overflow-hidden">
            <header class="px-4 py-2.5 border-b flex flex-wrap items-center gap-3">
              <div class="mr-auto">
                <h3 class="text-sm font-semibold">Wins by {{ dimLabel.toLowerCase() }}</h3>
                <p class="text-[11px] text-muted-foreground">Estimated revenue won, average deal size, days to close and touches.</p>
              </div>
              <div class="inline-flex flex-wrap rounded-lg border p-0.5 bg-muted/40">
                <button v-for="d in DIMENSIONS" :key="d.key" type="button" class="px-2 py-1 rounded-md text-xs transition-colors" :class="dim === d.key ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'" @click="dim = d.key">{{ d.label }}</button>
              </div>
            </header>
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="border-b text-muted-foreground">
                    <th class="text-left font-medium px-4 py-2">{{ dimLabel }}</th>
                    <th class="text-right font-medium px-2 py-2">Wins</th>
                    <th class="text-left font-medium px-2 py-2 w-[28%]">Est. annual revenue</th>
                    <th class="text-right font-medium px-2 py-2">Avg / win</th>
                    <th class="text-right font-medium px-2 py-2">Days</th>
                    <th class="text-right font-medium px-4 py-2">Touches</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in dimRows" :key="row.key" class="border-b last:border-0 hover:bg-muted/30">
                    <td class="px-4 py-2 font-medium">{{ keyLabel(row.key) }}</td>
                    <td class="px-2 py-2 text-right tabular-nums font-semibold">{{ row.count }}</td>
                    <td class="px-2 py-2">
                      <div class="flex items-center gap-2">
                        <div class="h-2 flex-1 rounded-full bg-muted overflow-hidden"><div class="h-full rounded-full bg-emerald-500" :style="{ width: `${(row.annualRevenue / dimMax) * 100}%` }" /></div>
                        <span class="tabular-nums w-20 text-right">{{ money(row.annualRevenue) }}</span>
                      </div>
                    </td>
                    <td class="px-2 py-2 text-right tabular-nums">{{ money(row.avgAnnualRevenue) }}</td>
                    <td class="px-2 py-2 text-right tabular-nums">{{ row.avgDaysToClose ?? '—' }}</td>
                    <td class="px-4 py-2 text-right tabular-nums">{{ row.avgTouches ?? '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Services sold -->
          <section class="rounded-xl border bg-card overflow-hidden">
            <header class="px-4 py-2.5 border-b">
              <h3 class="text-sm font-semibold">Services sold</h3>
              <p class="text-[11px] text-muted-foreground">Estimated monthly revenue and volume across wins.</p>
            </header>
            <ul class="py-1.5">
              <li v-for="s in r.byService" :key="s.key" class="px-4 py-1.5" :title="`${s.key}: ${s.count} deals · ${s.volume} cars/month · ${money(s.monthlyRevenue)}/month`">
                <div class="flex items-baseline justify-between gap-2 text-xs">
                  <span class="font-medium truncate">{{ s.key }}</span>
                  <span class="tabular-nums text-muted-foreground shrink-0"><span class="text-foreground font-semibold">{{ money(s.monthlyRevenue) }}</span>/mo · {{ s.count }} deal{{ s.count === 1 ? '' : 's' }}</span>
                </div>
                <div class="mt-1 h-2 rounded-full bg-muted overflow-hidden"><div class="h-full rounded-full bg-emerald-500" :style="{ width: `${(s.monthlyRevenue / serviceMax) * 100}%` }" /></div>
              </li>
            </ul>
          </section>
        </div>

        <!-- Wins -->
        <section class="rounded-xl border bg-card overflow-hidden">
          <header class="px-4 py-2.5 border-b flex items-center gap-2">
            <h3 class="text-sm font-semibold">Wins</h3>
            <span class="rounded-full px-1.5 py-0.5 text-[10px] tabular-nums leading-none font-semibold bg-muted">{{ r.wins.length }}</span>
          </header>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b text-muted-foreground">
                  <th class="text-left font-medium px-4 py-2">Dealership</th>
                  <th class="text-left font-medium px-2 py-2">Won</th>
                  <th class="text-left font-medium px-2 py-2">Services</th>
                  <th class="text-right font-medium px-2 py-2">Monthly</th>
                  <th class="text-right font-medium px-2 py-2">Annual</th>
                  <th class="text-right font-medium px-2 py-2">Profit/yr</th>
                  <th class="text-left font-medium px-2 py-2">Source · first touch</th>
                  <th class="text-left font-medium px-2 py-2">Credited to</th>
                  <th class="text-right font-medium px-2 py-2">Days · touches</th>
                  <th class="text-right font-medium px-2 py-2">Invoiced</th>
                  <th class="w-6" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="w in r.wins" :key="w.id" class="group border-b last:border-0 hover:bg-muted/30 cursor-pointer" :class="w.revertedAt && 'opacity-60'" @click="open(w)">
                  <td class="px-4 py-2">
                    <p class="font-medium group-hover:text-primary">{{ w.dealershipName }}</p>
                    <p class="text-[10px] text-muted-foreground"><span class="font-mono">{{ w.dealershipCode }}</span> · {{ w.ownerName || 'Unassigned' }}<span v-if="w.revertedAt" class="text-rose-600"> · undone {{ fmtDate(w.revertedAt) }}</span></p>
                  </td>
                  <td class="px-2 py-2 whitespace-nowrap tabular-nums">{{ fmtDate(w.wonAt) }}</td>
                  <td class="px-2 py-2 max-w-[220px]"><p class="line-clamp-2">{{ w.services.map(s => `${s.name} ×${s.monthlyVolume}`).join(', ') }}</p><p class="text-[10px] text-muted-foreground">{{ w.contractStructure }} · {{ w.contractTerm }}</p></td>
                  <td class="px-2 py-2 text-right tabular-nums">{{ money(w.monthlyRevenue) }}</td>
                  <td class="px-2 py-2 text-right tabular-nums font-semibold">{{ money(w.annualRevenue) }}</td>
                  <td class="px-2 py-2 text-right tabular-nums">{{ money(w.annualProfit) }}</td>
                  <td class="px-2 py-2"><p>{{ w.acquisitionSource || '—' }}</p><p class="text-[10px] text-muted-foreground">{{ w.firstTouch ? `${w.firstTouch.label} · ${fmtDate(w.firstTouch.at)}` : 'No first touch logged' }}</p></td>
                  <td class="px-2 py-2 max-w-[180px]"><p class="truncate">{{ w.attribution?.template?.name || '—' }}</p><p v-if="w.attribution?.campaign" class="text-[10px] text-muted-foreground truncate">{{ w.attribution.campaign.name }}</p></td>
                  <td class="px-2 py-2 text-right tabular-nums whitespace-nowrap">{{ w.daysToClose ?? '—' }}d · {{ w.touches?.total ?? 0 }}</td>
                  <td class="px-2 py-2 text-right tabular-nums">{{ money(w.invoicedToDate || 0) }}</td>
                  <td class="px-2 py-2"><ChevronRight class="size-4 text-muted-foreground/60 group-hover:text-primary" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>
