<script setup lang="ts">
import { toast } from 'vue-sonner'
import { generatePDF, downloadPDF, calcLineTotal } from '~/composables/useSalesDocument'
import { ChevronRight, ChevronDown, Folder, CalendarDays, Calendar as CalendarIcon, CalendarClock, Loader2, Download, Search, FileText, FileSpreadsheet, Eye, Mail, ThumbsUp, CheckCircle, Send } from 'lucide-vue-next'

const { setHeader } = usePageHeader()
setHeader({ title: 'Invoices', icon: 'i-lucide-receipt' })

// ─── Base State ──────────────────────────────────────────────────────────
const search = ref('')
const activeTab = ref<'all' | 'unpaid' | 'paid'>('all')
const activeType = ref<'all' | 'daily' | 'weekly'>('all')

const globalDatePreset = ref('this_month')
const customStartDate = ref('')
const customEndDate = ref('')

watch(() => customStartDate.value, (newVal: string) => {
  if (newVal && !customEndDate.value) customEndDate.value = newVal
})

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

const expandedDealers   = ref(new Set<string>())
const expandedYears     = ref(new Set<string>())
const expandedMonths    = ref(new Set<string>())
const expandedInvoices  = ref(new Set<string>())

const activeFilter = ref<{
  label: string
  dealerId?: string
  dateStart?: string
  dateEnd?: string
}>({ label: 'All Invoices' })

// ─── Formatter Helpers ───────────────────────────────────────────────────
const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const badgeClasses: Record<string, string> = {
  Draft: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  Approved: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  Emailed: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
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
        search: search.value,
      }
    })
    treeData.value = res.tree || []
  } catch (err) {
    console.error('Failed to load tree:', err)
  } finally {
    treeLoading.value = false
  }
}

// Client-side instant-filter for tree as user types
const filteredTreeData = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return treeData.value
  return treeData.value.filter((dealer: any) =>
    (dealer.dealerName || '').toLowerCase().includes(q)
  )
})

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

async function updateInvoiceStatus(inv: any, newStatus: string) {
  toast(`Mark invoice as ${newStatus}?`, {
    description: `Are you sure you want to mark this invoice as ${newStatus}?`,
    action: {
      label: 'Confirm',
      onClick: () => {
        toast.promise(
          ($fetch as any)(`/api/invoices/${inv.id}`, { method: 'PUT', body: { status: newStatus } }),
          {
            loading: 'Updating status...',
            success: () => {
              inv.status = newStatus
              return `Invoice marked as ${newStatus}`
            },
            error: 'Failed to update status'
          }
        )
      }
    },
    cancel: {
      label: 'Cancel',
      onClick: () => {}
    }
  })
}

// ─── Payment Dialog ──────────────────────────────────────────────────────
const showPaymentDialog = ref(false)
const selectedPaymentInvoice = ref<any>(null)
const paymentAmount = ref<number | ''>('')
const isPaying = ref(false)

function openPaymentDialog(inv: any) {
  selectedPaymentInvoice.value = inv
  paymentAmount.value = inv.total || ''
  showPaymentDialog.value = true
}

async function handlePaymentSubmit() {
  if (!selectedPaymentInvoice.value || !paymentAmount.value) return
  isPaying.value = true
  try {
    await $fetch(`/api/invoices/${selectedPaymentInvoice.value.id}`, {
      method: 'PUT',
      body: { status: 'Paid', paidAmount: Number(paymentAmount.value) }
    })
    selectedPaymentInvoice.value.status = 'Paid'
    selectedPaymentInvoice.value.paidAmount = Number(paymentAmount.value)
    showPaymentDialog.value = false
    toast.success('Invoice marked as paid')
  } catch (err: any) {
    toast.error('Failed to update invoice: ' + err.message)
  } finally {
    isPaying.value = false
  }
}

const showEmailDialog = ref(false)
const selectedEmailInvoice = ref<any>(null)
const recipientEmails = ref<string[]>([])
const newEmailInput = ref('')
const dealerContacts = ref<{email: string, name: string}[]>([])
const isFetchingContacts = ref(false)
const isEmailing = ref(false)

const cleanEmail = (e: string) => e?.trim().replace(/,+$/, '') || '';

