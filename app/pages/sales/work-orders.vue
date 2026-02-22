<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { toast } from 'vue-sonner'

const { setHeader } = usePageHeader()
// 1. remove description
setHeader({ title: 'Work Orders' })

const showImportModal = ref(false)
const search = ref('')

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
  try {
    const res = await $fetch('/api/work-orders', {
      query: { skip: skip.value, limit, search: search.value, sortBy: sortBy.value, sortDir: sortDir.value }
    })
    
    // @ts-ignore
    workOrders.value = [...workOrders.value, ...(res.workOrders || [])]
    // @ts-ignore
    hasMore.value = res.hasMore
    skip.value += limit
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

// Intersect Logic
const vIntersect = {
  mounted: (el: HTMLElement, binding: any) => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          binding.value()
        }
      },
      { rootMargin: '100px', threshold: 0.1 }
    )
    observer.observe(el)
    ;(el as any)._observer = observer
  },
  unmounted: (el: HTMLElement) => {
    if ((el as any)._observer) {
      ;(el as any)._observer.disconnect()
    }
  }
}

// Initial fetch
onMounted(() => {
  fetchWorkOrders()
})

// Search delay
let searchTimeout: any
watch(search, () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    fetchWorkOrders(true)
  }, 300)
})

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n || 0)
}

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function toggleSort(field: string) {
  if (sortBy.value === field) {
    sortDir.value = sortDir.value === -1 ? 1 : -1
  } else {
    sortBy.value = field
    sortDir.value = -1
  }
  fetchWorkOrders(true)
}

function sortIcon(field: string) {
  if (sortBy.value !== field) return 'lucide:arrow-up-down'
  return sortDir.value === -1 ? 'lucide:arrow-down' : 'lucide:arrow-up'
}

