<script setup lang="ts">
import type { LineItem, SalesDocument } from '~/composables/useSalesDocument'
import { toast } from 'vue-sonner'
import {
  calcDocumentTotals,
  calcLineTotal,
  createLineItem,
  downloadPDF,
  generatePDF,
  useSalesDocument,
} from '~/composables/useSalesDocument'

const props = defineProps<{
  storeKey: string
  docType: 'Work Order' | 'Invoice' | 'Order'
  title: string
  description: string
  icon: string
  statusOptions: { label: string, value: string }[]
  extraFields?: { key: string, label: string, type?: string, placeholder?: string }[]
  initialData: SalesDocument[]
}>()

const { setHeader } = usePageHeader()
setHeader({ title: props.title, description: props.description, icon: props.icon })

const { items, isLoaded, createDoc, updateDoc, removeDoc, resetDocs } = useSalesDocument(props.storeKey, props.initialData)

// ── State ──────────────────────────────────────────
const search = ref('')
const statusFilter = ref('all')
const currentPage = ref(1)
const perPage = 10

// Form/Dialog State
const showForm = ref(false)
const showDetail = ref(false)
const showPreview = ref(false)
const showDeleteDialog = ref(false)
const isEditing = ref(false)
const formData = ref<Partial<SalesDocument>>({})
const editingLineItems = ref<LineItem[]>([])
const selectedDoc = ref<SalesDocument | null>(null)
const deleteTarget = ref<SalesDocument | null>(null)

// ── Filtering ──────────────────────────────────────
const filteredItems = computed(() => {
  return items.value.filter((item) => {
    if (statusFilter.value !== 'all' && item.status !== statusFilter.value)
      return false
    if (search.value) {
      const q = search.value.toLowerCase()
      return item.number.toLowerCase().includes(q)
        || item.client.toLowerCase().includes(q)
        || item.lineItems.some((li: LineItem) => li.description.toLowerCase().includes(q))
    }
    return true
  })
})

const totalPages = computed(() => Math.ceil(filteredItems.value.length / perPage))
const paginatedItems = computed(() => {
  const start = (currentPage.value - 1) * perPage
  return filteredItems.value.slice(start, start + perPage)
})

watch(search, () => { currentPage.value = 1 })
watch(statusFilter, () => { currentPage.value = 1 })

// ── Summary Stats ──────────────────────────────────
const summaryStats = computed(() => {
  const allItems = items.value
  const totalAmount = allItems.reduce((s, d) => s + d.total, 0)
  const statusCounts: Record<string, number> = {}
  allItems.forEach((d) => {
    statusCounts[d.status] = (statusCounts[d.status] || 0) + 1
  })
  return { count: allItems.length, totalAmount, statusCounts }
})

// ── Line items totals (live in form) ───────────────
const editingTotals = computed(() => calcDocumentTotals(editingLineItems.value))

// ── CRUD ───────────────────────────────────────────
function openCreate() {
  isEditing.value = false
  formData.value = {
    number: `${props.docType === 'Work Order' ? 'WO' : props.docType === 'Invoice' ? 'INV' : 'ORD'}-2026-${String(items.value.length + 1).padStart(3, '0')}`,
    client: '',
    clientEmail: '',
    clientAddress: '',
    status: props.statusOptions[0]?.value || 'Draft',
    date: new Date().toISOString().slice(0, 10),
    notes: '',
  }
  editingLineItems.value = [createLineItem()]
  showForm.value = true
}

function openEdit(doc: SalesDocument) {
  isEditing.value = true
  formData.value = { ...doc }
  editingLineItems.value = doc.lineItems.map(li => ({ ...li }))
  showForm.value = true
}

function handleSave() {
  if (!formData.value.client) {
    toast.error('Client name is required')
    return
  }
  if (editingLineItems.value.length === 0 || editingLineItems.value.every(li => !li.description)) {
    toast.error('At least one line item is required')
    return
  }

  // Filter out empty line items
  const validLines = editingLineItems.value.filter(li => li.description.trim())
  const totals = calcDocumentTotals(validLines)

  if (isEditing.value && formData.value.id) {
    updateDoc(formData.value.id, {
      ...formData.value,
      lineItems: validLines,
      ...totals,
    } as Partial<SalesDocument>)
    toast.success(`${props.docType} updated successfully`)
  }
  else {
    createDoc({
      ...formData.value,
      lineItems: validLines,
      ...totals,
    } as Partial<SalesDocument>)
    toast.success(`${props.docType} created successfully`)
  }
  showForm.value = false
}