async function openEmailDialog(inv: any) {
  selectedEmailInvoice.value = inv
  recipientEmails.value = []
  newEmailInput.value = ''
  dealerContacts.value = []
  showEmailDialog.value = true
  
  if (inv.dealerId) {
    isFetchingContacts.value = true
    try {
      const res = await $fetch<{ dealer: any }>(`/api/dealers/${inv.dealerId}`)
      const dlr = res.dealer
      if (dlr) {
        const items = new Map<string, string>()
        dlr.contacts?.forEach((c: any) => {
          c.emails?.forEach((e: string) => {
            const cleaned = cleanEmail(e)
            if (cleaned && !items.has(cleaned)) items.set(cleaned, c.name || 'Contact')
          })
        })
        dealerContacts.value = Array.from(items.entries()).map(([email, name]) => ({ email, name }))
      }
    } catch { }
    finally { isFetchingContacts.value = false }
  }
}

function toggleContact(email: string) {
  if (recipientEmails.value.includes(email)) {
    recipientEmails.value = recipientEmails.value.filter(e => e !== email)
  } else {
    recipientEmails.value = [...recipientEmails.value, email]
  }
}

function selectAllContacts() {
  const allContactEmails = dealerContacts.value.map(c => c.email)
  const allSelected = allContactEmails.every(e => recipientEmails.value.includes(e))
  if (allSelected) {
    recipientEmails.value = recipientEmails.value.filter(e => !allContactEmails.includes(e))
  } else {
    const newEmails = allContactEmails.filter(e => !recipientEmails.value.includes(e))
    recipientEmails.value = [...recipientEmails.value, ...newEmails]
  }
}

function addCustomEmail() {
  const raw = newEmailInput.value
  const emails = raw.split(/[,;\s]+/).map(s => cleanEmail(s)).filter(Boolean)
  const fresh = emails.filter(e => !recipientEmails.value.includes(e))
  if (fresh.length > 0) recipientEmails.value = [...recipientEmails.value, ...fresh]
  newEmailInput.value = ''
}

function handleEmailInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    addCustomEmail()
  }
  if (e.key === 'Backspace' && !newEmailInput.value && recipientEmails.value.length > 0) {
    recipientEmails.value = recipientEmails.value.slice(0, -1)
  }
}

function removeRecipient(email: string) {
  recipientEmails.value = recipientEmails.value.filter(e => e !== email)
}

function getContactName(email: string): string | null {
  const contact = dealerContacts.value.find(c => c.email === email)
  return contact?.name || null
}

function handleEmailDialogSubmit() {
  // Flush any text remaining in the input
  addCustomEmail()
  
  const finalEmails = [...recipientEmails.value]
  if (finalEmails.length === 0) return toast.error('At least one email is required')

  const inv = selectedEmailInvoice.value
  const doc = toSalesDoc(inv)
  const htmlPayload = generatePDF(doc, 'Invoice')

  showEmailDialog.value = false
  toast.success(`Invoice sending to ${finalEmails.length} recipient${finalEmails.length > 1 ? 's' : ''}`)

  if (inv.status === 'Approved' || inv.status === 'Draft' || inv.status === 'Sent') {
    inv.status = 'Emailed'
  }

  $fetch('/api/invoices/send', {
    method: 'POST' as any,
    body: {
      html: htmlPayload,
      email: finalEmails,
      subject: `Invoice ${doc.number} from ZRZ OPS`,
      dealerId: inv.dealerId,
      invoiceId: inv.id,
      invoiceType: inv.type || 'Weekly',
      invoiceNumber: doc.number,
      invoiceData: doc,
    }
  }).then(() => {
    ($fetch as any)(`/api/invoices/${inv.id}`, { method: 'PUT', body: { status: 'Emailed' } }).catch(() => {})
  }).catch((err: any) => {
    toast.error('Email delivery failed: ' + (err.message || 'Unknown error'))
    inv.status = 'Approved'
  })
}

