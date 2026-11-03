<script setup lang="ts">
import type { CrmDealership, DealershipInput } from '~/composables/useCrmDealerships'
import { Building2, Globe, MapPin, Phone, Target, UserCircle2, X, Loader2, Sparkles } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { DEALERSHIP_STAGES, DEFAULT_STAGE, LEAD_SOURCES, STAGE_STYLE, US_STATES, WON_STAGE } from '~/constants/crm'

const isOpen = defineModel<boolean>('open', { default: false })
const props = defineProps<{ dealership?: CrmDealership | null }>()
const emit = defineEmits<{ saved: [d: CrmDealership] }>()

const { createDealership, updateDealership } = useCrmDealerships()

interface UserOpt { id: string, name: string, email: string }
const users = ref<UserOpt[]>([])
async function loadUsers() {
  if (users.value.length) return
  try {
    const res = await $fetch<any[]>('/api/users')
    users.value = (res || []).filter(u => u.status !== 'Inactive').map(u => ({ id: u.id, name: u.name || u.email, email: u.email }))
  } catch { /* non-blocking */ }
}

const blank = (): DealershipInput => ({
  name: '', dealerGroup: '', brands: [], website: '', address: '', city: '', state: '', zip: '', phone: '',
  territory: '', assignedUserId: '', assignedUserName: '', leadSource: 'Manual research', leadSourceDetail: '',
  stage: DEFAULT_STAGE, notes: '', tags: [], estMonthlyValue: null,
})
const form = ref<DealershipInput>(blank())
/** Duplicate guard: the server returns possible matches (409) — show them, allow "save anyway". */
const duplicates = ref<{ id: string, dealershipId: string, name: string, city: string, state: string, stage: string, reasons: string[], archived: boolean }[]>([])
watch(() => [form.value.name, form.value.website, form.value.phone], () => { duplicates.value = [] })
/** From the meeting stage on, an estimate feeds the dashboard's pipeline value. */
const showEstimate = computed(() => DEALERSHIP_STAGES.indexOf(form.value.stage as any) >= DEALERSHIP_STAGES.indexOf('Meeting Scheduled') && form.value.stage !== WON_STAGE)
const brandInput = ref('')
const saving = ref(false)
const errors = ref<Record<string, string>>({})

watch(isOpen, (open) => {
  if (!open) return
  loadUsers()
  errors.value = {}
  duplicates.value = []
  brandInput.value = ''
  form.value = props.dealership
    ? { ...blank(), ...JSON.parse(JSON.stringify(props.dealership)) }
    : blank()
})

const isEdit = computed(() => !!props.dealership)
// Won is a hand-off (it creates a Dealer) — it goes through "Mark as won", not this form.
// Won / Lost / Nurture need extra details (conversion, lost reason, revisit date) — set them from the stage menu.
const stageOptions = computed(() => DEALERSHIP_STAGES.filter(s => !['Won', 'Lost', 'Nurture / Follow Up Later'].includes(s) || props.dealership?.stage === s))
const stageLocked = computed(() => !!props.dealership?.dealerId)

function addBrand() {
  const v = brandInput.value.trim()
  if (!v) return
  if (!form.value.brands!.some(b => b.toLowerCase() === v.toLowerCase())) form.value.brands!.push(v)
  brandInput.value = ''
}
function removeBrand(i: number) { form.value.brands!.splice(i, 1) }

function onBrandKey(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addBrand() }
  else if (e.key === 'Backspace' && !brandInput.value && form.value.brands!.length) form.value.brands!.pop()
}

function onAssigneeChange(id: string) {
  form.value.assignedUserId = id === '__none' ? '' : id
  form.value.assignedUserName = users.value.find(u => u.id === id)?.name || ''
}

