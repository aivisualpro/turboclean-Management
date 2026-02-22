<script setup lang="ts">
import NumberFlow from '@number-flow/vue'
import { TrendingUp, Calendar as CalendarIcon } from 'lucide-vue-next'
import type { DateRange } from 'reka-ui'
import type { Ref } from 'vue'
import { CalendarDate, DateFormatter, getLocalTimeZone, today } from '@internationalized/date'

const { setHeader } = usePageHeader()
setHeader({ title: 'Sales Reports', icon: 'i-lucide-trending-up' })

const activeTab = ref('overview')

// ── Date Range ────────────────────────────────────
const df = new DateFormatter('en-US', { dateStyle: 'medium' })
const todayDate = today(getLocalTimeZone())
const dateRange = ref({
  start: todayDate.subtract({ days: 20 }),
  end: todayDate,
}) as Ref<DateRange>

function dateToISO(d: any): string {
  return d.toDate(getLocalTimeZone()).toISOString().split('T')[0]
}

// ── Fetch real stats ──────────────────────────────
const stats = ref<any>(null)
const statsLoading = ref(true)

async function fetchStats() {
  statsLoading.value = true
  try {
    const params: Record<string, string> = {}
    if (dateRange.value.start) params.from = dateToISO(dateRange.value.start)
    if (dateRange.value.end) params.to = dateToISO(dateRange.value.end)
    stats.value = await $fetch('/api/reports/sales-stats', { query: params })
  } catch (err) {
    console.error('Failed to load stats:', err)
  } finally {
    statsLoading.value = false
  }
}

watch(() => dateRange.value.end, (newEnd) => {
  if (newEnd) fetchStats()
})

onMounted(fetchStats)

