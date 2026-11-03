<script setup lang="ts">
import type { WonAttribution, WonInput } from '~/composables/useCrmWon'
import { money } from '~/composables/useCrmWon'
import { Plus, Trash2, Package, FileSignature, DollarSign, Route as RouteIcon, Pencil, Mail, Hourglass, Footprints } from 'lucide-vue-next'
import { format } from 'date-fns'
import { CONTRACT_STRUCTURES, CONTRACT_TERMS, LEAD_SOURCES } from '~/constants/crm'

/**
 * Won-deal capture: services sold (price × cars/month), contract, revenue, profit,
 * and the attribution worked out from the relationship history.
 */
const model = defineModel<WonInput>({ required: true })
const props = defineProps<{ preview: WonAttribution | null, errors?: Record<string, string> }>()

const { serviceCatalog, loadServices } = useCrmWon()
const { templates, campaigns, loadLibrary } = useCrmEmail()
onMounted(() => { loadServices(); loadLibrary().catch(() => {}) })

const CUSTOM = '__custom'
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }
const round2 = (n: number) => Math.round(n * 100) / 100
const rowMonthly = (s: WonInput['services'][number]) => round2(num(s.price) * Math.round(num(s.monthlyVolume)))
const calculated = computed(() => round2(model.value.services.reduce((a, s) => a + rowMonthly(s), 0)))
const overriding = ref(model.value.monthlyRevenueOverride !== null && model.value.monthlyRevenueOverride !== '')
watch(overriding, (o) => { if (!o) model.value.monthlyRevenueOverride = null; else if (model.value.monthlyRevenueOverride == null) model.value.monthlyRevenueOverride = calculated.value || '' })
const monthly = computed(() => overriding.value && model.value.monthlyRevenueOverride !== '' && model.value.monthlyRevenueOverride != null ? num(model.value.monthlyRevenueOverride) : calculated.value)
const blank = (v: unknown) => v === '' || v == null
const monthlyCost = computed(() => {
  if (model.value.costMode === 'pct') return blank(model.value.costPct) ? null : round2(monthly.value * Math.min(100, num(model.value.costPct)) / 100)
  if (model.value.costMode === 'amount') return blank(model.value.monthlyCost) ? null : num(model.value.monthlyCost)
  return null
})
const monthlyProfit = computed(() => monthlyCost.value == null ? null : round2(monthly.value - monthlyCost.value))
const margin = computed(() => monthlyProfit.value == null || !monthly.value ? null : Math.round((monthlyProfit.value / monthly.value) * 1000) / 10)

function addService() { model.value.services.push({ serviceId: '', name: '', price: '', monthlyVolume: '' }) }
function removeService(i: number) { model.value.services.splice(i, 1) }
function serviceKey(s: WonInput['services'][number]) { return s.serviceId || (s.name ? CUSTOM : '') }
function pickService(i: number, v: string) {
  const s = model.value.services[i]
  if (!s) return
  if (v === CUSTOM) { s.serviceId = ''; s.name = s.name || ''; customRows.value.add(i); return }
  customRows.value.delete(i)
  const c = serviceCatalog.value.find(x => x.id === v)
  s.serviceId = v; s.name = c?.service || ''
}
const customRows = ref(new Set<number>())

// Attribution: auto unless overridden.
const editingAttribution = ref(!!(model.value.attributionTemplateId || model.value.attributionCampaignId))
const NONE = '__none'
function toggleAttribution() {
  editingAttribution.value = !editingAttribution.value
  if (!editingAttribution.value) { model.value.attributionTemplateId = ''; model.value.attributionCampaignId = '' }
}
const MODEL_LABEL: Record<string, string> = {
  credited: 'credited with the win', replied: 'last email that got a reply', first_email: 'first email sent (first touch)', none: '', manual: 'set by hand',
}
const daysToClose = computed(() => {
  const f = props.preview?.firstContactAt
  if (!f || !model.value.wonAt) return null
  return Math.max(0, Math.round((new Date(`${model.value.wonAt}T12:00:00`).getTime() - new Date(f).getTime()) / 86_400_000))
})
</script>

