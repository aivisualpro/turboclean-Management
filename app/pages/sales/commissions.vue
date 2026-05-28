<script setup lang="ts">
import { ChevronLeft, ChevronRight, ChevronDown, Calendar as CalendarIcon, Search } from 'lucide-vue-next'

const { setHeader } = usePageHeader()
setHeader({ title: 'Commissions', icon: 'i-lucide-percent' })

// ─── Formatter ───────────────────────────────────────────────────────────
const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)

// ─── URL Query Sync ──────────────────────────────────────────────────────
const route = useRoute()
const router = useRouter()

const currentYear = new Date().getFullYear()
const selectedYear = ref(Number(route.query.year) || currentYear)
const showWeekList = ref(false)
const search = ref((route.query.search as string) || '')
const initialWeek = route.query.week != null ? Number(route.query.week) : -1 // -1 means "auto-detect"

// Generate all Fridays in a given year
function getFridaysInYear(year: number): Date[] {
  const fridays: Date[] = []
  const d = new Date(Date.UTC(year, 0, 1))
  // Find first Friday
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1)
  while (d.getUTCFullYear() === year) {
    fridays.push(new Date(d))
    d.setUTCDate(d.getUTCDate() + 7)
  }
  return fridays
}

const allFridays = computed(() => getFridaysInYear(selectedYear.value))

// Find the current (or most recent) Friday
function findCurrentFridayIndex(fridays: Date[]): number {
  const today = new Date()
  for (let i = fridays.length - 1; i >= 0; i--) {
    if (fridays[i] && fridays[i]! <= today) return i
  }
  return 0
}

const selectedFridayIndex = ref(0)

// Initialize to URL week or auto-detect
watch(allFridays, (fridays) => {
  if (initialWeek >= 0 && initialWeek < fridays.length) {
    selectedFridayIndex.value = initialWeek
  } else {
    selectedFridayIndex.value = findCurrentFridayIndex(fridays)
  }
}, { immediate: true })

// Sync state → URL (debounced for search)
let urlSyncTimeout: any
function syncToUrl() {
  clearTimeout(urlSyncTimeout)
  urlSyncTimeout = setTimeout(() => {
    const query: Record<string, string> = {}
    if (selectedYear.value !== currentYear) query.year = String(selectedYear.value)
    if (selectedFridayIndex.value !== findCurrentFridayIndex(allFridays.value)) query.week = String(selectedFridayIndex.value)
    if (search.value.trim()) query.search = search.value.trim()
    router.replace({ query })
  }, 300)
}

watch([selectedYear, selectedFridayIndex, search], () => syncToUrl())

const selectedFriday = computed(() => allFridays.value[selectedFridayIndex.value])

// Week range: Saturday (friday - 6 days) to Friday
const weekRange = computed(() => {
  const fri = selectedFriday.value
  if (!fri) return { start: '', end: '', label: '' }
  const sat = new Date(fri)
  sat.setUTCDate(sat.getUTCDate() - 6)
  const startStr = sat.toISOString().split('T')[0]
  const endStr = fri.toISOString().split('T')[0]
  const startLabel = sat.toLocaleDateString('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short' })
  const endLabel = fri.toLocaleDateString('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
  return { start: startStr, end: endStr, label: `${startLabel} — ${endLabel}` }
})

// Format a Friday for display in the selector
function fmtFriday(d: Date) {
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', day: '2-digit', month: 'short' })
}

function fmtFridayFull(d: Date) {
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' })
}

function prevWeek() {
  if (selectedFridayIndex.value > 0) selectedFridayIndex.value--
}
function nextWeek() {
  if (selectedFridayIndex.value < allFridays.value.length - 1) selectedFridayIndex.value++
}
function selectWeek(idx: number) {
  selectedFridayIndex.value = idx
  showWeekList.value = false
}

// Close week list on click outside
function handleOverlayClick() {
  showWeekList.value = false
}

// ─── Data Fetching ───────────────────────────────────────────────────────
const salesData = ref<any[]>([])
const loading = ref(false)