// ── Derived KPI cards ─────────────────────────────
const kpis = computed(() => {
  const k = stats.value?.kpis
  if (!k) return []
  return [
    { label: 'Total Revenue', value: k.totalRevenue, prefix: '$', suffix: '', icon: 'i-lucide-dollar-sign', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    { label: 'Work Orders', value: k.totalOrders, prefix: '', suffix: '', icon: 'i-lucide-wrench', color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { label: 'Avg. Order', value: k.avgOrderSize, prefix: '$', suffix: '', icon: 'i-lucide-bar-chart-3', color: 'text-violet-500', bg: 'bg-violet-500/10' },
    { label: 'Invoiced', value: k.invoicedPct, prefix: '', suffix: '%', icon: 'i-lucide-check-circle', color: 'text-amber-500', bg: 'bg-amber-500/10' },
    { label: 'Active Dealers', value: k.totalDealers, prefix: '', suffix: '', icon: 'i-lucide-building-2', color: 'text-pink-500', bg: 'bg-pink-500/10' },
    { label: 'Uninvoiced', value: k.uninvoicedRevenue, prefix: '$', suffix: '', icon: 'i-lucide-clock', color: 'text-cyan-500', bg: 'bg-cyan-500/10' },
  ]
})

// ── Chart data ────────────────────────────────────
const monthlyTrend = computed(() => stats.value?.monthlyTrend || [])
const topDealers = computed(() => stats.value?.topDealers || [])
const topDealerMax = computed(() => topDealers.value[0]?.revenue || 1)
const topServices = computed(() => stats.value?.topServices || [])
const dealerStatuses = computed(() => stats.value?.dealerStatuses || [])

// Deal breakdown for stacked bar chart
const dealsBreakdown = computed(() => {
  return monthlyTrend.value.map((m: any) => ({
    month: m.shortMonth,
    invoiced: m.invoiced,
    uninvoiced: m.uninvoiced,
  }))
})

// ── Helpers ────────────────────────────────────────
function fmt(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtFull(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const chartColors = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#6366f1']
const statusColors: Record<string, string> = {
  'Authorised': '#10b981',
  'Pending': '#f59e0b',
  'Rejected': '#ef4444',
  'In Followup': '#3b82f6',
}

const avatarColors = [
  'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  'bg-pink-500/15 text-pink-600 dark:text-pink-400',
  'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
]
</script>

<template>
  <div class="w-full flex flex-col gap-5">
    <!-- Header Actions (date picker teleported) -->
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <Popover>
          <PopoverTrigger as-child>
            <Button id="sales-date-range" variant="outline" size="sm" class="h-8 justify-start text-left font-normal text-xs">
              <CalendarIcon class="mr-2 size-3.5" />
              <template v-if="dateRange.start">
                <template v-if="dateRange.end">
                  {{ df.format(dateRange.start.toDate(getLocalTimeZone())) }} – {{ df.format(dateRange.end.toDate(getLocalTimeZone())) }}
                </template>
                <template v-else>
                  {{ df.format(dateRange.start.toDate(getLocalTimeZone())) }}
                </template>
              </template>
              <template v-else>
                Pick a date range
              </template>
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-0" align="end">
            <RangeCalendar
              v-model="dateRange"
              weekday-format="short"
              :number-of-months="2"
              initial-focus
              :placeholder="dateRange.start"
              @update:start-value="(startDate: any) => dateRange.start = startDate"
            />
          </PopoverContent>
        </Popover>
      </Teleport>
    </ClientOnly>
    <!-- Loading -->
    <div v-if="statsLoading" class="flex items-center justify-center py-32">
      <div class="text-center space-y-3">
        <Icon name="lucide:loader-2" class="size-8 animate-spin text-muted-foreground mx-auto" />
        <p class="text-sm text-muted-foreground">Crunching your numbers...</p>
      </div>
    </div>

    <template v-else-if="stats">
      <!-- Tab Navigation -->
      <div class="flex items-center gap-1 border rounded-lg p-1 bg-muted/30 w-fit">
        <button
          v-for="tab in [
            { id: 'overview', label: 'Overview', icon: 'i-lucide-layout-dashboard' },
            { id: 'dealers', label: 'Dealers', icon: 'i-lucide-building-2' },
            { id: 'services', label: 'Services', icon: 'i-lucide-briefcase' },
          ]"
          :key="tab.id"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all" :class="[
            activeTab === tab.id ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
          ]"
          @click="activeTab = tab.id"
        >
          <Icon :name="tab.icon" class="size-3.5" />
          {{ tab.label }}
        </button>
      </div>

      <!-- KPI Cards -->
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Card v-for="(kpi, i) in kpis" :key="i">
          <CardContent class="p-4 space-y-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center justify-center rounded-lg p-1.5" :class="kpi.bg">
                <Icon :name="kpi.icon" class="size-3.5" :class="kpi.color" />
              </div>
            </div>
            <div>
              <p class="text-xl font-bold tabular-nums leading-tight">
                {{ kpi.prefix }}<NumberFlow :value="kpi.value" :format="{ notation: kpi.value > 99999 ? 'compact' : 'standard', maximumFractionDigits: 1 }" />{{ kpi.suffix }}
              </p>
              <p class="text-[10px] text-muted-foreground mt-0.5">
                {{ kpi.label }}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- OVERVIEW TAB -->
      <template v-if="activeTab === 'overview'">
        <!-- Revenue Trend + Service Mix -->
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card class="lg:col-span-2">
            <CardHeader class="pb-2">
              <div class="flex items-center justify-between">
                <div>
                  <CardTitle class="text-sm font-semibold">Revenue Trend</CardTitle>
                  <CardDescription>Monthly work order revenue</CardDescription>
                </div>
                <Badge variant="outline" class="text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/10">
                  <TrendingUp class="size-3 mr-1" /> {{ monthlyTrend.length }} months
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <AreaChart
                v-if="monthlyTrend.length > 0"
                :data="monthlyTrend"
                index="month"
                :categories="['revenue']"
                :colors="['#10b981']"
                :y-formatter="(v: number | Date) => `$${(Number(v) / 1000).toFixed(0)}K`"
                class="h-[280px]"
                :show-legend="false"
              />
              <div v-else class="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                No monthly data available
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader class="pb-2">
              <CardTitle class="text-sm font-semibold">Revenue by Service</CardTitle>
              <CardDescription>Top service contribution</CardDescription>
            </CardHeader>
            <CardContent class="flex flex-col items-center">
              <DonutChart
                v-if="topServices.length > 0"
                :data="topServices"
                index="name"
                category="revenue"
                :colors="chartColors.slice(0, topServices.length)"
                :value-formatter="(v: number) => fmt(v)"
                class="h-[180px]"
              />
              <div class="w-full mt-4 space-y-2">
                <div v-for="(s, i) in topServices.slice(0, 5)" :key="s.name" class="flex items-center justify-between text-xs">
                  <div class="flex items-center gap-2 min-w-0">
                    <div class="size-2.5 rounded-full shrink-0" :style="{ background: chartColors[Number(i) % chartColors.length] }" />
                    <span class="text-muted-foreground truncate">{{ s.name }}</span>
                  </div>
                  <span class="font-semibold tabular-nums shrink-0 ml-2">{{ fmt(s.revenue) }}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <!-- Work Orders Breakdown + Dealer Status -->
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader class="pb-2">
              <CardTitle class="text-sm font-semibold">Work Orders Breakdown</CardTitle>
              <CardDescription>Monthly invoiced vs uninvoiced</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart
                v-if="dealsBreakdown.length > 0"
                :data="dealsBreakdown"
                index="month"
                :categories="['invoiced', 'uninvoiced']"
                :colors="['#10b981', '#f59e0b']"
                type="stacked"
                :rounded-corners="4"
                class="h-[260px]"
              />
              <div v-else class="h-[260px] flex items-center justify-center text-muted-foreground text-sm">
                No data available
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader class="pb-2">
              <CardTitle class="text-sm font-semibold">Dealer Status</CardTitle>
              <CardDescription>Current dealer pipeline distribution</CardDescription>
            </CardHeader>
            <CardContent>
              <div class="space-y-4">
                <div v-for="s in dealerStatuses" :key="s.name" class="space-y-1.5">
                  <div class="flex items-center justify-between text-sm">
                    <span class="font-medium">{{ s.name }}</span>
                    <span class="text-muted-foreground tabular-nums">{{ s.value }} <span class="text-[10px]">dealers</span></span>
                  </div>
                  <div class="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all duration-1000"
                      :style="{ width: `${(s.value / (stats.kpis.totalDealers || 1)) * 100}%`, background: statusColors[s.name] || '#94a3b8' }"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </template>

      <!-- DEALERS TAB -->
      <template v-if="activeTab === 'dealers'">
        <Card>
          <CardHeader class="pb-2">
            <div class="flex items-center justify-between">
              <div>
                <CardTitle class="text-sm font-semibold">Top Dealers by Revenue</CardTitle>
                <CardDescription>Highest revenue generating dealers from work orders</CardDescription>
              </div>
              <Badge variant="secondary" class="text-xs">{{ topDealers.length }} dealers</Badge>
            </div>
          </CardHeader>
          <CardContent class="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead class="w-12">Rank</TableHead>
                  <TableHead>Dealer</TableHead>
                  <TableHead class="text-right">Revenue</TableHead>
                  <TableHead class="text-center">Orders</TableHead>
                  <TableHead>Revenue Share</TableHead>
                  <TableHead class="text-center">Invoiced</TableHead>
                  <TableHead class="text-right">Avg. Order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="(d, i) in topDealers" :key="d.name">
                  <TableCell>
                    <div class="flex items-center justify-center size-6 rounded-full text-[10px] font-bold" :class="Number(i) < 3 ? 'bg-amber-500/15 text-amber-600' : 'bg-muted text-muted-foreground'">
                      {{ i + 1 }}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div class="flex items-center gap-2.5">
                      <div class="flex items-center justify-center rounded-full size-8 text-xs font-bold" :class="avatarColors[i % avatarColors.length]">
                        {{ d.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2) }}
                      </div>
                      <span class="font-medium text-sm truncate max-w-[200px]">{{ d.name }}</span>
                    </div>
                  </TableCell>
                  <TableCell class="text-right font-semibold tabular-nums">{{ fmtFull(d.revenue) }}</TableCell>
                  <TableCell class="text-center tabular-nums">{{ d.orders }}</TableCell>
                  <TableCell>
                    <div class="flex items-center gap-2">
                      <div class="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${(d.revenue / topDealerMax) * 100}%` }" />
                      </div>
                      <span class="text-xs font-medium tabular-nums w-10 text-right">{{ Math.round((d.revenue / (stats.kpis.totalRevenue || 1)) * 100) }}%</span>
                    </div>
                  </TableCell>
                  <TableCell class="text-center tabular-nums">
                    {{ d.invoiced }}/{{ d.orders }}
                  </TableCell>
                  <TableCell class="text-right tabular-nums text-sm text-muted-foreground">
                    {{ fmt(d.orders > 0 ? Math.round(d.revenue / d.orders) : 0) }}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <!-- Dealer Revenue Bar Chart -->
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm font-semibold">Dealer Revenue Distribution</CardTitle>
            <CardDescription>Visual comparison of top dealer revenue</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="space-y-3">
              <div v-for="(d, i) in topDealers" :key="d.name" class="space-y-1.5">
                <div class="flex items-center justify-between text-sm">
                  <div class="flex items-center gap-2">
                    <div class="size-3 rounded" :style="{ background: chartColors[i % chartColors.length] }" />
                    <span class="font-medium truncate max-w-[200px]">{{ d.name }}</span>
                  </div>
                  <span class="font-semibold tabular-nums">{{ fmt(d.revenue) }}</span>
                </div>
                <div class="h-7 rounded-lg overflow-hidden bg-muted/50 relative">
                  <div
                    class="h-full rounded-lg transition-all duration-1000 flex items-center px-3"
                    :style="{ width: `${(d.revenue / topDealerMax) * 100}%`, background: chartColors[i % chartColors.length] }"
                  >
                    <span v-if="(d.revenue / topDealerMax) > 0.15" class="text-white text-[10px] font-semibold">{{ d.orders }} orders</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </template>

      <!-- SERVICES TAB -->
      <template v-if="activeTab === 'services'">
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card class="lg:col-span-2">
            <CardHeader class="pb-2">
              <div class="flex items-center justify-between">
                <div>
                  <CardTitle class="text-sm font-semibold">Service Performance</CardTitle>
                  <CardDescription>Revenue and volume by service type</CardDescription>
                </div>
                <Badge variant="secondary" class="text-xs">{{ topServices.length }} services</Badge>
              </div>
            </CardHeader>
            <CardContent class="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead class="w-12">Rank</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead class="text-right">Revenue</TableHead>
                    <TableHead class="text-center">Orders</TableHead>
                    <TableHead>Revenue Share</TableHead>
                    <TableHead class="text-right">Avg. Order</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="(s, i) in topServices" :key="s.name">
                    <TableCell>
                      <div class="flex items-center justify-center size-6 rounded-full text-[10px] font-bold" :class="Number(i) < 3 ? 'bg-violet-500/15 text-violet-600' : 'bg-muted text-muted-foreground'">
                        {{ i + 1 }}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div class="flex items-center gap-2">
                        <div class="size-3 rounded" :style="{ background: chartColors[i % chartColors.length] }" />
                        <span class="font-medium text-sm truncate max-w-[250px]">{{ s.name }}</span>
                      </div>
                    </TableCell>
                    <TableCell class="text-right font-semibold tabular-nums">{{ fmtFull(s.revenue) }}</TableCell>
                    <TableCell class="text-center tabular-nums">{{ s.orders }}</TableCell>
                    <TableCell>
                      <div class="flex items-center gap-2">
                        <div class="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div class="h-full rounded-full transition-all" :style="{ width: `${(s.revenue / (stats.kpis.totalRevenue || 1)) * 100}%`, background: chartColors[i % chartColors.length] }" />
                        </div>
                        <span class="text-xs font-medium tabular-nums w-10 text-right">{{ Math.round((s.revenue / (stats.kpis.totalRevenue || 1)) * 100) }}%</span>
                      </div>
                    </TableCell>
                    <TableCell class="text-right tabular-nums text-sm text-muted-foreground">
                      {{ fmt(s.orders > 0 ? Math.round(s.revenue / s.orders) : 0) }}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader class="pb-2">
              <CardTitle class="text-sm font-semibold">Service Revenue Split</CardTitle>
              <CardDescription>Proportional breakdown</CardDescription>
            </CardHeader>
            <CardContent class="flex flex-col items-center">
              <DonutChart
                v-if="topServices.length > 0"
                :data="topServices"
                index="name"
                category="revenue"
                :colors="chartColors.slice(0, topServices.length)"
                :value-formatter="(v: number) => fmt(v)"
                class="h-[200px]"
              />
              <div class="w-full mt-4 space-y-2">
                <div v-for="(s, i) in topServices" :key="s.name" class="flex items-center justify-between text-xs">
                  <div class="flex items-center gap-2 min-w-0">
                    <div class="size-2.5 rounded-full shrink-0" :style="{ background: chartColors[i % chartColors.length] }" />
                    <span class="text-muted-foreground truncate">{{ s.name }}</span>
                  </div>
                  <div class="flex items-center gap-2 shrink-0 ml-2">
                    <span class="text-muted-foreground tabular-nums">{{ s.orders }} orders</span>
                    <span class="font-semibold tabular-nums">{{ fmt(s.revenue) }}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </template>
    </template>
  </div>
</template>
