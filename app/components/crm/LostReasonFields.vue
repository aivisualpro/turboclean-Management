<script setup lang="ts">
import { LOST_REASONS } from '~/constants/crm'

/** Standard lost reason (required) + notes (required for "Other") + competitor name. v-model is the whole object. */
const model = defineModel<{ lostReason: string, lostNotes: string, lostCompetitor: string }>({ required: true })
defineProps<{ error?: string }>()
</script>

<template>
  <div class="space-y-3">
    <div class="space-y-1.5">
      <p class="text-xs font-medium">Why was it lost? <span class="text-destructive">*</span></p>
      <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Lost reason">
        <button v-for="r in LOST_REASONS" :key="r" type="button" role="radio" :aria-checked="model.lostReason === r"
          class="rounded-full border px-2.5 py-1 text-xs transition-colors"
          :class="model.lostReason === r ? 'bg-rose-600 text-white border-rose-600 font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted'"
          @click="model = { ...model, lostReason: r }">{{ r }}</button>
      </div>
      <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
    </div>
    <div v-if="model.lostReason === 'Competitor'" class="space-y-1.5">
      <p class="text-xs font-medium">Which competitor? <span class="text-muted-foreground font-normal">(optional)</span></p>
      <Input :model-value="model.lostCompetitor" placeholder="Competitor name" @update:model-value="(v: any) => model = { ...model, lostCompetitor: String(v) }" />
    </div>
    <div class="space-y-1.5">
      <p class="text-xs font-medium">Notes <span v-if="model.lostReason === 'Other'" class="text-destructive">*</span><span v-else class="text-muted-foreground font-normal">(optional)</span></p>
      <Textarea :model-value="model.lostNotes" rows="3" class="text-sm" placeholder="What exactly happened? Who decided? Anything that would change their mind?" @update:model-value="(v: any) => model = { ...model, lostNotes: String(v) }" />
    </div>
  </div>
</template>
