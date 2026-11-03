<script setup lang="ts">
import type { CrudColumn, CrudFormField } from '~/composables/useCrud'
import { toast } from 'vue-sonner'

const props = defineProps<{
  storeKey: string
  title: string
  description: string
  icon: string
  entityName?: string
  columns: CrudColumn[]
  formFields: CrudFormField[]
  initialData: Record<string, any>[]
}>()

const entity = computed(() => props.entityName || 'Record')
const { items, isLoaded, create, update, remove, reset } = useCrud(props.storeKey, props.initialData)

const { setHeader } = usePageHeader()
setHeader({ title: props.title, description: props.description, icon: props.icon })

// UI State
const search = ref('')
// Rows load in batches as you scroll (no previous / next pages)
const BATCH = 50
const shownCount = ref(BATCH)
const loadMoreTrigger = ref<HTMLElement | null>(null)
const showDialog = ref(false)
const showDeleteDialog = ref(false)
const editingItem = ref<any>(null)
const deletingItem = ref<any>(null)
const formData = ref<Record<string, any>>({})

// Computed
const filteredItems = computed(() => {
  if (!search.value)
    return items.value
  const q = search.value.toLowerCase()
  return items.value.filter((item: any) =>
    props.columns.some(col =>
      String(item[col.key] ?? '').toLowerCase().includes(q),
    ),
  )
})

const paginatedItems = computed(() => filteredItems.value.slice(0, shownCount.value))
const hasMore = computed(() => shownCount.value < filteredItems.value.length)
function loadMore() { if (hasMore.value) shownCount.value += BATCH }
useIntersectionObserver(loadMoreTrigger, (entries) => { if (entries.some(e => e.isIntersecting)) loadMore() }, { rootMargin: '0px 0px 300px 0px' })

watch(search, () => { shownCount.value = BATCH })

// CRUD Handlers
function openCreate() {
  editingItem.value = null
  formData.value = {}
  props.formFields.forEach((f) => {
    formData.value[f.key] = ''
  })
  showDialog.value = true
}

function openEdit(item: any) {
  editingItem.value = item
  formData.value = { ...item }
  showDialog.value = true
}

function handleSave() {
  if (editingItem.value) {
    update(editingItem.value.id, formData.value)
    toast.success(`${entity.value} updated successfully`)
  }
  else {
    create(formData.value)
    toast.success(`${entity.value} created successfully`)
  }
  showDialog.value = false
}

function confirmDelete(item: any) {
  deletingItem.value = item
  showDeleteDialog.value = true
}

function handleDelete() {
  if (deletingItem.value) {
    remove(deletingItem.value.id)
    toast.success(`${entity.value} deleted successfully`)
  }
  showDeleteDialog.value = false
  deletingItem.value = null
}

function handleReset() {
  reset()
  shownCount.value = BATCH
  search.value = ''
  toast.info('Data has been reset to defaults')
}

