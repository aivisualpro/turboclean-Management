<script setup lang="ts">
import { toast } from 'vue-sonner'
import { generatePDF, downloadPDF, calcLineTotal } from '~/composables/useSalesDocument'

const { setHeader } = usePageHeader()
setHeader({ title: 'Invoices', icon: 'i-lucide-receipt' })

const search = ref('')
const statusFilter = ref('')
const invoices = ref<any[]>([])
const loading = ref(false)
const hasMore = ref(true)
const skip = ref(0)
const limit = 20
const generating = ref(false)

const selectedInvoice = ref<any>(null)
const showPreview = ref(false)

const statusOptions = [
  { label: 'All', value: '' },
  { label: 'Draft', value: 'Draft' },
  { label: 'Sent', value: 'Sent' },
  { label: 'Paid', value: 'Paid' },
  { label: 'Overdue', value: 'Overdue' },
]

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
    const res: any = await $fetch('/api/invoices', {
      query: { skip: skip.value, limit, search: search.value, status: statusFilter.value }
    })
    invoices.value = [...invoices.value, ...(res.invoices || [])]
    hasMore.value = res.hasMore
    skip.value += limit
  } catch (err) {
    console.error(err)
    toast.error('Failed to fetch invoices')
  } finally {
    loading.value = false
  }
}

async function handleGenerate() {
  generating.value = true
  try {
    const res: any = await $fetch('/api/invoices/generate', { method: 'POST' })
    if (res.generated > 0) {
      toast.success(`Generated ${res.generated} new invoices`)
      fetchInvoices(true)
    } else {
      toast.info('No new invoices to generate – all work orders are already invoiced')
    }
  } catch (err) {
    console.error(err)
    toast.error('Failed to generate invoices')
  } finally {
    generating.value = false
  }
}

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
      id: li.workOrderId || '',
      description: li.description || '',
      quantity: 1,
      unitPrice: li.amount || 0,
      discount: 0,
      tax: li.amount > 0 ? Math.round((li.tax / li.amount) * 10000) / 100 : 0,
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

// Intersect Logic
const vIntersect = {
  mounted: (el: HTMLElement, binding: any) => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) binding.value()
      },
      { rootMargin: '100px', threshold: 0.1 }
    )
    observer.observe(el)
    ;(el as any)._observer = observer
  },
  unmounted: (el: HTMLElement) => {
    if ((el as any)._observer) (el as any)._observer.disconnect()
  },
}

onMounted(() => fetchInvoices())

let searchTimeout: any
watch(search, () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => fetchInvoices(true), 300)
})
watch(statusFilter, () => fetchInvoices(true))

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
}

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const badgeClasses: Record<string, string> = {
  Draft: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  Sent: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  Paid: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  Overdue: 'bg-red-500/10 text-red-600 border-red-500/20',
  Cancelled: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
}

const summaryStats = computed(() => {
  const all = invoices.value
  return {
    count: all.length,
    totalAmount: all.reduce((s: number, inv: any) => s + (inv.total || 0), 0),
    draftCount: all.filter((i: any) => i.status === 'Draft').length,
    paidCount: all.filter((i: any) => i.status === 'Paid').length,
  }
})
</script>

