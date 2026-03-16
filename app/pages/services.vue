<script setup lang="ts">
import { ref, computed } from 'vue'
import { Plus, Search, Download, Upload, Loader2, Briefcase } from 'lucide-vue-next'
import { refDebounced } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { cn } from '~/lib/utils'
import { useServices } from '~/composables/useServices'

const { setHeader } = usePageHeader()
setHeader({ title: 'Services', icon: 'i-lucide-briefcase' })

const { services, isLoading, fetchServices } = useServices()

// Real-time: auto-refresh when AppSheet changes services
useLiveSync('Services', () => fetchServices())

const searchValue = ref('')
const debouncedSearch = refDebounced(searchValue, 250)
const showImport = ref(false)

// Navigation state
const activeTab = ref<'all'>('all')

// Search filter
function filterBySearch(list: any[]) {
  const q = debouncedSearch.value?.trim()?.toLowerCase()
  if (!q)
    return list
  return list.filter(s =>
    (s.service || '').toLowerCase().includes(q)
    || (s.description || '').toLowerCase().includes(q)
  )
}

const filteredList = computed(() => filterBySearch(services.value))

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
          <Button size="sm" class="h-8 gap-2">
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
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="s in filteredList" :key="s.id" class="cursor-pointer hover:bg-muted/50">
              <TableCell class="font-medium text-xs">{{ s.service }}</TableCell>
              <TableCell class="text-xs text-muted-foreground">{{ s.description }}</TableCell>
              <TableCell class="text-right text-xs tabular-nums">${{ Number(s.price).toFixed(2) }}</TableCell>
              <TableCell class="text-right text-xs tabular-nums text-muted-foreground">{{ Number(s.tax).toFixed(2) }}%</TableCell>
            </TableRow>
            <TableRow v-if="isLoading">
              <TableCell :colspan="4" class="text-center py-10">
                <Loader2 class="size-6 animate-spin text-muted-foreground mx-auto" />
              </TableCell>
            </TableRow>
            <TableRow v-if="!isLoading && filteredList.length === 0">
              <TableCell :colspan="4" class="text-center py-10 text-muted-foreground">
                No services found.
              </TableCell>
            </TableRow>
          </TableBody>
        </table>
      </div>
    </div>

    <!-- Dialogs -->
    <ServicesServiceImport v-model:open="showImport" />
  </div>
</template>
