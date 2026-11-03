<script setup lang="ts">
import { Search, X, Store } from 'lucide-vue-next'

/**
 * Inline dealership search (safe inside popovers/dialogs — no nested overlay).
 * v-model is the dealership id, or null for "not linked to a dealership".
 */
const model = defineModel<string | null>({ default: null })
defineProps<{ placeholder?: string }>()
const { dealerships, fetchDealerships } = useCrmDealerships()
onMounted(() => { if (!dealerships.value.length) fetchDealerships().catch(() => {}) })

const q = ref('')
const focused = ref(false)
const selected = computed(() => model.value ? dealerships.value.find(d => d.id === model.value) || null : null)
const results = computed(() => {
  const s = q.value.trim().toLowerCase()
  if (!s) return []
  return dealerships.value
    .filter(d => !d.archivedAt && `${d.name} ${d.dealershipId} ${d.dealerGroup || ''} ${d.city || ''}`.toLowerCase().includes(s))
    .slice(0, 6)
})
function pick(id: string) { model.value = id; q.value = ''; focused.value = false }
function clear() { model.value = null; q.value = '' }
</script>

<template>
  <div>
    <div v-if="selected" class="flex items-center gap-2 rounded-md border px-2.5 h-9 text-sm">
      <Store class="size-3.5 text-muted-foreground shrink-0" />
      <span class="truncate">{{ selected.name }}</span>
      <span class="text-[10px] font-mono text-muted-foreground shrink-0">{{ selected.dealershipId }}</span>
      <button type="button" class="ml-auto text-muted-foreground hover:text-foreground" aria-label="Clear dealership" @click="clear"><X class="size-3.5" /></button>
    </div>
    <div v-else class="relative">
      <Search class="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <Input v-model="q" :placeholder="placeholder || 'Dealership (optional)'" class="h-9 pl-8 text-sm" @focus="focused = true" @keydown.enter.prevent="results[0] && pick(results[0].id)" />
    </div>
    <ul v-if="!selected && focused && results.length" class="mt-1 rounded-md border bg-popover divide-y max-h-52 overflow-y-auto">
      <li v-for="d in results" :key="d.id">
        <button type="button" class="w-full text-left px-2.5 py-1.5 text-sm hover:bg-muted flex items-center gap-2" @mousedown.prevent="pick(d.id)">
          <span class="truncate">{{ d.name }}</span>
          <span class="text-[10px] text-muted-foreground ml-auto shrink-0">{{ [d.city, d.state].filter(Boolean).join(', ') }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
