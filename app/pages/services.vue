<script setup lang="ts">
import { Plus, Search, Download, Upload, Pencil, Trash2, Loader2, Sparkles, FileText, LayoutGrid, List } from 'lucide-vue-next'
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
const viewMode = ref<'grid' | 'list'>('grid')

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
})

function openAddForm() {
  editingId.value = null
  Object.assign(formData, { service: '', description: '' })
  showForm.value = true
}

function openEditForm(s: any) {
  editingId.value = s.id
  Object.assign(formData, {
    service: s.service || '',
    description: s.description || '',
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
    const oldData: Service | null = idx >= 0 ? { ...services.value[idx]! } : null

    if (idx >= 0) {
      Object.assign(services.value[idx]!, snapshot)
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
        services.value[tempIdx] = { ...services.value[tempIdx]!, id: res.id }
      }
    }).catch(() => {
      services.value = services.value.filter(s => s.id !== tempId)
      toast.error('Failed to create service — removed')
    })
  }
}

// ─── Color Palette for Cards ────────────────────────────
const cardColors = [
  { bg: 'from-violet-500/10 to-violet-500/5', border: 'border-violet-500/15', icon: 'text-violet-500', dot: 'bg-violet-500', avatar: 'bg-violet-500' },
  { bg: 'from-blue-500/10 to-blue-500/5', border: 'border-blue-500/15', icon: 'text-blue-500', dot: 'bg-blue-500', avatar: 'bg-blue-500' },
  { bg: 'from-emerald-500/10 to-emerald-500/5', border: 'border-emerald-500/15', icon: 'text-emerald-500', dot: 'bg-emerald-500', avatar: 'bg-emerald-500' },
  { bg: 'from-amber-500/10 to-amber-500/5', border: 'border-amber-500/15', icon: 'text-amber-500', dot: 'bg-amber-500', avatar: 'bg-amber-500' },
  { bg: 'from-rose-500/10 to-rose-500/5', border: 'border-rose-500/15', icon: 'text-rose-500', dot: 'bg-rose-500', avatar: 'bg-rose-500' },
  { bg: 'from-cyan-500/10 to-cyan-500/5', border: 'border-cyan-500/15', icon: 'text-cyan-500', dot: 'bg-cyan-500', avatar: 'bg-cyan-500' },
  { bg: 'from-fuchsia-500/10 to-fuchsia-500/5', border: 'border-fuchsia-500/15', icon: 'text-fuchsia-500', dot: 'bg-fuchsia-500', avatar: 'bg-fuchsia-500' },
  { bg: 'from-teal-500/10 to-teal-500/5', border: 'border-teal-500/15', icon: 'text-teal-500', dot: 'bg-teal-500', avatar: 'bg-teal-500' },
]

function getCardColor(index: number) {
  return cardColors[index % cardColors.length]!
}

// Service initial for the avatar
function getInitials(name: string): string {
  return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
}

