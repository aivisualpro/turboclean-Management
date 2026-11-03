<script setup lang="ts">
import type { ConvertInput, CrmContact, CrmDealership } from '~/composables/useCrmDealerships'
import type { WonAttribution, WonInput } from '~/composables/useCrmWon'
import { blankWonInput, validateWonInput } from '~/composables/useCrmWon'
import { Trophy, ArrowRight, Users, Building2, Briefcase, ShieldCheck, Loader2, Sparkles, MapPin, Star, Check, ExternalLink } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * "We won the account" — promotes a CRM dealership into an operational Dealer.
 * Shows exactly what will be created before anything is written.
 */
const isOpen = defineModel<boolean>('open', { default: false })
const props = defineProps<{ dealership: CrmDealership | null, contacts?: CrmContact[] }>()
const emit = defineEmits<{ converted: [dealerId: string] }>()

const { convertDealership } = useCrmDealerships()
const { dealers, fetchDealers } = useDealers()

const { getWin } = useCrmWon()
const WON_PRICES = '__won'
const form = ref<Required<Pick<ConvertInput, 'status' | 'isTaxApplied' | 'taxPercentage' | 'copyServicesFromDealerId' | 'duplicateStock'>>>({
  status: 'Authorised', isTaxApplied: false, taxPercentage: 0, copyServicesFromDealerId: WON_PRICES, duplicateStock: false,
})
// Won-deal details (section 10): services sold, contract, revenue, profit, attribution.
const won = ref<WonInput>(blankWonInput())
const preview = ref<WonAttribution | null>(null)
const wonErrors = ref<Record<string, string>>({})
const openAfter = useLocalStorage('crm-convert-open-after', true)
const saving = ref(false)

watch(isOpen, async (o) => {
  if (!o) return
  form.value = { status: 'Authorised', isTaxApplied: false, taxPercentage: 0, copyServicesFromDealerId: WON_PRICES, duplicateStock: false }
  won.value = blankWonInput(props.dealership?.leadSource || '')
  wonErrors.value = {}
  preview.value = null
  if (props.dealership) getWin(props.dealership.id).then((r) => { preview.value = r.preview }).catch(() => {})
  if (!dealers.value.length) fetchDealers().catch(() => {})
})

const activeContacts = computed(() => (props.contacts || []).filter(c => c.isActive))
const address = computed(() => props.dealership ? [props.dealership.address, [props.dealership.city, props.dealership.state].filter(Boolean).join(', '), props.dealership.zip].filter(Boolean).join(' · ') : '')
const sourceDealer = computed(() => dealers.value.find(d => d.id === form.value.copyServicesFromDealerId))
const serviceCount = computed(() => sourceDealer.value?.services?.length || 0)
const alreadyConverted = computed(() => !!props.dealership?.dealerId)

