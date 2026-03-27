<script setup lang="ts">
import type { Dealer } from '~/composables/useDealers'

definePageMeta({ layout: 'default' })
const props = defineProps<{ dealer: Dealer }>()

const workOrders = ref<any[]>([])
const loading = ref(false)
const hasMore = ref(true)
const skip = ref(0)
const limit = 20
const sortBy = ref('date')
const sortDir = ref(-1)

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
      query: {
        dealerId: props.dealer.id,
        skip: skip.value,
        limit,
        sortBy: sortBy.value,
        sortDir: sortDir.value,
      }
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

// Intersect directive for infinite scroll
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

onMounted(() => {
  fetchWorkOrders()
})

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function getAppSheetImageUrl(fileName: string | undefined | null) {
  if (!fileName) return null
  if (fileName.startsWith('http://') || fileName.startsWith('https://')) return fileName
  // The fileName coming from AppSheet usually starts with "/" e.g., "/699b1f1de586aba4c8f0daf7-Vernon Chevrolet/..."
  const encodedName = encodeURIComponent(fileName)
  return `https://www.appsheet.com/template/gettablefileurl?appName=ZRZOperationsAPP-109704988&tableName=WorkOrders&fileName=${encodedName}`
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
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
    <div class="h-full overflow-auto">
      <table class="w-full text-sm caption-bottom border-collapse">
        <TableHeader class="sticky top-0 z-10 bg-muted/95 backdrop-blur shadow-sm">
          <TableRow>
            <TableHead class="cursor-pointer select-none" @click="toggleSort('date')">
              <div class="flex items-center gap-1">Date <Icon :name="sortIcon('date')" class="size-3 text-muted-foreground" /></div>
            </TableHead>
            <TableHead class="cursor-pointer select-none" @click="toggleSort('stockNumber')">
              <div class="flex items-center gap-1">Stock # <Icon :name="sortIcon('stockNumber')" class="size-3 text-muted-foreground" /></div>
            </TableHead>
            <TableHead class="w-16">Photo</TableHead>
            <TableHead class="cursor-pointer select-none" @click="toggleSort('vin')">
              <div class="flex items-center gap-1">VIN <Icon :name="sortIcon('vin')" class="size-3 text-muted-foreground" /></div>
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
          <TableRow v-for="wo in workOrders" :key="wo.id" class="hover:bg-muted/50">
            <TableCell class="font-medium text-xs whitespace-nowrap">{{ fmtDate(wo.date) }}</TableCell>
            <TableCell class="text-xs">{{ wo.stockNumber }}</TableCell>
            <TableCell>
              <a v-if="wo.upload" :href="getAppSheetImageUrl(wo.upload)!" target="_blank" class="block w-9 h-9 rounded bg-muted border overflow-hidden hover:opacity-80 transition-opacity">
                <img :src="getAppSheetImageUrl(wo.upload)!" class="w-full h-full object-cover" loading="lazy" />
              </a>
              <div v-else class="w-9 h-9 rounded bg-muted/50 border border-dashed flex items-center justify-center">
                <Icon name="lucide:image-off" class="size-3.5 text-muted-foreground/40" />
              </div>
            </TableCell>
            <TableCell class="text-xs font-mono uppercase">{{ wo.vin || '—' }}</TableCell>
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

          <!-- Loading initial -->
          <TableRow v-if="loading && workOrders.length === 0">
            <TableCell :colspan="10" class="text-center py-10">
              <Icon name="lucide:loader-2" class="size-6 animate-spin text-muted-foreground mx-auto" />
            </TableCell>
          </TableRow>

          <!-- Empty -->
          <TableRow v-if="!loading && workOrders.length === 0">
            <TableCell :colspan="10" class="text-center py-10 text-muted-foreground">
              No work orders found for this dealer.
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
</template>