// ─── Export ─────────────────────────────────────────────
function exportToCsv() {
  const data = filteredList.value
  if (!data.length) {
    toast.error('No services to export')
    return
  }
  const headers = ['Id', 'Service', 'Description']
  const csvContent = [
    headers.join(','),
    ...data.map(s => {
      return [
        `"${s.id || ''}"`,
        `"${(s.service || '').replace(/"/g, '""')}"`,
        `"${(s.description || '').replace(/"/g, '""')}"`,
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
        <div class="flex items-center gap-1.5 sm:gap-2">
          <!-- Mobile search -->
          <div class="relative sm:hidden">
            <Icon name="lucide:search" class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input v-model="searchValue" placeholder="Search..." class="pl-8 w-32 h-8 text-sm" />
          </div>
          <!-- Desktop search -->
          <div class="relative hidden sm:block">
            <Icon name="lucide:search" class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input v-model="searchValue" placeholder="Search services..." class="pl-8 w-40 md:w-56 h-8 text-sm" />
          </div>
          <!-- View toggle -->
          <div class="hidden sm:flex items-center gap-0.5 rounded-md border bg-muted/50 p-0.5">
            <button
              @click="viewMode = 'grid'"
              class="rounded-sm p-1 transition-all"
              :class="viewMode === 'grid' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
            >
              <LayoutGrid class="size-3.5" />
            </button>
            <button
              @click="viewMode = 'list'"
              class="rounded-sm p-1 transition-all"
              :class="viewMode === 'list' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
            >
              <List class="size-3.5" />
            </button>
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

    <!-- Stats Bar -->
    <div class="flex items-center gap-3 mb-3 px-0.5">
      <div class="flex items-center gap-2 text-sm text-muted-foreground">
        <div class="flex items-center justify-center size-7 rounded-lg bg-primary/10">
          <Sparkles class="size-3.5 text-primary" />
        </div>
        <span class="tabular-nums font-medium text-foreground">{{ filteredList.length }}</span>
        <span class="hidden sm:inline">service{{ filteredList.length !== 1 ? 's' : '' }}</span>
        <span class="sm:hidden">total</span>
      </div>
      <span v-if="debouncedSearch" class="text-xs text-muted-foreground">
        filtered from {{ services.length }}
      </span>
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 overflow-auto">

      <!-- Loading -->
      <div v-if="isLoading" class="flex items-center justify-center h-full">
        <div class="flex flex-col items-center gap-3">
          <div class="relative">
            <div class="size-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
              <Loader2 class="size-6 animate-spin text-primary" />
            </div>
          </div>
          <p class="text-sm text-muted-foreground animate-pulse">Loading services...</p>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else-if="filteredList.length === 0" class="flex items-center justify-center h-full">
        <div class="flex flex-col items-center gap-4 max-w-sm text-center px-6">
          <div class="size-16 rounded-2xl bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
            <FileText class="size-8 text-muted-foreground/50" />
          </div>
          <div>
            <h3 class="text-base font-semibold text-foreground mb-1">
              {{ debouncedSearch ? 'No results found' : 'No services yet' }}
            </h3>
            <p class="text-sm text-muted-foreground">
              {{ debouncedSearch
                ? `Try adjusting your search for "${debouncedSearch}"`
                : 'Get started by adding your first service.'
              }}
            </p>
          </div>
          <Button v-if="!debouncedSearch" size="sm" class="gap-2" @click="openAddForm">
            <Plus class="size-4" />
            Add Service
          </Button>
        </div>
      </div>

      <!-- ─── GRID VIEW ──────────────────────────────────────── -->
      <div v-else-if="viewMode === 'grid'" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
        <div
          v-for="(s, i) in filteredList"
          :key="s.id"
          class="group relative rounded-xl border bg-card overflow-hidden transition-all duration-200 hover:shadow-md hover:shadow-black/5 hover:-translate-y-0.5 hover:border-primary/20"
        >
          <!-- Gradient top accent -->
          <div class="h-1 w-full bg-gradient-to-r" :class="getCardColor(i).bg" />

          <div class="p-4">
            <!-- Header: Avatar + Name -->
            <div class="flex items-start justify-between gap-3 mb-3">
              <div class="flex items-center gap-2.5 min-w-0">
                <div
                  class="size-9 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold text-white shadow-sm"
                  :class="getCardColor(i).avatar"
                >
                  {{ getInitials(s.service) }}
                </div>
                <div class="min-w-0">
                  <h3 class="text-sm font-semibold text-foreground leading-tight truncate">
                    {{ s.service }}
                  </h3>
                  <p class="text-[10px] text-muted-foreground/70 mt-0.5 tabular-nums">
                    Added {{ new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }}
                  </p>
                </div>
              </div>

              <!-- Actions (visible on hover for desktop, always visible on mobile) -->
              <div class="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-150">
                <Button variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-foreground" title="Edit" @click="openEditForm(s)">
                  <Pencil class="size-3" />
                </Button>
                <Button variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10" title="Delete" @click="confirmDelete(s.id)">
                  <Trash2 class="size-3" />
                </Button>
              </div>
            </div>

            <!-- Description -->
            <p
              v-if="s.description"
              class="text-xs text-muted-foreground leading-relaxed line-clamp-2"
            >
              {{ s.description }}
            </p>
            <p v-else class="text-xs text-muted-foreground/40 italic">
              No description
            </p>
          </div>
        </div>

        <!-- Add Card -->
        <button
          @click="openAddForm"
          class="group rounded-xl border-2 border-dashed hover:border-primary/30 bg-card/50 hover:bg-primary/5 transition-all duration-200 flex flex-col items-center justify-center min-h-[120px] gap-2 cursor-pointer"
        >
          <div class="size-9 rounded-lg bg-muted/80 group-hover:bg-primary/15 flex items-center justify-center transition-colors">
            <Plus class="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <span class="text-xs font-medium text-muted-foreground group-hover:text-primary transition-colors">Add Service</span>
        </button>
      </div>

      <!-- ─── LIST VIEW ──────────────────────────────────────── -->
      <div v-else class="space-y-2">
        <div
          v-for="(s, i) in filteredList"
          :key="s.id"
          class="group flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3 rounded-xl border bg-card hover:shadow-sm hover:border-primary/20 transition-all duration-200"
        >
          <!-- Color dot -->
          <div class="size-2 rounded-full shrink-0" :class="getCardColor(i).dot" />

          <!-- Content -->
          <div class="flex-1 min-w-0">
            <h3 class="text-sm font-medium text-foreground truncate">{{ s.service }}</h3>
            <p v-if="s.description" class="text-xs text-muted-foreground truncate mt-0.5">{{ s.description }}</p>
          </div>

          <!-- Date (hidden on mobile) -->
          <span class="hidden md:block text-[11px] text-muted-foreground/60 tabular-nums whitespace-nowrap">
            {{ new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}
          </span>

          <!-- Actions -->
          <div class="flex items-center gap-0.5 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-foreground" title="Edit" @click="openEditForm(s)">
              <Pencil class="size-3" />
            </Button>
            <Button variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10" title="Delete" @click="confirmDelete(s.id)">
              <Trash2 class="size-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- Service Form Sidebar -->
    <Sheet v-model:open="showForm">
      <SheetContent side="right" class="sm:max-w-md w-full overflow-y-auto p-0 flex flex-col">
        <SheetHeader class="px-6 py-5 border-b shrink-0 bg-gradient-to-r from-primary/5 to-transparent">
          <div class="flex items-center gap-3">
            <div class="size-10 rounded-xl bg-primary/15 flex items-center justify-center">
              <Icon :name="editingId ? 'i-lucide-pencil' : 'i-lucide-plus'" class="size-5 text-primary" />
            </div>
            <div>
              <SheetTitle class="text-base">{{ editingId ? 'Edit Service' : 'New Service' }}</SheetTitle>
              <SheetDescription class="text-xs">{{ editingId ? 'Update the service details below.' : 'Fill in the details to create a new service.' }}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div class="space-y-5 px-6 py-6 flex-1">
          <div class="space-y-2">
            <Label class="text-xs font-medium">Service Name</Label>
            <Input v-model="formData.service" placeholder="e.g. Interior Cleaning" class="h-10" />
          </div>
          
          <div class="space-y-2">
            <Label class="text-xs font-medium">Description</Label>
            <Textarea v-model="formData.description" placeholder="Full interior detailing, dashboard polish..." class="min-h-[100px] resize-none" />
          </div>
        </div>

        <SheetFooter class="gap-2 px-6 py-4 border-t shrink-0 bg-muted/30">
          <Button variant="outline" @click="showForm = false" class="flex-1 sm:flex-none">Cancel</Button>
          <Button @click="handleSave" class="flex-1 sm:flex-none gap-2">
            <Icon :name="editingId ? 'i-lucide-check' : 'i-lucide-plus'" class="size-4" />
            {{ editingId ? 'Save Changes' : 'Create Service' }}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>

    <!-- Delete Confirmation -->
    <AlertDialog v-model:open="showDeleteDialog">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this service. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="handleDelete" class="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Import Dialog -->
    <ServicesServiceImport v-model:open="showImport" />
  </div>
</template>
