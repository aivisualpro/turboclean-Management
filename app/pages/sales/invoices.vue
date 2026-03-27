<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { toast } from 'vue-sonner'
import { generatePDF, downloadPDF, calcLineTotal } from '~/composables/useSalesDocument'
import { ChevronRight, ChevronDown, Folder, CalendarDays, Calendar as CalendarIcon, CalendarClock, Loader2, Download, Search, FileText, FileSpreadsheet, Eye } from 'lucide-vue-next'

const { setHeader } = usePageHeader()
setHeader({ title: 'Invoices', icon: 'i-lucide-receipt' })

// ─── Base State ──────────────────────────────────────────────────────────
const search = ref('')
const activeTab = ref<'all' | 'unpaid' | 'paid'>('all')
const activeType = ref<'all' | 'daily' | 'weekly'>('all')

const globalDatePreset = ref('all_time')
const customStartDate = ref('')
const customEndDate = ref('')

const computedDates = computed(() => {
  const d = new Date()
  const preset = globalDatePreset.value
  
  if (preset === 'today') return { start: new Date(d.setHours(0,0,0,0)).toISOString(), end: new Date(d.setHours(23,59,59,999)).toISOString() }
  if (preset === 'yesterday') { const y = new Date(); y.setDate(y.getDate() - 1); return { start: new Date(y.setHours(0,0,0,0)).toISOString(), end: new Date(y.setHours(23,59,59,999)).toISOString() } }
  if (preset === 'this_month') return { start: new Date(d.getFullYear(), d.getMonth(), 1).toISOString(), end: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).toISOString() }
  if (preset === 'last_month') return { start: new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString(), end: new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 59, 999).toISOString() }
  if (preset === 'this_year') return { start: new Date(d.getFullYear(), 0, 1).toISOString(), end: new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999).toISOString() }
  if (preset === 'last_year') return { start: new Date(d.getFullYear() - 1, 0, 1).toISOString(), end: new Date(d.getFullYear() - 1, 11, 31, 23, 59, 59, 999).toISOString() }
  if (preset === 'custom' && customStartDate.value && customEndDate.value) {
     return { start: new Date(customStartDate.value + 'T00:00:00.000Z').toISOString(), end: new Date(customEndDate.value + 'T23:59:59.999Z').toISOString() }
  }
  return { start: '', end: '' }
})

const expandedDealers = ref(new Set<string>())
const expandedYears   = ref(new Set<string>())
const expandedMonths  = ref(new Set<string>())

const activeFilter = ref<{
  label: string
  dealerId?: string
  dateStart?: string
  dateEnd?: string
}>({ label: 'All Invoices' })

// ─── Formatter Helpers ───────────────────────────────────────────────────
const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const badgeClasses: Record<string, string> = {
  Draft: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  Sent: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  Paid: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  Overdue: 'bg-red-500/10 text-red-600 border-red-500/20',
  Cancelled: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
}

// ─── Tree Data Fetching ──────────────────────────────────────────────────
const treeData = ref<any[]>([])
const treeLoading = ref(false)

async function fetchTree() {
  treeLoading.value = true
  try {
    const res = await $fetch<{ success: boolean; tree: any[] }>('/api/invoices/tree', {
      query: {
        paymentStatus: activeTab.value,
        type: activeType.value,
        dateStart: computedDates.value.start,
        dateEnd: computedDates.value.end,
      }
    })
    treeData.value = res.tree || []
  } catch (err) {
    console.error('Failed to load tree:', err)
  } finally {
    treeLoading.value = false
  }
}

// ─── Table Data Fetching ─────────────────────────────────────────────────
const invoices = ref<any[]>([])
const loading = ref(false)
const hasMore = ref(true)
const skip = ref(0)
const limit = 20
const sortBy = ref('date')
const sortDir = ref(-1)