function addLineItem() {
  editingLineItems.value.push(createLineItem())
}

function removeLineItem(id: string) {
  if (editingLineItems.value.length <= 1) {
    toast.error('At least one line item is required')
    return
  }
  editingLineItems.value = editingLineItems.value.filter(li => li.id !== id)
}

function openDetail(doc: SalesDocument) {
  selectedDoc.value = doc
  showDetail.value = true
}

function openPreview(doc: SalesDocument) {
  selectedDoc.value = doc
  showPreview.value = true
}

function confirmDelete(doc: SalesDocument) {
  deleteTarget.value = doc
  showDeleteDialog.value = true
}

function handleDelete() {
  if (deleteTarget.value) {
    removeDoc(deleteTarget.value.id)
    toast.success(`${props.docType} deleted`)
    showDeleteDialog.value = false
    showDetail.value = false
  }
}

function handleReset() {
  resetDocs()
  toast.success('Data reset to defaults')
}

function handleDownload(doc: SalesDocument) {
  downloadPDF(doc, props.docType)
}

// ── Formatters ─────────────────────────────────────
function fmt(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(n)
}

function fmtDate(d: string) {
  if (!d)
    return '—'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function getInitials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

const badgeClasses: Record<string, string> = {
  Draft: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  Sent: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  Accepted: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  Rejected: 'bg-rose-500/10 text-rose-600 border-rose-500/20',
  Expired: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  Paid: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  Overdue: 'bg-rose-500/10 text-rose-600 border-rose-500/20',
  Cancelled: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  Pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  Processing: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  Shipped: 'bg-violet-500/10 text-violet-600 border-violet-500/20',
  Delivered: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
}

function getAvatarColor(name: string) {
  const colors = [
    'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    'bg-pink-500/15 text-pink-600 dark:text-pink-400',
    'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  ]
  return colors[name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length]
}

// Preview HTML
const previewHtml = computed(() => {
  if (!selectedDoc.value)
    return ''
  return generatePDF(selectedDoc.value, props.docType)
})
</script>

<template>
  <div class="w-full flex flex-col gap-4">
    <!-- Summary Stats -->
    <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Card>
        <CardContent class="flex items-center gap-3 p-4">
          <div class="flex items-center justify-center rounded-lg bg-primary/10 p-2">
            <Icon :name="icon" class="size-4 text-primary" />
          </div>
          <div>
            <p class="text-2xl font-bold tabular-nums">
              {{ summaryStats.count }}
            </p>
            <p class="text-xs text-muted-foreground">
              Total {{ title }}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="flex items-center gap-3 p-4">
          <div class="flex items-center justify-center rounded-lg bg-emerald-500/10 p-2">
            <Icon name="i-lucide-dollar-sign" class="size-4 text-emerald-500" />
          </div>
          <div>
            <p class="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {{ fmt(summaryStats.totalAmount) }}
            </p>
            <p class="text-xs text-muted-foreground">
              Total Amount
            </p>
          </div>
        </CardContent>
      </Card>
      <Card v-for="(status, idx) in statusOptions.slice(0, 2)" :key="status.value">
        <CardContent class="flex items-center gap-3 p-4">
          <div class="flex items-center justify-center rounded-lg p-2" :class="idx === 0 ? 'bg-blue-500/10' : 'bg-amber-500/10'">
            <Icon :name="idx === 0 ? 'i-lucide-send' : 'i-lucide-clock'" :class="idx === 0 ? 'size-4 text-blue-500' : 'size-4 text-amber-500'" />
          </div>
          <div>
            <p class="text-2xl font-bold tabular-nums">
              {{ summaryStats.statusCounts[status.value] || 0 }}
            </p>
            <p class="text-xs text-muted-foreground">
              {{ status.label }}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Toolbar -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <div class="relative">
          <Icon name="i-lucide-search" class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input v-model="search" placeholder="Search by number, client..." class="pl-8 w-60" />
        </div>
        <Select v-model="statusFilter">
          <SelectTrigger class="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              All Status
            </SelectItem>
            <SelectItem v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="handleReset">
          <Icon name="i-lucide-rotate-ccw" class="mr-1 size-4" />
          Reset
        </Button>
        <Button size="sm" @click="openCreate">
          <Icon name="i-lucide-plus" class="mr-1 size-4" />
          New {{ docType }}
        </Button>
      </div>
    </div>

    <!-- Table -->
    <Card v-if="isLoaded">
      <div class="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{{ docType }} #</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead class="text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="item in paginatedItems" :key="item.id" class="group cursor-pointer" @click="openDetail(item)">
              <TableCell class="font-mono text-sm font-semibold">
                {{ item.number }}
              </TableCell>
              <TableCell>
                <div class="flex items-center gap-2">
                  <div class="flex items-center justify-center rounded-full size-7 text-[10px] font-bold" :class="getAvatarColor(item.client)">
                    {{ getInitials(item.client) }}
                  </div>
                  <div>
                    <p class="text-sm font-medium">
                      {{ item.client }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ item.clientEmail || '' }}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="secondary" class="text-xs">
                  {{ item.lineItems.length }} items
                </Badge>
              </TableCell>
              <TableCell class="font-semibold tabular-nums">
                {{ fmt(item.total) }}
              </TableCell>
              <TableCell>
                <Badge variant="outline" :class="badgeClasses[item.status] || ''">
                  {{ item.status }}
                </Badge>
              </TableCell>
              <TableCell class="text-muted-foreground text-sm">
                {{ fmtDate(item.date) }}
              </TableCell>
              <TableCell class="text-right">
                <div class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" class="size-7" title="Preview PDF" @click.stop="openPreview(item)">
                    <Icon name="i-lucide-eye" class="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" class="size-7" title="Download PDF" @click.stop="handleDownload(item)">
                    <Icon name="i-lucide-download" class="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" class="size-7" title="Edit" @click.stop="openEdit(item)">
                    <Icon name="i-lucide-pencil" class="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" class="size-7 text-destructive" title="Delete" @click.stop="confirmDelete(item)">
                    <Icon name="i-lucide-trash-2" class="size-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
            <TableRow v-if="paginatedItems.length === 0">
              <TableCell :colspan="7" class="text-center py-12 text-muted-foreground">
                <Icon name="i-lucide-inbox" class="size-8 mx-auto mb-2 opacity-40" />
                <p>No {{ docType.toLowerCase() }}s found</p>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex items-center justify-between px-4 py-3 border-t">
        <p class="text-xs text-muted-foreground">
          {{ filteredItems.length }} result{{ filteredItems.length === 1 ? '' : 's' }}
        </p>
        <div class="flex items-center gap-1">
          <Button variant="outline" size="icon" class="size-7" :disabled="currentPage <= 1" @click="currentPage--">
            <Icon name="i-lucide-chevron-left" class="size-3.5" />
          </Button>
          <span class="text-xs px-2 tabular-nums">{{ currentPage }} / {{ totalPages }}</span>
          <Button variant="outline" size="icon" class="size-7" :disabled="currentPage >= totalPages" @click="currentPage++">
            <Icon name="i-lucide-chevron-right" class="size-3.5" />
          </Button>
        </div>
      </div>
    </Card>

    <!-- ─── CREATE/EDIT SHEET ─────────────────────────── -->
    <Sheet v-model:open="showForm">
      <SheetContent side="right" class="sm:max-w-2xl w-full overflow-y-auto p-0">
        <SheetHeader class="px-6 pt-6 pb-4 border-b">
          <SheetTitle>{{ isEditing ? 'Edit' : 'New' }} {{ docType }}</SheetTitle>
          <SheetDescription>{{ isEditing ? 'Update' : 'Fill in' }} the details and add line items below.</SheetDescription>
        </SheetHeader>

        <div class="space-y-6 px-6 py-6">
          <!-- Basic Info -->
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <Label>{{ docType }} Number</Label>
              <Input v-model="formData.number" placeholder="QT-2026-001" />
            </div>
            <div class="space-y-1.5">
              <Label>Date</Label>
              <Input v-model="formData.date" type="date" />
            </div>
            <div class="space-y-1.5 col-span-2">
              <Label>Client Name *</Label>
              <Input v-model="formData.client" placeholder="TechVision Inc" />
            </div>
            <div class="space-y-1.5">
              <Label>Client Email</Label>
              <Input v-model="formData.clientEmail" type="email" placeholder="contact@client.com" />
            </div>
            <div class="space-y-1.5">
              <Label>Status</Label>
              <Select v-model="formData.status">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1.5 col-span-2">
              <Label>Client Address</Label>
              <Input v-model="formData.clientAddress" placeholder="123 Business Ave, Suite 200, New York, NY 10001" />
            </div>
            <!-- Extra fields (validUntil, dueDate, tracking, etc.) -->
            <template v-if="extraFields">
              <div v-for="field in extraFields" :key="field.key" class="space-y-1.5">
                <Label>{{ field.label }}</Label>
                <Input v-model="formData[field.key]" :type="field.type || 'text'" :placeholder="field.placeholder" />
              </div>
            </template>
          </div>

          <!-- Line Items -->
          <div>
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-sm font-semibold">
                Line Items
              </h3>
              <Button variant="outline" size="sm" @click="addLineItem">
                <Icon name="i-lucide-plus" class="mr-1 size-3.5" />
                Add Item
              </Button>
            </div>

            <div class="rounded-lg border overflow-hidden">
              <!-- Header -->
              <div class="grid grid-cols-[1fr_70px_100px_65px_60px_40px] gap-2 px-3 py-2 bg-muted/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                <span>Description</span>
                <span class="text-center">
                  Qty
                </span>
                <span class="text-right">
                  Unit Price
                </span>
                <span class="text-center">
                  Disc. %
                </span>
                <span class="text-center">
                  Tax %
                </span>
                <span />
              </div>

              <!-- Rows -->
              <div v-for="(li, idx) in editingLineItems" :key="li.id" class="grid grid-cols-[1fr_70px_100px_65px_60px_40px] gap-2 px-3 py-2 items-center border-t" :class="{ 'bg-muted/10': idx % 2 === 0 }">
                <Input v-model="li.description" placeholder="Product or service..." class="h-8 text-sm" />
                <Input v-model.number="li.quantity" type="number" min="1" class="h-8 text-sm text-center" />
                <Input v-model.number="li.unitPrice" type="number" min="0" step="0.01" class="h-8 text-sm text-right" />
                <Input v-model.number="li.discount" type="number" min="0" max="100" class="h-8 text-sm text-center" />
                <Input v-model.number="li.tax" type="number" min="0" max="100" class="h-8 text-sm text-center" />
                <Button variant="ghost" size="icon" class="size-7 text-destructive/60 hover:text-destructive" @click="removeLineItem(li.id)">
                  <Icon name="i-lucide-x" class="size-3.5" />
                </Button>
              </div>
            </div>

            <!-- Running totals -->
            <div class="flex justify-end mt-3">
              <div class="w-64 space-y-1 text-sm">
                <div class="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span class="tabular-nums font-medium">{{ fmt(editingTotals.subtotal) }}</span>
                </div>
                <div class="flex justify-between text-muted-foreground">
                  <span>Discount</span>
                  <span class="tabular-nums text-rose-500">-{{ fmt(editingTotals.discountTotal) }}</span>
                </div>
                <div class="flex justify-between text-muted-foreground">
                  <span>Tax</span>
                  <span class="tabular-nums">{{ fmt(editingTotals.taxTotal) }}</span>
                </div>
                <Separator />
                <div class="flex justify-between font-bold text-base pt-1">
                  <span>Total</span>
                  <span class="tabular-nums">{{ fmt(editingTotals.total) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Notes -->
          <div class="space-y-1.5">
            <Label>Notes / Terms</Label>
            <Textarea v-model="formData.notes" placeholder="Payment terms, additional notes..." :rows="3" />
          </div>
        </div>

        <SheetFooter class="gap-2 px-6 py-4 border-t">
          <Button variant="outline" @click="showForm = false">
            Cancel
          </Button>
          <Button @click="handleSave">
            <Icon name="i-lucide-check" class="mr-1 size-4" />
            {{ isEditing ? 'Update' : 'Create' }} {{ docType }}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>

    <!-- ─── DETAIL DIALOG ─────────────────────────────── -->
    <Dialog v-model:open="showDetail">
      <DialogContent class="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Icon :name="icon" class="size-5 text-primary" />
            {{ selectedDoc?.number }}
          </DialogTitle>
          <DialogDescription>{{ docType }} Details</DialogDescription>
        </DialogHeader>

        <div v-if="selectedDoc" class="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          <!-- Header row -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="flex items-center justify-center rounded-full size-10 text-sm font-bold" :class="getAvatarColor(selectedDoc.client)">
                {{ getInitials(selectedDoc.client) }}
              </div>
              <div>
                <p class="font-semibold">
                  {{ selectedDoc.client }}
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ selectedDoc.clientEmail || 'No email' }}
                </p>
              </div>
            </div>
            <Badge variant="outline" :class="badgeClasses[selectedDoc.status]">
              {{ selectedDoc.status }}
            </Badge>
          </div>

          <!-- Metadata -->
          <div class="grid grid-cols-3 gap-3">
            <div class="rounded-lg border p-3 space-y-0.5">
              <p class="text-[10px] text-muted-foreground uppercase tracking-wider">
                Date
              </p>
              <p class="text-sm font-medium">
                {{ fmtDate(selectedDoc.date) }}
              </p>
            </div>
            <div class="rounded-lg border p-3 space-y-0.5">
              <p class="text-[10px] text-muted-foreground uppercase tracking-wider">
                Items
              </p>
              <p class="text-sm font-medium">
                {{ selectedDoc.lineItems.length }}
              </p>
            </div>
            <div class="rounded-lg border p-3 space-y-0.5">
              <p class="text-[10px] text-muted-foreground uppercase tracking-wider">
                Total
              </p>
              <p class="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                {{ fmt(selectedDoc.total) }}
              </p>
            </div>
          </div>

          <!-- Line Items Table -->
          <div>
            <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Line Items
            </h4>
            <div class="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/30">
                    <TableHead class="text-xs">
                      Description
                    </TableHead>
                    <TableHead class="text-xs text-center">
                      Qty
                    </TableHead>
                    <TableHead class="text-xs text-right">
                      Price
                    </TableHead>
                    <TableHead class="text-xs text-right">
                      Total
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="li in selectedDoc.lineItems" :key="li.id">
                    <TableCell class="text-sm font-medium">
                      {{ li.description }}
                    </TableCell>
                    <TableCell class="text-sm text-center tabular-nums">
                      {{ li.quantity }}
                    </TableCell>
                    <TableCell class="text-sm text-right tabular-nums">
                      {{ fmt(li.unitPrice) }}
                    </TableCell>
                    <TableCell class="text-sm text-right tabular-nums font-semibold">
                      {{ fmt(calcLineTotal(li)) }}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>

          <!-- Totals -->
          <div class="flex justify-end">
            <div class="w-64 space-y-1.5 text-sm">
              <div class="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span class="tabular-nums">{{ fmt(selectedDoc.subtotal) }}</span>
              </div>
              <div v-if="selectedDoc.discountTotal > 0" class="flex justify-between text-muted-foreground">
                <span>Discount</span>
                <span class="tabular-nums text-rose-500">-{{ fmt(selectedDoc.discountTotal) }}</span>
              </div>
              <div v-if="selectedDoc.taxTotal > 0" class="flex justify-between text-muted-foreground">
                <span>Tax</span>
                <span class="tabular-nums">{{ fmt(selectedDoc.taxTotal) }}</span>
              </div>
              <Separator />
              <div class="flex justify-between font-bold text-base">
                <span>Total</span>
                <span class="tabular-nums">{{ fmt(selectedDoc.total) }}</span>
              </div>
            </div>
          </div>

          <!-- Notes -->
          <div v-if="selectedDoc.notes" class="rounded-lg bg-muted/30 border p-3">
            <p class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              Notes
            </p>
            <p class="text-sm text-muted-foreground">
              {{ selectedDoc.notes }}
            </p>
          </div>
        </div>

        <DialogFooter class="gap-2 flex-wrap">
          <Button variant="outline" size="sm" @click="openPreview(selectedDoc!)">
            <Icon name="i-lucide-eye" class="mr-1 size-4" />
            Preview
          </Button>
          <Button variant="outline" size="sm" @click="handleDownload(selectedDoc!)">
            <Icon name="i-lucide-download" class="mr-1 size-4" />
            Download PDF
          </Button>
          <Button variant="outline" size="sm" @click="showDetail = false; openEdit(selectedDoc!)">
            <Icon name="i-lucide-pencil" class="mr-1 size-4" />
            Edit
          </Button>
          <Button variant="destructive" size="sm" @click="confirmDelete(selectedDoc!)">
            <Icon name="i-lucide-trash-2" class="mr-1 size-4" />
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- ─── PDF PREVIEW DIALOG ────────────────────────── -->
    <Dialog v-model:open="showPreview">
      <DialogContent class="sm:max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Icon name="i-lucide-file-text" class="size-5 text-primary" />
            {{ docType }} Preview — {{ selectedDoc?.number }}
          </DialogTitle>
          <DialogDescription>Print-ready preview of the document</DialogDescription>
        </DialogHeader>
        <div class="border rounded-lg overflow-hidden bg-white">
          <iframe
            :srcdoc="previewHtml"
            class="w-full h-[60vh] border-0"
            title="PDF Preview"
          />
        </div>
        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showPreview = false">
            Close
          </Button>
          <Button @click="handleDownload(selectedDoc!)">
            <Icon name="i-lucide-printer" class="mr-1 size-4" />
            Print / Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- ─── DELETE DIALOG ─────────────────────────────── -->
    <AlertDialog v-model:open="showDeleteDialog">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {{ docType }}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete <strong>{{ deleteTarget?.number }}</strong>.
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction class="bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="handleDelete">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