function validate() {
  const e: Record<string, string> = {}
  if (!form.value.name?.trim()) e.name = 'Dealership name is required'
  if (!isEdit.value && !form.value.state) e.state = 'State is required'
  if (form.value.zip && !/^\d{5}(-\d{4})?$/.test(form.value.zip)) e.zip = 'ZIP should be 5 digits (or ZIP+4)'
  if (form.value.website && !/^[\w.-]+\.[a-z]{2,}/i.test(form.value.website.replace(/^https?:\/\//i, ''))) e.website = 'Enter a valid website'
  errors.value = e
  return Object.keys(e).length === 0
}

async function submit(allowDuplicate = false) {
  addBrand()
  if (!validate()) return
  saving.value = true
  try {
    const payload: any = { ...form.value, ...(allowDuplicate ? { allowDuplicate: true } : {}) }
    if (payload.estMonthlyValue === '') payload.estMonthlyValue = null
    delete (payload as any).contactSummary
    const saved = isEdit.value
      ? await updateDealership(props.dealership!.id, payload)
      : await createDealership(payload)
    toast.success(isEdit.value ? 'Dealership updated' : `${saved.dealershipId} · ${saved.name} added`)
    emit('saved', saved)
    isOpen.value = false
  } catch (err: any) {
    const dups = err?.data?.data?.duplicates
    if (err?.statusCode === 409 && dups?.length) duplicates.value = dups
    else toast.error(err?.data?.statusMessage || err?.message || 'Could not save dealership')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Sheet v-model:open="isOpen">
    <SheetContent side="right" class="w-full sm:max-w-xl p-0 flex flex-col gap-0">
      <SheetHeader class="px-6 pt-6 pb-4 border-b">
        <div class="flex items-start gap-3">
          <div class="size-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Building2 class="size-5 text-primary" />
          </div>
          <div class="min-w-0">
            <SheetTitle class="text-base">{{ isEdit ? 'Edit dealership' : 'New dealership' }}</SheetTitle>
            <SheetDescription class="text-xs">
              <template v-if="isEdit">Record <span class="font-mono text-foreground">{{ dealership?.dealershipId }}</span> · changes are tracked in the activity log.</template>
              <template v-else>A permanent record with its own ID. Contacts are added after saving.</template>
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <form id="dealership-form" class="flex-1 overflow-y-auto px-6 py-5 space-y-7" @submit.prevent="submit()">
        <!-- Identity -->
        <section class="space-y-4">
          <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Building2 class="size-3.5" /> Identity
          </h4>
          <div class="space-y-1.5">
            <Label for="ds-name">Dealership name <span class="text-destructive">*</span></Label>
            <Input id="ds-name" v-model="form.name" placeholder="e.g. Metro Honda of Austin" :aria-invalid="!!errors.name" autofocus />
            <p v-if="errors.name" class="text-xs text-destructive">{{ errors.name }}</p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <Label for="ds-group">Dealer group / parent company</Label>
              <Input id="ds-group" v-model="form.dealerGroup" placeholder="e.g. AutoNation" />
            </div>
            <div class="space-y-1.5">
              <Label for="ds-website">Website</Label>
              <div class="relative">
                <Globe class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input id="ds-website" v-model="form.website" placeholder="metrohonda.com" class="pl-9" :aria-invalid="!!errors.website" />
              </div>
              <p v-if="errors.website" class="text-xs text-destructive">{{ errors.website }}</p>
            </div>
          </div>
          <div class="space-y-1.5">
            <Label for="ds-brands">Franchise / brands</Label>
            <div class="flex flex-wrap items-center gap-1.5 min-h-9 rounded-md border border-input bg-transparent dark:bg-input/30 px-2 py-1 shadow-xs focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] transition-[color,box-shadow]">
              <span v-for="(b, i) in form.brands" :key="b" class="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">
                {{ b }}
                <button type="button" class="hover:text-destructive" :aria-label="`Remove ${b}`" @click="removeBrand(i)"><X class="size-3" /></button>
              </span>
              <input
                id="ds-brands" v-model="brandInput" class="flex-1 min-w-24 bg-transparent outline-none text-sm py-0.5 placeholder:text-muted-foreground"
                :placeholder="form.brands?.length ? 'Add another…' : 'Honda, Acura… press Enter'" @keydown="onBrandKey" @blur="addBrand"
              >
            </div>
          </div>
        </section>

        <!-- Location -->
        <section class="space-y-4">
          <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <MapPin class="size-3.5" /> Location & contact
          </h4>
          <div class="space-y-1.5">
            <Label for="ds-address">Street address</Label>
            <Input id="ds-address" v-model="form.address" placeholder="1200 S Lamar Blvd" />
          </div>
          <div class="grid grid-cols-6 gap-3">
            <div class="col-span-6 sm:col-span-3 space-y-1.5">
              <Label for="ds-city">City</Label>
              <Input id="ds-city" v-model="form.city" placeholder="Austin" />
            </div>
            <div class="col-span-3 sm:col-span-1 space-y-1.5">
              <Label>State <span v-if="!isEdit" class="text-destructive">*</span></Label>
              <Select v-model="form.state">
                <SelectTrigger class="w-full" :aria-invalid="!!errors.state"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent class="max-h-72">
                  <SelectItem v-for="s in US_STATES" :key="s" :value="s">{{ s }}</SelectItem>
                </SelectContent>
              </Select>
              <p v-if="errors.state" class="text-xs text-destructive">{{ errors.state }}</p>
            </div>
            <div class="col-span-3 sm:col-span-2 space-y-1.5">
              <Label for="ds-zip">ZIP</Label>
              <Input id="ds-zip" v-model="form.zip" placeholder="78704" inputmode="numeric" :aria-invalid="!!errors.zip" />
              <p v-if="errors.zip" class="text-xs text-destructive">{{ errors.zip }}</p>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <Label for="ds-phone">Main phone</Label>
              <div class="relative">
                <Phone class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input id="ds-phone" v-model="form.phone" placeholder="(512) 555-0100" class="pl-9" inputmode="tel" />
              </div>
            </div>
            <div class="space-y-1.5">
              <Label for="ds-territory">Territory / market</Label>
              <Input id="ds-territory" v-model="form.territory" placeholder="Central Texas" />
            </div>
          </div>
        </section>

        <!-- Pipeline -->
        <section class="space-y-4">
          <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Target class="size-3.5" /> Pipeline & ownership
          </h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <Label>Assigned salesperson</Label>
              <Select :model-value="form.assignedUserId || '__none'" @update:model-value="onAssigneeChange($event as string)">
                <SelectTrigger class="w-full">
                  <div class="flex items-center gap-2 truncate">
                    <UserCircle2 class="size-4 text-muted-foreground shrink-0" />
                    <SelectValue placeholder="Unassigned" />
                  </div>
                </SelectTrigger>
                <SelectContent class="max-h-72">
                  <SelectItem value="__none">Unassigned</SelectItem>
                  <SelectItem v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1.5">
              <Label>Stage</Label>
              <Select v-model="form.stage" :disabled="stageLocked">
                <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent class="max-h-80">
                  <SelectItem v-for="s in stageOptions" :key="s" :value="s"><span class="flex items-center gap-2"><span class="size-1.5 rounded-full" :class="STAGE_STYLE[s]?.dot" />{{ s }}</span></SelectItem>
                </SelectContent>
              </Select>
              <p v-if="stageLocked" class="text-[11px] text-muted-foreground">Won — delete the Dealer to return it to the pipeline.</p>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <Label>Lead source</Label>
              <Select v-model="form.leadSource">
                <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent class="max-h-72">
                  <SelectItem v-for="s in LEAD_SOURCES" :key="s" :value="s">{{ s }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1.5">
              <Label for="ds-lead-detail">Source detail</Label>
              <Input id="ds-lead-detail" v-model="form.leadSourceDetail" :placeholder="form.leadSource === 'Referral' ? 'Referred by…' : 'Campaign, event, person…'" />
            </div>
          </div>
          <div v-if="showEstimate" class="space-y-1.5">
            <Label for="ds-est">Est. monthly value <span class="text-muted-foreground font-normal text-xs">(optional — feeds pipeline value)</span></Label>
            <div class="relative w-48"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span><Input id="ds-est" v-model="form.estMonthlyValue" type="number" min="0" step="50" placeholder="e.g. 1500" class="pl-6 tabular-nums" /></div>
          </div>
          <div class="space-y-1.5">
            <Label for="ds-notes">Internal notes</Label>
            <Textarea id="ds-notes" v-model="form.notes" rows="3" placeholder="Context the team should know before reaching out." class="resize-none" />
          </div>
        </section>
      </form>

      <div v-if="duplicates.length" class="mx-6 mb-0 mt-0 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm space-y-2">
        <p class="font-medium text-amber-900 dark:text-amber-200">This looks like a dealership that's already in the CRM:</p>
        <ul class="space-y-1">
          <li v-for="d in duplicates" :key="d.id" class="flex flex-wrap items-center gap-x-2 text-xs">
            <NuxtLink :to="`/crm/dealership/${d.id}`" class="font-medium text-primary hover:underline" @click="isOpen = false">{{ d.name }}</NuxtLink>
            <span class="text-muted-foreground">{{ d.dealershipId }} · {{ [d.city, d.state].filter(Boolean).join(', ') }} · {{ d.stage }}<span v-if="d.archived"> · archived</span></span>
            <span class="text-amber-700 dark:text-amber-300">{{ d.reasons.join(' · ') }}</span>
          </li>
        </ul>
        <div class="flex gap-2"><Button size="sm" variant="outline" class="h-7 text-xs" :disabled="saving" @click="submit(true)">It's a different dealership — save anyway</Button></div>
      </div>
      <SheetFooter class="px-6 py-4 border-t flex-row items-center justify-between gap-3 sm:justify-between">
        <p class="text-[11px] text-muted-foreground hidden sm:flex items-center gap-1.5">
          <Sparkles class="size-3" /> <span v-if="!isEdit">ID is assigned automatically on save.</span><span v-else>Edits are written to the timeline.</span>
        </p>
        <div class="flex items-center gap-2 ml-auto">
          <Button type="button" variant="ghost" :disabled="saving" @click="isOpen = false">Cancel</Button>
          <Button type="submit" form="dealership-form" :disabled="saving" class="min-w-28">
            <Loader2 v-if="saving" class="size-4 animate-spin" />
            <span v-else>{{ isEdit ? 'Save changes' : 'Create dealership' }}</span>
          </Button>
        </div>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
