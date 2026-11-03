<script setup lang="ts">
import { Loader2, Replace } from 'lucide-vue-next'
import { CASCADE_LABEL } from '~/composables/useCascade'
import type { useCascade } from '~/composables/useCascade'

/**
 * "You renamed the dealer group on one dealership — change the 6 others too?"
 * Driven by useCascade(); mount it once next to any editor that calls cascade.offer().
 */
const props = defineProps<{ cascade: ReturnType<typeof useCascade> }>()
const open = computed({ get: () => !!props.cascade.current.value, set: (v) => { if (!v) props.cascade.skipCurrent() } })
const o = computed(() => props.cascade.current.value)
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent v-if="o" class="sm:max-w-md">
      <DialogHeader>
        <div class="flex items-start gap-3">
          <div class="size-10 shrink-0 rounded-xl bg-sky-500/10 flex items-center justify-center"><Replace class="size-5 text-sky-600 dark:text-sky-400" /></div>
          <div class="min-w-0">
            <DialogTitle class="text-base">Change the {{ CASCADE_LABEL[o.field].toLowerCase() }} everywhere?</DialogTitle>
            <DialogDescription class="text-xs mt-1">
              <b class="text-foreground">{{ o.others }}</b> other dealership{{ o.others === 1 ? ' still has' : 's still have' }} the {{ CASCADE_LABEL[o.field].toLowerCase() }}
              <span class="font-mono text-foreground">"{{ o.from }}"</span>.
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>
      <div class="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
        <div class="flex items-center gap-2 font-medium">
          <span class="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-700 line-through decoration-rose-500/60 dark:text-rose-300">{{ o.from }}</span>
          <span class="text-muted-foreground">→</span>
          <span class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">{{ o.to || '— (cleared)' }}</span>
        </div>
        <p class="mt-2 text-xs text-muted-foreground">
          {{ o.names.join(', ') }}<template v-if="o.others > o.names.length"> and {{ o.others - o.names.length }} more</template>.
          Each change is written to that dealership's activity log.
        </p>
      </div>
      <DialogFooter class="gap-2 sm:gap-2">
        <Button variant="outline" :disabled="cascade.busy.value" @click="cascade.skipCurrent()">Only this one</Button>
        <Button :disabled="cascade.busy.value" @click="cascade.applyCurrent()">
          <Loader2 v-if="cascade.busy.value" class="size-4 animate-spin" /> Change all {{ o.others + o.exceptIds.length }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
