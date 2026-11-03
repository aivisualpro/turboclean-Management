<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { addDays } from 'date-fns'
import { TIME_CATEGORIES, TIME_CATEGORY_MAP, formatMinutes } from '~/constants/crm'
import { INTERACTION_ICONS } from '~/constants/crm-icons'
import { localDay } from '~/composables/useCrmDealerships'

/** "I just spent 30 min driving" — category, minutes, day, optional dealership & note. */
const props = defineProps<{ dealershipId?: string | null, compact?: boolean }>()
const emit = defineEmits<{ saved: [] }>()
const { add } = useCrmTime()

const category = ref('')
const minutes = ref<number | string>('')
const date = ref(localDay(new Date()))
const dealershipId = ref<string | null>(props.dealershipId || null)
const note = ref('')
const saving = ref(false)
const error = ref('')
watch(() => props.dealershipId, v => { if (v) dealershipId.value = v })

const PRESETS = [15, 30, 45, 60, 90, 120]
const DAYS = computed(() => [{ l: 'Today', v: localDay(new Date()) }, { l: 'Yesterday', v: localDay(addDays(new Date(), -1)) }])

async function save() {
  const m = Math.round(Number(minutes.value))
  if (!category.value) { error.value = 'Pick what the time was spent on'; return }
  if (!m || m < 1) { error.value = 'Enter the minutes'; return }
  if (m > 720) { error.value = 'At most 12 hours per entry'; return }
  error.value = ''
  saving.value = true
  try {
    await add({ category: category.value, minutes: m, date: date.value, dealershipId: dealershipId.value, note: note.value.trim() })
    toast.success(`${formatMinutes(m)} of ${TIME_CATEGORY_MAP[category.value]?.label.toLowerCase()} added`)
    minutes.value = ''; note.value = ''; category.value = ''
    emit('saved')
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save time') } finally { saving.value = false }
}
</script>

<template>
  <div class="space-y-3">
    <div class="grid grid-cols-3 gap-1.5">
      <button v-for="c in TIME_CATEGORIES" :key="c.key" type="button" class="rounded-md border px-2 py-1.5 text-[11px] flex items-center gap-1.5 transition-colors text-left"
        :class="category === c.key ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted text-muted-foreground hover:text-foreground'" :title="c.label" @click="category = c.key">
        <component :is="INTERACTION_ICONS[c.icon]" class="size-3.5 shrink-0" /><span class="truncate">{{ c.short }}</span>
      </button>
    </div>
    <div class="flex flex-wrap items-center gap-1.5">
      <button v-for="p in PRESETS" :key="p" type="button" class="rounded-full border px-2.5 py-0.5 text-xs tabular-nums transition-colors"
        :class="Number(minutes) === p ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'" @click="minutes = p">{{ formatMinutes(p) }}</button>
      <div class="relative w-24">
        <Input v-model="minutes" type="number" min="1" max="720" placeholder="Min" class="h-7 pr-9 text-xs tabular-nums" @keydown.enter.prevent="save" />
        <span class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">min</span>
      </div>
    </div>
    <div class="flex items-center gap-1.5">
      <button v-for="d in DAYS" :key="d.v" type="button" class="rounded-full border px-2.5 py-0.5 text-xs transition-colors"
        :class="date === d.v ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted'" @click="date = d.v">{{ d.l }}</button>
      <Input v-model="date" type="date" class="h-7 w-36 text-xs ml-auto" />
    </div>
    <CrmDealershipPicker v-model="dealershipId" />
    <Input v-if="!compact" v-model="note" placeholder="Note (optional)" class="h-9 text-sm" @keydown.enter.prevent="save" />
    <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
    <Button class="w-full" :disabled="saving" @click="save"><Loader2 v-if="saving" class="size-4 animate-spin" /> Add time</Button>
  </div>
</template>