// Formatters
const badgeClasses: Record<string, string> = {
  'Active': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Completed': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Paid': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Won': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Closed Won': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Delivered': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'In Stock': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Resolved': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Approved': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Accepted': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Published': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Present': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Processed': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Closed': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Shipped': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  'VIP': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  'Pending': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  'Processing': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  'Low Stock': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  'Under Review': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  'In Transit': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  'Partial': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  'Draft': 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  'In Progress': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  'On Hold': 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  'Overdue': 'bg-red-500/10 text-red-600 border-red-500/20',
  'Cancelled': 'bg-red-500/10 text-red-600 border-red-500/20',
  'Lost': 'bg-red-500/10 text-red-600 border-red-500/20',
  'Closed Lost': 'bg-red-500/10 text-red-600 border-red-500/20',
  'Rejected': 'bg-red-500/10 text-red-600 border-red-500/20',
  'Inactive': 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  'Out of Stock': 'bg-red-500/10 text-red-600 border-red-500/20',
  'Expired': 'bg-red-500/10 text-red-600 border-red-500/20',
  'Absent': 'bg-red-500/10 text-red-600 border-red-500/20',
  'New': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  'Contacted': 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
  'Qualified': 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  'Proposal': 'bg-violet-500/10 text-violet-600 border-violet-500/20',
  'Negotiation': 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  'Discovery': 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
  'Lead': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  'Prospect': 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
  'Sent': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  'Open': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  'Call': 'bg-green-500/10 text-green-600 border-green-500/20',
  'Email': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  'Meeting': 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  'Note': 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  'Task': 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  'High': 'bg-red-500/10 text-red-600 border-red-500/20',
  'Medium': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  'Low': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  'Critical': 'bg-red-500/10 text-red-600 border-red-500/20',
  'Urgent': 'bg-red-500/10 text-red-600 border-red-500/20',
  'Annual': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  'Sick': 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  'Personal': 'bg-violet-500/10 text-violet-600 border-violet-500/20',
  'Maternity': 'bg-pink-500/10 text-pink-600 border-pink-500/20',
  'Revenue': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Expense': 'bg-red-500/10 text-red-600 border-red-500/20',
  'Asset': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  'Liability': 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  'Equity': 'bg-violet-500/10 text-violet-600 border-violet-500/20',
  'Credit': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Debit': 'bg-red-500/10 text-red-600 border-red-500/20',
  'Billable': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Non-Billable': 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  'At Risk': 'bg-red-500/10 text-red-600 border-red-500/20',
  'On Track': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Late': 'bg-red-500/10 text-red-600 border-red-500/20',
  'Beta': 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  'Running': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  'Paused': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  'Scheduled': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
}

function getBadgeClass(value: string): string {
  return badgeClasses[value] || 'bg-gray-500/10 text-gray-600 border-gray-500/20'
}

function formatCurrency(value: any): string {
  if (value === null || value === undefined)
    return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value))
}

function formatDate(value: string): string {
  if (!value)
    return '—'
  try {
    return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }
  catch { return value }
}

function formatNumber(value: any): string {
  if (value === null || value === undefined)
    return '—'
  return new Intl.NumberFormat('en-US').format(Number(value))
}
</script>

