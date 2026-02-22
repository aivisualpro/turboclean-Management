<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'

const { setHeader } = usePageHeader()
// 1. remove description
setHeader({ title: 'Work Orders' })

const showImportModal = ref(false)
const search = ref('')
const statusFilter = ref('all')

const workOrders = ref<any[]>([])
const loading = ref(false)
const hasMore = ref(true)
const skip = ref(0)
const limit = 20

const statusOptions = [
  { label: 'Pending', value: 'Pending' },
  { label: 'Completed', value: 'Completed' },
]

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
      query: { skip: skip.value, limit, search: search.value, status: statusFilter.value === 'all' ? undefined : statusFilter.value }
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
watch([search, statusFilter], () => {
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

function handleExport() {
  // Logic from previous actions slot placeholder
  alert('Export functionality clicked')
}
</script>

<template>
  <div class="h-[calc(100vh-8rem)] flex flex-col gap-4 relative">
    
    <!-- 2. Move Search, Filters, Import, Add new to Main Header -->
    <Teleport to="#page-header-actions">
      <div class="flex items-center gap-2">
        <div class="relative hidden sm:block">
          <Icon name="lucide:search" class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input v-model="search" placeholder="Search..." class="pl-8 w-40 h-8 text-sm" />
        </div>
        <Select v-model="statusFilter">
          <SelectTrigger class="w-28 h-8 text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </SelectItem>
          </SelectContent>
        </Select>
        
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

    <!-- 4 & 5. Columns & Table Loadmore -->
    <Card class="flex-1 min-h-0 flex flex-col">
      <div class="flex-1 overflow-auto border-0">
        <Table>
          <TableHeader class="sticky top-0 z-10 bg-muted/95 backdrop-blur shadow-sm">
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Stock Number</TableHead>
              <TableHead>VIN</TableHead>
              <TableHead>Dealer</TableHead>
              <TableHead>Service ID</TableHead>
              <TableHead class="text-right">Amount</TableHead>
              <TableHead class="text-right">Tax</TableHead>
              <TableHead class="text-right">Total</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Status</TableHead>
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
                <Badge variant="secondary" class="text-[10px]">{{ wo.status || 'Pending' }}</Badge>
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
            <tr v-if="hasMore" v-intersect="fetchWorkOrders" class="h-10">
              <td :colspan="10" class="text-center">
                <div v-if="loading" class="flex justify-center py-4">
                  <Icon name="lucide:loader-2" class="size-4 animate-spin text-muted-foreground" />
                </div>
              </td>
            </tr>
          </TableBody>
        </Table>
      </div>
    </Card>

    <SalesWorkOrderImport v-if="showImportModal" v-model:open="showImportModal" @imported="fetchWorkOrders(true)" />
  </div>
</template>
