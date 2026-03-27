<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { Dealer } from '~/composables/useDealers'
import { Mail, Clock, Inbox, Loader2 } from 'lucide-vue-next'

definePageMeta({ layout: 'default' })
const props = defineProps<{ dealer: Dealer }>()

const emails = ref<any[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await $fetch<any[]>(`/api/emails?dealerId=${props.dealer.id}`)
    emails.value = res || []
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
})

const getStatusColor = (st: string) => {
  if (st === 'Sent') return 'text-emerald-600 bg-emerald-50 border-emerald-200'
  return 'text-blue-600 bg-blue-50 border-blue-200'
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
    <div class="p-4 border-b bg-muted/20 flex justify-between items-center">
      <div>
        <h3 class="font-semibold flex items-center gap-2"><Mail class="size-4 text-primary" /> Communication Log</h3>
        <p class="text-xs text-muted-foreground mt-0.5">Email trails and invoice dispatches for {{ dealer.dealerName }}</p>
      </div>
    </div>
    
    <div class="flex-1 overflow-auto bg-gray-50/50">
      <div v-if="loading" class="flex justify-center py-20">
        <Loader2 class="size-6 animate-spin text-muted-foreground/50" />
      </div>
      
      <div v-else-if="emails.length === 0" class="flex-1 flex flex-col items-center justify-center py-20">
        <Inbox class="size-12 text-muted-foreground/20 mb-3" />
        <h4 class="text-sm font-semibold text-foreground">No Emails Found</h4>
        <p class="text-xs text-muted-foreground w-64 text-center mt-1">We haven't recorded any emails dispatched to this dealer yet.</p>
      </div>

      <div v-else class="divide-y divide-border">
        <div v-for="log in emails" :key="log.id" class="p-4 hover:bg-white transition flex items-start gap-4 flex-col sm:flex-row">
          <div class="p-2 bg-blue-50 rounded-full shrink-0">
            <Mail class="size-5 text-blue-600" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h4 class="text-sm font-medium truncate leading-tight">{{ log.subject }}</h4>
              <span :class="['text-[10px] px-2 py-0.5 rounded-full border shadow-sm font-semibold tracking-wide uppercase', getStatusColor(log.status)]">
                {{ log.status }}
              </span>
            </div>
            <div class="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <span class="font-medium text-foreground">To: {{ log.email }}</span>
              <span class="flex items-center gap-1.5"><Clock class="size-3" /> {{ new Date(log.sentAt).toLocaleString() }}</span>
              <span v-if="log.type === 'Invoice'" class="px-1.5 py-0.5 bg-muted rounded border border-border">Linked Invoice</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
