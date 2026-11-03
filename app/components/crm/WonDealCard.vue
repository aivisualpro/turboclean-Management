<script setup lang="ts">
import type { WonAttribution, WonDeal, WonInput } from '~/composables/useCrmWon'
import { blankWonInput, money, validateWonInput, wonInputFrom } from '~/composables/useCrmWon'
import { Pencil, Loader2, AlertTriangle, Trophy } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format } from 'date-fns'

/** Won-deal summary on a won dealership, with "record / edit deal details". */
const props = defineProps<{ dealershipId: string, leadSource?: string, canEdit?: boolean }>()
const { getWin, saveWin } = useCrmWon()

const win = ref<WonDeal | null>(null)
const preview = ref<WonAttribution | null>(null)
const loaded = ref(false)
async function load() {
  try { const r = await getWin(props.dealershipId); win.value = r.win; preview.value = r.preview } catch {} finally { loaded.value = true }
}
onMounted(load)

const open = ref(false)
const form = ref<WonInput>(blankWonInput())
const errors = ref<Record<string, string>>({})
const saving = ref(false)
function edit() {
  form.value = win.value ? wonInputFrom(win.value) : blankWonInput(props.leadSource || '')
  errors.value = {}
  open.value = true
}
async function save() {
  errors.value = validateWonInput(form.value)
  if (Object.keys(errors.value).length) return
  saving.value = true
  try {
    win.value = await saveWin(props.dealershipId, form.value)
    toast.success('Deal details saved')
    open.value = false
    await load()
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save') } finally { saving.value = false }
}
const servicesLabel = computed(() => (win.value?.services || []).map(s => `${s.name} (${s.monthlyVolume}/mo)`).join(', '))
</script>

<template>
  <div v-if="loaded" class="relative px-2 pb-3 -mt-1">
    <div v-if="win" class="rounded-lg border border-emerald-500/25 bg-background/70 px-4 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
      <div><p class="text-[10px] uppercase tracking-wider text-muted-foreground">Won</p><p class="font-semibold">{{ format(new Date(`${win.wonAt}T12:00:00`), 'MMM d, yyyy') }}</p></div>
      <div><p class="text-[10px] uppercase tracking-wider text-muted-foreground">Est. revenue</p><p class="font-semibold tabular-nums">{{ money(win.monthlyRevenue) }}/mo · {{ money(win.annualRevenue) }}/yr</p></div>
      <div v-if="win.annualProfit != null"><p class="text-[10px] uppercase tracking-wider text-muted-foreground">Est. profit</p><p class="font-semibold tabular-nums">{{ money(win.annualProfit) }}/yr<span v-if="win.marginPct != null" class="text-muted-foreground font-normal"> · {{ win.marginPct }}%</span></p></div>
      <div class="min-w-0 max-w-xs"><p class="text-[10px] uppercase tracking-wider text-muted-foreground">Services · {{ win.contractStructure }}</p><p class="truncate" :title="servicesLabel">{{ servicesLabel }}</p></div>
      <div><p class="text-[10px] uppercase tracking-wider text-muted-foreground">To close</p><p class="font-semibold tabular-nums">{{ win.daysToClose ?? '—' }} days · {{ win.touches?.total ?? 0 }} touches</p></div>
      <div v-if="win.attribution?.template || win.attribution?.campaign" class="min-w-0 max-w-xs"><p class="text-[10px] uppercase tracking-wider text-muted-foreground">Credited to</p><p class="truncate">{{ win.attribution.template?.name || '' }}<span v-if="win.attribution.campaign" class="text-muted-foreground"> · {{ win.attribution.campaign.name }}</span></p></div>
      <Button v-if="canEdit" variant="ghost" size="sm" class="h-7 text-xs gap-1 ml-auto" @click="edit"><Pencil class="size-3.5" /> Edit deal</Button>
    </div>
    <div v-else class="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2 flex flex-wrap items-center gap-3 text-xs">
      <AlertTriangle class="size-4 text-amber-600" />
      <span class="text-amber-900 dark:text-amber-200">No deal details yet — record the services sold and revenue so this win counts in the won-deal report.</span>
      <Button v-if="canEdit" size="sm" class="h-7 text-xs ml-auto" @click="edit">Record deal details</Button>
    </div>

    <Dialog v-model:open="open">
      <DialogContent class="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2"><Trophy class="size-4 text-emerald-600" /> Won deal details</DialogTitle>
          <DialogDescription class="text-xs">Services sold, contract and revenue. Touches, first touch and days to close come from the relationship history.</DialogDescription>
        </DialogHeader>
        <CrmWonDealFields v-model="form" :preview="preview" :errors="errors" />
        <DialogFooter>
          <Button variant="ghost" @click="open = false">Cancel</Button>
          <Button class="bg-emerald-600 hover:bg-emerald-600/90 text-white" :disabled="saving" @click="save"><Loader2 v-if="saving" class="size-4 animate-spin" /> Save deal</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
