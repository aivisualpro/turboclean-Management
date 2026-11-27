<script setup lang="ts">
import { Check, Loader2, Pencil, FileDown, Mail } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format } from 'date-fns'
import { useInventoryScanner } from '~/composables/useInventoryScanner'

/**
 * Review a saved crawl again — the same results screen as a fresh crawl (re-label photos, image
 * groups, rules). "Save corrections" updates the audit it produced (same date), its report and emails.
 */
const props = defineProps<{
  scanId: string | null, dealershipName?: string, auditId?: string | null, auditedAt?: string
  /** Offer "Email this audit" (the user may email this dealership). */
  canEmail?: boolean
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [], /** Open the composer on the audit email. */ email: [] }>()
const sc = useInventoryScanner()
const loading = ref(false)
const saving = ref(false)
const failed = ref('')
watch(() => [open.value, props.scanId] as const, async ([o, id]) => {
  if (!o || !id) return
  loading.value = true; failed.value = ''; sc.results.value = null
  try {
    const p = await sc.refresh(id)
    if (!p?.results) failed.value = 'This crawl has no results to review (it may have been cleaned up).'
  } catch (e: any) { failed.value = e?.data?.statusMessage || 'Could not load this crawl' } finally { loading.value = false }
}, { immediate: true })
const r = computed(() => sc.results.value)
const dirty = computed(() => !!r.value && !r.value.savedAuditId)
async function save() {
  saving.value = true
  try {
    const res = await sc.save()
    toast.success('Corrections saved', { description: `${res.summary.withoutReal} of ${res.summary.total} without a real photo (${res.summary.withoutRealPct ?? 0}%). The audit, report and emails use these numbers.` })
    emit('saved')
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save') } finally { saving.value = false }
}
/** Asked before the review goes away (Back, Escape, or walking off through the sidebar). */
function mayClose() {
  return !dirty.value || confirm('You changed some verdicts but did not save them. Close anyway? (They stay here as a draft.)')
}
function close() { if (mayClose()) open.value = false }
</script>

<template>
  <!-- Opens in the page area (sidebar and main header stay); the back button in the header closes it. -->
  <LayoutWorkScreen
    v-model:open="open" :title="`Crawl results${dealershipName ? ` · ${dealershipName}` : ''}`" icon="i-lucide-scan-search" :back-label="dealershipName ? `Back to ${dealershipName}` : 'Back'"
    panel-class="border-2 border-primary bg-background" :leave-guard="mayClose" @back="close"
  >
    <template #actions>
      <span v-if="auditedAt" class="hidden xl:inline text-xs text-muted-foreground whitespace-nowrap">Audit of {{ format(new Date(auditedAt), 'MMM d, yyyy h:mm a') }}</span>
      <template v-if="auditId">
        <Button as="a" :href="`/api/crm/audits/${auditId}/report?format=pdf&download=1`" size="sm" variant="outline" class="h-8 gap-1.5"><FileDown class="size-4" /><span class="hidden lg:inline">Report PDF</span></Button>
        <Button v-if="canEmail" size="sm" class="h-8 gap-1.5" :disabled="dirty" :title="dirty ? 'Save the corrections first — the email uses the saved numbers' : 'Email this audit to the dealer'" @click="emit('email')"><Mail class="size-4" /><span class="hidden lg:inline">Email this audit</span></Button>
      </template>
    </template>
    <div v-if="dirty" class="shrink-0 flex flex-wrap items-center gap-3 px-5 py-2.5 bg-amber-500/10 border-b border-amber-500/20 text-sm">
      <Pencil class="size-4 text-amber-600" />
      <span><b>Not saved yet</b> — now <b class="tabular-nums">{{ r!.summary.withoutReal }}</b> of {{ r!.summary.total }} without a real photo ({{ r!.summary.withoutRealPct ?? 0 }}%). The audit, report and emails keep the old numbers until you save.</span>
      <Button size="sm" class="ml-auto h-8 gap-1.5" :disabled="saving" @click="save"><Loader2 v-if="saving" class="size-3.5 animate-spin" /><Check v-else class="size-3.5" /> Save corrections</Button>
    </div>
    <div class="flex-1 min-h-0">
      <div v-if="loading" class="h-full flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 class="size-4 animate-spin" /> Loading the crawl…</div>
      <div v-else-if="failed" class="h-full flex items-center justify-center text-sm text-muted-foreground">{{ failed }}</div>
      <CrmScannerResults v-else-if="r" :results="r" :review="sc.review" :recheck="sc.recheck" :list-rules="sc.listRules" :add-rule="sc.addRule" :remove-rule="sc.removeRule" />
    </div>
  </LayoutWorkScreen>
</template>
