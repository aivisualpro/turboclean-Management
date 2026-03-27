<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { toast } from 'vue-sonner'
import { ChevronRight, ChevronDown, Folder, CalendarDays, Calendar as CalendarIcon, CalendarClock, DollarSign, Loader2, Download, Upload, Plus, Search, FileText, Edit2 } from 'lucide-vue-next'

const { setHeader } = usePageHeader()
setHeader({ title: 'Work Orders' })

// ─── Base State ──────────────────────────────────────────────────────────
const showImportModal = ref(false)
const search = ref('')
const lastUpdatedBy = ref('')
const activeTab = ref<'all' | 'false' | 'true'>('all')

const globalDatePreset = ref('today')
const customStartDate = ref('')
const customEndDate = ref('')

const computedDates = computed(() => {
  const d = new Date()
  const preset = globalDatePreset.value
  
  if (preset === 'today') {
    return { start: new Date(d.setHours(0,0,0,0)).toISOString(), end: new Date(d.setHours(23,59,59,999)).toISOString() }
  }
  if (preset === 'yesterday') {
    const y = new Date()
    y.setDate(y.getDate() - 1)
    return { start: new Date(y.setHours(0,0,0,0)).toISOString(), end: new Date(y.setHours(23,59,59,999)).toISOString() }
  }
  if (preset === 'this_month') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
    return { start: start.toISOString(), end: end.toISOString() }
  }
  if (preset === 'last_month') {
    const start = new Date(d.getFullYear(), d.getMonth() - 1, 1)
    const end = new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 59, 999)
    return { start: start.toISOString(), end: end.toISOString() }
  }
  if (preset === 'this_year') {
    const start = new Date(d.getFullYear(), 0, 1)
    const end = new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999)
    return { start: start.toISOString(), end: end.toISOString() }
  }
  if (preset === 'last_year') {
    const start = new Date(d.getFullYear() - 1, 0, 1)
    const end = new Date(d.getFullYear() - 1, 11, 31, 23, 59, 59, 999)
    return { start: start.toISOString(), end: end.toISOString() }
  }
  if (preset === 'custom' && customStartDate.value && customEndDate.value) {
     return { start: new Date(customStartDate.value + 'T00:00:00.000Z').toISOString(), end: new Date(customEndDate.value + 'T23:59:59.999Z').toISOString() }
  }
  return { start: '', end: '' }
})


const expandedDealers = ref(new Set<string>())
const expandedYears   = ref(new Set<string>())
const expandedMonths  = ref(new Set<string>())

// The active node filter for the right table
const activeFilter = ref<{
  label: string
  dealerId?: string
  dateStart?: string
  dateEnd?: string
}>({ label: 'All Work Orders' })

// ─── Formatter Helpers ───────────────────────────────────────────────────
const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function getAppSheetImageUrl(fileName: string | undefined | null) {
  if (!fileName) return null
  if (fileName.startsWith('http://') || fileName.startsWith('https://')) return fileName
  const encodedName = encodeURIComponent(fileName)
  return `https://www.appsheet.com/template/gettablefileurl?appName=ZRZOperationsAPP-109704988&tableName=WorkOrders&fileName=${encodedName}`
}

// ─── Tree Data Fetching ──────────────────────────────────────────────────
const treeData = ref<any[]>([])
const treeLoading = ref(false)