<template>
  <div class="w-full flex flex-col gap-6">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="relative flex-1 max-w-sm">
        <Icon name="i-lucide-search" class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input v-model="search" placeholder="Search records..." class="pl-9" />
      </div>
      <div class="flex items-center gap-2">
        <p class="text-sm text-muted-foreground tabular-nums hidden sm:block">
          {{ filteredItems.length }} record{{ filteredItems.length !== 1 ? 's' : '' }}
        </p>
        <Button variant="ghost" size="sm" @click="handleReset">
          <Icon name="i-lucide-rotate-ccw" class="mr-1 size-4" />
          Reset
        </Button>
        <Button size="sm" @click="openCreate">
          <Icon name="i-lucide-plus" class="mr-1 size-4" />
          Add {{ entity }}
        </Button>
      </div>
    </div>

    <!-- Table -->
    <Card v-if="isLoaded">
      <div class="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead v-for="col in columns" :key="col.key">
                {{ col.label }}
              </TableHead>
              <TableHead class="w-[80px] text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="item in paginatedItems" :key="item.id" class="group">
              <TableCell v-for="col in columns" :key="col.key">
                <!-- Name (no avatar in tables) -->
                <span v-if="col.type === 'avatar'" class="font-medium">{{ item[col.key] }}</span>
                <!-- Badge -->
                <Badge v-else-if="col.type === 'badge'" variant="outline" :class="getBadgeClass(item[col.key])">
                  {{ item[col.key] || '—' }}
                </Badge>
                <!-- Currency -->
                <span v-else-if="col.type === 'currency'" class="font-medium tabular-nums">
                  {{ formatCurrency(item[col.key]) }}
                </span>
                <!-- Date -->
                <span v-else-if="col.type === 'date'" class="text-muted-foreground">
                  {{ formatDate(item[col.key]) }}
                </span>
                <!-- Email -->
                <span v-else-if="col.type === 'email'" class="text-muted-foreground">
                  {{ item[col.key] || '—' }}
                </span>
                <!-- Number -->
                <span v-else-if="col.type === 'number'" class="tabular-nums">
                  {{ formatNumber(item[col.key]) }}
                </span>
                <!-- Progress -->
                <div v-else-if="col.type === 'progress'" class="flex items-center gap-2">
                  <Progress :model-value="Number(item[col.key])" class="h-2 w-20" />
                  <span class="text-sm tabular-nums text-muted-foreground">{{ item[col.key] }}%</span>
                </div>
                <!-- Tags -->
                <div v-else-if="col.type === 'tags'" class="flex flex-wrap gap-1">
                  <Badge v-for="tag in (item[col.key] || [])" :key="tag" variant="secondary" class="text-xs font-normal">
                    {{ tag }}
                  </Badge>
                </div>
                <!-- Default text -->
                <span v-else>{{ item[col.key] ?? '—' }}</span>
              </TableCell>
              <TableCell class="text-right">
                <div class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" class="size-8" @click="openEdit(item)">
                    <Icon name="i-lucide-pencil" class="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" class="size-8 text-destructive hover:text-destructive" @click="confirmDelete(item)">
                    <Icon name="i-lucide-trash-2" class="size-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
            <TableRow v-if="paginatedItems.length === 0">
              <TableCell :colspan="columns.length + 1" class="h-32 text-center">
                <div class="flex flex-col items-center gap-2 text-muted-foreground">
                  <Icon name="i-lucide-inbox" class="size-8" />
                  <p>No records found</p>
                  <Button size="sm" variant="outline" @click="openCreate">
                    <Icon name="i-lucide-plus" class="mr-1 size-4" />
                    Add {{ entity }}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </Card>

    <!-- Skeleton -->
    <Card v-else class="p-8">
      <div class="space-y-4">
        <Skeleton class="h-8 w-full" />
        <Skeleton class="h-8 w-full" />
        <Skeleton class="h-8 w-full" />
        <Skeleton class="h-8 w-3/4" />
      </div>
    </Card>

    <!-- Load more on scroll -->
    <div v-if="isLoaded && filteredItems.length" ref="loadMoreTrigger" class="flex items-center justify-center gap-2 text-xs text-muted-foreground">
      <span class="tabular-nums">Showing {{ paginatedItems.length }} of {{ filteredItems.length }}</span>
      <Button v-if="hasMore" variant="ghost" size="sm" class="h-7 text-xs" @click="loadMore">Load more</Button>
    </div>

    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="showDialog">
      <DialogContent class="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{{ editingItem ? 'Edit' : 'New' }} {{ entity }}</DialogTitle>
          <DialogDescription class="sr-only">
            {{ editingItem ? 'Edit' : 'Create' }} a {{ entity.toLowerCase() }} record
          </DialogDescription>
        </DialogHeader>
        <form class="space-y-4" @submit.prevent="handleSave">
          <div v-for="field in formFields" :key="field.key" class="space-y-2">
            <Label :for="field.key">{{ field.label }}</Label>
            <Select v-if="field.type === 'select'" v-model="formData[field.key]">
              <SelectTrigger>
                <SelectValue :placeholder="field.placeholder || `Select ${field.label.toLowerCase()}`" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="opt in field.options" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              v-else-if="field.type === 'textarea'"
              :id="field.key"
              v-model="formData[field.key]"
              :placeholder="field.placeholder"
              rows="3"
            />
            <Input
              v-else
              :id="field.key"
              v-model="formData[field.key]"
              :type="field.type || 'text'"
              :placeholder="field.placeholder"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" @click="showDialog = false">
              Cancel
            </Button>
            <Button type="submit">
              {{ editingItem ? 'Update' : 'Create' }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Delete Confirmation -->
    <AlertDialog v-model:open="showDeleteDialog">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete this {{ entity.toLowerCase() }} record.
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