async function fetchInvoices(reset = false) {
  if (loading.value) return
  if (reset) {
    skip.value = 0
    invoices.value = []
    hasMore.value = true
  }
  if (!hasMore.value) return

  loading.value = true
  try {
    const res = await $fetch<{ invoices: any[], hasMore: boolean }>('/api/invoices', {
      query: {
        skip: skip.value,
        limit,
        search: search.value,
        sortBy: sortBy.value,
        sortDir: sortDir.value,
        paymentStatus: activeTab.value,
        type: activeType.value,
        dealerId: activeFilter.value.dealerId,
        dateStart: activeFilter.value.dateStart || computedDates.value.start,
        dateEnd: activeFilter.value.dateEnd || computedDates.value.end,
      }
    })
    invoices.value = [...invoices.value, ...(res.invoices || [])]
    hasMore.value = res.hasMore
    skip.value += limit
  } catch (err) {
    console.error('Failed to fetch invoices:', err)
    toast.error('Failed to fetch invoices')
  } finally {
    loading.value = false
  }
}

// ─── Document Generation / Print ─────────────────────────────────────────
const selectedInvoice = ref<any>(null)
const showPreview = ref(false)

function openPreviewFor(inv: any) {
  selectedInvoice.value = inv
  showPreview.value = true
}

function handleDownload(inv: any) {
  const doc = toSalesDoc(inv)
  downloadPDF(doc, 'Invoice')
}

function toSalesDoc(inv: any) {
  return {
    id: inv.id,
    number: inv.number,
    client: inv.dealerName,
    clientEmail: inv.dealerEmail,
    clientAddress: inv.dealerAddress,
    status: inv.status,
    date: inv.date,
    dueDate: inv.dueDate,
    paidAmount: inv.paidAmount || 0,
    paymentMethod: inv.paymentMethod || '',
    notes: inv.notes || '',
    lineItems: (inv.lineItems || []).map((li: any) => ({
      id: li.workOrderId || li.invoiceId || '',
      description: li.description || `Invoice #${li.number}` || '',
      quantity: 1,
      unitPrice: li.amount || li.total || 0,
      discount: 0,
      tax: li.tax || li.taxTotal || 0,
    })),
    subtotal: inv.subtotal,
    taxTotal: inv.taxTotal,
    discountTotal: 0,
    total: inv.total,
    createdAt: inv.createdAt,
  }
}

const previewHtml = computed(() => {
  if (!selectedInvoice.value) return ''
  return generatePDF(toSalesDoc(selectedInvoice.value), 'Invoice')
})

// ─── Lifecycle & Observers ───────────────────────────────────────────────
const vIntersect = {
  mounted: (el: HTMLElement, binding: any) => {
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) binding.value() },
      { rootMargin: '100px', threshold: 0.1 }
    )
    observer.observe(el); (el as any)._observer = observer
  },
  unmounted: (el: HTMLElement) => {
    if ((el as any)._observer) (el as any)._observer.disconnect()
  },
}

onMounted(() => {
  fetchTree()
  fetchInvoices()
})

useLiveSync('Invoices', () => {
  fetchTree()
  fetchInvoices(true)
})

let searchTimeout: any
watch([search, activeTab, activeType, computedDates], () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    fetchTree()
    fetchInvoices(true)
  }, 300)
})

watch(activeFilter, () => fetchInvoices(true), { deep: true })

// ─── Tree Interactions ───────────────────────────────────────────────────
function toggleSet(set: Set<string>, val: string) { if (set.has(val)) set.delete(val); else set.add(val) }
function selectAll() { activeFilter.value = { label: 'All Invoices' } }
function selectDealer(dealer: any) { activeFilter.value = { label: dealer.dealerName, dealerId: dealer.dealerId } }

function selectYear(dealer: any, year: any) {
  activeFilter.value = {
    label: `${dealer.dealerName} — ${year.year}`,
    dealerId: dealer.dealerId,
    dateStart: `${year.year}-01-01T00:00:00.000Z`,
    dateEnd: `${year.year}-12-31T23:59:59.999Z`
  }
}

function selectMonth(dealer: any, year: any, month: any) {
  const y = year.year
  const m = month.monthNumber.toString().padStart(2, '0')
  const lastDay = new Date(y, month.monthNumber, 0).getDate()
  activeFilter.value = {
    label: `${dealer.dealerName} — ${month.month} ${year.year}`,
    dealerId: dealer.dealerId,
    dateStart: `${y}-${m}-01T00:00:00.000Z`,
    dateEnd: `${y}-${m}-${lastDay}T23:59:59.999Z`
  }
}