async function fetchTree() {
  treeLoading.value = true
  try {
    const res = await $fetch<{ success: boolean; tree: any[] }>('/api/work-orders/tree', {
      query: {
        isInvoiced: activeTab.value === 'all' ? '' : activeTab.value,
        lastUpdatedBy: lastUpdatedBy.value,
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
const workOrders = ref<any[]>([])
const loading = ref(false)
const hasMore = ref(true)
const skip = ref(0)
const limit = 20
const sortBy = ref('date')
const sortDir = ref(-1) // -1 = desc, 1 = asc

async function fetchWorkOrders(reset = false) {
  if (loading.value) return
  if (reset) {
    skip.value = 0
    workOrders.value = []
    hasMore.value = true
  }
  if (!hasMore.value) return

  loading.value = true
  try {
    const res = await $fetch('/api/work-orders', {
      query: {
        skip: skip.value,
        limit,
        search: search.value,
        sortBy: sortBy.value,
        sortDir: sortDir.value,
        isInvoiced: activeTab.value === 'all' ? '' : activeTab.value,
        lastUpdatedBy: lastUpdatedBy.value,
        dealerId: activeFilter.value.dealerId,
        dateStart: activeFilter.value.dateStart || computedDates.value.start,
        dateEnd: activeFilter.value.dateEnd || computedDates.value.end,
      }
    })

    // @ts-ignore
    workOrders.value = [...workOrders.value, ...(res.workOrders || [])]
    // @ts-ignore
    hasMore.value = res.hasMore
    skip.value += limit
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

// ─── Observers & Lifecycles ──────────────────────────────────────────────
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
  }
}

// ─── Editing Work Orders ───────────────────────────────────────────────
const showEditModal = ref(false)
const editingWorkOrder = ref<any>(null)
const editForm = ref({
  id: '',
  date: '',
  stockNumber: '',
  vin: '',
  dealerServiceId: '',
  amount: 0,
  tax: 0,
  total: 0,
  notes: '',
  upload: ''
})
const savingEdit = ref(false)

function openEditModal(row: any) {
  editingWorkOrder.value = row
  editForm.value = {
    id: row.id,
    date: row.date ? new Date(row.date).toISOString().slice(0, 10) : '',
    stockNumber: row.stockNumber || '',
    vin: row.vin || '',
    dealerServiceId: row.dealerServiceId || row.rawServiceId || '',
    amount: row.amount || 0,
    tax: row.tax || 0,
    total: row.total || 0,
    notes: row.notes || '',
    upload: row.upload || ''
  }
  showEditModal.value = true
}

// Auto calculate total
watch(() => [editForm.value.amount, editForm.value.tax], ([amt, tx]) => {
  editForm.value.total = Number(amt) + Number(tx)
})

async function saveEdit() {
  if (!editForm.value.id) return
  savingEdit.value = true
  try {
    const payload = {
      ...editForm.value,
      amount: Number(editForm.value.amount),
      tax: Number(editForm.value.tax),
      total: Number(editForm.value.total),
      date: new Date(editForm.value.date + 'T12:00:00.000Z') // Prevent timezone shift
    }
    
    await $fetch(`/api/work-orders/${editForm.value.id}`, {
      method: 'PUT',
      body: payload
    })
    
    toast.success('Work Order updated successfully')
    showEditModal.value = false
    fetchWorkOrders(true)
  } catch (err: any) {
    console.error(err)
    toast.error(err.statusMessage || 'Failed to update work order')
  } finally {
    savingEdit.value = false
  }
}

onMounted(() => {
  fetchTree()
  fetchWorkOrders()
})

useLiveSync('WorkOrders', () => {
  fetchTree()
  fetchWorkOrders(true)
})

let searchTimeout: any
watch([search, lastUpdatedBy, activeTab, computedDates], () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    fetchTree() // Tab/LastUpd/Dates may change totals
    fetchWorkOrders(true)
  }, 300)
})

watch(activeFilter, () => {
  fetchWorkOrders(true) // Filter node clicked
}, { deep: true })

// ─── Tree Interactions ───────────────────────────────────────────────────
function toggleSet(set: Set<string>, val: string) {
  if (set.has(val)) set.delete(val)
  else set.add(val)
}

function selectAll() {
  activeFilter.value = { label: 'All Work Orders' }
}

function selectDealer(dealer: any) {
  activeFilter.value = { label: dealer.dealerName, dealerId: dealer.dealerId }
}

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
  const lastDay = new Date(y, month.monthNumber, 0).getDate() // smart trick to get last day of month

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

// ─── Table Sorting & Export ──────────────────────────────────────────────
function toggleSort(field: string) {
  if (sortBy.value === field) sortDir.value = sortDir.value === -1 ? 1 : -1
  else { sortBy.value = field; sortDir.value = -1 }
  fetchWorkOrders(true)
}

function sortIcon(field: string) {
  if (sortBy.value !== field) return 'lucide:arrow-up-down'
  return sortDir.value === -1 ? 'lucide:arrow-down' : 'lucide:arrow-up'
}

async function handleExport() {
  try {
    toast.info('Preparing export...')
    const res = await $fetch('/api/work-orders', {
      query: { search: search.value, export: 'true', dealerId: activeFilter.value.dealerId, dateStart: activeFilter.value.dateStart, dateEnd: activeFilter.value.dateEnd, isInvoiced: activeTab.value === 'all' ? '' : activeTab.value, lastUpdatedBy: lastUpdatedBy.value }
    })
    
    // @ts-ignore
    const dataToExport = res.workOrders || []
    if (dataToExport.length === 0) return toast.error('No work orders found to export')

    const headers = ['Object ID', 'Date', 'Stock Number', 'VIN', 'Dealer', 'Service', 'Amount', 'Tax', 'Total', 'Notes', 'Is Invoiced', 'Image', 'Last Updated By']
    const rows = dataToExport.map((wo: any) => [
      wo.id, wo.date ? new Date(wo.date).toLocaleDateString() : '', wo.stockNumber, wo.vin,
      wo.dealerName, wo.dealerServiceId, wo.amount, wo.tax, wo.total,
      `"${(wo.notes || '').replace(/"/g, '""')}"`, wo.isInvoiced ? 'Yes' : 'No', wo.upload || '', wo.lastUpdatedBy || ''
    ])

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `work-orders-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${dataToExport.length} work orders`)
  } catch (err) {
    console.error('Export failed:', err)
    toast.error('Failed to export')
  }
}

// ─── Document Generation ───────────────────────────────────────────────
const generatingDaily = ref(false)
const generatingWeekly = ref(false)

async function handleGenerate(type: 'daily' | 'weekly') {
  if (type === 'daily') generatingDaily.value = true
  else generatingWeekly.value = true
  
  try {
    const res: any = await $fetch('/api/invoices/generate', { method: 'POST', body: { type } })
    if (res.generated > 0) {
      toast.success(res.message)
      fetchWorkOrders(true)
    } else {
      toast.info(res.message)
    }
  } catch (err: any) {
    toast.error(`Failed to generate ${type} invoices`)
  } finally {
    if (type === 'daily') generatingDaily.value = false
    else generatingWeekly.value = false
  }
}

</script>

<template>
  <div class="absolute inset-0 flex flex-col overflow-hidden bg-background">

    <!-- Top Tools Teleport -->
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <div class="flex items-center gap-2">

          <!-- Global Date Presets -->
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

          <!-- Custom Date Input -->
          <div v-if="globalDatePreset === 'custom'" class="flex items-center gap-1.5 animate-in fade-in zoom-in-95">
            <Input type="date" v-model="customStartDate" class="h-8 text-xs w-[125px] flex-1 bg-background shadow-sm" />
            <span class="text-muted-foreground text-xs font-medium">to</span>
            <Input type="date" v-model="customEndDate" class="h-8 text-xs w-[125px] flex-1 bg-background shadow-sm" />
          </div>

          <!-- General Search -->
          <div class="relative hidden sm:block">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input v-model="search" placeholder="Search orders..." class="pl-8 w-44 h-8 text-sm" />
          </div>
          <Button variant="outline" size="sm" class="h-8" @click="handleExport">
            <Download class="mr-1 size-4" /> Export
          </Button>
          <Button variant="outline" size="sm" class="h-8" @click="showImportModal = true">
            <Upload class="mr-1 size-4" /> Import
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button size="sm" class="h-8">
                <Icon name="lucide:receipt" class="mr-1.5 size-4" /> Generate
                <ChevronDown class="ml-1 size-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-48">
              <DropdownMenuItem @click="handleGenerate('daily')" :disabled="generatingDaily" class="cursor-pointer">
                <Icon :name="generatingDaily ? 'lucide:loader-2' : 'lucide:calendar-days'" :class="generatingDaily ? 'animate-spin': ''" class="mr-2 size-4 opacity-70" />
                <span>Create Daily Invoices</span>
              </DropdownMenuItem>
              <DropdownMenuItem @click="handleGenerate('weekly')" :disabled="generatingWeekly" class="cursor-pointer">
                <Icon :name="generatingWeekly ? 'lucide:loader-2' : 'lucide:calendar-range'" :class="generatingWeekly ? 'animate-spin': ''" class="mr-2 size-4 opacity-70" />
                <span>Create Weekly Invoices</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Teleport>
    </ClientOnly>

    <!-- Main Layout Grid -->
    <div class="flex-1 min-h-0 flex flex-col md:flex-row gap-4 p-4 w-full">
      
      <!-- ─── Sidebar Tree ──────────────────────────────────────────────────────── -->
      <aside class="w-full md:w-80 shrink-0 flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
        <div class="p-3 border-b bg-muted/30 shrink-0 font-medium text-sm flex items-center justify-between">
          <span>Grouping & Filters</span>
          <button @click="selectAll" class="text-xs text-primary hover:underline">Clear</button>
        </div>

        <div class="flex-1 overflow-y-auto p-2" v-if="!treeLoading || treeData.length > 0">
          
          <!-- All Node -->
          <div
            @click="selectAll"
            class="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm mb-1 transition-colors"
            :class="!activeFilter.dealerId ? 'bg-primary text-primary-foreground font-medium shadow-sm' : 'hover:bg-muted'"
          >
            <div class="flex items-center gap-2">
              <Folder class="size-4" :class="!activeFilter.dealerId ? 'text-primary-foreground/80' : 'text-muted-foreground'" />
              <span>All Dealers</span>
            </div>
          </div>

          <!-- Tree Dealers -->
          <div v-for="dealer in treeData" :key="dealer.dealerId">
            <div
              class="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors group"
              :class="activeFilter.dealerId === dealer.dealerId && !activeFilter.dateStart ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'"
              @click="selectDealer(dealer)"
            >
              <div class="flex items-center gap-1.5 overflow-hidden">
                <button class="shrink-0 p-0.5 rounded text-muted-foreground hover:bg-muted-foreground/20" @click.stop="toggleSet(expandedDealers, dealer.dealerId)">
                  <ChevronDown v-if="expandedDealers.has(dealer.dealerId)" class="size-3.5" />
                  <ChevronRight v-else class="size-3.5" />
                </button>
                <Folder class="size-3.5" :class="activeFilter.dealerId === dealer.dealerId && !activeFilter.dateStart ? 'text-primary' : 'text-muted-foreground'" />
                <span class="truncate font-semibold">{{ dealer.dealerName }}</span>
              </div>
              <span class="text-[10px] tabular-nums font-mono opacity-60 shrink-0 select-none">
                <span class="opacity-70 mr-1.5">({{ dealer.count }})</span>{{ fmt(dealer.totalAmount) }}
              </span>
            </div>

            <!-- Years -->
            <div v-if="expandedDealers.has(dealer.dealerId)" class="pl-5 relative before:absolute before:inset-y-0 before:left-3.5 before:w-px before:bg-border/60">
              <div v-for="yr in dealer.years" :key="yr.year">
                <div
                  class="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors"
                  :class="activeFilter.dateStart?.startsWith(yr.year.toString()) && activeFilter.dateEnd?.endsWith('12-31T23:59:59.999Z') ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'"
                  @click="selectYear(dealer, yr)"
                >
                  <div class="flex items-center gap-1.5">
                    <button class="shrink-0 p-0.5 rounded text-muted-foreground hover:bg-muted-foreground/20" @click.stop="toggleSet(expandedYears, `${dealer.dealerId}-${yr.year}`)">
                      <ChevronDown v-if="expandedYears.has(`${dealer.dealerId}-${yr.year}`)" class="size-3.5" />
                      <ChevronRight v-else class="size-3.5" />
                    </button>
                    <CalendarIcon class="size-3.5 text-muted-foreground" />
                    <span>{{ yr.year }}</span>
                  </div>
                  <span class="text-[10px] tabular-nums font-mono opacity-50 shrink-0 select-none">
                    <span class="opacity-70 mr-1.5">({{ yr.count }})</span>{{ fmt(yr.totalAmount) }}
                  </span>
                </div>

                <!-- Months -->
                <div v-if="expandedYears.has(`${dealer.dealerId}-${yr.year}`)" class="pl-5 relative before:absolute before:inset-y-0 before:left-3.5 before:w-px before:bg-border/60">
                  <div v-for="mo in yr.months" :key="mo.month">
                    <div
                      class="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors"
                      :class="activeFilter.dateStart?.startsWith(`${yr.year}-${mo.monthNumber.toString().padStart(2, '0')}`) && !activeFilter.dateEnd?.startsWith(activeFilter.dateStart?.slice(0, 10) || '') ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'"
                      @click="selectMonth(dealer, yr, mo)"
                    >
                      <div class="flex items-center gap-1.5">
                        <button class="shrink-0 p-0.5 rounded text-muted-foreground hover:bg-muted-foreground/20" @click.stop="toggleSet(expandedMonths, `${dealer.dealerId}-${yr.year}-${mo.monthNumber}`)">
                          <ChevronDown v-if="expandedMonths.has(`${dealer.dealerId}-${yr.year}-${mo.monthNumber}`)" class="size-3.5" />
                          <ChevronRight v-else class="size-3.5" />
                        </button>
                        <CalendarDays class="size-3.5 text-muted-foreground" />
                        <span>{{ mo.month }}</span>
                      </div>
                      <span class="text-[10px] tabular-nums font-mono opacity-50 shrink-0 select-none">
                        <span class="opacity-70 mr-1.5">({{ mo.count }})</span>{{ fmt(mo.totalAmount) }}
                      </span>
                    </div>

                    <!-- Dates -->
                    <div v-if="expandedMonths.has(`${dealer.dealerId}-${yr.year}-${mo.monthNumber}`)" class="pl-6 relative before:absolute before:inset-y-0 before:left-3.5 before:w-px before:bg-border/60">
                      <div
                        v-for="dt in mo.dates" :key="dt.date"
                        @click="selectDate(dealer, yr, mo, dt)"
                        class="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors"
                        :class="activeFilter.dateStart?.startsWith(dt.date) ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-foreground/80'"
                      >
                        <div class="flex items-center gap-2">
                          <CalendarClock class="size-3 text-muted-foreground" />
                          <span>{{ fmtDate(dt.date) }}</span>
                        </div>
                        <span class="text-[10px] tabular-nums font-mono opacity-50 shrink-0 select-none">
                          <span class="opacity-70 mr-1.5">({{ dt.count }})</span>{{ fmt(dt.totalAmount) }}
                        </span>
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

      <!-- ─── Main Details Array ──────────────────────────────────────────────── -->
      <main class="flex-1 min-w-0 flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
        
        <!-- Tabs & Context Header -->
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b bg-muted/10 shrink-0">
          <div class="flex items-center px-4 py-3 gap-3 w-full sm:w-auto overflow-hidden">
            <span class="truncate font-semibold text-sm">{{ activeFilter.label }}</span>
            <Badge variant="secondary" class="font-mono text-[10px] shrink-0">
              <span v-if="loading" class="animate-pulse">...</span>
              <span v-else>{{ hasMore ? workOrders.length + '+' : workOrders.length }} orders</span>
            </Badge>
          </div>

          <div class="flex items-center px-2">
            <div class="flex bg-muted p-1 rounded-lg">
              <button
                @click="activeTab = 'all'"
                class="px-3 py-1.5 text-xs font-medium rounded-md transition-all shadow-sm"
                :class="activeTab === 'all' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground'"
              >
                All
              </button>
              <button
                @click="activeTab = 'false'"
                class="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
                :class="activeTab === 'false' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              >
                Not Invoiced
              </button>
              <button
                @click="activeTab = 'true'"
                class="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
                :class="activeTab === 'true' ? 'bg-background text-foreground shadow-sm bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground hover:text-foreground'"
              >
                Invoiced
              </button>
            </div>
          </div>
        </div>

        <!-- Table Data -->
        <div class="flex-1 overflow-auto">
          <table class="w-full text-sm caption-bottom border-collapse">
            <TableHeader class="sticky top-0 z-10 bg-card backdrop-blur shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              <TableRow>
                <TableHead class="cursor-pointer select-none" @click="toggleSort('date')">
                  <div class="flex items-center gap-1">Date <Icon :name="sortIcon('date')" class="size-3 text-muted-foreground" /></div>
                </TableHead>
                <TableHead class="cursor-pointer select-none" @click="toggleSort('stockNumber')">
                  <div class="flex items-center gap-1">Stock # <Icon :name="sortIcon('stockNumber')" class="size-3 text-muted-foreground" /></div>
                </TableHead>
                <TableHead class="w-16">Photo</TableHead>
                <TableHead class="cursor-pointer select-none" @click="toggleSort('vin')">
                  <div class="flex items-center gap-1">VIN <Icon :name="sortIcon('vin')" class="size-3 text-muted-foreground" /></div>
                </TableHead>
                <!-- Only show Dealer column if we are viewing "All Dealers" -->
                <TableHead v-if="!activeFilter.dealerId" class="cursor-pointer select-none" @click="toggleSort('dealerName')">
                  <div class="flex items-center gap-1">Dealer <Icon :name="sortIcon('dealerName')" class="size-3 text-muted-foreground" /></div>
                </TableHead>
                <TableHead class="cursor-pointer select-none" @click="toggleSort('dealerServiceId')">
                  <div class="flex items-center gap-1">Service <Icon :name="sortIcon('dealerServiceId')" class="size-3 text-muted-foreground" /></div>
                </TableHead>
                <TableHead class="cursor-pointer select-none" @click="toggleSort('notes')">
                  <div class="flex items-center gap-1">Notes <Icon :name="sortIcon('notes')" class="size-3 text-muted-foreground" /></div>
                </TableHead>
                <TableHead class="text-right cursor-pointer select-none" @click="toggleSort('amount')">
                  <div class="flex items-center justify-end gap-1">Amount <Icon :name="sortIcon('amount')" class="size-3 text-muted-foreground" /></div>
                </TableHead>
                <TableHead class="text-right cursor-pointer select-none" @click="toggleSort('tax')">
                  <div class="flex items-center justify-end gap-1">Tax <Icon :name="sortIcon('tax')" class="size-3 text-muted-foreground" /></div>
                </TableHead>
                <TableHead class="text-right cursor-pointer select-none" @click="toggleSort('total')">
                  <div class="flex items-center justify-end gap-1">Total <Icon :name="sortIcon('total')" class="size-3 text-muted-foreground" /></div>
                </TableHead>
                <TableHead class="cursor-pointer select-none" @click="toggleSort('isInvoiced')">
                  <div class="flex items-center gap-1">State <Icon :name="sortIcon('isInvoiced')" class="size-3 text-muted-foreground" /></div>
                </TableHead>
                <TableHead class="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="wo in workOrders" :key="wo.id" class="cursor-pointer hover:bg-muted/50 transition-colors">
                <TableCell class="font-medium text-xs whitespace-nowrap">{{ fmtDate(wo.date) }}</TableCell>
                <TableCell class="text-xs">{{ wo.stockNumber }}</TableCell>
                <TableCell @click.stop>
                  <a v-if="wo.upload" :href="getAppSheetImageUrl(wo.upload)!" target="_blank" class="block w-9 h-9 rounded bg-muted border overflow-hidden hover:opacity-80 transition-opacity">
                    <img :src="getAppSheetImageUrl(wo.upload)!" class="w-full h-full object-cover" loading="lazy" />
                  </a>
                  <div v-else class="w-9 h-9 rounded bg-muted/50 border border-dashed flex items-center justify-center">
                    <Icon name="lucide:image-off" class="size-3.5 text-muted-foreground/40" />
                  </div>
                </TableCell>
                <TableCell class="text-xs font-mono uppercase text-muted-foreground">{{ wo.vin }}</TableCell>
                <TableCell v-if="!activeFilter.dealerId" class="text-xs truncate max-w-[120px] font-semibold">{{ wo.dealerName }}</TableCell>
                <TableCell class="text-xs truncate max-w-[120px]">
                  <span>{{ wo.dealerServiceId }}</span>
                </TableCell>
                <TableCell class="text-xs text-muted-foreground truncate max-w-[150px]" :title="wo.notes">
                  {{ wo.notes || '—' }}
                </TableCell>
                <TableCell class="text-right text-xs tabular-nums">{{ fmt(wo.amount) }}</TableCell>
                <TableCell class="text-right text-xs tabular-nums text-muted-foreground">{{ fmt(wo.tax) }}</TableCell>
                <TableCell class="text-right text-xs tabular-nums font-bold">{{ fmt(wo.total) }}</TableCell>
                <TableCell>
                  <Badge :variant="wo.isInvoiced ? 'default' : 'outline'" :class="wo.isInvoiced ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'text-muted-foreground'" class="text-[10px]">
                    {{ wo.isInvoiced ? 'Invoiced' : 'Pending' }}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" class="h-7 w-7 hover:bg-muted text-muted-foreground hover:text-foreground" @click.stop="openEditModal(wo)">
                    <Edit2 class="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>

              <TableRow v-if="loading && workOrders.length === 0">
                <TableCell :colspan="12" class="text-center py-10">
                  <Loader2 class="size-6 animate-spin text-muted-foreground/50 mx-auto" />
                </TableCell>
              </TableRow>
              <TableRow v-if="!loading && workOrders.length === 0">
                <TableCell :colspan="12" class="text-center py-10">
                  <FileText class="size-10 text-muted-foreground/20 mx-auto mb-3" />
                  <p class="text-sm font-medium text-foreground">No work orders found</p>
                  <p class="text-xs text-muted-foreground mt-1">Try adjusting your filters or selecting a different date range.</p>
                </TableCell>
              </TableRow>

              <!-- Load More Sentinel -->
              <tr v-if="hasMore && workOrders.length > 0" v-intersect="fetchWorkOrders" class="h-10">
                <td :colspan="12" class="text-center">
                  <div v-if="loading" class="flex justify-center py-4">
                    <Loader2 class="size-4 animate-spin text-muted-foreground/50" />
                  </div>
                </td>
              </tr>
            </TableBody>
          </table>
        </div>
      </main>
    </div>

    <SalesWorkOrderImport v-if="showImportModal" v-model:open="showImportModal" @imported="fetchWorkOrders(true)" />

    <!-- Edit Work Order Modal -->
    <Dialog v-model:open="showEditModal">
      <DialogContent class="sm:max-w-[700px] overflow-visible">
        <DialogHeader>
          <DialogTitle>Edit Work Order</DialogTitle>
          <DialogDescription>
            Modify the details of this work order and click save when finished.
          </DialogDescription>
        </DialogHeader>

        <div class="grid grid-cols-2 gap-4 py-4" v-if="editingWorkOrder">
          
          <div class="space-y-2">
            <Label>Date</Label>
            <Input type="date" v-model="editForm.date" />
          </div>

          <div class="space-y-2">
            <Label>Stock Number</Label>
            <Input v-model="editForm.stockNumber" />
          </div>

          <div class="space-y-2">
            <Label>VIN</Label>
            <Input v-model="editForm.vin" class="font-mono uppercase" />
          </div>

          <div class="space-y-2">
            <Label>Service ID / Name</Label>
            <Input v-model="editForm.dealerServiceId" />
          </div>

          <div class="space-y-2">
            <Label>Amount</Label>
            <Input type="number" step="0.01" v-model="editForm.amount" />
          </div>

          <div class="space-y-2">
            <Label>Tax</Label>
            <Input type="number" step="0.01" v-model="editForm.tax" />
          </div>

          <div class="space-y-2">
            <Label>Total (Auto-computed)</Label>
            <Input type="number" step="0.01" v-model="editForm.total" disabled class="bg-muted/30 opacity-80" />
          </div>

          <div class="space-y-2 col-span-2">
            <Label>Notes</Label>
            <Textarea v-model="editForm.notes" rows="2" />
          </div>
          
          <div class="space-y-2 col-span-2">
            <Label>Photo / Image URL</Label>
            <Input v-model="editForm.upload" placeholder="Upload Image Name or URL" />
            <a v-if="editForm.upload" :href="getAppSheetImageUrl(editForm.upload)!" target="_blank" class="block max-w-sm h-32 mt-2 border rounded-md overflow-hidden bg-muted/20">
              <img :src="getAppSheetImageUrl(editForm.upload)!" class="w-full h-full object-contain" />
            </a>
          </div>

        </div>

        <DialogFooter>
          <Button variant="outline" @click="showEditModal = false" :disabled="savingEdit">Cancel</Button>
          <Button type="button" @click="saveEdit" :disabled="savingEdit">
            <Loader2 v-if="savingEdit" class="mr-2 size-4 animate-spin" />
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

  </div>
</template>
