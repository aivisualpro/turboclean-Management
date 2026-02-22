<script setup lang="ts">
import type { Dealer, DealerStatus } from '~/composables/useDealers'
import { Plus, Search, Download, Upload, FileDown, FileUp, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'

const { setHeader } = usePageHeader()
setHeader({ title: 'Dealers', icon: 'i-lucide-building-2' })

const { dealers, authorised, pending, rejected, updateDealer, deleteDealer, deleteAllDealerServices } = useDealers()

const selectedDealer = ref<string | undefined>()
const searchValue = ref('')
const debouncedSearch = refDebounced(searchValue, 250)

const showForm = ref(false)
const showImportServices = ref(false)
const showImportDealers = ref(false)
const editingDealer = ref<Dealer | null>(null)

// Navigation state (sidebar removed)
const activeData = computed(() => dealers.value)

// Search filter
function filterBySearch(list: Dealer[]) {
  const q = debouncedSearch.value?.trim()?.toLowerCase()
  if (!q)
    return list
  return list.filter(d =>
    d.dealerName.toLowerCase().includes(q)
    || d.address.toLowerCase().includes(q)
    || d.contacts.some(c =>
      c.name.toLowerCase().includes(q)
      || c.emails.some(e => e.toLowerCase().includes(q))
      || c.phones.some(p => p.number.includes(q)),
    ),
  )
}

const filteredList = computed(() => filterBySearch(activeData.value))
const selectedDealerData = computed(() => dealers.value.find(d => d.id === selectedDealer.value))

const displayLimit = ref(50)
const displayList = computed(() => filteredList.value.slice(0, displayLimit.value))

watch(debouncedSearch, () => {
  displayLimit.value = 50
})

const loadMoreTrigger = ref<HTMLElement | null>(null)
import { useIntersectionObserver } from '@vueuse/core'
useIntersectionObserver(
  loadMoreTrigger,
  ([entry]) => {
    if (entry?.isIntersecting && displayLimit.value < filteredList.value.length) {
      displayLimit.value += 50
    }
  },
  { rootMargin: '100px' }
)

function handleEdit(dealer: Dealer) {
  editingDealer.value = dealer
  showForm.value = true
}

function handleDelete(id: string) {
  deleteDealer(id)
  selectedDealer.value = undefined
  toast.success('Dealer deleted')
}

function handleStatusChange(id: string, status: DealerStatus) {
  updateDealer(id, { status })
  toast.success(`Status updated to ${status}`)
}

function openAddForm() {
  editingDealer.value = null
  showForm.value = true
}

function exportToCsv() {
  const data = filteredList.value
  if (!data.length) {
    toast.error('No dealers to export')
    return
  }
  const headers = ['Id', 'Dealer Name', 'Address', 'Primary Contact', 'Phone', 'Email', 'Status']
  const csvContent = [
    headers.join(','),
    ...data.map(d => {
      const contactName = d.contacts.length ? (d.contacts[0]?.name || '') : ''
      const phone = (d.contacts.length && d.contacts[0]?.phones?.length) ? (d.contacts[0]?.phones[0]?.number || '') : ''
      const email = (d.contacts.length && d.contacts[0]?.emails?.length) ? (d.contacts[0]?.emails[0] || '') : ''
      return [
        `"${d.id || ''}"`,
        `"${(d.dealerName || '').replace(/"/g, '""')}"`,
        `"${(d.address || '').replace(/"/g, '""')}"`,
        `"${contactName.replace(/"/g, '""')}"`,
        `"${phone}"`,
        `"${email.replace(/"/g, '""')}"`,
        `"${d.status || ''}"`
      ].join(',')
    })
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', 'dealers_export.csv')
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function exportServicesToCsv() {
  const data = filteredList.value
  
  const exportData: any[] = []
  for (const d of data) {
    if (d.services && Array.isArray(d.services)) {
      for (const s of d.services) {
        exportData.push({
          dealerId: d.id,
          dealerServiceId: s.id,
          dealerName: d.dealerName,
          service: s.service,
          amount: s.amount,
          tax: s.tax,
          total: s.total
        })
      }
    }
  }

  if (!exportData.length) {
    toast.error('No services to export')
    return
  }

  const headers = ['Dealer ID', 'Dealer Service ID', 'Dealer Name', 'Service', 'Amount', 'Tax', 'Total']
  const csvContent = [
    headers.join(','),
    ...exportData.map(row => {
      return [
        `"${row.dealerId || ''}"`,
        `"${row.dealerServiceId || ''}"`,
        `"${(row.dealerName || '').replace(/"/g, '""')}"`,
        `"${(row.service || '').replace(/"/g, '""')}"`,
        `"${row.amount}"`,
        `"${row.tax}"`,
        `"${row.total}"`
      ].join(',')
    })
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', 'dealer_services_export.csv')
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
async function handleDeleteAllServices() {
  const result = await deleteAllDealerServices()
  if (result > 0) {
    toast.success(`Successfully deleted ${result} dealer services`)
  }
}
</script>

<template>
  <div class="-m-4 lg:-m-6 h-[calc(100dvh-54px-3rem)]">
    <TooltipProvider :delay-duration="0">
      <div class="h-full flex flex-col bg-background/50 border rounded-xl overflow-hidden backdrop-blur supports-[backdrop-filter]:bg-background/50">
        <!-- Detail or Table -->
          <DealersDealerDetail
            v-if="selectedDealerData"
            :dealer="selectedDealerData"
            @close="selectedDealer = undefined"
            @edit="handleEdit"
            @delete="handleDelete"
            @status-change="(id, status) => handleStatusChange(id, status)"
          />
          <div v-else class="h-full flex flex-col relative overflow-hidden">
            <ClientOnly>
              <Teleport to="#page-header-actions">
                <form @submit.prevent class="relative w-48 xl:w-64 max-w-sm">
                  <Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input v-model="searchValue" placeholder="Search dealers..." class="pl-9 h-9 bg-background" />
                </form>
                <div class="flex items-center gap-2 shrink-0">
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button variant="outline" size="sm" class="h-9 px-3 gap-2" @click="showImportDealers = true">
                        <FileUp class="size-4" />
                        <span class="hidden lg:inline">Import Dealers</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Import Dealers</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button variant="outline" size="sm" class="h-9 px-3 gap-2" @click="showImportServices = true">
                        <Upload class="size-4" />
                        <span class="hidden lg:inline">Import Services</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Import Services</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button variant="outline" size="sm" class="h-9 px-3 gap-2" @click="exportServicesToCsv">
                        <FileDown class="size-4" />
                        <span class="hidden lg:inline">Export Services</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Export Services</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button variant="outline" size="sm" class="h-9 px-3 gap-2" @click="exportToCsv">
                        <Download class="size-4" />
                        <span class="hidden lg:inline">Export</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Export to CSV</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button variant="outline" size="sm" class="h-9 px-3 gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20" @click="handleDeleteAllServices">
                        <Trash2 class="size-4" />
                        <span class="hidden lg:inline">Delete All Services</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete All Dealer Services</TooltipContent>
                  </Tooltip>
                  <Button size="sm" class="h-9 px-3 gap-2" @click="openAddForm">
                    <Plus class="size-4" />
                    <span class="hidden lg:inline">Add</span>
                  </Button>
                </div>
              </Teleport>
            </ClientOnly>

            <div class="flex-1 overflow-auto relative">
              <table class="w-full text-sm">
                <thead class="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80 shadow-[0_1px_0_var(--border)]">
                  <tr>
                    <th class="p-4 text-left font-medium text-muted-foreground">
                      Dealer Name
                    </th>
                    <th class="p-4 text-left font-medium text-muted-foreground">
                      Address
                    </th>
                    <th class="p-4 text-left font-medium text-muted-foreground">
                      Primary Contact
                    </th>
                    <th class="p-4 text-left font-medium text-muted-foreground">
                      Phone
                    </th>
                    <th class="p-4 text-left font-medium text-muted-foreground">
                      Email
                    </th>
                    <th class="p-4 text-left font-medium text-muted-foreground whitespace-nowrap">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="d in displayList"
                    :key="d.id"
                    class="border-b cursor-pointer transition-colors hover:bg-muted/30"
                    :class="{ 'bg-muted/50': selectedDealer === d.id }"
                    @click="selectedDealer = d.id"
                  >
                    <td class="p-4 font-medium">
                      {{ d.dealerName }}
                    </td>
                    <td class="p-4 text-muted-foreground text-xs max-w-[200px] truncate">
                      {{ d.address }}
                    </td>
                    <td class="p-4">
                      <span v-if="d.contacts.length">{{ d.contacts[0]?.name }}</span>
                      <span v-else class="text-muted-foreground">—</span>
                    </td>
                    <td class="p-4 text-xs tabular-nums">
                      <span v-if="d.contacts.length && d.contacts[0]?.phones?.length">{{ d.contacts[0]?.phones?.[0]?.number }}</span>
                      <span v-else class="text-muted-foreground">—</span>
                    </td>
                    <td class="p-4 text-xs">
                      <span v-if="d.contacts.length && d.contacts[0]?.emails?.length">{{ d.contacts[0]?.emails?.[0] }}</span>
                      <span v-else class="text-muted-foreground">—</span>
                    </td>
                    <td class="p-4">
                      <Badge
                        variant="outline"
                        :class="{
                          'bg-emerald-500/10 text-emerald-600 border-emerald-500/20': d.status === 'Authorised',
                          'bg-amber-500/10 text-amber-600 border-amber-500/20': d.status === 'Pending',
                          'bg-red-500/10 text-red-600 border-red-500/20': d.status === 'Rejected',
                          'bg-blue-500/10 text-blue-600 border-blue-500/20': d.status === 'In Followup',
                        }"
                        class="text-[10px] px-1.5 py-0"
                      >
                        {{ d.status }}
                      </Badge>
                    </td>
                  </tr>
                  <tr v-if="filteredList.length === 0">
                    <td colspan="6" class="p-8 text-center text-muted-foreground">
                      No dealers found
                    </td>
                  </tr>
                  <tr v-if="displayList.length > 0">
                    <td colspan="6" class="p-0 border-0">
                      <div ref="loadMoreTrigger" class="h-4 w-full"></div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
      </div>
    </TooltipProvider>

    <!-- Dialogs -->
    <DealersDealerForm v-model:open="showForm" :dealer="editingDealer" @saved="selectedDealer = undefined" />
    <DealersDealerImport v-model:open="showImportDealers" />
    <DealersDealerServicesImport v-model:open="showImportServices" />
  </div>
</template>
