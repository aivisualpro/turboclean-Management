<script setup lang="ts">
import { Plus, Search, Download, Upload, Pencil, Trash2, Loader2 } from 'lucide-vue-next'
import { refDebounced } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useServices } from '~/composables/useServices'

const { setHeader } = usePageHeader()
setHeader({ title: 'Services', icon: 'i-lucide-briefcase' })

const { services, isLoading, fetchServices } = useServices()

// Real-time: toast when AppSheet changes services
useLiveSync('Services', () => fetchServices())

const searchValue = ref('')
const debouncedSearch = refDebounced(searchValue, 250)
const showImport = ref(false)

// Search filter
function filterBySearch(list: any[]) {
  const q = debouncedSearch.value?.trim()?.toLowerCase()
  if (!q) return list
  return list.filter(s =>
    (s.service || '').toLowerCase().includes(q)
    || (s.description || '').toLowerCase().includes(q)
  )
}

const filteredList = computed(() => filterBySearch(services.value))

// ─── CRUD State ─────────────────────────────────────────
const showForm = ref(false)
const showDeleteDialog = ref(false)
const editingId = ref<string | null>(null)

const formData = reactive({
  service: '',
  description: '',
  price: 0,
  tax: 0,
})

function openAddForm() {
  editingId.value = null
  Object.assign(formData, { service: '', description: '', price: 0, tax: 0 })
  showForm.value = true
}

function openEditForm(s: any) {
  editingId.value = s.id
  Object.assign(formData, {
    service: s.service || '',
    description: s.description || '',
    price: s.price || 0,
    tax: s.tax || 0,
  })
  showForm.value = true
}

function confirmDelete(id: string) {
  editingId.value = id
  showDeleteDialog.value = true
}

// ─── Optimistic CRUD ────────────────────────────────────
function handleDelete() {
  if (!editingId.value) return
  const deleteId = editingId.value

  // Optimistic: remove from UI immediately
  const removed = services.value.find(s => s.id === deleteId)
  services.value = services.value.filter(s => s.id !== deleteId)
  showDeleteDialog.value = false
  toast.success('Service deleted successfully')

  // Background API call
  $fetch(`/api/services/${deleteId}`, { method: 'DELETE' }).catch(() => {
    if (removed) services.value.push(removed)
    toast.error('Failed to delete service — restored')
  })
}

