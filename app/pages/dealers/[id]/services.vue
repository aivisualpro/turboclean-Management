<script setup lang="ts">
import type { Dealer } from '~/composables/useDealers'
import { useServices } from '~/composables/useServices'

definePageMeta({ layout: 'default' })

const props = defineProps<{ dealer: Dealer }>()
const { services } = useServices()

function getServiceName(serviceId: string) {
  const s = services.value.find(s => s.id === serviceId)
  return s ? s.service : 'Unknown Service'
}

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
    <div v-if="!dealer.services?.length" class="flex-1 flex items-center justify-center">
      <div class="text-center py-14 px-4">
        <Icon name="i-lucide-briefcase" class="size-10 text-muted-foreground/30 mx-auto mb-3" />
        <h4 class="text-sm font-semibold text-foreground">No Services Configured</h4>
        <p class="text-xs text-muted-foreground max-w-xs mx-auto mt-1.5">Import services to configure pricing rates for this dealer.</p>
      </div>
    </div>

    <template v-else>
      <div class="h-full overflow-auto">
        <table class="w-full text-sm caption-bottom border-collapse">
          <TableHeader class="sticky top-0 z-10 bg-muted/95 backdrop-blur shadow-sm">
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Service</TableHead>
              <TableHead class="text-right">Amount</TableHead>
              <TableHead class="text-right">Tax</TableHead>
              <TableHead class="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="(srv, i) in dealer.services" :key="i" class="hover:bg-muted/50">
              <TableCell class="text-xs text-muted-foreground tabular-nums w-10">{{ i + 1 }}</TableCell>
              <TableCell class="text-xs font-medium">{{ getServiceName(srv.service) }}</TableCell>
              <TableCell class="text-right text-xs tabular-nums text-muted-foreground">{{ fmt(srv.amount) }}</TableCell>
              <TableCell class="text-right text-xs tabular-nums text-muted-foreground">{{ fmt(srv.tax) }}</TableCell>
              <TableCell class="text-right text-xs tabular-nums font-semibold">{{ fmt(srv.total) }}</TableCell>
            </TableRow>
          </TableBody>
        </table>
      </div>
      <div class="bg-muted/10 border-t px-4 py-2.5 flex justify-between items-center shrink-0">
        <span class="text-[11px] text-muted-foreground font-medium">{{ dealer.services.length }} services configured</span>
        <span class="text-xs font-semibold text-foreground">Total: {{ fmt(dealer.services.reduce((s, v) => s + v.total, 0)) }}</span>
      </div>
    </template>
  </div>
</template>
