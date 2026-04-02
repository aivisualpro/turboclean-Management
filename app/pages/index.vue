<script setup lang="ts">
import NumberFlow from '@number-flow/vue'
import { TrendingUp, Calendar as CalendarIcon } from 'lucide-vue-next'
import type { DateRange } from 'reka-ui'
import type { Ref } from 'vue'
import { CalendarDate, DateFormatter, getLocalTimeZone, today } from '@internationalized/date'
import DashboardRevenueTooltip from '~/components/dashboard/RevenueTooltip.vue'

const { setHeader } = usePageHeader()
setHeader({ title: 'Dashboard', icon: 'i-lucide-layout-dashboard' })

const activeTab = ref('overview')

// ── Quarter helpers ───────────────────────────────
function getQuarterRange(year: number, quarter: number) {
  const startMonth = (quarter - 1) * 3 + 1
  const endMonth = startMonth + 2
  const endDay = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][endMonth - 1]!
  const actualEndDay = endMonth === 2 && (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : endDay
  return {
    start: new CalendarDate(year, startMonth, 1),
    end: new CalendarDate(year, endMonth, actualEndDay),
  }
}

function getLastDayOfMonth(year: number, month: number) {
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
  if (month === 2 && (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) return 29
  return days
}

const df = new DateFormatter('en-US', { dateStyle: 'medium' })
const todayDate = today(getLocalTimeZone())
const currentQuarter = Math.ceil(todayDate.month / 3)
const currentYear = todayDate.year

const activeQuarter = ref(currentQuarter)
const activeYear = ref(currentYear)
const activeFilter = ref('quarter')

const quarterLabel = computed(() => `Q${activeQuarter.value} ${activeYear.value}`)

const dateRange = ref(getQuarterRange(currentYear, currentQuarter)) as Ref<DateRange>

function prevQuarter() {
  if (activeQuarter.value === 1) {
    activeQuarter.value = 4
    activeYear.value--
  } else {
    activeQuarter.value--
  }
  activeFilter.value = 'quarter'
  dateRange.value = getQuarterRange(activeYear.value, activeQuarter.value)
}

function nextQuarter() {
  if (activeQuarter.value === 4) {
    activeQuarter.value = 1
    activeYear.value++
  } else {
    activeQuarter.value++
  }
  activeFilter.value = 'quarter'
  dateRange.value = getQuarterRange(activeYear.value, activeQuarter.value)
}

// ── Preset filters ──────────────────────────────
const presets = [
  { value: 'current-month', label: 'Current Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'last-3-months', label: 'Last 3 Months' },
  { value: 'quarter', label: 'Current Quarter' },
  { value: 'current-year', label: 'Current Year' },
  { value: 'last-year', label: 'Last Year' },
  { value: 'all', label: 'All Records' },
  { value: 'custom', label: 'Custom Range' },
]

const activeFilterLabel = computed(() => {
  if (activeFilter.value === 'quarter') return quarterLabel.value
  if (activeFilter.value === 'custom') return 'Custom Range'
  return presets.find(p => p.value === activeFilter.value)?.label || 'Custom'
})

function applyPreset(preset: string) {
  activeFilter.value = preset
  const y = todayDate.year
  const m = todayDate.month

  switch (preset) {
    case 'current-month':
      dateRange.value = {
        start: new CalendarDate(y, m, 1),
        end: new CalendarDate(y, m, getLastDayOfMonth(y, m)),
      }
      break
    case 'last-month': {
      const lm = m === 1 ? 12 : m - 1
      const ly = m === 1 ? y - 1 : y
      dateRange.value = {
        start: new CalendarDate(ly, lm, 1),
        end: new CalendarDate(ly, lm, getLastDayOfMonth(ly, lm)),
      }
      break
    }
    case 'last-3-months': {
      const threeMonthsAgo = todayDate.subtract({ months: 2 })
      dateRange.value = {
        start: new CalendarDate(threeMonthsAgo.year, threeMonthsAgo.month, 1),
        end: new CalendarDate(y, m, getLastDayOfMonth(y, m)),
      }
      break
    }
    case 'quarter':
      activeQuarter.value = currentQuarter
      activeYear.value = currentYear
      dateRange.value = getQuarterRange(currentYear, currentQuarter)
      break
    case 'current-year':
      dateRange.value = {
        start: new CalendarDate(y, 1, 1),
        end: new CalendarDate(y, 12, 31),
      }
      break
    case 'last-year':
      dateRange.value = {
        start: new CalendarDate(y - 1, 1, 1),
        end: new CalendarDate(y - 1, 12, 31),
      }
      break
    case 'all':
      dateRange.value = { start: undefined as any, end: undefined as any }
      fetchStats()
      break
    case 'custom':
      // Keep current dateRange — user will pick via calendar
      break
  }
}

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

// Fire immediately — no loading delay
if (import.meta.client) fetchStats()

// ── Derived KPI cards ─────────────────────────────
const kpis = computed(() => {
  const k = stats.value?.kpis
  if (!k) return []

  if (activeTab.value === 'dealers') {
    const td = topDealers.value
    const topDealerName = td[0]?.name || 'N/A'
    const topDealerRev = td[0]?.revenue || 0
    const totalDealerRevenue = td.reduce((s: number, d: any) => s + d.revenue, 0)
    const avgPerDealer = td.length > 0 ? totalDealerRevenue / td.length : 0
    const totalDealerOrders = td.reduce((s: number, d: any) => s + d.orders, 0)
    return [
      { label: 'Total Dealers', value: k.totalDealers, prefix: '', suffix: '', icon: 'i-lucide-building-2', color: 'text-pink-500', bg: 'bg-pink-500/10' },
      { label: 'Total Revenue', value: totalDealerRevenue, prefix: '$', suffix: '', icon: 'i-lucide-dollar-sign', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
      { label: 'Top Dealer Revenue', value: topDealerRev, prefix: '$', suffix: '', icon: 'i-lucide-trophy', color: 'text-amber-500', bg: 'bg-amber-500/10' },
      { label: 'Avg. Revenue / Dealer', value: Math.round(avgPerDealer * 100) / 100, prefix: '$', suffix: '', icon: 'i-lucide-bar-chart-3', color: 'text-violet-500', bg: 'bg-violet-500/10' },
      { label: 'Total Orders', value: totalDealerOrders, prefix: '', suffix: '', icon: 'i-lucide-wrench', color: 'text-blue-500', bg: 'bg-blue-500/10' },
    ]
  }

  if (activeTab.value === 'services') {
    const ts = topServices.value
    const topSvcName = ts[0]?.name || 'N/A'
    const topSvcRev = ts[0]?.revenue || 0
    const totalSvcRevenue = ts.reduce((s: number, svc: any) => s + svc.revenue, 0)
    const avgPerSvc = ts.length > 0 ? totalSvcRevenue / ts.length : 0
    const totalSvcOrders = ts.reduce((s: number, svc: any) => s + svc.orders, 0)
    return [
      { label: 'Total Services', value: k.totalServices, prefix: '', suffix: '', icon: 'i-lucide-briefcase', color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
      { label: 'Total Revenue', value: totalSvcRevenue, prefix: '$', suffix: '', icon: 'i-lucide-dollar-sign', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
      { label: 'Top Service Revenue', value: topSvcRev, prefix: '$', suffix: '', icon: 'i-lucide-trophy', color: 'text-amber-500', bg: 'bg-amber-500/10' },
      { label: 'Avg. Revenue / Service', value: Math.round(avgPerSvc * 100) / 100, prefix: '$', suffix: '', icon: 'i-lucide-bar-chart-3', color: 'text-violet-500', bg: 'bg-violet-500/10' },
      { label: 'Total Orders', value: totalSvcOrders, prefix: '', suffix: '', icon: 'i-lucide-wrench', color: 'text-blue-500', bg: 'bg-blue-500/10' },
    ]
  }

  // Overview (default)
  const zakat = Math.round((k.totalAmount || 0) * 0.025 * 100) / 100
  return [
    { label: 'Revenue Before Tax', value: k.totalAmount, prefix: '$', suffix: '', icon: 'i-lucide-banknote', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    { label: 'Total Taxes', value: k.totalTax, prefix: '$', suffix: '', icon: 'i-lucide-receipt-text', color: 'text-red-500', bg: 'bg-red-500/10' },
    { label: 'Revenue After Tax', value: k.totalRevenue, prefix: '$', suffix: '', icon: 'i-lucide-dollar-sign', color: 'text-emerald-600', bg: 'bg-emerald-600/10' },
    { label: 'Zakat (2.5% Charity)', value: zakat, prefix: '$', suffix: '', icon: 'i-lucide-heart-handshake', color: 'text-teal-500', bg: 'bg-teal-500/10' },
    { label: 'Work Orders', value: k.totalOrders, prefix: '', suffix: '', icon: 'i-lucide-wrench', color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { label: 'Avg. Order', value: k.avgOrderSize, prefix: '$', suffix: '', icon: 'i-lucide-bar-chart-3', color: 'text-violet-500', bg: 'bg-violet-500/10' },
    { label: 'Invoiced %', value: k.invoicedPct, prefix: '', suffix: '%', icon: 'i-lucide-check-circle', color: 'text-amber-500', bg: 'bg-amber-500/10' },
    { label: 'Active Dealers', value: k.totalDealers, prefix: '', suffix: '', icon: 'i-lucide-building-2', color: 'text-pink-500', bg: 'bg-pink-500/10' },
    { label: 'Uninvoiced', value: k.uninvoicedRevenue, prefix: '$', suffix: '', icon: 'i-lucide-clock', color: 'text-cyan-500', bg: 'bg-cyan-500/10' },
  ]
})

// ── Chart data ────────────────────────────────────
const monthlyTrendRaw = computed(() => stats.value?.monthlyTrend || [])
const monthlyTrend = computed(() => monthlyTrendRaw.value.map((m: any) => ({
  month: m.month,
  revenue: m.revenue,
  orders: m.orders,
  avgOrder: m.orders > 0 ? Math.round(m.revenue / m.orders * 100) / 100 : 0,
  topDealers: m.topDealers || [],
})))
const topDealers = computed(() => stats.value?.topDealers || [])
const topDealerMax = computed(() => topDealers.value[0]?.revenue || 1)
const topServices = computed(() => stats.value?.topServices || [])
const dealerStatuses = computed(() => stats.value?.dealerStatuses || [])

// Deal breakdown for stacked bar chart
const dealsBreakdown = computed(() => {
  return monthlyTrendRaw.value.map((m: any) => ({
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
    <!-- Header Actions -->
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <div class="flex items-center gap-1.5">
          <!-- Preset Filters Dropdown -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" size="sm" class="h-8 text-xs gap-1.5">
                <Icon name="i-lucide-filter" class="size-3.5" />
                {{ activeFilterLabel }}
                <Icon name="i-lucide-chevron-down" class="size-3 ml-0.5 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-44">
              <DropdownMenuItem
                v-for="p in presets"
                :key="p.value"
                class="text-xs"
                :class="activeFilter === p.value ? 'bg-accent' : ''"
                @click="applyPreset(p.value)"
              >
                <Icon v-if="activeFilter === p.value" name="i-lucide-check" class="size-3.5 mr-1" />
                <span :class="activeFilter !== p.value ? 'ml-[22px]' : ''">{{ p.label }}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <!-- Quarter Navigation (visible when quarter filter is active) -->
          <div v-if="activeFilter === 'quarter'" class="flex items-center gap-0.5 border rounded-lg bg-muted/30 h-8">
            <Button variant="ghost" size="icon" class="h-8 w-7 rounded-r-none" @click="prevQuarter">
              <Icon name="i-lucide-chevron-left" class="size-3.5" />
            </Button>
            <span class="text-xs font-semibold px-1 tabular-nums min-w-[56px] text-center">{{ quarterLabel }}</span>
            <Button variant="ghost" size="icon" class="h-8 w-7 rounded-l-none" @click="nextQuarter">
              <Icon name="i-lucide-chevron-right" class="size-3.5" />
            </Button>
          </div>

          <!-- Custom Date Range Picker (visible when custom filter is active) -->
          <Popover v-if="activeFilter === 'custom'">
            <PopoverTrigger as-child>
              <Button variant="outline" size="sm" class="h-8 text-xs gap-1.5">
                <CalendarIcon class="size-3.5" />
                <template v-if="dateRange.start">
                  {{ df.format(dateRange.start.toDate(getLocalTimeZone())) }} – {{ dateRange.end ? df.format(dateRange.end.toDate(getLocalTimeZone())) : '...' }}
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

          <!-- Date Range Display (for non-custom, non-all filters) -->
          <div v-else-if="activeFilter !== 'all' && dateRange.start" class="hidden md:flex items-center h-8 px-2.5 border rounded-lg bg-muted/30 text-xs text-muted-foreground">
            <CalendarIcon class="mr-1.5 size-3.5" />
            {{ df.format(dateRange.start.toDate(getLocalTimeZone())) }} – {{ dateRange.end ? df.format(dateRange.end.toDate(getLocalTimeZone())) : '...' }}
          </div>
        </div>
      </Teleport>
    </ClientOnly>
    <!-- Loading State -->
    <div v-if="statsLoading" class="space-y-6">
      <div class="flex items-center gap-1 border rounded-lg p-1 bg-muted/30 w-fit">
        <Skeleton class="h-8 w-24" />
        <Skeleton class="h-8 w-24" />
        <Skeleton class="h-8 w-24" />
      </div>
      
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Card v-for="i in 5" :key="i">
          <CardContent class="p-4 space-y-3">
            <Skeleton class="h-8 w-8 rounded-lg" />
            <div class="space-y-2">
              <Skeleton class="h-6 w-24" />
              <Skeleton class="h-3 w-16" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton class="lg:col-span-2 h-[380px] rounded-xl" />
        <Skeleton class="h-[380px] rounded-xl" />
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton class="h-[340px] rounded-xl" />
        <Skeleton class="h-[340px] rounded-xl" />
        <Skeleton class="h-[340px] rounded-xl" />
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
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Card v-for="(kpi, i) in kpis" :key="i">
          <CardContent class="p-4 space-y-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center justify-center rounded-lg p-1.5" :class="kpi.bg">
                <Icon :name="kpi.icon" class="size-3.5" :class="kpi.color" />
              </div>
            </div>
            <div>
              <p class="text-xl font-bold tabular-nums leading-tight">
                {{ kpi.prefix }}<NumberFlow :value="kpi.value" :format="{ notation: 'standard', maximumFractionDigits: 2 }" />{{ kpi.suffix }}
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
                :custom-tooltip="DashboardRevenueTooltip"
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

        <!-- Work Orders Breakdown + Dealer Status + Sales per Dealer -->
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <!-- Sales per Dealer -->
          <Card>
            <CardHeader class="pb-2">
              <CardTitle class="text-sm font-semibold">Sales per Dealer</CardTitle>
              <CardDescription>Top dealers by revenue</CardDescription>
            </CardHeader>
            <CardContent>
              <div class="space-y-4 pt-1">
                <div v-for="(d, i) in topDealers.slice(0, 5)" :key="d.name" class="space-y-1.5">
                  <div class="flex items-center justify-between text-sm">
                    <span class="font-medium truncate pr-2">{{ d.name }}</span>
                    <span class="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{{ fmt(d.revenue) }}</span>
                  </div>
                  <div class="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all duration-1000"
                      :style="{ width: `${(d.revenue / topDealerMax) * 100}%`, background: chartColors[Number(i) % chartColors.length] }"
                    />
                  </div>
                </div>
                <div v-if="topDealers.length === 0" class="h-[140px] flex items-center justify-center text-muted-foreground text-sm">
                  No data available
                </div>
              </div>
            </CardContent>
          </Card>

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
                      {{ Number(i) + 1 }}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div class="flex items-center gap-2.5">
                      <div class="flex items-center justify-center rounded-full size-8 text-xs font-bold" :class="avatarColors[Number(i) % avatarColors.length]">
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
                    <div class="size-3 rounded" :style="{ background: chartColors[Number(i) % chartColors.length] }" />
                    <span class="font-medium truncate max-w-[200px]">{{ d.name }}</span>
                  </div>
                  <span class="font-semibold tabular-nums">{{ fmt(d.revenue) }}</span>
                </div>
                <div class="h-7 rounded-lg overflow-hidden bg-muted/50 relative">
                  <div
                    class="h-full rounded-lg transition-all duration-1000 flex items-center px-3"
                    :style="{ width: `${(d.revenue / topDealerMax) * 100}%`, background: chartColors[Number(i) % chartColors.length] }"
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
                        {{ Number(i) + 1 }}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div class="flex items-center gap-2">
                        <div class="size-3 rounded" :style="{ background: chartColors[Number(i) % chartColors.length] }" />
                        <span class="font-medium text-sm truncate max-w-[250px]">{{ s.name }}</span>
                      </div>
                    </TableCell>
                    <TableCell class="text-right font-semibold tabular-nums">{{ fmtFull(s.revenue) }}</TableCell>
                    <TableCell class="text-center tabular-nums">{{ s.orders }}</TableCell>
                    <TableCell>
                      <div class="flex items-center gap-2">
                        <div class="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div class="h-full rounded-full transition-all" :style="{ width: `${(s.revenue / (stats.kpis.totalRevenue || 1)) * 100}%`, background: chartColors[Number(i) % chartColors.length] }" />
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
                    <div class="size-2.5 rounded-full shrink-0" :style="{ background: chartColors[Number(i) % chartColors.length] }" />
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