<template>
  <div class="absolute inset-0 flex flex-col overflow-hidden">
    <!-- Header Actions -->
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <div class="flex items-center gap-2">
          <div class="relative hidden sm:block">
            <Icon name="lucide:search" class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input v-model="search" placeholder="Search invoices..." class="pl-8 w-40 h-8 text-sm" />
          </div>
          <Select v-model="statusFilter">
            <SelectTrigger class="h-8 w-[100px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="s in statusOptions" :key="s.value" :value="s.value" class="text-xs">
                {{ s.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" class="h-8" :disabled="generating" @click="handleGenerate">
            <Icon :name="generating ? 'lucide:loader-2' : 'lucide:zap'" :class="generating ? 'animate-spin' : ''" class="mr-1 size-4" />
            {{ generating ? 'Generating...' : 'Generate Invoices' }}
          </Button>
        </div>
      </Teleport>
    </ClientOnly>

    <!-- Summary Cards -->
    <div class="grid grid-cols-2 gap-3 md:grid-cols-4 p-4 pb-0 lg:p-6 lg:pb-0">
      <Card>
        <CardContent class="flex items-center gap-3 p-4">
          <div class="flex items-center justify-center rounded-lg bg-primary/10 p-2">
            <Icon name="i-lucide-receipt" class="size-4 text-primary" />
          </div>
          <div>
            <p class="text-lg font-bold tabular-nums">{{ summaryStats.count }}</p>
            <p class="text-xs text-muted-foreground">Total Invoices</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="flex items-center gap-3 p-4">
          <div class="flex items-center justify-center rounded-lg bg-emerald-500/10 p-2">
            <Icon name="i-lucide-dollar-sign" class="size-4 text-emerald-500" />
          </div>
          <div>
            <p class="text-lg font-bold tabular-nums">{{ fmt(summaryStats.totalAmount) }}</p>
            <p class="text-xs text-muted-foreground">Total Amount</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="flex items-center gap-3 p-4">
          <div class="flex items-center justify-center rounded-lg bg-gray-500/10 p-2">
            <Icon name="i-lucide-file-edit" class="size-4 text-gray-500" />
          </div>
          <div>
            <p class="text-lg font-bold tabular-nums">{{ summaryStats.draftCount }}</p>
            <p class="text-xs text-muted-foreground">Drafts</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="flex items-center gap-3 p-4">
          <div class="flex items-center justify-center rounded-lg bg-emerald-500/10 p-2">
            <Icon name="i-lucide-check-circle" class="size-4 text-emerald-500" />
          </div>
          <div>
            <p class="text-lg font-bold tabular-nums">{{ summaryStats.paidCount }}</p>
            <p class="text-xs text-muted-foreground">Paid</p>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Table -->
    <div class="flex-1 min-h-0 rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden m-4 mt-3 lg:m-6 lg:mt-3">
      <div class="h-full overflow-auto">
        <table class="w-full text-sm caption-bottom border-collapse">
          <TableHeader class="sticky top-0 z-10 bg-muted/95 backdrop-blur shadow-sm">
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Dealer</TableHead>
              <TableHead>Week</TableHead>
              <TableHead class="text-right">Subtotal</TableHead>
              <TableHead class="text-right">Tax</TableHead>
              <TableHead class="text-right">Total</TableHead>
              <TableHead class="text-center">Items</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead class="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="inv in invoices" :key="inv.id" class="cursor-pointer hover:bg-muted/50">
              <TableCell class="font-semibold text-xs whitespace-nowrap">{{ inv.number }}</TableCell>
              <TableCell class="text-xs truncate max-w-[140px]">
                <div>
                  <p class="font-medium">{{ inv.dealerName }}</p>
                  <p v-if="inv.dealerEmail" class="text-[10px] text-muted-foreground">{{ inv.dealerEmail }}</p>
                </div>
              </TableCell>
              <TableCell class="text-xs whitespace-nowrap">
                W{{ inv.weekNumber }}, {{ inv.weekYear }}
              </TableCell>
              <TableCell class="text-right text-xs tabular-nums">{{ fmt(inv.subtotal) }}</TableCell>
              <TableCell class="text-right text-xs tabular-nums">{{ fmt(inv.taxTotal) }}</TableCell>
              <TableCell class="text-right text-xs tabular-nums font-semibold">{{ fmt(inv.total) }}</TableCell>
              <TableCell class="text-center text-xs tabular-nums">{{ inv.lineItems?.length || 0 }}</TableCell>
              <TableCell>
                <Badge variant="outline" :class="badgeClasses[inv.status] || ''" class="text-[10px]">
                  {{ inv.status }}
                </Badge>
              </TableCell>
              <TableCell class="text-xs whitespace-nowrap">{{ fmtDate(inv.date) }}</TableCell>
              <TableCell class="text-xs whitespace-nowrap">{{ fmtDate(inv.dueDate) }}</TableCell>
              <TableCell>
                <div class="flex items-center justify-center gap-1">
                  <Button variant="ghost" size="icon" class="h-7 w-7" @click="openPreviewFor(inv)">
                    <Icon name="lucide:eye" class="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" class="h-7 w-7" @click="handleDownload(inv)">
                    <Icon name="lucide:download" class="size-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
            <TableRow v-if="loading && invoices.length === 0">
              <TableCell :colspan="11" class="text-center py-10">
                <Icon name="lucide:loader-2" class="size-6 animate-spin text-muted-foreground mx-auto" />
              </TableCell>
            </TableRow>
            <TableRow v-if="!loading && invoices.length === 0">
              <TableCell :colspan="11" class="text-center py-10 text-muted-foreground">
                <div class="space-y-2">
                  <Icon name="lucide:receipt" class="size-10 mx-auto opacity-30" />
                  <p>No invoices found.</p>
                  <p class="text-xs">Click <strong>Generate Invoices</strong> to create invoices from your work orders.</p>
                </div>
              </TableCell>
            </TableRow>
            <tr v-if="hasMore && invoices.length > 0" v-intersect="fetchInvoices" class="h-10">
              <td :colspan="11" class="text-center">
                <div v-if="loading" class="flex justify-center py-4">
                  <Icon name="lucide:loader-2" class="size-4 animate-spin text-muted-foreground" />
                </div>
              </td>
            </tr>
          </TableBody>
        </table>
      </div>
    </div>

    <!-- Preview Dialog -->
    <Dialog v-model:open="showPreview">
      <DialogContent class="sm:max-w-[90vw] w-[90vw] max-h-[95vh] overflow-auto">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Icon name="i-lucide-receipt" class="size-4" />
            Invoice Preview – {{ selectedInvoice?.number }}
          </DialogTitle>
        </DialogHeader>
        <div class="border rounded-lg overflow-hidden bg-white">
          <iframe :srcdoc="previewHtml" class="w-full border-0" style="height: calc(85vh - 120px)" />
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" @click="showPreview = false">Close</Button>
          <Button size="sm" @click="handleDownload(selectedInvoice)">
            <Icon name="lucide:download" class="mr-1 size-4" />
            Download PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