async function submit() {
  if (!props.dealership) return
  if (!alreadyConverted.value) {
    wonErrors.value = validateWonInput(won.value)
    if (Object.keys(wonErrors.value).length) { toast.error(wonErrors.value.services || 'Check the deal details'); return }
  }
  saving.value = true
  try {
    const copy = form.value.copyServicesFromDealerId
    const res = await convertDealership(props.dealership.id, {
      ...form.value,
      copyServicesFromDealerId: copy === '__none' || copy === WON_PRICES ? '' : copy,
      ...(alreadyConverted.value ? {} : { won: { ...won.value, useAsPriceList: copy === WON_PRICES } }),
    })
    await fetchDealers().catch(() => {})
    toast.success(res.created ? `${props.dealership.name} is now a Dealer` : `${props.dealership.name} was already a Dealer`, {
      description: res.created ? `${res.contactsCarried} contact${res.contactsCarried === 1 ? '' : 's'} carried over${res.servicesCopied ? ` · ${res.servicesCopied} services copied` : ''}` : undefined,
      action: { label: 'Open in Dealers', onClick: () => navigateTo(`/dealers/${res.dealerId}/details`) },
    })
    emit('converted', res.dealerId)
    isOpen.value = false
    if (openAfter.value) navigateTo(`/dealers/${res.dealerId}/details`)
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || err?.message || 'Conversion failed')
  } finally { saving.value = false }
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-2xl max-h-[92vh] overflow-y-auto p-0 gap-0">
      <div class="relative px-6 pt-6 pb-5 border-b overflow-hidden">
        <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,theme(colors.emerald.500/12),transparent_60%)]" />
        <DialogHeader class="relative">
          <div class="flex items-start gap-3">
            <div class="size-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0"><Trophy class="size-5 text-emerald-600 dark:text-emerald-400" /></div>
            <div class="min-w-0">
              <DialogTitle class="text-lg">Mark as won &amp; promote to Dealer</DialogTitle>
              <DialogDescription class="text-xs mt-0.5">
                <span class="font-medium text-foreground">{{ dealership?.name }}</span> becomes an operational dealer — services, work orders and invoices continue in <span class="font-medium text-foreground">Dealers</span>. The CRM record and its history stay linked.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
      </div>

      <div v-if="dealership" class="px-6 py-5 space-y-5">
        <div v-if="alreadyConverted" class="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm flex items-center gap-3">
          <Check class="size-4 text-emerald-600" /> This dealership is already a Dealer. Converting again will simply open the existing record.
        </div>

        <!-- What will be created -->
        <section class="rounded-xl border overflow-hidden">
          <header class="px-4 py-2.5 bg-muted/40 border-b text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><Sparkles class="size-3.5" /> What will be created</header>
          <div class="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x">
            <div class="p-4 space-y-3">
              <div class="flex items-start gap-3">
                <div class="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Building2 class="size-4 text-primary" /></div>
                <div class="min-w-0">
                  <p class="text-[10px] uppercase tracking-wider text-muted-foreground">Dealer</p>
                  <p class="font-semibold truncate">{{ dealership.name }}</p>
                  <p v-if="dealership.dealerGroup || dealership.brands?.length" class="text-xs text-muted-foreground truncate">{{ [dealership.dealerGroup, dealership.brands?.join(', ')].filter(Boolean).join(' · ') }}</p>
                </div>
              </div>
              <div class="flex items-start gap-3">
                <div class="size-9 rounded-lg bg-muted flex items-center justify-center shrink-0"><MapPin class="size-4 text-muted-foreground" /></div>
                <div class="min-w-0">
                  <p class="text-[10px] uppercase tracking-wider text-muted-foreground">Address</p>
                  <p class="text-sm" :class="!address && 'italic text-muted-foreground'">{{ address || 'No address on file' }}</p>
                </div>
              </div>
              <div class="flex items-center gap-2 text-[11px] text-muted-foreground pt-1">
                <span class="font-mono bg-muted px-1.5 py-0.5 rounded">{{ dealership.dealershipId }}</span><ArrowRight class="size-3" /> linked to the new dealer · lead source <span class="font-medium text-foreground">{{ dealership.leadSource }}</span>
              </div>
            </div>
            <div class="p-4">
              <div class="flex items-center justify-between mb-2">
                <p class="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Users class="size-3.5" /> Contacts carried over</p>
                <Badge variant="secondary" class="text-[10px]">{{ activeContacts.length }}</Badge>
              </div>
              <ul v-if="activeContacts.length" class="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                <li v-for="c in activeContacts" :key="c.id" class="flex items-center gap-2 text-sm">
                  <div class="size-6 rounded-md bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">{{ (c.firstName?.[0] || '') + (c.lastName?.[0] || '') }}</div>
                  <span class="truncate">{{ c.fullName }}</span>
                  <Star v-if="c.isPrimary" class="size-3 text-amber-500 fill-amber-500 shrink-0" />
                  <span class="text-xs text-muted-foreground truncate ml-auto">{{ c.jobTitle || c.role }}</span>
                </li>
              </ul>
              <p v-else class="text-xs italic text-muted-foreground">No active contacts — you can add them in Dealers afterwards.</p>
              <p class="text-[11px] text-muted-foreground mt-2">Former contacts stay in CRM history only.</p>
            </div>
          </div>
        </section>

        <!-- Deal details (won-deal tracking) -->
        <section v-if="!alreadyConverted" class="space-y-3">
          <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><Trophy class="size-3.5" /> Deal details</h4>
          <CrmWonDealFields v-model="won" :preview="preview" :errors="wonErrors" />
        </section>

        <!-- Operational setup -->
        <section class="space-y-4">
          <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><Briefcase class="size-3.5" /> Operational setup</h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <Label>Dealer status</Label>
              <Select v-model="form.status">
                <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Authorised">Authorised — ready for work orders</SelectItem>
                  <SelectItem value="Pending">Pending — paperwork outstanding</SelectItem>
                  <SelectItem value="In Followup">In Followup</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1.5">
              <Label>Copy service pricing from</Label>
              <Select v-model="form.copyServicesFromDealerId">
                <SelectTrigger class="w-full"><SelectValue placeholder="Start with an empty catalogue" /></SelectTrigger>
                <SelectContent class="max-h-64">
                  <SelectItem :value="WON_PRICES">Use the prices of the services sold</SelectItem>
                  <SelectItem value="__none">Start with an empty catalogue</SelectItem>
                  <SelectItem v-for="d in dealers.filter(x => x.services?.length)" :key="d.id" :value="d.id">{{ d.dealerName }} <span class="text-muted-foreground">· {{ d.services?.length }} services</span></SelectItem>
                </SelectContent>
              </Select>
              <p v-if="serviceCount" class="text-[11px] text-muted-foreground">{{ serviceCount }} services will be cloned with new IDs.</p>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer select-none hover:bg-accent/40 transition-colors">
              <div class="flex items-center gap-2.5"><ShieldCheck class="size-4" :class="form.isTaxApplied ? 'text-primary' : 'text-muted-foreground'" /><div><p class="text-sm font-medium">Apply tax</p><p class="text-[11px] text-muted-foreground">Charged on every invoice</p></div></div>
              <div class="flex items-center gap-2">
                <div v-if="form.isTaxApplied" class="relative w-20" @click.stop>
                  <Input v-model="form.taxPercentage" type="number" min="0" max="100" step="0.1" class="h-8 pr-6 text-xs tabular-nums" />
                  <span class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">%</span>
                </div>
                <Switch v-model="form.isTaxApplied" />
              </div>
            </label>
            <label class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer select-none hover:bg-accent/40 transition-colors">
              <div><p class="text-sm font-medium">Allow duplicate stock numbers</p><p class="text-[11px] text-muted-foreground">Usually off</p></div>
              <Switch v-model="form.duplicateStock" />
            </label>
          </div>
        </section>
      </div>

      <DialogFooter class="px-6 py-4 border-t sm:justify-between items-center gap-3">
        <label class="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <Checkbox v-model="openAfter" /> Open in Dealers afterwards
        </label>
        <div class="flex items-center gap-2">
          <Button variant="ghost" :disabled="saving" @click="isOpen = false">Cancel</Button>
          <Button class="min-w-44 gap-2 bg-emerald-600 hover:bg-emerald-600/90 text-white" :disabled="saving" @click="submit">
            <Loader2 v-if="saving" class="size-4 animate-spin" />
            <template v-else><Trophy class="size-4" /> {{ alreadyConverted ? 'Open existing Dealer' : 'Confirm — promote to Dealer' }} <ExternalLink v-if="openAfter" class="size-3.5 opacity-70" /></template>
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