<template>
  <div class="space-y-5">
    <!-- Date + services -->
    <section class="space-y-2.5">
      <div class="flex items-center justify-between gap-3">
        <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><Package class="size-3.5" /> Services sold <span class="text-destructive">*</span></h4>
        <label class="flex items-center gap-2 text-xs text-muted-foreground">Date won <Input v-model="model.wonAt" type="date" class="h-8 w-40 text-xs" /></label>
      </div>
      <div class="rounded-lg border overflow-hidden">
        <div class="grid grid-cols-[1fr_96px_88px_96px_28px] gap-2 px-3 py-1.5 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Service</span><span class="text-right">Price</span><span class="text-right">Cars / mo</span><span class="text-right">Monthly</span><span />
        </div>
        <div v-for="(s, i) in model.services" :key="i" class="grid grid-cols-[1fr_96px_88px_96px_28px] gap-2 px-3 py-1.5 items-center border-t">
          <div class="min-w-0 space-y-1">
            <Select :model-value="customRows.has(i) ? CUSTOM : serviceKey(s)" @update:model-value="(v: any) => pickService(i, String(v))">
              <SelectTrigger class="h-8 w-full text-xs"><SelectValue placeholder="Choose a service" /></SelectTrigger>
              <SelectContent class="max-h-64">
                <SelectItem v-for="c in serviceCatalog" :key="c.id" :value="c.id">{{ c.service }}</SelectItem>
                <SelectItem :value="CUSTOM">Other — type a name</SelectItem>
              </SelectContent>
            </Select>
            <Input v-if="customRows.has(i) || (!s.serviceId && s.name)" v-model="s.name" placeholder="Service name" class="h-7 text-xs" />
          </div>
          <div class="relative"><span class="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span><Input v-model="s.price" type="number" min="0" step="0.01" class="h-8 pl-5 text-xs text-right tabular-nums" aria-label="Price per vehicle" /></div>
          <Input v-model="s.monthlyVolume" type="number" min="0" step="1" class="h-8 text-xs text-right tabular-nums" aria-label="Vehicles per month" />
          <span class="text-right text-xs tabular-nums font-medium">{{ money(rowMonthly(s), 2) }}</span>
          <button type="button" class="text-muted-foreground hover:text-destructive disabled:opacity-30" :disabled="model.services.length === 1" aria-label="Remove service" @click="removeService(i)"><Trash2 class="size-3.5" /></button>
        </div>
        <button type="button" class="w-full border-t px-3 py-1.5 text-xs text-primary hover:bg-muted/40 flex items-center gap-1" @click="addService"><Plus class="size-3.5" /> Add service</button>
      </div>
      <p v-if="errors?.services" class="text-xs text-destructive">{{ errors.services }}</p>
    </section>

    <!-- Revenue + profit -->
    <section class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="rounded-lg border p-3 space-y-2">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><DollarSign class="size-3.5" /> Estimated revenue</p>
        <div class="flex items-baseline justify-between"><span class="text-xs text-muted-foreground">Monthly</span><span class="text-lg font-bold tabular-nums">{{ money(monthly) }}</span></div>
        <div class="flex items-baseline justify-between"><span class="text-xs text-muted-foreground">Annual</span><span class="text-sm font-semibold tabular-nums">{{ money(monthly * 12) }}</span></div>
        <label class="flex items-center gap-2 text-[11px] text-muted-foreground pt-1"><Switch v-model="overriding" /> Override monthly total</label>
        <div v-if="overriding" class="relative"><span class="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span><Input v-model="model.monthlyRevenueOverride" type="number" min="0" step="10" class="h-8 pl-5 text-xs tabular-nums" /><p class="text-[10px] text-muted-foreground mt-1">Calculated from services: {{ money(calculated) }}</p></div>
      </div>
      <div class="rounded-lg border p-3 space-y-2">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Estimated profit <span class="normal-case font-normal">(if known)</span></p>
        <div class="inline-flex rounded-md border p-0.5 bg-muted/40 text-[11px]">
          <button v-for="o in [{ k: 'none', l: 'Unknown' }, { k: 'pct', l: 'Cost %' }, { k: 'amount', l: 'Cost $/mo' }]" :key="o.k" type="button" class="px-2 py-0.5 rounded" :class="model.costMode === o.k ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'" @click="model.costMode = o.k as any">{{ o.l }}</button>
        </div>
        <div v-if="model.costMode === 'pct'" class="relative w-32"><Input v-model="model.costPct" type="number" min="0" max="100" step="1" placeholder="e.g. 55" class="h-8 pr-6 text-xs tabular-nums" /><span class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">%</span></div>
        <div v-else-if="model.costMode === 'amount'" class="relative w-36"><span class="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span><Input v-model="model.monthlyCost" type="number" min="0" step="10" class="h-8 pl-5 text-xs tabular-nums" /></div>
        <template v-if="monthlyProfit != null">
          <div class="flex items-baseline justify-between"><span class="text-xs text-muted-foreground">Monthly</span><span class="text-sm font-semibold tabular-nums" :class="monthlyProfit < 0 && 'text-destructive'">{{ money(monthlyProfit) }}</span></div>
          <div class="flex items-baseline justify-between"><span class="text-xs text-muted-foreground">Annual · margin</span><span class="text-sm tabular-nums">{{ money(monthlyProfit * 12) }}<span v-if="margin != null" class="text-muted-foreground"> · {{ margin }}%</span></span></div>
        </template>
        <p v-else class="text-[11px] text-muted-foreground">{{ model.costMode === 'pct' ? 'Labor + supplies as a % of revenue.' : model.costMode === 'amount' ? 'Labor + supplies per month.' : 'Leave as unknown if you do not have costs yet — revenue is still tracked.' }}</p>
      </div>
    </section>

    <!-- Contract -->
    <section class="space-y-2.5">
      <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><FileSignature class="size-3.5" /> Contract structure</h4>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Select v-model="model.contractStructure">
          <SelectTrigger class="w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem v-for="c in CONTRACT_STRUCTURES" :key="c" :value="c">{{ c }}</SelectItem></SelectContent>
        </Select>
        <Select v-model="model.contractTerm">
          <SelectTrigger class="w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem v-for="t in CONTRACT_TERMS" :key="t" :value="t">{{ t }}</SelectItem></SelectContent>
        </Select>
        <div v-if="model.contractStructure === 'Per vehicle + monthly minimum'" class="relative"><span class="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span><Input v-model="model.monthlyMinimum" type="number" min="0" placeholder="Monthly minimum" class="pl-5 text-xs tabular-nums" /></div>
      </div>
      <Textarea v-model="model.contractNotes" rows="2" class="text-sm" placeholder="Terms worth remembering — pricing tiers, start date, who signed, cancellation…" />
    </section>

    <!-- Attribution -->
    <section class="rounded-lg border p-3 space-y-3">
      <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><RouteIcon class="size-3.5" /> How we won it <span class="normal-case font-normal">— from the relationship history</span></h4>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div class="space-y-1">
          <p class="text-[10px] uppercase tracking-wider text-muted-foreground">Acquisition source</p>
          <Select v-model="model.acquisitionSource">
            <SelectTrigger class="h-8 w-full text-xs"><SelectValue placeholder="Lead source" /></SelectTrigger>
            <SelectContent><SelectItem v-for="s in LEAD_SOURCES" :key="s" :value="s">{{ s }}</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Footprints class="size-3" /> First touch</p>
          <p class="font-medium mt-1">{{ preview?.firstTouch?.label || '—' }}</p>
          <p v-if="preview?.firstTouch" class="text-[11px] text-muted-foreground">{{ format(new Date(preview.firstTouch.at), 'MMM d, yyyy') }} · {{ preview.firstTouch.channel }}</p>
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Mail class="size-3" /> Touches before close</p>
          <p class="font-medium mt-1 tabular-nums">{{ preview?.touches.total ?? 0 }} <span class="text-muted-foreground font-normal">· {{ preview?.touches.emails ?? 0 }} emails</span></p>
          <p v-if="preview" class="text-[11px] text-muted-foreground">{{ preview.touches.calls }} calls · {{ preview.touches.visits }} visits · {{ preview.touches.meetings }} meetings</p>
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Hourglass class="size-3" /> First contact → close</p>
          <p class="font-medium mt-1 tabular-nums">{{ daysToClose == null ? '—' : `${daysToClose} days` }}</p>
        </div>
      </div>
      <div class="border-t pt-3">
        <div class="flex items-center justify-between gap-2">
          <p class="text-[10px] uppercase tracking-wider text-muted-foreground">Campaign / template responsible</p>
          <button type="button" class="text-[11px] text-primary inline-flex items-center gap-1" @click="toggleAttribution"><Pencil class="size-3" /> {{ editingAttribution ? 'Use automatic' : 'Change' }}</button>
        </div>
        <template v-if="!editingAttribution">
          <p v-if="preview?.template || preview?.campaign" class="text-sm mt-1">
            <span class="font-medium">{{ preview?.template?.name || 'No template' }}</span><span v-if="preview?.template?.version" class="text-muted-foreground"> · {{ preview.template.version }}</span>
            <span v-if="preview?.campaign" class="text-muted-foreground"> · campaign {{ preview.campaign.name }}</span>
          </p>
          <p v-else class="text-sm mt-1 text-muted-foreground">No CRM email in this deal's history.</p>
          <p v-if="preview && preview.model !== 'none'" class="text-[11px] text-muted-foreground">Automatic: {{ MODEL_LABEL[preview.model] }}.</p>
        </template>
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
          <Select :model-value="model.attributionTemplateId || NONE" @update:model-value="(v: any) => model.attributionTemplateId = v === NONE ? '' : String(v)">
            <SelectTrigger class="h-8 w-full text-xs"><SelectValue placeholder="Template" /></SelectTrigger>
            <SelectContent class="max-h-64"><SelectItem :value="NONE">No template</SelectItem><SelectItem v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</SelectItem></SelectContent>
          </Select>
          <Select :model-value="model.attributionCampaignId || NONE" @update:model-value="(v: any) => model.attributionCampaignId = v === NONE ? '' : String(v)">
            <SelectTrigger class="h-8 w-full text-xs"><SelectValue placeholder="Campaign" /></SelectTrigger>
            <SelectContent class="max-h-64"><SelectItem :value="NONE">No campaign</SelectItem><SelectItem v-for="c in campaigns" :key="c.id" :value="c.id">{{ c.name }}</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
    </section>
  </div>
</template>