function handleSave() {
  if (!formData.service) {
    toast.error('Service name is required')
    return
  }

  const snapshot = { ...formData }

  if (editingId.value) {
    // Optimistic Edit
    const idx = services.value.findIndex(s => s.id === editingId.value)
    const oldData = idx >= 0 ? { ...services.value[idx] } : null

    if (idx >= 0) {
      services.value[idx] = { ...services.value[idx], ...snapshot }
    }
    showForm.value = false
    toast.success('Service updated successfully')

    $fetch(`/api/services/${editingId.value}`, {
      method: 'PUT',
      body: snapshot,
    }).catch(() => {
      if (oldData && idx >= 0) services.value[idx] = oldData
      toast.error('Failed to update service — reverted')
    })
  } else {
    // Optimistic Add
    const tempId = `temp-${Date.now()}`
    const tempService = {
      id: tempId,
      ...snapshot,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    services.value.unshift(tempService as any)
    showForm.value = false
    toast.success('Service created successfully')

    $fetch<{ success: boolean; id: string }>('/api/services', {
      method: 'POST',
      body: snapshot,
    }).then((res) => {
      const tempIdx = services.value.findIndex(s => s.id === tempId)
      if (tempIdx >= 0) {
        services.value[tempIdx] = { ...services.value[tempIdx], id: res.id }
      }
    }).catch(() => {
      services.value = services.value.filter(s => s.id !== tempId)
      toast.error('Failed to create service — removed')
    })
  }
}

// ─── Export ─────────────────────────────────────────────
function exportToCsv() {
  const data = filteredList.value
  if (!data.length) {
    toast.error('No services to export')
    return
  }
  const headers = ['Id', 'Service', 'Description', 'Price', 'Tax']
  const csvContent = [
    headers.join(','),
    ...data.map(s => {
      return [
        `"${s.id || ''}"`,
        `"${(s.service || '').replace(/"/g, '""')}"`,
        `"${(s.description || '').replace(/"/g, '""')}"`,
        `"${s.price}"`,
        `"${s.tax}"`
      ].join(',')
    })
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', 'services_export.csv')
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
</script>

<template>
  <div class="absolute inset-0 flex flex-col overflow-hidden">

    <ClientOnly>
      <Teleport to="#page-header-actions">
        <div class="flex items-center gap-2">
          <div class="relative hidden sm:block">
            <Icon name="lucide:search" class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input v-model="searchValue" placeholder="Search services..." class="pl-8 w-40 md:w-56 h-8 text-sm" />
          </div>
          <Button variant="outline" size="sm" class="h-8 gap-2" @click="exportToCsv">
            <Download class="size-4" />
            <span class="hidden lg:inline">Export</span>
          </Button>
          <Button variant="outline" size="sm" class="h-8 gap-2" @click="showImport = true">
            <Upload class="size-4" />
            <span class="hidden lg:inline">Import</span>
          </Button>
          <Button size="sm" class="h-8 gap-2" @click="openAddForm">
            <Plus class="size-4" />
            <span class="hidden lg:inline">New Service</span>
          </Button>
        </div>
      </Teleport>
    </ClientOnly>

    <div class="flex-1 min-h-0 rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
      <div class="h-full overflow-auto">
        <table class="w-full text-sm caption-bottom border-collapse">
          <TableHeader class="sticky top-0 z-10 bg-muted/95 backdrop-blur shadow-sm">
            <TableRow>
              <TableHead class="w-1/4">Service</TableHead>
              <TableHead class="w-1/2">Description</TableHead>
              <TableHead class="text-right">Price</TableHead>
              <TableHead class="text-right">Tax</TableHead>
              <TableHead class="text-right w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="s in filteredList" :key="s.id" class="hover:bg-muted/50">
              <TableCell class="font-medium text-xs">{{ s.service }}</TableCell>
              <TableCell class="text-xs text-muted-foreground">{{ s.description }}</TableCell>
              <TableCell class="text-right text-xs tabular-nums">${{ Number(s.price).toFixed(2) }}</TableCell>
              <TableCell class="text-right text-xs tabular-nums text-muted-foreground">{{ Number(s.tax).toFixed(2) }}%</TableCell>
              <TableCell class="text-right">
                <div class="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="icon" class="size-7" title="Edit" @click="openEditForm(s)">
                    <Pencil class="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" class="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive" title="Delete" @click="confirmDelete(s.id)">
                    <Trash2 class="size-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
            <TableRow v-if="isLoading">
              <TableCell :colspan="5" class="text-center py-10">
                <Loader2 class="size-6 animate-spin text-muted-foreground mx-auto" />
              </TableCell>
            </TableRow>
            <TableRow v-if="!isLoading && filteredList.length === 0">
              <TableCell :colspan="5" class="text-center py-10 text-muted-foreground">
                No services found.
              </TableCell>
            </TableRow>
          </TableBody>
        </table>
      </div>
    </div>

    <!-- Service Form Sidebar -->
    <Sheet v-model:open="showForm">
      <SheetContent side="right" class="sm:max-w-md w-full overflow-y-auto p-0 flex flex-col">
        <SheetHeader class="px-6 py-4 border-b shrink-0">
          <SheetTitle>{{ editingId ? 'Edit Service' : 'Add Service' }}</SheetTitle>
          <SheetDescription>Enter service details.</SheetDescription>
        </SheetHeader>

        <div class="space-y-4 px-6 py-6 flex-1">
          <div class="space-y-1.5">
            <Label>Service Name</Label>
            <Input v-model="formData.service" placeholder="Interior Cleaning" />
          </div>
          
          <div class="space-y-1.5">
            <Label>Description</Label>
            <Input v-model="formData.description" placeholder="Full interior detailing..." />
          </div>
          
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <Label>Price ($)</Label>
              <Input v-model.number="formData.price" type="number" step="0.01" min="0" placeholder="0.00" />
            </div>
            <div class="space-y-1.5">
              <Label>Tax (%)</Label>
              <Input v-model.number="formData.tax" type="number" step="0.01" min="0" placeholder="0.00" />
            </div>
          </div>
        </div>

        <SheetFooter class="gap-2 px-6 py-4 border-t shrink-0">
          <Button variant="outline" @click="showForm = false">Cancel</Button>
          <Button @click="handleSave">Save Service</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>

    <!-- Delete Confirmation -->
    <AlertDialog v-model:open="showDeleteDialog">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this service from the <code class="bg-muted px-1 rounded">turboCleanServices</code> collection.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="handleDelete" class="bg-destructive text-destructive-foreground hover:bg-destructive/90">Continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Import Dialog -->
    <ServicesServiceImport v-model:open="showImport" />
  </div>
</template>
