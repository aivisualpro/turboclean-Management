<script setup lang="ts">
import type { Dealer } from '~/composables/useDealers'
import { Trash2, ShieldAlert, Briefcase, Wrench, Receipt, Loader2, ArrowRight, Undo2, Check } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * Guarded dealer deletion. Loads what still depends on the dealer first; the
 * action is only offered when nothing does. Mirrors the server-side rule.
 */
const isOpen = defineModel<boolean>('open', { default: false })
const props = defineProps<{ dealer: Dealer | null }>()
const emit = defineEmits<{ deleted: [result: { id: string, crm: { dealershipId: string, stage: string } | null }] }>()

const { getDealerUsage, deleteDealer } = useDealers()

const loading = ref(false)
const deleting = ref(false)
const usage = ref<{ services: number, workOrders: number, invoices: number, total: number } | null>(null)
const confirmText = ref('')

watch(isOpen, async (o) => {
  if (!o || !props.dealer) return
  usage.value = null; confirmText.value = ''; loading.value = true
  try { usage.value = await getDealerUsage(props.dealer.id) } catch { usage.value = null } finally { loading.value = false }
})

const blockers = computed(() => {
  if (!usage.value || !props.dealer) return []
  const base = `/dealers/${props.dealer.id}`
  return [
    { key: 'services', label: 'Services', count: usage.value.services, icon: Briefcase, href: `${base}/services`, hint: 'Remove every service from the price list first.' },
    { key: 'workOrders', label: 'Work orders', count: usage.value.workOrders, icon: Wrench, href: `${base}/work-orders`, hint: 'Work orders are operational history and stay on record.' },
    { key: 'invoices', label: 'Invoices', count: usage.value.invoices, icon: Receipt, href: `${base}/invoices`, hint: 'Invoices are financial records and stay on record.' },
  ].filter(b => b.count > 0)
})
const blocked = computed(() => blockers.value.length > 0)
const wonViaCrm = computed(() => !!props.dealer?.crmDealershipCode)
const canConfirm = computed(() => !blocked.value && !loading.value && usage.value !== null && confirmText.value.trim().toUpperCase() === 'DELETE')

async function confirm() {
  if (!props.dealer || !canConfirm.value) return
  deleting.value = true
  try {
    const res = await deleteDealer(props.dealer.id)
    toast.success(`${props.dealer.dealerName} deleted`, res.crm
      ? { description: `CRM record returned to the pipeline as ${res.crm.stage}.`, action: { label: 'Open CRM record', onClick: () => navigateTo(`/crm/dealership/${res.crm!.dealershipId}`) } }
      : undefined)
    emit('deleted', { id: res.id, crm: res.crm })
    isOpen.value = false
  } catch (err: any) {
    const u = err?.data?.data?.usage
    if (err?.statusCode === 409 && u) { usage.value = u; toast.error('Dealer still has linked records') }
    else toast.error(err?.data?.statusMessage || err?.message || 'Could not delete dealer')
  } finally { deleting.value = false }
}
</script>

<template>
  <AlertDialog v-model:open="isOpen">
    <AlertDialogContent class="sm:max-w-lg">
      <AlertDialogHeader>
        <div class="flex items-start gap-3">
          <div class="size-10 rounded-xl flex items-center justify-center shrink-0" :class="blocked ? 'bg-amber-500/10' : 'bg-destructive/10'">
            <component :is="blocked ? ShieldAlert : Trash2" class="size-5" :class="blocked ? 'text-amber-600 dark:text-amber-400' : 'text-destructive'" />
          </div>
          <div class="min-w-0">
            <AlertDialogTitle>{{ blocked ? 'This dealer can\'t be deleted yet' : 'Delete dealer?' }}</AlertDialogTitle>
            <AlertDialogDescription class="text-xs mt-0.5">
              <span class="font-medium text-foreground">{{ dealer?.dealerName }}</span>
              <template v-if="blocked"> still has records that depend on it. Deleting would orphan them, so it's blocked until they're cleared.</template>
              <template v-else> will be removed permanently from Dealers and from AppSheet. This cannot be undone.</template>
            </AlertDialogDescription>
          </div>
        </div>
      </AlertDialogHeader>

      <div v-if="loading" class="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 class="size-4 animate-spin" /> Checking linked records…</div>

      <template v-else-if="usage">
        <!-- Blockers -->
        <ul v-if="blocked" class="rounded-lg border divide-y">
          <li v-for="b in blockers" :key="b.key" class="flex items-center gap-3 px-3 py-2.5">
            <component :is="b.icon" class="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium">{{ b.count }} {{ b.label.toLowerCase() }}</p>
              <p class="text-[11px] text-muted-foreground">{{ b.hint }}</p>
            </div>
            <NuxtLink :to="b.href" class="text-xs text-primary hover:underline underline-offset-2 inline-flex items-center gap-1 shrink-0" @click="isOpen = false">Review <ArrowRight class="size-3" /></NuxtLink>
          </li>
        </ul>

        <!-- Clear to delete -->
        <div v-else class="space-y-4">
          <ul class="rounded-lg border divide-y text-xs text-muted-foreground">
            <li class="flex items-center gap-2 px-3 py-2"><Check class="size-3.5 text-emerald-600" /> No services, work orders or invoices reference this dealer.</li>
            <li v-if="wonViaCrm" class="flex items-start gap-2 px-3 py-2"><Undo2 class="size-3.5 text-emerald-600 shrink-0 mt-0.5" /><span>CRM record <span class="font-mono text-foreground whitespace-nowrap">{{ dealer?.crmDealershipCode }}</span> returns to its previous pipeline stage; its history is kept.</span></li>
          </ul>
          <div class="space-y-1.5">
            <Label for="dealer-delete-confirm" class="text-xs">Type <span class="font-mono font-semibold">DELETE</span> to confirm</Label>
            <Input id="dealer-delete-confirm" v-model="confirmText" placeholder="DELETE" autocomplete="off" class="font-mono" @keydown.enter.prevent="confirm" />
          </div>
        </div>
      </template>
      <p v-else class="text-sm text-destructive py-2">Couldn't check linked records. Try again.</p>

      <AlertDialogFooter>
        <AlertDialogCancel :disabled="deleting">{{ blocked ? 'Close' : 'Cancel' }}</AlertDialogCancel>
        <Button v-if="!blocked" variant="destructive" class="min-w-32 gap-2" :disabled="!canConfirm || deleting" @click="confirm">
          <Loader2 v-if="deleting" class="size-4 animate-spin" /><Trash2 v-else class="size-4" /> Delete dealer
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
