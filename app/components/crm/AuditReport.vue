<script setup lang="ts">
import { FileDown, ExternalLink, Link2, Loader2, FileBarChart } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format } from 'date-fns'

/**
 * A dealer's inventory analysis report for one audit — stored exactly as it read on that day
 * (then vs now, history, evidence). Open, download as PDF, or copy the dealer's own link
 * (the same link templates insert as {{reportUrl}}).
 */
const props = defineProps<{ auditId: string | null, auditedAt?: string, dealershipName?: string }>()
const open = defineModel<boolean>('open', { default: false })
const loaded = ref(false)
watch(() => [open.value, props.auditId], () => { loaded.value = false })
const src = computed(() => props.auditId ? `/api/crm/audits/${props.auditId}/report?embed=1` : '')
const base = computed(() => props.auditId ? `/api/crm/audits/${props.auditId}/report` : '')
async function copyLink() {
  try {
    const r = await $fetch<{ url: string }>(`/api/crm/audits/${props.auditId}/share`)
    await navigator.clipboard.writeText(r.url)
    toast.success('Link copied', { description: 'The dealer can open this report without signing in.' })
  } catch { toast.error('Could not copy the link') }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-5xl max-h-[94vh] p-0 gap-0 flex flex-col overflow-hidden">
      <DialogHeader class="px-5 pt-5 pb-3 border-b">
        <DialogTitle class="text-base flex items-center gap-2"><FileBarChart class="size-4 text-violet-600" /> Inventory report{{ auditedAt ? ` · ${format(new Date(auditedAt), 'MMM d, yyyy')}` : '' }}</DialogTitle>
        <DialogDescription class="text-xs flex flex-wrap items-center gap-2">
          <span>{{ dealershipName }} — stored exactly as it read on the audit date.</span>
          <span class="ml-auto flex gap-2">
            <Button size="sm" variant="outline" class="h-7 gap-1.5 text-xs" @click="copyLink"><Link2 class="size-3.5" /> Copy link for the dealer</Button>
            <Button as="a" :href="`${base}?format=pdf`" target="_blank" size="sm" variant="outline" class="h-7 gap-1.5 text-xs"><ExternalLink class="size-3.5" /> Open PDF</Button>
            <Button as="a" :href="`${base}?format=pdf&download=1`" size="sm" class="h-7 gap-1.5 text-xs"><FileDown class="size-3.5" /> Download PDF</Button>
          </span>
        </DialogDescription>
      </DialogHeader>
      <div class="relative flex-1 min-h-[70vh] bg-[#eef1ef]">
        <div v-if="!loaded" class="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 class="size-4 animate-spin" /> Building the report…</div>
        <iframe v-if="open && src" :src="src" title="Inventory report" class="absolute inset-0 size-full border-0" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" @load="loaded = true" />
      </div>
    </DialogContent>
  </Dialog>
</template>