async function fetchWeeklyData() {
  const { start, end } = weekRange.value
  if (!start || !end) return
  loading.value = true
  try {
    const res = await $fetch<{ success: boolean; dealers: any[] }>('/api/commissions/weekly', {
      query: { dateStart: start, dateEnd: end }
    })
    // Map to table rows with local commission % and check state
    salesData.value = (res.dealers || []).map((d: any) => ({
      ...d,
      commissionPct: 75,
      checkDeposited: false,
    }))
  } catch (err) {
    console.error('Failed to fetch commission data:', err)
    salesData.value = []
  } finally {
    loading.value = false
  }
}

// ─── Dealer Detail (Right Panel) ─────────────────────────────────────────
const selectedDealer = ref<any>(null)
const dealerInvoices = ref<any[]>([])
const loadingInvoices = ref(false)

// Refetch when week changes — also clear dealer selection
watch(weekRange, () => {
  fetchWeeklyData()
  selectedDealer.value = null
  dealerInvoices.value = []
}, { immediate: true })

async function selectDealer(row: any) {
  selectedDealer.value = row
  dealerInvoices.value = []
  loadingInvoices.value = true
  try {
    const res = await $fetch<{ invoices: any[] }>('/api/invoices', {
      query: {
        dealerId: row.dealerId,
        dateStart: weekRange.value.start,
        dateEnd: weekRange.value.end,
        type: 'daily',
        limit: 200,
        sortBy: 'date',
        sortDir: -1,
      }
    })
    dealerInvoices.value = res.invoices || []
  } catch (err) {
    console.error('Failed to fetch dealer invoices:', err)
  } finally {
    loadingInvoices.value = false
  }
}

const dealerInvoiceTotalBefore = computed(() => dealerInvoices.value.reduce((s, i) => s + (i.subtotal || 0), 0))
const dealerInvoiceTotalAfter = computed(() => dealerInvoices.value.reduce((s, i) => s + (i.total || 0), 0))

// ─── Client-side Search Filter ───────────────────────────────────────────
const filteredSalesData = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return salesData.value
  return salesData.value.filter((d: any) =>
    (d.dealerName || '').toLowerCase().includes(q)
  )
})

// ─── Computed Totals ─────────────────────────────────────────────────────
const totalBeforeTax = computed(() => filteredSalesData.value.reduce((sum, d) => sum + (d.beforeTax || 0), 0))
const totalTax = computed(() => filteredSalesData.value.reduce((sum, d) => sum + ((d.beforeTax || 0) - (d.afterTax || 0)), 0))
const totalAfterTax = computed(() => filteredSalesData.value.reduce((sum, d) => sum + (d.afterTax || 0), 0))
const totalCommission = computed(() => filteredSalesData.value.reduce((sum, d) => sum + ((d.beforeTax || 0) * (d.commissionPct || 75) / 100), 0))

</script>

