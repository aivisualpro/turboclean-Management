<script setup lang="ts">
import { Info } from 'lucide-vue-next'

/** A small "i" next to a label: hover or tap it to read what the number means. */
defineProps<{ text: string, label?: string }>()
</script>

<template>
  <TooltipProvider :delay-duration="100">
    <Tooltip>
      <TooltipTrigger as-child>
        <button type="button" class="inline-grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground/60 outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50" :aria-label="label ? `What is ${label}?` : 'What does this mean?'" @click.prevent>
          <Info class="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" class="max-w-72 text-xs leading-relaxed whitespace-pre-line">{{ text }}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
