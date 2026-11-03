<script setup lang="ts">
import type { RenderedEmail } from '~/composables/useTemplatePreview'
import { inboxCheck } from '~/composables/useTemplatePreview'
import { ShieldCheck, ShieldAlert, CheckCircle2, AlertTriangle, XCircle } from 'lucide-vue-next'

/** "Inbox check" score + checklist for a rendered email (what spam filters look at). */
const props = defineProps<{ rendered: RenderedEmail, source: { html?: string, body?: string, format?: string } }>()
const res = computed(() => props.rendered.html ? inboxCheck(props.rendered, props.source) : null)
const tone = computed(() => !res.value ? '' : res.value.score >= 85 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' : res.value.score >= 65 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30')
</script>

<template>
  <Popover v-if="res">
    <PopoverTrigger as-child>
      <button type="button" class="inline-flex items-center gap-1.5 rounded-full border px-2 h-7 text-[11px] font-semibold tabular-nums" :class="tone" title="How spam filters will see this email">
        <component :is="res.score >= 85 ? ShieldCheck : ShieldAlert" class="size-3.5" /> Inbox check {{ res.score }}
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-96 p-0">
      <div class="px-4 py-3 border-b">
        <p class="text-sm font-semibold">Inbox check · {{ res.score }}/100</p>
        <p class="text-[11px] text-muted-foreground">What spam filters look at in this email. Domain records (SPF, DKIM, DMARC) are checked on Email → Settings.</p>
      </div>
      <ul class="max-h-80 overflow-y-auto divide-y">
        <li v-for="i in res.items" :key="i.label" class="px-4 py-2 flex gap-2.5 text-xs">
          <CheckCircle2 v-if="i.status === 'ok'" class="size-4 text-emerald-500 shrink-0 mt-px" /><AlertTriangle v-else-if="i.status === 'warn'" class="size-4 text-amber-500 shrink-0 mt-px" /><XCircle v-else class="size-4 text-rose-500 shrink-0 mt-px" />
          <div class="min-w-0"><p class="font-medium">{{ i.label }}</p><p class="text-muted-foreground break-words">{{ i.detail }}</p></div>
        </li>
      </ul>
    </PopoverContent>
  </Popover>
</template>