<template>
  <div class="absolute inset-0 flex flex-col overflow-hidden bg-background">
    <!-- Top Nav Action Bar -->
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <div class="flex items-center gap-2">
          
          <!-- Search -->
          <div class="relative hidden sm:block">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input v-model="search" placeholder="Search dealers..." class="pl-8 w-44 h-8 text-sm bg-background shadow-sm" />
          </div>

          <!-- Year Selector -->
          <Select :model-value="selectedYear.toString()" @update:model-value="(v: any) => selectedYear = Number(v)">
            <SelectTrigger class="w-[100px] h-8 text-sm font-medium bg-background shadow-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="y in [2024, 2025, 2026, 2027]" :key="y" :value="y.toString()">{{ y }}</SelectItem>
            </SelectContent>
          </Select>

          <!-- Week Navigator: << [01-May] >> -->
          <div class="flex items-center gap-0 relative">
            <Button variant="ghost" size="icon" class="h-8 w-8" :disabled="selectedFridayIndex <= 0" @click="prevWeek">
              <ChevronLeft class="size-4" />
            </Button>

            <button 
              class="h-8 px-3 flex items-center gap-1.5 text-sm font-semibold rounded-md border bg-background shadow-sm hover:bg-muted transition-colors min-w-[100px] justify-center"
              @click.stop="showWeekList = !showWeekList"
            >
              <CalendarIcon class="size-3.5 text-muted-foreground" />
              {{ selectedFriday ? fmtFriday(selectedFriday) : '—' }}
              <ChevronDown class="size-3 text-muted-foreground ml-0.5" />
            </button>

            <Button variant="ghost" size="icon" class="h-8 w-8" :disabled="selectedFridayIndex >= allFridays.length - 1" @click="nextWeek">
              <ChevronRight class="size-4" />
            </Button>

            <!-- Week List Dropdown -->
            <Teleport to="body">
              <div v-if="showWeekList" class="fixed inset-0 z-40" @click="handleOverlayClick" />
            </Teleport>
            <div 
              v-if="showWeekList"
              class="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 w-[200px] max-h-[320px] overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg animate-in fade-in zoom-in-95"
            >
              <button
                v-for="(fri, idx) in allFridays"
                :key="idx"
                class="flex items-center justify-between w-full px-2.5 py-1.5 text-sm rounded-md transition-colors"
                :class="idx === selectedFridayIndex ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-muted text-foreground'"
                @click="selectWeek(idx)"
              >
                <span>{{ fmtFridayFull(fri) }}</span>
                <span class="text-[10px] font-mono opacity-60">W{{ idx + 1 }}</span>
              </button>
            </div>
          </div>

          <!-- Week Range Label -->
          <Badge variant="outline" class="h-8 px-3 text-xs font-medium whitespace-nowrap hidden lg:flex items-center gap-1.5">
            <CalendarIcon class="size-3 text-muted-foreground" />
            {{ weekRange.label }}
          </Badge>
        </div>
      </Teleport>
    </ClientOnly>

    <!-- 3-Column Layout: 50% | 15% | 35% -->
    <div class="flex-1 min-h-0 flex gap-4 p-4 w-full">

      <!-- ─── LEFT: Sales Table (50%) ─────────────────────────────────────────── -->
      <div class="flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm" style="flex: 0 0 50%;">
        <div class="p-3 border-b bg-muted/30 shrink-0 font-medium text-sm flex items-center justify-between">
          <span>Commission CARLOS 75% Minus Insurance</span>
          <Badge variant="secondary" class="font-mono text-[10px]">
            {{ filteredSalesData.length }} dealers
          </Badge>
        </div>

        <div class="flex-1 overflow-auto">
          <table class="w-full text-sm caption-bottom border-collapse">
            <TableHeader class="sticky top-0 z-10 bg-card backdrop-blur shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              <TableRow>
                <TableHead class="pl-4">Dealer</TableHead>
                <TableHead class="text-right">Check Amount</TableHead>
                <TableHead class="text-right">Tax</TableHead>
                <TableHead class="text-right">After Tax</TableHead>
                <TableHead class="text-right">Commission (75%)</TableHead>
                <TableHead class="text-center">Check Deposited</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <!-- Loading -->
              <template v-if="loading && salesData.length === 0">
                <TableRow v-for="i in 8" :key="i">
                  <TableCell v-for="j in 6" :key="j"><Skeleton class="h-4 w-full rounded" /></TableCell>
                </TableRow>
              </template>

              <!-- Data Rows -->
              <TableRow v-for="(row, idx) in filteredSalesData" :key="row.dealerId" class="hover:bg-muted/50 transition-colors">
                <TableCell class="pl-4">
                  <span class="font-semibold text-xs">{{ row.dealerName }}</span>
                </TableCell>
                <TableCell class="text-right text-xs tabular-nums text-muted-foreground">
                  {{ fmt(row.beforeTax) }}
                </TableCell>
                <TableCell class="text-right text-xs tabular-nums text-muted-foreground">
                  {{ fmt((row.beforeTax || 0) - (row.afterTax || 0)) }}
                </TableCell>
                <TableCell class="text-right text-xs tabular-nums font-bold">
                  {{ fmt(row.afterTax) }}
                </TableCell>
                <TableCell class="text-right text-xs tabular-nums text-primary font-bold">
                  {{ fmt((row.beforeTax || 0) * (row.commissionPct || 75) / 100) }}
                </TableCell>
                <TableCell class="text-center">
                  <div class="flex items-center justify-center">
                    <button
                      :aria-checked="row.checkDeposited"
                      @click="row.checkDeposited = !row.checkDeposited"
                      role="checkbox"
                      class="size-5 rounded border flex items-center justify-center transition-colors cursor-pointer"
                      :class="row.checkDeposited 
                        ? 'bg-emerald-500 border-emerald-500 text-white' 
                        : 'border-input bg-card hover:bg-muted'"
                    >
                      <Icon v-if="row.checkDeposited" name="lucide:check" class="size-3.5" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>

              <!-- Empty State -->
              <TableRow v-if="!loading && filteredSalesData.length === 0">
                <TableCell colspan="6" class="text-center py-10">
                  <Icon name="i-lucide-receipt" class="size-10 text-muted-foreground/20 mx-auto mb-3" />
                  <p class="text-sm font-medium text-foreground">No invoices found</p>
                  <p class="text-xs text-muted-foreground mt-1">No sales data for this week.</p>
                </TableCell>
              </TableRow>

              <!-- Totals Footer -->
              <TableRow v-if="filteredSalesData.length > 0" class="bg-muted/30 border-t-2 font-semibold">
                <TableCell class="pl-4 text-xs">
                  Total
                </TableCell>
                <TableCell class="text-right text-xs tabular-nums">
                  {{ fmt(totalBeforeTax) }}
                </TableCell>
                <TableCell class="text-right text-xs tabular-nums">
                  {{ fmt(totalTax) }}
                </TableCell>
                <TableCell class="text-right text-xs tabular-nums font-bold">
                  {{ fmt(totalAfterTax) }}
                </TableCell>
                <TableCell class="text-right text-xs tabular-nums text-primary font-bold pr-4">
                  {{ fmt(totalCommission) }}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </table>
        </div>
      </div>

      <!-- ─── MIDDLE: 15% ──────────────────────────────────────────────────────── -->
      <div class="flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm" style="flex: 0 0 15%;">
        <div class="p-3 border-b bg-muted/30 shrink-0 font-medium text-sm">
          <span>Summary</span>
        </div>
        <div class="flex-1 flex flex-col items-center justify-center gap-3 p-4 text-center">
          <div class="w-full space-y-3">
            <div class="rounded-lg bg-muted/20 p-3 space-y-1">
              <p class="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">Check Amount</p>
              <p class="text-lg font-bold tabular-nums">{{ fmt(totalBeforeTax) }}</p>
            </div>
            <div class="rounded-lg bg-muted/20 p-3 space-y-1">
              <p class="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">After Tax</p>
              <p class="text-lg font-bold tabular-nums">{{ fmt(totalAfterTax) }}</p>
            </div>
            <div class="rounded-lg bg-primary/10 p-3 space-y-1 border border-primary/20">
              <p class="text-[10px] uppercase font-semibold text-primary tracking-wide">Commission</p>
              <p class="text-lg font-bold tabular-nums text-primary">{{ fmt(totalCommission) }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- ─── RIGHT: Coming Up (35%) ────────────────────────────────────── -->
      <div class="flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm" style="flex: 0 0 calc(35% - 2rem);">
        <div class="p-3 border-b bg-muted/30 shrink-0 font-medium text-sm">
          <span>Details</span>
        </div>
        <div class="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div class="flex size-14 items-center justify-center rounded-2xl bg-muted/30">
            <Icon name="i-lucide-construction" class="size-7 text-muted-foreground/40" />
          </div>
          <div>
            <p class="text-base font-semibold text-foreground">Coming Up</p>
            <p class="text-xs text-muted-foreground mt-1">This section is under development.</p>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
