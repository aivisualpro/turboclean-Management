<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { toast } from 'vue-sonner'
import { ChevronRight, ChevronDown, Folder, CalendarDays, Calendar as CalendarIcon, CalendarClock, DollarSign, Loader2, Download, Upload, Plus, Search, FileText, Edit2 } from 'lucide-vue-next'

const { setHeader } = usePageHeader()
setHeader({ title: 'Work Orders' })
const { isActionAllowed, isAdmin } = usePermissions()
const canEditWO = computed(() => isActionAllowed('work_orders', 'Edit'))

// ─── Base State ──────────────────────────────────────────────────────────
const showImportModal = ref(false)
const search = ref('')
const lastUpdatedBy = ref('')
const activeTab = ref<'all' | 'false' | 'true'>('all')

const globalDatePreset = ref('this_month')
const customStartDate = ref('')
const customEndDate = ref('')

watch(() => customStartDate.value, (newVal) => {
  if (newVal && !customEndDate.value) customEndDate.value = newVal
})

const computedDates = computed(() => {
  const now = new Date()
  const preset = globalDatePreset.value
  
  // Helper: format as YYYY-MM-DD (timezone-agnostic, matches backend UTC date-string comparison)
  const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const y = now.getFullYear()
  const m = now.getMonth() + 1 // 1-indexed
  const todayStr = ymd(y, m, now.getDate())

  if (preset === 'today') {
    return { start: todayStr, end: todayStr }
  }
  if (preset === 'yesterday') {
    const yd = new Date(now)
    yd.setDate(yd.getDate() - 1)
    const yStr = ymd(yd.getFullYear(), yd.getMonth() + 1, yd.getDate())
    return { start: yStr, end: yStr }
  }
  if (preset === 'this_month') {
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate()
    return { start: ymd(y, m, 1), end: ymd(y, m, lastDay) }
  }
  if (preset === 'last_month') {
    const lm = now.getMonth() // 0-indexed = last month in 1-indexed
    const lmYear = lm === 0 ? y - 1 : y
    const lmMonth = lm === 0 ? 12 : lm
    const lastDay = new Date(lmYear, lmMonth, 0).getDate()
    return { start: ymd(lmYear, lmMonth, 1), end: ymd(lmYear, lmMonth, lastDay) }
  }
  if (preset === 'this_year') {
    return { start: ymd(y, 1, 1), end: ymd(y, 12, 31) }
  }
  if (preset === 'last_year') {
    return { start: ymd(y - 1, 1, 1), end: ymd(y - 1, 12, 31) }
  }
  if (preset === 'custom' && customStartDate.value && customEndDate.value) {
    return { start: customStartDate.value, end: customEndDate.value }
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
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function getAppSheetImageUrl(fileName: string | undefined | null) {
  if (!fileName) return null
  if (fileName.startsWith('http://') || fileName.startsWith('https://')) return fileName
  const encodedName = encodeURIComponent(fileName)
  return `https://www.appsheet.com/template/gettablefileurl?appName=ZRZOperationsAPP-109704988&tableName=WorkOrders&fileName=${encodedName}`
}

// ── Image Lightbox ───────────────────────────────────────────────────────
const woLightboxOpen = ref(false)
const woLightboxSrc = ref('')

function openWoLightbox(url: string) {
  woLightboxSrc.value = url
  woLightboxOpen.value = true
}
function closeWoLightbox() {
  woLightboxOpen.value = false
  woLightboxSrc.value = ''
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
  const prevHeight = tableContainerRef.value?.scrollHeight || 0
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

    // Since backend sortDir=-1 returns newest first, reversing makes it oldest->newest.
    const incomingData = (res.workOrders || []).slice().reverse()
    if (reset) {
      // @ts-ignore
      workOrders.value = incomingData
    } else {
      // @ts-ignore
      workOrders.value = [...incomingData, ...workOrders.value]
    }
    // @ts-ignore
    hasMore.value = res.hasMore
    skip.value += limit

    nextTick(() => {
      if (reset && tableContainerRef.value) {
        tableContainerRef.value.scrollTop = tableContainerRef.value.scrollHeight
      } else if (!reset && tableContainerRef.value) {
        // maintain scroll position visually when loading older items above
        const newHeight = tableContainerRef.value.scrollHeight
        tableContainerRef.value.scrollTop += (newHeight - prevHeight)
      }
    })
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}
const tableContainerRef = ref<HTMLElement | null>(null)

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
  poNumber: '',
  vin: '',
  dealerServiceId: '',
  amount: 0,
  tax: 0,
  total: 0,
  notes: '',
  upload: ''
})
const savingEdit = ref(false)
const dealerServices = ref<any[]>([])
const loadingServices = ref(false)

async function openEditModal(row: any) {
  editingWorkOrder.value = row
  editForm.value = {
    id: row.id,
    date: row.date ? new Date(row.date).toISOString().slice(0, 10) : '',
    stockNumber: (row.stockNumber || '').toUpperCase(),
    poNumber: String(row.poNumber || ''),
    vin: row.vin || '',
    dealerServiceId: row.rawServiceId || '',
    amount: row.amount || 0,
    tax: row.tax || 0,
    total: row.total || 0,
    notes: row.notes || '',
    upload: row.upload || ''
  }
  showEditModal.value = true

  // Fetch this dealer's linked services for the dropdown
  if (row.dealerId) {
    loadingServices.value = true
    try {
      const res = await $fetch<{ dealers: any[] }>('/api/dealers')
      const dealer = (res.dealers || []).find((d: any) => d.id === row.dealerId)
      if (dealer?.services) {
        // Resolve service names
        const services = await $fetch<any[]>('/api/services')
        const svcMap = new Map(services.map((s: any) => [s.id, s.service]))
        dealerServices.value = dealer.services.map((s: any) => ({
          id: (s.id || s._id || '').toString(),
          name: svcMap.get(s.service?.toString()) || s.service?.toString() || 'Unknown',
          amount: s.amount || 0,
          tax: s.tax || 0,
          total: s.total || 0,
        }))
      } else {
        dealerServices.value = []
      }
    } catch (err) {
      console.error('Failed to load dealer services:', err)
      dealerServices.value = []
    } finally {
      loadingServices.value = false
    }
  }
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

// Fetch on every visit — non-blocking so navigation is instant
fetchTree()
fetchWorkOrders(true)

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

const exporting = ref(false)

async function handleExport() {
  if (exporting.value) return
  exporting.value = true
  try {
    toast.info('Preparing export...')
    const res = await $fetch('/api/work-orders', {
      query: { 
        search: search.value, 
        export: 'true', 
        sortBy: 'date',
        sortDir: 1,
        dealerId: activeFilter.value.dealerId, 
        dateStart: activeFilter.value.dateStart || computedDates.value.start, 
        dateEnd: activeFilter.value.dateEnd || computedDates.value.end, 
        isInvoiced: activeTab.value === 'all' ? '' : activeTab.value, 
        lastUpdatedBy: lastUpdatedBy.value 
      }
    })
    
    // @ts-ignore
    const dataToExport = res.workOrders || []
    if (dataToExport.length === 0) {
      exporting.value = false
      return toast.error('No work orders found to export')
    }

    // Determine context dynamically checking all rows
    const isAvonSelected = dataToExport.length > 0 && dataToExport.every((wo: any) => (wo.dealerName || '').toUpperCase().includes('AVON BODYSHOP'))
    const isEhSelected = dataToExport.length > 0 && dataToExport.every((wo: any) => (wo.dealerName || '').toUpperCase().includes('EH BODYSHOP'))

    let headers: string[] = []
    let rows: any[] = []

    if (isAvonSelected) {
      headers = ['DATE OPENED', 'RO', 'PO', 'PO AMOUNT', 'TAX', 'TOTAL']
      rows = dataToExport.map((wo: any) => [
        wo.date ? new Date(wo.date).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '',
        `"${(wo.stockNumber || '').toUpperCase()}"`,
        `"${wo.poNumber || ''}"`,
        wo.amount || 0,
        wo.tax || 0,
        wo.total || 0
      ])
    } else if (isEhSelected) {
      headers = ['DATE OPENED', 'RO', 'PO AMOUNT', 'SALES TAX', 'TOTAL']
      rows = dataToExport.map((wo: any) => [
        wo.date ? new Date(wo.date).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '',
        `"${(wo.stockNumber || '').toUpperCase()}"`,
        wo.amount || 0,
        wo.tax || 0,
        wo.total || 0
      ])
    } else {
      headers = ['DATE', 'STOCK #', 'LAST 8 OF VIN', 'CLEAN TYPE', 'PO AMOUNT', 'TAX 6.35%', 'TOTAL', 'PO']
      rows = dataToExport.map((wo: any) => {
        const vinStr = String(wo.vin || '')
        const last8Vin = vinStr.length > 8 ? vinStr.slice(-8) : vinStr
        
        return [
          wo.date ? new Date(wo.date).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '', 
          `"${(wo.stockNumber || '').toUpperCase()}"`, 
          last8Vin,
          `"${(wo.dealerServiceId || wo.rawServiceId || '').replace(/"/g, '""')}"`,
          wo.amount || 0, 
          wo.tax || 0, 
          wo.total || 0,
          `"${wo.poNumber || ''}"`
        ]
      })
    }

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `work-orders-${activeFilter.value.label.replace(/[^a-z0-9]/gi, '_').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${dataToExport.length} work orders successfully!`)
  } catch (err) {
    console.error('Export failed:', err)
    toast.error('Failed to export data')
  } finally {
    exporting.value = false
  }
}

// ─── Document Generation ───────────────────────────────────────────────
const generatingDaily = ref(false)
const generatingWeekly = ref(false)

const showCustomWeeklyModal = ref(false)
const customWeeklyForm = ref({ dealerId: '', startDate: '', endDate: '' })

watch(() => customWeeklyForm.value.startDate, (newVal) => {
  if (newVal && !customWeeklyForm.value.endDate) {
    customWeeklyForm.value.endDate = newVal
  }
})

const generatingCustomWeekly = ref(false)
const allDealersList = ref<any[]>([])
const dealerSearch = ref('')
const dealerPopoverOpen = ref(false)
const startDateInputRef = ref<any>(null)

const filteredDealersList = computed(() => {
  const q = dealerSearch.value.toLowerCase().trim()
  if (!q) return allDealersList.value
  return allDealersList.value.filter(d => d.dealerName.toLowerCase().includes(q))
})

function selectWeeklyDealer(id: string) {
  customWeeklyForm.value.dealerId = id
  dealerSearch.value = ''
  dealerPopoverOpen.value = false
  // Focus start date input after popover close animation
  setTimeout(() => {
    const el = startDateInputRef.value?.$el || startDateInputRef.value
    if (el) {
      el.focus()
      el.showPicker?.()
    }
  }, 150)
}

// Press Enter to select when there is at least 1 filtered result
function handleDealerSearchEnter() {
  if (filteredDealersList.value.length >= 1 && dealerSearch.value.trim()) {
    selectWeeklyDealer(filteredDealersList.value[0].id)
  }
}

const maxWeeklyEndDate = computed(() => {
  if (!customWeeklyForm.value.startDate) return ''
  const s = new Date(customWeeklyForm.value.startDate)
  s.setDate(s.getDate() + 6)
  return s.toISOString().split('T')[0]
})

const isWeeklyFormValid = computed(() => {
  return customWeeklyForm.value.dealerId && customWeeklyForm.value.startDate && customWeeklyForm.value.endDate
})

async function openCustomWeeklyModal() {
  showCustomWeeklyModal.value = true
  customWeeklyForm.value = { dealerId: '', startDate: '', endDate: '' }
  dealerSearch.value = ''
  if (allDealersList.value.length === 0) {
     const res = await $fetch<{ dealers: any[] }>('/api/dealers')
     allDealersList.value = (res.dealers || []).sort((a,b) => (a.dealerName || '').localeCompare(b.dealerName || ''))
  }
}

async function handleCustomWeeklyGenerate() {
  if (!isWeeklyFormValid.value || generatingCustomWeekly.value) return
  generatingCustomWeekly.value = true
  try {
    const res: any = await $fetch('/api/invoices/generate', { 
      method: 'POST', 
      body: { type: 'custom_weekly', ...customWeeklyForm.value } 
    })
    if (res.success && res.generated > 0) {
      toast.success(res.message)
      showCustomWeeklyModal.value = false
      fetchWorkOrders(true)
    } else {
      toast.info(res.message)
    }
  } catch (err: any) {
    toast.error('Failed to generate custom weekly invoice')
  } finally {
    generatingCustomWeekly.value = false
  }
}

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
          <Button
            @click="handleExport"
            :disabled="exporting"
            size="sm"
            class="h-8"
          >
            <Loader2 v-if="exporting" class="mr-1.5 size-4 animate-spin" />
            <Download v-else class="mr-1.5 size-4" />
            <span>Export CSV</span>
          </Button>
          <Button v-if="isAdmin" variant="outline" size="sm" class="h-8" @click="showImportModal = true">
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
                <span>Daily Invoice</span>
              </DropdownMenuItem>
              <DropdownMenuItem @click="openCustomWeeklyModal" class="cursor-pointer">
                <Icon name="lucide:calendar-range" class="mr-2 size-4 opacity-70" />
                <span>Weekly Invoice</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Teleport>
    </ClientOnly>

    <!-- Main Layout Grid -->
    <div class="flex-1 min-h-0 flex flex-col md:flex-row gap-4 p-4 w-full">
      
      <!-- ─── Sidebar Tree ──────────────────────────────────────────────────────── -->
      <aside class="w-full md:w-96 shrink-0 flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
        <div class="p-3 border-b bg-muted/30 shrink-0 font-medium text-sm flex items-center justify-between">
          <span>Grouping & Filters</span>
          <button @click="selectAll" class="text-xs text-primary hover:underline">Clear</button>
        </div>

        <ClientOnly>
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

          <div v-else class="flex-1 space-y-3 p-3">
            <div v-for="i in 8" :key="i" class="flex items-center gap-3">
              <Skeleton class="h-4 w-4 rounded" />
              <Skeleton class="h-4 flex-1 rounded" />
              <Skeleton class="h-4 w-12 rounded" />
            </div>
          </div>

          <template #fallback>
            <div class="flex-1 space-y-3 p-3">
              <Skeleton v-for="i in 8" :key="i" class="h-6 w-full rounded" />
            </div>
          </template>
        </ClientOnly>
      </aside>

      <!-- ─── Main Details Array ──────────────────────────────────────────────── -->
      <main class="flex-1 min-w-0 flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
        
        <!-- Tabs & Context Header -->
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b bg-muted/10 shrink-0">
          <div class="flex items-center px-4 py-3 gap-3 w-full sm:w-auto overflow-hidden">
            <span class="truncate font-semibold text-sm">{{ activeFilter.label }}</span>
            <ClientOnly>
              <Badge variant="secondary" class="font-mono text-[10px] shrink-0">
                <span v-if="loading && workOrders.length === 0"><Skeleton class="h-3 w-12 inline-block" /></span>
                <span v-else>{{ hasMore ? workOrders.length + '+' : workOrders.length }} orders</span>
              </Badge>
              <template #fallback>
                <Skeleton class="h-5 w-20 rounded" />
              </template>
            </ClientOnly>
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
        <div class="flex-1 overflow-auto" ref="tableContainerRef">
          <table class="w-full text-sm caption-bottom border-collapse">
            <TableHeader class="sticky top-0 z-10 bg-card backdrop-blur shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              <TableRow>
                <TableHead class="cursor-pointer select-none" @click="toggleSort('date')">
                  <div class="flex items-center gap-1">Date <Icon :name="sortIcon('date')" class="size-3 text-muted-foreground" /></div>
                </TableHead>
                <TableHead class="cursor-pointer select-none" @click="toggleSort('stockNumber')">
                  <div class="flex items-center gap-1">Stock # <Icon :name="sortIcon('stockNumber')" class="size-3 text-muted-foreground" /></div>
                </TableHead>
                <TableHead class="cursor-pointer select-none" @click="toggleSort('poNumber')">
                  <div class="flex items-center gap-1">PO # <Icon :name="sortIcon('poNumber')" class="size-3 text-muted-foreground" /></div>
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
            <ClientOnly>
              <TableBody>
                <!-- Initial Load Skeleton -->
                <template v-if="loading && workOrders.length === 0">
                  <TableRow v-for="i in 10" :key="i">
                    <TableCell v-for="j in (activeFilter.dealerId ? 11 : 12)" :key="j">
                      <Skeleton class="h-4 w-full rounded" />
                    </TableCell>
                  </TableRow>
                </template>

                <!-- Load More Sentinel (Top) -->
                <tr v-if="hasMore && workOrders.length > 0" v-intersect="fetchWorkOrders" class="h-10">
                  <td :colspan="12" class="text-center">
                    <div v-if="loading" class="flex justify-center py-4">
                      <Loader2 class="size-4 animate-spin text-muted-foreground/50" />
                    </div>
                  </td>
                </tr>

                <TableRow v-for="wo in workOrders" :key="wo.id" class="cursor-pointer hover:bg-muted/50 transition-colors">
                  <TableCell class="font-medium text-xs whitespace-nowrap">{{ fmtDate(wo.date) }}</TableCell>
                  <TableCell class="text-xs uppercase">{{ wo.stockNumber }}</TableCell>
                  <TableCell class="text-xs">{{ wo.poNumber || '—' }}</TableCell>
                  <TableCell @click.stop>
                    <div v-if="wo.upload" class="w-9 h-9 rounded bg-muted border overflow-hidden hover:opacity-80 transition-opacity cursor-pointer" @click="openWoLightbox(getAppSheetImageUrl(wo.upload)!)">
                      <img :src="getAppSheetImageUrl(wo.upload)!" class="w-full h-full object-cover" loading="lazy" referrerpolicy="no-referrer" @error="(e) => (e.target as HTMLElement).style.display = 'none'" />
                    </div>
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
                    <Button v-if="canEditWO" variant="ghost" size="icon" class="h-7 w-7 hover:bg-muted text-muted-foreground hover:text-foreground" @click.stop="openEditModal(wo)">
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
              </TableBody>

              <template #fallback>
                <TableBody>
                  <TableRow>
                    <TableCell :colspan="12" class="text-center py-10">
                      <Loader2 class="size-6 animate-spin text-muted-foreground/50 mx-auto" />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </template>
            </ClientOnly>
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
            <Input v-model="editForm.stockNumber" class="uppercase" />
          </div>

          <div class="space-y-2">
            <Label>PO Number</Label>
            <Input type="text" v-model="editForm.poNumber" />
          </div>

          <div class="space-y-2">
            <Label>VIN</Label>
            <Input v-model="editForm.vin" class="font-mono uppercase" />
          </div>

          <div class="space-y-2">
            <Label>Service</Label>
            <Select v-model="editForm.dealerServiceId">
              <SelectTrigger>
                <SelectValue placeholder="Select a service..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-if="loadingServices" value="_loading" disabled>Loading...</SelectItem>
                <SelectItem v-for="svc in dealerServices" :key="svc.id" :value="svc.id">
                  {{ svc.name }}
                </SelectItem>
                <SelectItem v-if="!loadingServices && dealerServices.length === 0" value="_none" disabled>No services linked</SelectItem>
              </SelectContent>
            </Select>
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

    <!-- Custom Weekly Invoice Modal -->
    <Dialog v-model:open="showCustomWeeklyModal">
      <DialogContent class="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Custom Weekly Invoice</DialogTitle>
          <DialogDescription>
            Select a dealer and a date range (max 7 days) to group their unbilled work orders into a single weekly invoice.
          </DialogDescription>
        </DialogHeader>

        <div class="grid gap-4 py-4">
          <div class="space-y-2">
            <Label>Dealer</Label>
            <Popover v-model:open="dealerPopoverOpen">
              <PopoverTrigger as-child>
                <Button variant="outline" class="w-full justify-between font-normal" :class="!customWeeklyForm.dealerId && 'text-muted-foreground'">
                  {{ allDealersList.find(d => d.id === customWeeklyForm.dealerId)?.dealerName || 'Select dealer...' }}
                  <Icon name="lucide:chevrons-up-down" class="ml-2 size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent class="w-[350px] p-0" align="start">
                <div class="flex items-center border-b px-3">
                  <Icon name="lucide:search" class="mr-2 size-4 shrink-0 text-muted-foreground" />
                  <input
                    v-model="dealerSearch"
                    placeholder="Search dealer..."
                    class="flex h-9 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                    @keydown.enter.prevent="handleDealerSearchEnter"
                  />
                </div>
                <div class="max-h-56 overflow-y-auto p-1">
                  <div v-if="filteredDealersList.length === 0" class="py-6 text-center text-sm text-muted-foreground">No dealers found.</div>
                  <button
                    v-for="d in filteredDealersList"
                    :key="d.id"
                    class="relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                    :class="customWeeklyForm.dealerId === d.id ? 'bg-accent text-accent-foreground font-medium' : ''"
                    @click="selectWeeklyDealer(d.id)"
                  >
                    <Icon name="lucide:check" class="mr-2 size-4" :class="customWeeklyForm.dealerId === d.id ? 'opacity-100' : 'opacity-0'" />
                    {{ d.dealerName }}
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          
          <div class="space-y-2">
            <Label>Start Date</Label>
            <Input ref="startDateInputRef" type="date" v-model="customWeeklyForm.startDate" />
          </div>

          <div class="space-y-2">
            <Label>End Date</Label>
            <Input type="date" v-model="customWeeklyForm.endDate" :min="customWeeklyForm.startDate" :max="maxWeeklyEndDate" />
            <p v-if="customWeeklyForm.startDate" class="text-xs text-muted-foreground mt-1">Max end date: {{ maxWeeklyEndDate }}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="showCustomWeeklyModal = false">Cancel</Button>
          <Button :disabled="!isWeeklyFormValid || generatingCustomWeekly" @click="handleCustomWeeklyGenerate">
            <Loader2 v-if="generatingCustomWeekly" class="animate-spin mr-2 size-4"/>
            Generate Invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

  </div>

  <!-- Image Lightbox Overlay -->
  <Teleport to="body">
    <Transition name="wo-lightbox">
      <div v-if="woLightboxOpen" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm" @click.self="closeWoLightbox">
        <div class="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center">
          <button @click="closeWoLightbox" class="absolute -top-10 right-0 text-white/80 hover:text-white text-sm font-medium flex items-center gap-1 transition-colors">
            <span>Close</span>
            <span class="text-lg leading-none">×</span>
          </button>
          <div class="overflow-auto bg-muted/5 p-2 rounded-xl flex items-center justify-center">
            <img :src="woLightboxSrc" alt="Work Order Photo" class="max-w-full max-h-[85vh] rounded-lg shadow-2xl object-contain" referrerpolicy="no-referrer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.wo-lightbox-enter-active,
.wo-lightbox-leave-active {
  transition: opacity 0.2s ease;
}
.wo-lightbox-enter-from,
.wo-lightbox-leave-to {
  opacity: 0;
}
</style>