function selectDate(dealer: any, year: any, month: any, dateNode: any) {
  activeFilter.value = {
    label: `${dealer.dealerName} — ${fmtDate(dateNode.date)}`,
    dealerId: dealer.dealerId,
    dateStart: `${dateNode.date}T00:00:00.000Z`,
    dateEnd: `${dateNode.date}T23:59:59.999Z`
  }
}

// ─── Table Sorting ───────────────────────────────────────────────────────
function toggleSort(field: string) {
  if (sortBy.value === field) sortDir.value = sortDir.value === -1 ? 1 : -1
  else { sortBy.value = field; sortDir.value = -1 }
  fetchInvoices(true)
}
function sortIcon(field: string) {
  if (sortBy.value !== field) return 'lucide:arrow-up-down'
  return sortDir.value === -1 ? 'lucide:arrow-down' : 'lucide:arrow-up'
}

</script>

<template>
  <div class="absolute inset-0 flex flex-col overflow-hidden bg-background">
    <!-- Top Nav Action Bar -->
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <div class="flex items-center gap-2">
          
          <Select v-model="globalDatePreset">
            <SelectTrigger class="w-[140px] h-8 text-sm font-medium bg-background shadow-sm">
              <SelectValue placeholder="Date Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="yesterday">Yesterday</SelectItem>
              <SelectItem value="this_month">This Month</SelectItem>
              <SelectItem value="last_month">Last Month</SelectItem>
              <SelectItem value="this_year">This Year</SelectItem>
              <SelectItem value="last_year">Last Year</SelectItem>
              <SelectItem value="all_time">All Time</SelectItem>
              <SelectItem value="custom">Custom Date...</SelectItem>
            </SelectContent>
          </Select>

          <div v-if="globalDatePreset === 'custom'" class="flex items-center gap-1.5 animate-in fade-in zoom-in-95">
            <Input type="date" v-model="customStartDate" class="h-8 text-xs w-[125px] flex-1 bg-background shadow-sm" />
            <span class="text-muted-foreground text-xs font-medium">to</span>
            <Input type="date" v-model="customEndDate" class="h-8 text-xs w-[125px] flex-1 bg-background shadow-sm" />
          </div>

          <div class="relative hidden sm:block">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input v-model="search" placeholder="Search invoices..." class="pl-8 w-44 h-8 text-sm bg-background shadow-sm" />
          </div>
        </div>
      </Teleport>
    </ClientOnly>

    <!-- Main Layout Grid -->
    <div class="flex-1 min-h-0 flex flex-col md:flex-row gap-4 p-4 lg:px-8 max-w-[1600px] mx-auto w-full">
      
      <!-- ─── Sidebar Tree ──────────────────────────────────────────────────────── -->
      <aside class="w-full md:w-80 shrink-0 flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
        <div class="p-3 border-b bg-muted/30 shrink-0 font-medium text-sm flex items-center justify-between">
          <span>Grouping & Filters</span>
          <button @click="selectAll" class="text-xs text-primary hover:underline">Clear</button>
        </div>

        <div class="flex-1 overflow-y-auto p-2" v-if="!treeLoading || treeData.length > 0">
          <div @click="selectAll" class="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm mb-1 transition-colors" :class="!activeFilter.dealerId ? 'bg-primary text-primary-foreground font-medium shadow-sm' : 'hover:bg-muted'">
            <div class="flex items-center gap-2">
              <Folder class="size-4" :class="!activeFilter.dealerId ? 'text-primary-foreground/80' : 'text-muted-foreground'" />
              <span>All Invoices</span>
            </div>
          </div>

          <!-- Tree Dealers -->
          <div v-for="dealer in treeData" :key="dealer.dealerId">
            <div class="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors group" :class="activeFilter.dealerId === dealer.dealerId && !activeFilter.dateStart ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'">
              <div class="flex items-center gap-1.5 overflow-hidden" @click="toggleSet(expandedDealers, dealer.dealerId)">
                <button class="shrink-0 p-0.5 rounded text-muted-foreground hover:bg-muted-foreground/20">
                  <ChevronDown v-if="expandedDealers.has(dealer.dealerId)" class="size-3.5" />
                  <ChevronRight v-else class="size-3.5" />
                </button>
                <Folder class="size-3.5" :class="activeFilter.dealerId === dealer.dealerId && !activeFilter.dateStart ? 'text-primary' : 'text-muted-foreground'" />
                <span class="truncate font-semibold" @click.stop="selectDealer(dealer)">{{ dealer.dealerName }}</span>
              </div>
              <span class="text-[10px] tabular-nums font-mono opacity-60 shrink-0 select-none">
                <span class="opacity-70 mr-1.5">({{ dealer.count }})</span>{{ fmt(dealer.totalAmount) }}
              </span>
            </div>

            <!-- Years -->
            <div v-if="expandedDealers.has(dealer.dealerId)" class="pl-5 relative before:absolute before:inset-y-0 before:left-3.5 before:w-px before:bg-border/60">
              <div v-for="yr in dealer.years" :key="yr.year">
                <div class="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors" :class="activeFilter.dateStart?.startsWith(yr.year.toString()) && activeFilter.dateEnd?.endsWith('12-31T23:59:59.999Z') ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'">
                  <div class="flex items-center gap-1.5" @click="toggleSet(expandedYears, `${dealer.dealerId}-${yr.year}`)">
                    <button class="shrink-0 p-0.5 rounded text-muted-foreground hover:bg-muted-foreground/20">
                      <ChevronDown v-if="expandedYears.has(`${dealer.dealerId}-${yr.year}`)" class="size-3.5" />
                      <ChevronRight v-else class="size-3.5" />
                    </button>
                    <CalendarIcon class="size-3.5 text-muted-foreground" />
                    <span @click.stop="selectYear(dealer, yr)">{{ yr.year }}</span>
                  </div>
                  <span class="text-[10px] tabular-nums font-mono opacity-50 shrink-0 select-none"><span class="opacity-70 mr-1.5">({{ yr.count }})</span>{{ fmt(yr.totalAmount) }}</span>
                </div>

                <!-- Months -->
                <div v-if="expandedYears.has(`${dealer.dealerId}-${yr.year}`)" class="pl-5 relative before:absolute before:inset-y-0 before:left-3.5 before:w-px before:bg-border/60">
                  <div v-for="mo in yr.months" :key="mo.month">
                    <div class="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors" :class="activeFilter.dateStart?.startsWith(`${yr.year}-${mo.monthNumber.toString().padStart(2, '0')}`) && !activeFilter.dateEnd?.startsWith(activeFilter.dateStart?.slice(0, 10) || '') ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'">
                      <div class="flex items-center gap-1.5" @click="toggleSet(expandedMonths, `${dealer.dealerId}-${yr.year}-${mo.monthNumber}`)">
                        <button class="shrink-0 p-0.5 rounded text-muted-foreground hover:bg-muted-foreground/20">
                          <ChevronDown v-if="expandedMonths.has(`${dealer.dealerId}-${yr.year}-${mo.monthNumber}`)" class="size-3.5" />
                          <ChevronRight v-else class="size-3.5" />
                        </button>
                        <CalendarDays class="size-3.5 text-muted-foreground" />
                        <span @click.stop="selectMonth(dealer, yr, mo)">{{ mo.month }}</span>
                      </div>
                      <span class="text-[10px] tabular-nums font-mono opacity-50 shrink-0 select-none"><span class="opacity-70 mr-1.5">({{ mo.count }})</span>{{ fmt(mo.totalAmount) }}</span>
                    </div>

                    <!-- Dates -->
                    <div v-if="expandedMonths.has(`${dealer.dealerId}-${yr.year}-${mo.monthNumber}`)" class="pl-6 relative before:absolute before:inset-y-0 before:left-3.5 before:w-px before:bg-border/60">
                      <div v-for="dt in mo.dates" :key="dt.date" @click="selectDate(dealer, yr, mo, dt)" class="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors" :class="activeFilter.dateStart?.startsWith(dt.date) ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-foreground/80'">
                        <div class="flex items-center gap-2">
                          <CalendarClock class="size-3 text-muted-foreground" />
                          <span>{{ fmtDate(dt.date) }}</span>
                        </div>
                        <span class="text-[10px] tabular-nums font-mono opacity-50 shrink-0 select-none"><span class="opacity-70 mr-1.5">({{ dt.count }})</span>{{ fmt(dt.totalAmount) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="flex-1 flex items-center justify-center p-4">
          <Loader2 class="size-5 animate-spin text-muted-foreground/50" />
        </div>
      </aside>

      <!-- ─── Main Content ──────────────────────────────────────────────────────── -->
      <main class="flex-1 min-w-0 flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-[rgba(0,0,0,0.05)_0px_2px_10px]">
        
        <!-- Header Filters -->
        <div class="flex flex-col xl:flex-row items-start xl:items-center justify-between border-b bg-muted/10 shrink-0">
          <div class="flex items-center px-4 py-3 gap-3 w-full xl:w-auto overflow-hidden border-b xl:border-b-0">
            <span class="truncate font-semibold text-sm">{{ activeFilter.label }}</span>
            <Badge variant="secondary" class="font-mono text-[10px] shrink-0">
              <span v-if="loading" class="animate-pulse">...</span>
              <span v-else>{{ hasMore ? invoices.length + '+' : invoices.length }} invoices</span>
            </Badge>
          </div>

          <div class="flex flex-wrap items-center gap-2 px-3 py-2 xl:py-2 bg-gradient-to-r from-transparent to-muted/20">
            <!-- TYPE TABS (Daily vs Weekly) -->
            <div class="flex bg-muted/60 p-1 rounded-lg border border-border/50">
              <button @click="activeType = 'all'"     class="px-2.5 py-1 text-xs font-medium rounded-md transition-all shadow-sm" :class="activeType === 'all' ? 'bg-background text-foreground ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground'">All Types</button>
              <button @click="activeType = 'daily'"   class="px-2.5 py-1 text-xs font-medium rounded-md transition-all" :class="activeType === 'daily' ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50 text-blue-600' : 'text-muted-foreground hover:text-foreground'">Daily</button>
              <button @click="activeType = 'weekly'"  class="px-2.5 py-1 text-xs font-medium rounded-md transition-all" :class="activeType === 'weekly' ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50 text-purple-600' : 'text-muted-foreground hover:text-foreground'">Weekly</button>
            </div>

            <!-- PAYMENT STATUS TABS -->
            <div class="flex bg-muted/60 p-1 rounded-lg border border-border/50">
              <button @click="activeTab = 'all'"      class="px-2.5 py-1 text-xs font-medium rounded-md transition-all shadow-sm" :class="activeTab === 'all' ? 'bg-background text-foreground ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground'">All Status</button>
              <button @click="activeTab = 'unpaid'"   class="px-2.5 py-1 text-xs font-medium rounded-md transition-all" :class="activeTab === 'unpaid' ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground'">Un-Paid</button>
              <button @click="activeTab = 'paid'"     class="px-2.5 py-1 text-xs font-medium rounded-md transition-all" :class="activeTab === 'paid' ? 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 shadow-sm' : 'text-muted-foreground hover:text-foreground'">Paid</button>
            </div>
          </div>
        </div>

        <!-- Table Data -->
        <div class="flex-1 overflow-auto">
          <table class="w-full text-sm caption-bottom border-collapse">
            <TableHeader class="sticky top-0 z-10 bg-card backdrop-blur shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              <TableRow>
                <TableHead class="w-[80px]">#</TableHead>
                <TableHead v-if="!activeFilter.dealerId">Dealer</TableHead>
                <TableHead class="cursor-pointer" @click="toggleSort('date')"><div class="flex items-center gap-1">Date <Icon :name="sortIcon('date')" class="size-3 opacity-50" /></div></TableHead>
                <TableHead>Type</TableHead>
                <TableHead class="text-right">Subtotal</TableHead>
                <TableHead class="text-right">Tax</TableHead>
                <TableHead class="text-right">Total</TableHead>
                <TableHead class="text-center">Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead class="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="inv in invoices" :key="inv.id" class="cursor-pointer hover:bg-muted/50 transition-colors">
                <TableCell class="font-bold text-xs">
                  <div class="flex items-center gap-1.5 text-primary">
                    <FileSpreadsheet class="size-3.5 opacity-70" />
                    {{ inv.number }}
                  </div>
                </TableCell>
                <TableCell v-if="!activeFilter.dealerId" class="text-xs">
                  <p class="font-semibold max-w-[140px] truncate">{{ inv.dealerName }}</p>
                </TableCell>
                <TableCell class="text-xs whitespace-nowrap">{{ fmtDate(inv.date) }}</TableCell>
                <TableCell>
                  <Badge variant="outline" class="text-[9px] uppercase tracking-wide" :class="inv.type === 'Weekly' ? 'bg-purple-500/10 text-purple-600 border-purple-500/20' : 'bg-blue-500/10 text-blue-600 border-blue-500/20'">
                    {{ inv.type || 'Weekly' }}
                  </Badge>
                </TableCell>
                <TableCell class="text-right text-xs tabular-nums text-muted-foreground">{{ fmt(inv.subtotal) }}</TableCell>
                <TableCell class="text-right text-xs tabular-nums text-muted-foreground">{{ fmt(inv.taxTotal) }}</TableCell>
                <TableCell class="text-right text-xs tabular-nums font-bold">{{ fmt(inv.total) }}</TableCell>
                <TableCell class="text-center text-xs tabular-nums">{{ inv.lineItems?.length || 0 }}</TableCell>
                <TableCell>
                  <Badge variant="outline" :class="badgeClasses[inv.status] || ''" class="text-[10px]">
                    {{ inv.status }}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div class="flex items-center justify-center gap-0.5">
                    <Button variant="ghost" size="icon" class="h-7 w-7 hover:text-primary hover:bg-primary/10" @click="openPreviewFor(inv)">
                      <Eye class="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" class="h-7 w-7" @click="handleDownload(inv)">
                      <Download class="size-4 text-muted-foreground" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>

              <TableRow v-if="loading && invoices.length === 0">
                <TableCell :colspan="11" class="text-center py-10">
                  <Loader2 class="size-6 animate-spin text-muted-foreground/50 mx-auto" />
                </TableCell>
              </TableRow>
              <TableRow v-if="!loading && invoices.length === 0">
                <TableCell :colspan="11" class="text-center py-10">
                  <FileSpreadsheet class="size-10 text-muted-foreground/20 mx-auto mb-3" />
                  <p class="text-sm font-medium text-foreground">No invoices found</p>
                  <p class="text-xs text-muted-foreground mt-1">Try adjusting your tabs or date range.</p>
                </TableCell>
              </TableRow>

              <tr v-if="hasMore && invoices.length > 0" v-intersect="fetchInvoices" class="h-10">
                <td :colspan="11" class="text-center">
                  <div v-if="loading" class="flex justify-center py-4"><Loader2 class="size-4 animate-spin text-muted-foreground/50" /></div>
                </td>
              </tr>
            </TableBody>
          </table>
        </div>
      </main>
    </div>

    <!-- Preview Dialog -->
    <Dialog v-model:open="showPreview">
      <DialogContent class="sm:max-w-[70vw] w-[95vw] lg:max-w-[1000px] max-h-[95vh] overflow-auto p-0 gap-0">
        <div class="p-4 border-b flex items-center justify-between bg-muted/20">
          <DialogTitle class="flex items-center gap-2">
            <div class="p-1.5 bg-primary/10 text-primary rounded-md"><FileSpreadsheet class="size-4" /></div>
            Invoice Preview – {{ selectedInvoice?.number }}
          </DialogTitle>
          <div class="flex gap-2">
            <Button variant="outline" size="sm" @click="showPreview = false">Close</Button>
            <Button size="sm" @click="handleDownload(selectedInvoice)">
              <Download class="mr-1 size-4" /> Download PDF
            </Button>
          </div>
        </div>
        <div class="bg-gray-50/50 p-6 flex justify-center">
          <div class="border rounded-lg overflow-hidden bg-white shadow-lg w-full max-w-[850px]">
            <iframe :srcdoc="previewHtml" class="w-full border-0 min-h-[750px]" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
