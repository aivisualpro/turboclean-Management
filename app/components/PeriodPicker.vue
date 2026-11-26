<script setup lang="ts">
import { CalendarRange } from 'lucide-vue-next'
import { format, parseISO } from 'date-fns'

/**
 * Period filter for the page header: buttons on wide screens, a dropdown on narrower ones.
 * Choosing "Custom" shows a small date button that opens From / To pickers.
 *   <PeriodPicker v-model="range" v-model:from="customFrom" v-model:to="customTo" :ranges="RANGES" :label="label" />
 */
const props = defineProps<{
  ranges: readonly { key: string, label: string }[]
  /** The dates the chosen period covers, e.g. "Nov 1 – Nov 27, 2026" — shown when there is room. */
  label?: string
  customKey?: string
}>()
const range = defineModel<string>({ required: true })
const from = defineModel<string>('from')
const to = defineModel<string>('to')

const CUSTOM = computed(() => props.customKey ?? 'custom')
const isCustom = computed(() => range.value === CUSTOM.value)
const customOpen = ref(false)
const day = (v?: string) => { try { return v ? format(parseISO(v), 'MMM d, yyyy') : '' } catch { return v || '' } }
const customLabel = computed(() => from.value && to.value ? `${day(from.value)} – ${day(to.value)}` : 'Pick dates')
function choose(key: string) {
  range.value = key
  if (key === CUSTOM.value) nextTick(() => { customOpen.value = true })
}
</script>

<template>
  <div class="flex min-w-0 items-center gap-2">
    <!-- Wide screens: one button per period -->
    <div class="hidden h-8 items-center rounded-lg border bg-muted/40 p-0.5 xl:inline-flex" role="tablist" aria-label="Period" :title="label">
      <button
        v-for="r in ranges" :key="r.key" type="button" role="tab" :aria-selected="range === r.key"
        class="h-full whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors"
        :class="range === r.key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'"
        @click="choose(r.key)"
      >{{ r.label }}</button>
    </div>
    <!-- Narrower screens: a dropdown -->
    <Select :model-value="range" @update:model-value="choose(String($event))">
      <SelectTrigger size="sm" class="h-8 w-[136px] text-xs xl:hidden" aria-label="Period"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem v-for="r in ranges" :key="r.key" :value="r.key">{{ r.label }}</SelectItem></SelectContent>
    </Select>

    <Popover v-if="isCustom" v-model:open="customOpen">
      <PopoverTrigger as-child>
        <Button variant="outline" size="sm" class="h-8 gap-1.5 whitespace-nowrap px-2.5 text-xs" aria-label="Custom dates"><CalendarRange class="size-3.5" />{{ customLabel }}</Button>
      </PopoverTrigger>
      <PopoverContent align="end" class="w-64 p-3">
        <p class="mb-2 text-xs font-medium">Custom period</p>
        <div class="grid grid-cols-[44px_1fr] items-center gap-2 text-xs">
          <label for="period-from" class="text-muted-foreground">From</label>
          <Input id="period-from" v-model="from" type="date" class="h-8 text-xs" />
          <label for="period-to" class="text-muted-foreground">To</label>
          <Input id="period-to" v-model="to" type="date" class="h-8 text-xs" :min="from" />
        </div>
      </PopoverContent>
    </Popover>
    <span v-else-if="label" class="hidden whitespace-nowrap text-xs text-muted-foreground 2xl:inline">{{ label }}</span>
  </div>
</template>
