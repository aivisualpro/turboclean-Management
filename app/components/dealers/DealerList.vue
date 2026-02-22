<script setup lang="ts">
import type { Dealer } from '~/composables/useDealers'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '~/lib/utils'

interface Props {
  items: Dealer[]
}

defineProps<Props>()
const selectedDealer = defineModel<string>('selectedDealer', { required: false })

function getStatusColor(status: string) {
  switch (status) {
    case 'Authorised': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
    case 'Pending': return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
    case 'Rejected': return 'bg-red-500/10 text-red-600 border-red-500/20'
    case 'In Followup': return 'bg-blue-500/10 text-blue-600 border-blue-500/20'
    default: return 'bg-muted text-muted-foreground'
  }
}
</script>

<template>
  <ScrollArea class="h-[calc(100dvh-72px-56px-3rem-53px)] flex">
    <div class="flex flex-1 flex-col gap-2 p-4 pt-0">
      <TransitionGroup name="list" appear>
        <button
          v-for="item of items"
          :key="item.id"
          :class="cn(
            'flex flex-col items-start gap-2 rounded-lg border p-3 text-left text-sm transition-all hover:bg-accent',
            selectedDealer === item.id && 'bg-muted',
          )"
          @click="selectedDealer = item.id"
        >
          <div class="w-full flex flex-col gap-1">
            <div class="flex items-center">
              <div class="flex items-center gap-2">
                <div class="font-semibold">
                  {{ item.dealerName }}
                </div>
              </div>
              <div
                :class="cn(
                  'ml-auto text-xs',
                  selectedDealer === item.id ? 'text-foreground' : 'text-muted-foreground',
                )"
              >
                {{ formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true }) }}
              </div>
            </div>
            <div class="text-xs text-muted-foreground line-clamp-1">
              {{ item.address }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <Badge variant="outline" :class="getStatusColor(item.status)" class="text-[10px] px-1.5 py-0">
              {{ item.status }}
            </Badge>
            <span class="text-xs text-muted-foreground">
              {{ item.contacts.length }} contact{{ item.contacts.length !== 1 ? 's' : '' }}
            </span>
          </div>
        </button>
      </TransitionGroup>
      <div v-if="items.length === 0" class="py-8 text-center text-sm text-muted-foreground">
        No dealers found
      </div>
    </div>
  </ScrollArea>
</template>

<style scoped>
.list-move,
.list-enter-active,
.list-leave-active {
  transition: all 0.5s ease;
}

.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateY(15px);
}

.list-leave-active {
  position: absolute;
}
</style>
