<script setup lang="ts">
import { ref, computed } from 'vue'
import { Plus, Search, Download, Upload } from 'lucide-vue-next'
import { refDebounced } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { cn } from '~/lib/utils'
import { useServices } from '~/composables/useServices'
const { setHeader } = usePageHeader()
setHeader({ title: 'Services', icon: 'i-lucide-briefcase' })

const { services, isLoading } = useServices()

const searchValue = ref('')
const debouncedSearch = refDebounced(searchValue, 250)
const showImport = ref(false)

// Navigation state
const activeTab = ref<'all'>('all')

const navLinks = computed(() => [
  { id: 'all', title: 'All Services', icon: 'lucide:briefcase', count: services.value.length },
])

const activeData = computed(() => {
  return services.value
})

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

const filteredList = computed(() => filterBySearch(activeData.value))

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
  <div class="-m-4 lg:-m-6">
    <TooltipProvider :delay-duration="0">
      <ResizablePanelGroup
        id="service-panel-group"
        direction="horizontal"
        class="h-full max-h-[calc(100dvh-54px-3rem)] items-stretch"
      >

        <!-- Main panel: Table -->
        <ResizablePanel id="service-table-panel" :default-size="100" :min-size="40">
          <div class="h-full flex flex-col">
            <div class="flex items-center px-4 py-2 h-[52px]">
              <h1 class="text-xl font-bold truncate">
                {{ navLinks.find(l => l.id === activeTab)?.title }}
              </h1>
              <div class="ml-auto flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="ghost" size="icon" class="size-8" @click="exportToCsv">
                      <Download class="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Export to CSV</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="ghost" size="icon" class="size-8" @click="showImport = true">
                      <Upload class="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Import Services</TooltipContent>
                </Tooltip>
                <!-- Add new service form left for future implementation -->
              </div>
            </div>

            <Separator />

            <div class="bg-background/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <form @submit.prevent>
                <div class="relative">
                  <Search class="absolute left-2 top-2.5 size-4 text-muted-foreground" />
                  <Input v-model="searchValue" placeholder="Search services..." class="pl-8 bg-background" />
                </div>
              </form>
            </div>

            <ScrollArea class="flex-1">
              <div v-if="isLoading" class="p-8 text-center text-muted-foreground">
                Loading...
              </div>
              <table v-else class="w-full text-sm">
                <thead>
                  <tr class="border-b bg-muted/50">
                    <th class="p-4 text-left font-medium text-muted-foreground w-1/4">
                      Service
                    </th>
                    <th class="p-4 text-left font-medium text-muted-foreground w-1/2">
                      Description
                    </th>
                    <th class="p-4 text-right font-medium text-muted-foreground">
                      Price
                    </th>
                    <th class="p-4 text-right font-medium text-muted-foreground">
                      Tax
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="s in filteredList"
                    :key="s.id"
                    class="border-b transition-colors hover:bg-muted/30"
                  >
                    <td class="p-4 font-medium">
                      {{ s.service }}
                    </td>
                    <td class="p-4 text-muted-foreground text-xs">
                      {{ s.description }}
                    </td>
                    <td class="p-4 text-right tabular-nums">
                      ${{ Number(s.price).toFixed(2) }}
                    </td>
                    <td class="p-4 text-right tabular-nums text-muted-foreground">
                      {{ Number(s.tax).toFixed(2) }}%
                    </td>
                  </tr>
                  <tr v-if="filteredList.length === 0 && !isLoading">
                    <td colspan="4" class="p-8 text-center text-muted-foreground">
                      No services found
                    </td>
                  </tr>
                </tbody>
              </table>
            </ScrollArea>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </TooltipProvider>

    <!-- Dialogs -->
    <ServicesServiceImport v-model:open="showImport" />
  </div>
</template>