async function handleExport() {
  try {
    toast.info('Preparing export...')
    const res = await $fetch('/api/work-orders', {
      query: { search: search.value, export: 'true' }
    })
    
    // @ts-ignore
    const dataToExport = res.workOrders || []
    
    if (dataToExport.length === 0) {
      toast.error('No work orders found to export')
      return
    }

    const headers = ['Object ID', 'Date', 'Stock Number', 'VIN', 'Dealer', 'Service', 'Amount', 'Tax', 'Total', 'Notes', 'Is Invoiced']
    const rows = dataToExport.map((wo: any) => [
      wo.id,
      wo.date ? new Date(wo.date).toLocaleDateString() : '',
      wo.stockNumber,
      wo.vin,
      wo.dealerId || wo.dealerName, // fallback to name if dealerId is somehow missing
      wo.rawServiceId || wo.dealerServiceId,
      wo.amount,
      wo.tax,
      wo.total,
      `"${(wo.notes || '').replace(/"/g, '""')}"`,
      wo.isInvoiced ? 'Yes' : 'No'
    ])

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `work-orders-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    
    toast.success(`Exported ${dataToExport.length} work orders`)
  } catch (err) {
    console.error('Export failed:', err)
    toast.error('Failed to export work orders')
  }
}
</script>

<template>
  <div class="absolute inset-0 flex flex-col overflow-hidden">
    
    <!-- 2. Move Search, Filters, Import, Add new to Main Header -->
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <div class="flex items-center gap-2">
          <div class="relative hidden sm:block">
            <Icon name="lucide:search" class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input v-model="search" placeholder="Search..." class="pl-8 w-40 h-8 text-sm" />
          </div>
          <Button variant="outline" size="sm" class="h-8" @click="handleExport">
            <Icon name="lucide:download" class="mr-1 size-4" />
            Export
          </Button>
          <Button variant="outline" size="sm" class="h-8" @click="showImportModal = true">
            <Icon name="lucide:upload" class="mr-1 size-4" />
            Import
          </Button>
          <Button size="sm" class="h-8">
            <Icon name="lucide:plus" class="mr-1 size-4" />
            New
          </Button>
        </div>
      </Teleport>
    </ClientOnly>

    <!-- 4 & 5. Columns & Table Loadmore -->
    <div class="flex-1 min-h-0 rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
      <div class="h-full overflow-auto">
        <table class="w-full text-sm caption-bottom border-collapse">
          <TableHeader class="sticky top-0 z-10 bg-muted/95 backdrop-blur shadow-sm">
            <TableRow>
              <TableHead class="cursor-pointer select-none" @click="toggleSort('date')">
                <div class="flex items-center gap-1">Date <Icon :name="sortIcon('date')" class="size-3 text-muted-foreground" /></div>
              </TableHead>
              <TableHead class="cursor-pointer select-none" @click="toggleSort('stockNumber')">
                <div class="flex items-center gap-1">Stock Number <Icon :name="sortIcon('stockNumber')" class="size-3 text-muted-foreground" /></div>
              </TableHead>
              <TableHead class="cursor-pointer select-none" @click="toggleSort('vin')">
                <div class="flex items-center gap-1">VIN <Icon :name="sortIcon('vin')" class="size-3 text-muted-foreground" /></div>
              </TableHead>
              <TableHead class="cursor-pointer select-none" @click="toggleSort('dealerName')">
                <div class="flex items-center gap-1">Dealer <Icon :name="sortIcon('dealerName')" class="size-3 text-muted-foreground" /></div>
              </TableHead>
              <TableHead class="cursor-pointer select-none" @click="toggleSort('dealerServiceId')">
                <div class="flex items-center gap-1">Service <Icon :name="sortIcon('dealerServiceId')" class="size-3 text-muted-foreground" /></div>
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
              <TableHead class="cursor-pointer select-none" @click="toggleSort('notes')">
                <div class="flex items-center gap-1">Notes <Icon :name="sortIcon('notes')" class="size-3 text-muted-foreground" /></div>
              </TableHead>
              <TableHead class="cursor-pointer select-none" @click="toggleSort('isInvoiced')">
                <div class="flex items-center gap-1">Invoiced <Icon :name="sortIcon('isInvoiced')" class="size-3 text-muted-foreground" /></div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="wo in workOrders" :key="wo.id" class="cursor-pointer hover:bg-muted/50">
              <TableCell class="font-medium text-xs whitespace-nowrap">{{ fmtDate(wo.date) }}</TableCell>
              <TableCell class="text-xs">{{ wo.stockNumber }}</TableCell>
              <TableCell class="text-xs font-mono uppercase">{{ wo.vin }}</TableCell>
              <TableCell class="text-xs truncate max-w-[120px]">{{ wo.dealerName }}</TableCell>
              <TableCell class="text-xs truncate max-w-[120px]">{{ wo.dealerServiceId }}</TableCell>
              <TableCell class="text-right text-xs tabular-nums">{{ fmt(wo.amount) }}</TableCell>
              <TableCell class="text-right text-xs tabular-nums">{{ fmt(wo.tax) }}</TableCell>
              <TableCell class="text-right text-xs tabular-nums font-semibold">{{ fmt(wo.total) }}</TableCell>
              <TableCell class="text-xs truncate max-w-[150px]" :title="wo.notes">{{ wo.notes }}</TableCell>
              <TableCell>
                <Badge :variant="wo.isInvoiced ? 'default' : 'outline'" :class="wo.isInvoiced ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'text-muted-foreground'" class="text-[10px]">
                  {{ wo.isInvoiced ? 'Yes' : 'No' }}
                </Badge>
              </TableCell>
            </TableRow>
            <TableRow v-if="loading && workOrders.length === 0">
              <TableCell :colspan="10" class="text-center py-10">
                <Icon name="lucide:loader-2" class="size-6 animate-spin text-muted-foreground mx-auto" />
              </TableCell>
            </TableRow>
            <TableRow v-if="!loading && workOrders.length === 0">
              <TableCell :colspan="10" class="text-center py-10 text-muted-foreground">
                No work orders found.
              </TableCell>
            </TableRow>

            <!-- Load More Sentinel -->
            <tr v-if="hasMore && workOrders.length > 0" v-intersect="fetchWorkOrders" class="h-10">
              <td :colspan="10" class="text-center">
                <div v-if="loading" class="flex justify-center py-4">
                  <Icon name="lucide:loader-2" class="size-4 animate-spin text-muted-foreground" />
                </div>
              </td>
            </tr>
          </TableBody>
        </table>
      </div>
    </div>

    <SalesWorkOrderImport v-if="showImportModal" v-model:open="showImportModal" @imported="fetchWorkOrders(true)" />
  </div>
</template>