async function handleEmail(inv: any) {
  openEmailDialog(inv)
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
    weekStart: inv.weekStart,
    weekEnd: inv.weekEnd,
    type: inv.type,
    paidAmount: inv.paidAmount || 0,
    paymentMethod: inv.paymentMethod || '',
    notes: inv.notes || '',
    lineItems: (inv.lineItems || []).map((li: any) => ({
      id: li.workOrderId || li.invoiceId || '',
      number: li.number,
      description: li.description || `Invoice #${li.number}` || '',
      quantity: 1,
      unitPrice: li.amount || li.total || li.unitPrice || 0,
      discount: 0,
      tax: li.tax || li.taxTotal || 0,
      date: li.date,
      stockNumber: li.stockNumber,
      poNumber: li.poNumber || '',
      vin: li.vin,
      serviceName: li.serviceName || li.serviceId,
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

// Fetch on every visit — non-blocking so navigation is instant
fetchTree()
fetchInvoices()

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
    <div class="flex-1 min-h-0 flex flex-col md:flex-row gap-4 p-4 w-full">
      
      <!-- ─── Sidebar Tree ──────────────────────────────────────────────────────── -->
      <aside class="w-full md:w-96 shrink-0 flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
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
          <div v-for="dealer in filteredTreeData" :key="dealer.dealerId">
            <div class="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors group" :class="activeFilter.dealerId === dealer.dealerId && !activeFilter.dateStart ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'" @click="selectDealer(dealer)">
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
                <div class="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors" :class="activeFilter.dateStart?.startsWith(yr.year.toString()) && activeFilter.dateEnd?.endsWith('12-31T23:59:59.999Z') ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'" @click="selectYear(dealer, yr)">
                  <div class="flex items-center gap-1.5">
                    <button class="shrink-0 p-0.5 rounded text-muted-foreground hover:bg-muted-foreground/20" @click.stop="toggleSet(expandedYears, `${dealer.dealerId}-${yr.year}`)">
                      <ChevronDown v-if="expandedYears.has(`${dealer.dealerId}-${yr.year}`)" class="size-3.5" />
                      <ChevronRight v-else class="size-3.5" />
                    </button>
                    <CalendarIcon class="size-3.5 text-muted-foreground" />
                    <span>{{ yr.year }}</span>
                  </div>
                  <span class="text-[10px] tabular-nums font-mono opacity-50 shrink-0 select-none"><span class="opacity-70 mr-1.5">({{ yr.count }})</span>{{ fmt(yr.totalAmount) }}</span>
                </div>

                <!-- Months -->
                <div v-if="expandedYears.has(`${dealer.dealerId}-${yr.year}`)" class="pl-5 relative before:absolute before:inset-y-0 before:left-3.5 before:w-px before:bg-border/60">
                  <div v-for="mo in yr.months" :key="mo.month">
                    <div class="flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors" :class="activeFilter.dateStart?.startsWith(`${yr.year}-${mo.monthNumber.toString().padStart(2, '0')}`) && !activeFilter.dateEnd?.startsWith(activeFilter.dateStart?.slice(0, 10) || '') ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'" @click="selectMonth(dealer, yr, mo)">
                      <div class="flex items-center gap-1.5">
                        <button class="shrink-0 p-0.5 rounded text-muted-foreground hover:bg-muted-foreground/20" @click.stop="toggleSet(expandedMonths, `${dealer.dealerId}-${yr.year}-${mo.monthNumber}`)">
                          <ChevronDown v-if="expandedMonths.has(`${dealer.dealerId}-${yr.year}-${mo.monthNumber}`)" class="size-3.5" />
                          <ChevronRight v-else class="size-3.5" />
                        </button>
                        <CalendarDays class="size-3.5 text-muted-foreground" />
                        <span>{{ mo.month }}</span>
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

        <div v-else class="flex-1 space-y-3 p-3">
          <div v-for="i in 8" :key="i" class="flex items-center gap-3">
            <Skeleton class="h-4 w-4 rounded" />
            <Skeleton class="h-4 flex-1 rounded" />
            <Skeleton class="h-4 w-12 rounded" />
          </div>
        </div>
      </aside>

      <!-- ─── Main Content ──────────────────────────────────────────────────────── -->
      <main class="flex-1 min-w-0 flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-[rgba(0,0,0,0.05)_0px_2px_10px]">
        
        <!-- Header Filters -->
        <div class="flex flex-col xl:flex-row items-start xl:items-center justify-between border-b bg-muted/10 shrink-0">
          <div class="flex items-center px-4 py-3 gap-3 w-full xl:w-auto overflow-hidden border-b xl:border-b-0">
            <span class="truncate font-semibold text-sm">{{ activeFilter.label }}</span>
            <Badge variant="secondary" class="font-mono text-[10px] shrink-0">
              <span v-if="loading && invoices.length === 0"><Skeleton class="h-3 w-12 inline-block" /></span>
              <span v-else>{{ hasMore ? invoices.length + '+' : invoices.length }} invoices</span>
            </Badge>
          </div>

          <div class="flex flex-wrap items-center gap-2 px-3 py-2 xl:py-2 bg-gradient-to-r from-transparent to-muted/20">
            <!-- TYPE TABS (Daily vs Weekly) -->
            <div class="flex bg-muted/60 p-1 rounded-lg border border-border/50">
              <button @click="activeType = 'all'"     class="px-2.5 py-1 text-xs font-medium rounded-md transition-all shadow-sm" :class="activeType === 'all' ? 'bg-background text-foreground ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground'">All Types</button>
              <button @click="activeType = 'daily'"   class="px-2.5 py-1 text-xs font-medium rounded-md transition-all" :class="activeType === 'daily' ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50 text-emerald-600' : 'text-muted-foreground hover:text-foreground'">Daily</button>
              <button @click="activeType = 'weekly'"  class="px-2.5 py-1 text-xs font-medium rounded-md transition-all" :class="activeType === 'weekly' ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50 text-amber-600' : 'text-muted-foreground hover:text-foreground'">Weekly</button>
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
                <TableHead class="w-[80px] cursor-pointer" @click="toggleSort('number')"><div class="flex items-center gap-1"># <Icon :name="sortIcon('number')" class="size-3 opacity-50" /></div></TableHead>
                <TableHead v-if="!activeFilter.dealerId" class="cursor-pointer" @click="toggleSort('dealerName')"><div class="flex items-center gap-1">Dealer <Icon :name="sortIcon('dealerName')" class="size-3 opacity-50" /></div></TableHead>
                <TableHead class="cursor-pointer" @click="toggleSort('date')"><div class="flex items-center gap-1">Date <Icon :name="sortIcon('date')" class="size-3 opacity-50" /></div></TableHead>
                <TableHead class="cursor-pointer" @click="toggleSort('type')"><div class="flex items-center gap-1">Type <Icon :name="sortIcon('type')" class="size-3 opacity-50" /></div></TableHead>
                <TableHead v-if="activeType === 'weekly'">Range</TableHead>
                <TableHead class="text-right cursor-pointer" @click="toggleSort('subtotal')"><div class="flex items-center justify-end gap-1">Subtotal <Icon :name="sortIcon('subtotal')" class="size-3 opacity-50" /></div></TableHead>
                <TableHead class="text-right cursor-pointer" @click="toggleSort('taxTotal')"><div class="flex items-center justify-end gap-1">Tax <Icon :name="sortIcon('taxTotal')" class="size-3 opacity-50" /></div></TableHead>
                <TableHead class="text-right cursor-pointer" @click="toggleSort('total')"><div class="flex items-center justify-end gap-1">Total <Icon :name="sortIcon('total')" class="size-3 opacity-50" /></div></TableHead>
                <TableHead class="text-right cursor-pointer" @click="toggleSort('paidAmount')"><div class="flex items-center justify-end gap-1">Paid $ <Icon :name="sortIcon('paidAmount')" class="size-3 opacity-50" /></div></TableHead>
                <TableHead class="text-center">Items</TableHead>
                <TableHead class="cursor-pointer" @click="toggleSort('status')"><div class="flex items-center gap-1">Status <Icon :name="sortIcon('status')" class="size-3 opacity-50" /></div></TableHead>
                <TableHead class="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <template v-for="inv in invoices" :key="inv.id">
                <TableRow 
                  @click="toggleSet(expandedInvoices, inv.id)"
                  class="cursor-pointer hover:bg-muted/50 transition-colors"
                  :class="expandedInvoices.has(inv.id) ? 'bg-muted/30' : ''"
                >
                  <TableCell class="font-bold text-xs">
                    <div class="flex items-center gap-1.5 text-primary">
                      <ChevronRight v-if="!expandedInvoices.has(inv.id)" class="size-3 text-muted-foreground/50" />
                      <ChevronDown v-else class="size-3 text-primary" />
                      <FileSpreadsheet class="size-3.5 opacity-70" />
                      {{ inv.number }}
                    </div>
                  </TableCell>
                  <TableCell v-if="!activeFilter.dealerId" class="text-xs">
                    <p class="font-semibold max-w-[140px] truncate">{{ inv.dealerName }}</p>
                  </TableCell>
                  <TableCell class="text-xs whitespace-nowrap">{{ fmtDate(inv.date) }}</TableCell>
                  <TableCell>
                    <Badge variant="outline" class="text-[9px] uppercase tracking-wide" :class="inv.type === 'Weekly' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'">
                      {{ inv.type || 'Weekly' }}
                    </Badge>
                  </TableCell>
                  <TableCell v-if="activeType === 'weekly'" class="text-[11px] text-muted-foreground whitespace-nowrap">
                    {{ fmtDate(inv.customStartDate || inv.weekStart) }} - {{ fmtDate(inv.customEndDate || inv.weekEnd) }}
                  </TableCell>
                  <TableCell class="text-right text-xs tabular-nums text-muted-foreground">{{ fmt(inv.subtotal) }}</TableCell>
                  <TableCell class="text-right text-xs tabular-nums text-muted-foreground">{{ fmt(inv.taxTotal) }}</TableCell>
                  <TableCell class="text-right text-xs tabular-nums font-bold">{{ fmt(inv.total) }}</TableCell>
                  <TableCell class="text-right text-xs tabular-nums text-emerald-600 font-semibold">{{ inv.paidAmount ? fmt(inv.paidAmount) : '—' }}</TableCell>
                  <TableCell class="text-center text-xs tabular-nums">
                    {{ inv.lineItems?.length || 0 }}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" :class="badgeClasses[inv.status] || ''" class="text-[10px]">
                      {{ inv.status }}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div class="flex items-center justify-center gap-0.5">
                      <Button v-if="inv.status === 'Draft'" variant="ghost" size="icon" class="h-7 w-7 text-amber-600 hover:bg-amber-50" @click.stop="updateInvoiceStatus(inv, 'Approved')" title="Approve">
                        <ThumbsUp class="size-4" />
                      </Button>
                      <Button v-if="inv.status === 'Approved' || inv.status === 'Emailed'" variant="ghost" size="icon" class="h-7 w-7 text-emerald-600 hover:bg-emerald-50" @click.stop="openPaymentDialog(inv)" title="Mark Paid">
                        <CheckCircle class="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" class="h-7 w-7 text-blue-600 hover:bg-blue-50" @click.stop="openEmailDialog(inv)" title="Email Dealer">
                        <Send class="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" class="h-7 w-7 hover:text-primary hover:bg-primary/10" @click.stop="openPreviewFor(inv)" title="Preview">
                        <Eye class="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground hover:bg-muted" @click.stop="handleDownload(inv)" title="Download">
                        <Download class="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>

                <!-- Line Items Accordion Content -->
                <TableRow v-if="expandedInvoices.has(inv.id)" class="bg-muted/20 border-t-0 hover:bg-muted/20">
                  <TableCell :colspan="12" class="p-0">
                    <div class="px-10 py-4 animate-in slide-in-from-top-2 duration-200">
                      <div class="border rounded-lg bg-card shadow-sm overflow-hidden">
                        <table class="w-full text-[11px]">
                          <thead class="bg-muted/50 border-b">
                            <tr>
                              <th class="px-3 py-2 text-left font-semibold text-muted-foreground">Date</th>
                              <th class="px-3 py-2 text-left font-semibold text-muted-foreground">Service / Description</th>
                              <th class="px-3 py-2 text-left font-semibold text-muted-foreground">Stock # / VIN</th>
                              <th class="px-3 py-2 text-right font-semibold text-muted-foreground">Line Total</th>
                            </tr>
                          </thead>
                          <tbody class="divide-y">
                            <tr v-for="li in inv.lineItems" :key="li.date + (li.serviceName || li.description) + (li._id || li.workOrderId)" class="hover:bg-muted/30 transition-colors">
                              <td class="px-3 py-2 text-muted-foreground whitespace-nowrap">{{ fmtDate(li.date) }}</td>
                              <td class="px-3 py-2">
                                <div class="font-medium text-foreground">{{ li.serviceName || '—' }}</div>
                                <div v-if="li.description" class="text-[10px] text-muted-foreground">{{ li.description }}</div>
                              </td>
                              <td class="px-3 py-2 font-mono text-[10px]">
                                <span v-if="li.stockNumber" class="text-foreground font-bold mr-2 uppercase">{{ li.stockNumber }}</span>
                                <span v-if="li.vin" class="text-muted-foreground">{{ li.vin }}</span>
                                <span v-if="!li.stockNumber && !li.vin" class="text-muted-foreground opacity-50">—</span>
                              </td>
                              <td class="px-3 py-2 text-right font-semibold tabular-nums">
                                {{ fmt(li.amount || li.total || li.unitPrice) }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        <div class="px-3 py-2 bg-muted/30 flex justify-between items-center border-t">
                          <span class="text-muted-foreground font-medium italic">* Includes Tax if calculated per line item</span>
                          <span class="text-foreground font-bold">Items count: {{ inv.lineItems?.length }}</span>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              </template>

              <template v-if="loading && invoices.length === 0">
                <TableRow v-for="i in 10" :key="i">
                  <TableCell v-for="j in (activeFilter.dealerId ? 9 : 10)" :key="j">
                    <Skeleton class="h-4 w-full rounded" />
                  </TableCell>
                </TableRow>
              </template>
              <TableRow v-if="!loading && invoices.length === 0">
                <TableCell :colspan="activeFilter.dealerId ? 9 : 10" class="text-center py-10">
                  <FileSpreadsheet class="size-10 text-muted-foreground/20 mx-auto mb-3" />
                  <p class="text-sm font-medium text-foreground">No invoices found</p>
                  <p class="text-xs text-muted-foreground mt-1">Try adjusting your tabs or date range.</p>
                </TableCell>
              </TableRow>

              <tr v-if="hasMore && invoices.length > 0" v-intersect="fetchInvoices" class="h-10">
                <td :colspan="activeFilter.dealerId ? 9 : 10" class="text-center">
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
      <DialogContent class="sm:max-w-[70vw] w-[95vw] lg:max-w-[1000px] max-h-[95vh] overflow-auto p-0 gap-0 [&>button:last-child]:hidden">
        <div class="p-4 border-b flex items-center justify-between bg-muted/20">
          <DialogTitle class="flex items-center gap-2">
            <div class="p-1.5 bg-primary/10 text-primary rounded-md"><FileSpreadsheet class="size-4" /></div>
            Invoice Preview – {{ selectedInvoice?.number }}
          </DialogTitle>
          <div class="flex gap-2">
            <Button variant="outline" size="sm" @click="showPreview = false">Close</Button>
            <Button variant="secondary" size="sm" :disabled="isEmailing" @click="openEmailDialog(selectedInvoice)">
              <Loader2 v-if="isEmailing" class="mr-1 size-4 animate-spin" />
              <Mail v-else class="mr-1 size-4" /> 
              {{ isEmailing ? 'Sending...' : 'Email Dealer' }}
            </Button>
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

    <!-- Email Dialog -->
    <Dialog v-model:open="showEmailDialog">
      <DialogContent class="sm:max-w-[480px] p-0 gap-0 overflow-hidden">
        <div class="px-5 pt-5 pb-4 border-b bg-gradient-to-b from-muted/50 to-transparent">
          <DialogTitle class="flex items-center gap-2.5 text-lg">
            <div class="p-2 bg-muted text-foreground rounded-lg"><Send class="size-4" /></div>
            Email Invoice
          </DialogTitle>
          <DialogDescription class="mt-1.5 text-muted-foreground text-sm">
            Send <span class="font-semibold text-foreground">{{ selectedEmailInvoice?.number }}</span> to <span class="font-semibold text-foreground">{{ selectedEmailInvoice?.dealerName }}</span>
          </DialogDescription>
        </div>

        <div class="px-5 py-4 space-y-4">
          <!-- Quick-pick Contacts -->
          <div v-if="isFetchingContacts" class="flex items-center text-sm text-muted-foreground gap-2 py-3">
            <Loader2 class="size-3.5 animate-spin" /> Loading contacts...
          </div>
          <div v-else-if="dealerContacts.length > 0">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Quick Add from Contacts</span>
              <button type="button" class="text-[10px] uppercase font-bold tracking-wider transition-colors" :class="dealerContacts.every(c => recipientEmails.includes(c.email)) ? 'text-destructive hover:text-destructive/80' : 'text-primary hover:text-primary/80'" @click="selectAllContacts">
                {{ dealerContacts.every(c => recipientEmails.includes(c.email)) ? 'Remove All' : 'Add All' }}
              </button>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="c in dealerContacts" :key="c.email"
                type="button"
                @click="toggleContact(c.email)"
                class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 border"
                :class="recipientEmails.includes(c.email)
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm scale-[1.02]'
                  : 'bg-card text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground hover:bg-muted'"
              >
                <Icon :name="recipientEmails.includes(c.email) ? 'lucide:check' : 'lucide:plus'" class="size-3" />
                <span class="font-semibold">{{ c.name }}</span>
              </button>
            </div>
          </div>

          <!-- Recipients Tag Input -->
          <div>
            <span class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 block">Recipients</span>
            <div
              class="min-h-[44px] flex flex-wrap items-center gap-1.5 p-2 rounded-lg border border-border bg-background transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:border-foreground/40 cursor-text"
              @click="($refs.emailInputEl as HTMLInputElement)?.focus()"
            >
              <TransitionGroup name="tag">
                <span
                  v-for="email in recipientEmails" :key="email"
                  class="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-md text-xs font-medium transition-all bg-muted text-foreground border border-border"
                >
                  {{ getContactName(email) || email }}
                  <span v-if="getContactName(email)" class="text-[9px] opacity-60 ml-0.5">&lt;{{ email }}&gt;</span>
                  <button type="button" @click.stop="removeRecipient(email)" class="ml-0.5 p-0.5 rounded hover:bg-foreground/10 transition-colors">
                    <Icon name="lucide:x" class="size-3" />
                  </button>
                </span>
              </TransitionGroup>
              <input
                ref="emailInputEl"
                v-model="newEmailInput"
                type="email"
                class="flex-1 min-w-[140px] bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 h-7"
                placeholder="Type email & press Enter"
                @keydown="handleEmailInputKeydown"
                @blur="addCustomEmail"
              />
            </div>
            <p v-if="recipientEmails.length === 0 && !newEmailInput" class="text-[11px] text-muted-foreground/60 mt-1.5 ml-0.5">Click contacts above or type an email address</p>
          </div>
        </div>

        <div class="px-5 py-3.5 border-t bg-muted/30 flex items-center justify-between gap-3">
          <span v-if="recipientEmails.length > 0" class="text-xs text-muted-foreground tabular-nums">
            <span class="font-bold text-foreground">{{ recipientEmails.length }}</span> recipient{{ recipientEmails.length > 1 ? 's' : '' }}
          </span>
          <span v-else />
          <div class="flex gap-2">
            <Button variant="outline" size="sm" @click="showEmailDialog = false">Cancel</Button>
            <Button size="sm" class="bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm min-w-[120px]" :disabled="recipientEmails.length === 0 || isEmailing" @click="handleEmailDialogSubmit">
              <Loader2 v-if="isEmailing" class="mr-2 size-3.5 animate-spin" />
              <Send v-else class="mr-2 size-3.5" />
              Send{{ recipientEmails.length > 0 ? ` to ${recipientEmails.length}` : '' }}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <!-- Payment Dialog -->
    <Dialog v-model:open="showPaymentDialog">
      <DialogContent class="sm:max-w-[400px]">
        <div class="px-2 pt-2">
          <DialogTitle class="flex items-center gap-2 text-lg">
            <div class="p-1.5 bg-emerald-500/10 text-emerald-600 rounded-md"><CheckCircle class="size-5" /></div>
            Mark as Paid
          </DialogTitle>
          <DialogDescription class="mt-2 text-muted-foreground">
            Enter the amount paid for <span class="font-semibold text-foreground">{{ selectedPaymentInvoice?.number }}</span>.
          </DialogDescription>
          
          <div class="mt-6 space-y-4">
            <div class="space-y-2">
              <label class="text-sm font-medium">Payment Amount</label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input type="number" step="0.01" v-model="paymentAmount" class="pl-7" placeholder="0.00" @keydown.enter="handlePaymentSubmit" />
              </div>
            </div>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2 px-2 pb-2">
          <Button variant="outline" @click="showPaymentDialog = false">Cancel</Button>
          <Button class="bg-emerald-600 hover:bg-emerald-700 text-white" :disabled="isPaying || !paymentAmount" @click="handlePaymentSubmit">
            <Loader2 v-if="isPaying" class="mr-2 size-4 animate-spin" />
            Confirm Payment
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
.tag-enter-active { animation: tag-in 0.2s ease-out; }
.tag-leave-active { animation: tag-out 0.15s ease-in; position: absolute; }
.tag-move { transition: transform 0.2s ease; }
@keyframes tag-in { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
@keyframes tag-out { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.8); } }
</style>
