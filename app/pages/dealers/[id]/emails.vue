<script setup lang="ts">
import type { Dealer } from '~/composables/useDealers'

definePageMeta({ layout: 'default' })
const props = defineProps<{ dealer: Dealer }>()
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center py-14 px-4">
        <Icon name="i-lucide-mail-check" class="size-10 text-muted-foreground/30 mx-auto mb-3" />
        <h4 class="text-sm font-semibold text-foreground">Communication Log</h4>
        <p class="text-xs text-muted-foreground max-w-xs mx-auto mt-1.5">Track emails, notifications, and dispatches for {{ dealer.dealerName }}.</p>
      </div>
    </div>
  </div>
</template>
