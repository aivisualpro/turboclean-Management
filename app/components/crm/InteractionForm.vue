<script setup lang="ts">
import type { CrmContact, CrmDealership, CrmInteraction, InteractionInput } from '~/composables/useCrmDealerships'
import { localDay } from '~/composables/useCrmDealerships'
import { Loader2, CalendarClock, UserRound, ArrowRight, CircleCheck, NotebookPen, Target, AlertTriangle, Timer } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format, addDays } from 'date-fns'
import { INTERACTION_GROUPS, INTERACTION_TYPES, INTERACTION_TYPE_MAP, NEXT_ACTION_TYPES, OPEN_STAGES, QUEUE_STAGES, STAGE_STYLE, WON_STAGE, LOST_REASONS, TIME_CATEGORIES, INTERACTION_TIME_CATEGORY, formatMinutes } from '~/constants/crm'
import { INTERACTION_ICONS } from '~/constants/crm-icons'

/**
 * Log (or edit) one interaction with a dealership:
 * date/time · contact · type · user · notes · result/outcome · next action + date.
 */
const isOpen = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  dealership: CrmDealership | null
  contacts: CrmContact[]
  interaction?: CrmInteraction | null
  defaultType?: string
  openNextActions?: number
}>()
const emit = defineEmits<{ saved: [r: { interaction: CrmInteraction, stageMoved: string | null }], won: [] }>()
const { logInteraction, updateInteraction } = useCrmDealerships()
const { user: me } = useAuth()

const NONE = '__none'
const ME = '__me'
const nowLocal = () => format(new Date(), "yyyy-MM-dd'T'HH:mm")
const blank = () => ({
  type: props.defaultType || 'phone_call', occurredAt: nowLocal(), contactId: NONE, userId: ME,
  notes: '', outcome: '', nextAction: '', nextActionDate: '', nextActionType: '', nextActionTime: '',
})
const form = ref(blank())
const completePrevious = ref(true)
const moveStage = ref(true)
const lost = ref({ lostReason: '', lostNotes: '', lostCompetitor: '' })
/** Time tracking: minutes this took (optional) and what kind of time it was. */
const minutesSpent = ref<number | string>('')
const timeCategory = ref('')
const TIME_PRESETS = [5, 10, 15, 30, 45, 60]
const { version: timeVersion } = useCrmTime()
const saving = ref(false)
const errors = ref<Record<string, string>>({})
const isEdit = computed(() => !!props.interaction)

const users = ref<{ id: string, name: string }[]>([])
async function loadUsers() {
  if (users.value.length) return
  try { const res = await $fetch<any[]>('/api/users'); users.value = (res || []).filter(u => u.status !== 'Inactive').map(u => ({ id: u.id, name: u.name || u.email })) } catch {}
}

watch(isOpen, (o) => {
  if (!o) return
  loadUsers()
  errors.value = {}
  completePrevious.value = true
  moveStage.value = true
  lost.value = { lostReason: '', lostNotes: '', lostCompetitor: '' }
  minutesSpent.value = ''
  timeCategory.value = ''
  const i = props.interaction
  if (i) {
    form.value = {
      type: i.type, occurredAt: format(new Date(i.occurredAt), "yyyy-MM-dd'T'HH:mm"), contactId: i.contactId || NONE,
      userId: i.user?.id && i.user.id !== (me.value as any)?.id ? i.user.id : ME,
      notes: i.notes, outcome: i.outcome, nextAction: i.nextAction, nextActionDate: i.nextActionDate || '', nextActionType: i.nextActionType || '', nextActionTime: i.nextActionTime || '',
    }
  } else {
    form.value = blank()
    const primary = props.contacts.find(c => c.isActive && c.isPrimary)
    if (primary) form.value.contactId = primary.id
  }
})

const typeDef = computed(() => INTERACTION_TYPE_MAP[form.value.type])
const defaultTimeCategory = computed(() => INTERACTION_TIME_CATEGORY[form.value.type] || 'admin')
/** Moving to Lost requires a reason — same rule as the server. */
const losing = computed(() => suggestedStage.value === 'Lost' && moveStage.value)
// A standard reason picked as the outcome pre-fills the lost reason.
watch(() => form.value.outcome, (o) => {
  if ((LOST_REASONS as readonly string[]).includes(o) && (!lost.value.lostReason || (LOST_REASONS as readonly string[]).includes(lost.value.lostReason))) lost.value = { ...lost.value, lostReason: o }
})
const activeContacts = computed(() => props.contacts.filter(c => c.isActive))
const formerContacts = computed(() => props.contacts.filter(c => !c.isActive))

/** Forward-only stage suggestion for the chosen type. */
const suggestedStage = computed(() => {
  const d = props.dealership
  const target = typeDef.value?.suggestStage
  if (!d || !target || isEdit.value || d.dealerId || d.archivedAt || d.stage === target) return null
  if (d.stage === WON_STAGE) return null
  const cur = OPEN_STAGES.indexOf(d.stage), to = OPEN_STAGES.indexOf(target)
  if (cur !== -1 && to !== -1 && to <= cur) return null
  return target
})

/** Same guess the server makes when no type is picked. */
const autoNextType = computed(() => {
  const t = form.value.nextAction.toLowerCase().trim()
  if (/^(call|phone|ring|dial)\b/.test(t)) return 'call'
  if (/^(email|e-mail|send|reply)\b/.test(t)) return 'email'
  if (/^(visit|stop by|drop by)\b/.test(t)) return 'visit'
  if (form.value.type === 'meeting_scheduled' || /\b(meeting|demo|walkthrough)\b/.test(t)) return 'meeting'
  if (/\b(call|phone|ring|dial)\b/.test(t)) return 'call'
  if (/\b(email|send|reply)\b/.test(t)) return 'email'
  if (/\b(visit|stop by|drop by)\b/.test(t)) return 'visit'
  return 'follow_up'
})
/** Would this dealership be left without a dated next step after saving? */
const leavesNoNextStep = computed(() => {
  const d = props.dealership
  if (!d || d.dealerId || isEdit.value || !OPEN_STAGES.includes(d.stage) || QUEUE_STAGES.includes(d.stage)) return false
  const hasNew = !!form.value.nextAction.trim() && !!form.value.nextActionDate
  const keepsOld = !!props.openNextActions && !completePrevious.value
  return !hasNew && !keepsOld
})
function quickDate(days: number) { form.value.nextActionDate = localDay(addDays(new Date(), days)) }
const QUICK_DATES = [{ label: 'Tomorrow', d: 1 }, { label: '3 days', d: 3 }, { label: '1 week', d: 7 }, { label: '2 weeks', d: 14 }, { label: '1 month', d: 30 }]

function validate() {
  const e: Record<string, string> = {}
  if (!INTERACTION_TYPE_MAP[form.value.type]) e.type = 'Choose an activity type'
  if (!form.value.occurredAt) e.occurredAt = 'Date and time are required'
  else if (new Date(form.value.occurredAt).getTime() > Date.now() + 10 * 60_000) e.occurredAt = 'Cannot be in the future — put planned items in Next action'
  if (form.value.nextActionDate && !form.value.nextAction.trim()) e.nextAction = 'What needs to happen on that date?'
  if (form.value.type === 'note' && !form.value.notes.trim()) e.notes = 'Write the note'
  const m = Number(minutesSpent.value)
  if (minutesSpent.value !== '' && (!Number.isFinite(m) || m < 0 || m > 720)) e.minutes = 'Between 1 and 720 minutes'
  if (!isEdit.value && losing.value) {
    if (!lost.value.lostReason) e.lost = 'Pick the reason this deal was lost'
    else if (lost.value.lostReason === 'Other' && !lost.value.lostNotes.trim() && !form.value.notes.trim()) e.lost = 'Describe the reason in the notes'
  }
  errors.value = e
  return !Object.keys(e).length
}

async function submit() {
  if (!props.dealership || !validate()) return
  saving.value = true
  const payload: InteractionInput = {
    type: form.value.type,
    occurredAt: new Date(form.value.occurredAt).toISOString(),
    contactId: form.value.contactId === NONE ? null : form.value.contactId,
    userId: form.value.userId === ME ? ((me.value as any)?.id || '') : form.value.userId,
    notes: form.value.notes.trim(),
    outcome: form.value.outcome.trim(),
    nextAction: form.value.nextAction.trim(),
    nextActionDate: form.value.nextActionDate || null,
    nextActionType: form.value.nextAction.trim() ? (form.value.nextActionType || autoNextType.value) : null,
    nextActionTime: form.value.nextAction.trim() ? (form.value.nextActionTime || null) : null,
  }
  try {
    if (isEdit.value) {
      const interaction = await updateInteraction(props.dealership.id, props.interaction!.id, payload)
      toast.success('Activity updated')
      emit('saved', { interaction, stageMoved: null })
    } else {
      const wantsWon = suggestedStage.value === WON_STAGE && moveStage.value
      const res = await logInteraction(props.dealership.id, {
        ...payload,
        completePrevious: !!props.openNextActions && completePrevious.value,
        moveStage: suggestedStage.value && moveStage.value && !wantsWon ? suggestedStage.value : undefined,
        ...(Number(minutesSpent.value) > 0 ? { minutesSpent: Math.round(Number(minutesSpent.value)), timeCategory: timeCategory.value || defaultTimeCategory.value, timeDate: form.value.occurredAt.slice(0, 10) } : {}),
        ...(losing.value ? { lostReason: lost.value.lostReason, lostNotes: lost.value.lostNotes.trim() || (lost.value.lostReason === 'Other' ? form.value.notes.trim() : ''), lostCompetitor: lost.value.lostCompetitor.trim() } : {}),
      })
      const mins = Number(minutesSpent.value) > 0 ? Math.round(Number(minutesSpent.value)) : 0
      if (mins) timeVersion.value++
      toast.success(`${typeDef.value?.label} logged`, { description: [res.stageMoved ? `Stage moved to ${res.stageMoved}` : '', mins ? `${formatMinutes(mins)} added to your time` : ''].filter(Boolean).join(' · ') || undefined })
      emit('saved', { interaction: res.interaction, stageMoved: res.stageMoved })
      if (wantsWon) emit('won')
    }
    isOpen.value = false
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || err?.message || 'Could not save activity')
  } finally { saving.value = false }
}
</script>

<template>
  <Sheet v-model:open="isOpen">
    <SheetContent side="right" class="w-full sm:max-w-2xl p-0 flex flex-col gap-0">
      <SheetHeader class="px-6 pt-6 pb-4 border-b">
        <div class="flex items-start gap-3">
          <div class="size-10 rounded-xl flex items-center justify-center shrink-0" :class="typeDef?.tone || 'bg-primary/10 text-primary'">
            <component :is="INTERACTION_ICONS[typeDef?.icon || 'StickyNote']" class="size-5" />
          </div>
          <div class="min-w-0">
            <SheetTitle class="text-base">{{ isEdit ? 'Edit activity' : 'Log activity' }}</SheetTitle>
            <SheetDescription class="text-xs">{{ dealership?.name }}<span v-if="dealership"> · {{ dealership.dealershipId }}</span> — saved to the relationship history.</SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <form id="interaction-form" class="flex-1 overflow-y-auto px-6 py-5 space-y-6" @submit.prevent="submit">
        <!-- Type -->
        <section class="space-y-2.5">
          <Label>Activity type <span class="text-destructive">*</span></Label>
          <div class="space-y-2">
            <div v-for="g in INTERACTION_GROUPS" :key="g" class="grid grid-cols-[88px_1fr] gap-2 items-start">
              <span class="text-[10px] uppercase tracking-wider text-muted-foreground pt-1.5">{{ g }}</span>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="t in INTERACTION_TYPES.filter(x => x.group === g)" :key="t.key" type="button"
                  class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors"
                  :class="form.type === t.key ? 'border-primary bg-primary/10 text-foreground font-medium ring-1 ring-primary/30' : 'bg-background text-muted-foreground hover:text-foreground hover:bg-muted'"
                  :aria-pressed="form.type === t.key" @click="form.type = t.key; form.outcome = ''"
                >
                  <component :is="INTERACTION_ICONS[t.icon]" class="size-3.5" />{{ t.label }}
                </button>
              </div>
            </div>
          </div>
          <p v-if="errors.type" class="text-xs text-destructive">{{ errors.type }}</p>
        </section>

        <!-- When / who -->
        <section class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="space-y-1.5">
            <Label for="ix-when" class="flex items-center gap-1.5"><CalendarClock class="size-3.5 text-muted-foreground" /> Date &amp; time <span class="text-destructive">*</span></Label>
            <Input id="ix-when" v-model="form.occurredAt" type="datetime-local" :max="nowLocal()" :aria-invalid="!!errors.occurredAt" />
            <p v-if="errors.occurredAt" class="text-xs text-destructive">{{ errors.occurredAt }}</p>
          </div>
          <div class="space-y-1.5">
            <Label>Contact</Label>
            <Select v-model="form.contactId">
              <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent class="max-h-72">
                <SelectItem :value="NONE"><span class="text-muted-foreground">No specific contact</span></SelectItem>
                <SelectGroup v-if="activeContacts.length">
                  <SelectLabel class="text-[10px]">Current</SelectLabel>
                  <SelectItem v-for="c in activeContacts" :key="c.id" :value="c.id">{{ c.fullName }}<span class="text-muted-foreground text-xs"> · {{ c.jobTitle || c.role }}</span></SelectItem>
                </SelectGroup>
                <SelectGroup v-if="formerContacts.length">
                  <SelectLabel class="text-[10px]">Former</SelectLabel>
                  <SelectItem v-for="c in formerContacts" :key="c.id" :value="c.id">{{ c.fullName }}<span class="text-muted-foreground text-xs"> · former</span></SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <Label class="flex items-center gap-1.5"><UserRound class="size-3.5 text-muted-foreground" /> User</Label>
            <Select v-model="form.userId">
              <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent class="max-h-72">
                <SelectItem :value="ME">Me<span v-if="(me as any)?.name" class="text-muted-foreground text-xs"> · {{ (me as any).name }}</span></SelectItem>
                <SelectItem v-for="u in users.filter(u => u.id !== (me as any)?.id)" :key="u.id" :value="u.id">{{ u.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <!-- Notes & outcome -->
        <section class="space-y-4">
          <div class="space-y-1.5">
            <Label for="ix-notes" class="flex items-center gap-1.5"><NotebookPen class="size-3.5 text-muted-foreground" /> Notes <span v-if="form.type === 'note'" class="text-destructive">*</span></Label>
            <Textarea id="ix-notes" v-model="form.notes" rows="5" class="text-sm" placeholder="What was said, sent or learned…" :aria-invalid="!!errors.notes" />
            <p v-if="errors.notes" class="text-xs text-destructive">{{ errors.notes }}</p>
          </div>
          <div v-if="form.type !== 'note'" class="space-y-1.5">
            <Label for="ix-outcome">Result / outcome</Label>
            <Input id="ix-outcome" v-model="form.outcome" placeholder="e.g. Interested — wants pricing" />
            <div v-if="typeDef?.outcomes?.length" class="flex flex-wrap gap-1.5 pt-0.5">
              <button v-for="o in typeDef.outcomes" :key="o" type="button" class="rounded-full border px-2 py-0.5 text-[11px] transition-colors" :class="form.outcome === o ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'" @click="form.outcome = form.outcome === o ? '' : o">{{ o }}</button>
            </div>
          </div>
        </section>

        <!-- Time spent (time tracking) -->
        <section v-if="!isEdit" class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Label class="flex items-center gap-1.5 text-sm"><Timer class="size-3.5 text-muted-foreground" /> Time spent <span class="text-muted-foreground font-normal text-xs">(optional)</span></Label>
          <div class="flex flex-wrap items-center gap-1.5">
            <button v-for="p in TIME_PRESETS" :key="p" type="button" class="rounded-full border px-2 py-0.5 text-[11px] tabular-nums transition-colors"
              :class="Number(minutesSpent) === p ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'" @click="minutesSpent = Number(minutesSpent) === p ? '' : p">{{ formatMinutes(p) }}</button>
            <div class="relative w-20"><Input v-model="minutesSpent" type="number" min="1" max="720" placeholder="—" class="h-7 pr-8 text-xs tabular-nums" aria-label="Minutes spent" /><span class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">min</span></div>
          </div>
          <Select v-if="Number(minutesSpent) > 0" :model-value="timeCategory || defaultTimeCategory" @update:model-value="(v: any) => timeCategory = String(v)">
            <SelectTrigger class="h-7 w-[200px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem v-for="c in TIME_CATEGORIES" :key="c.key" :value="c.key">{{ c.label }}</SelectItem></SelectContent>
          </Select>
          <p v-if="errors.minutes" class="w-full text-xs text-destructive">{{ errors.minutes }}</p>
        </section>

        <!-- Next action -->
        <section class="rounded-xl border bg-muted/20 p-4 space-y-3">
          <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><Target class="size-3.5" /> Next action</h4>
          <div class="grid grid-cols-1 sm:grid-cols-[1fr_170px] gap-3">
            <div class="space-y-1.5">
              <Input v-model="form.nextAction" placeholder="e.g. Call Priya to confirm the demo" aria-label="Next action" :aria-invalid="!!errors.nextAction" />
              <p v-if="errors.nextAction" class="text-xs text-destructive">{{ errors.nextAction }}</p>
            </div>
            <div class="flex gap-2">
              <Input v-model="form.nextActionDate" type="date" :min="localDay()" aria-label="Next-action date" class="flex-1" />
              <Input v-model="form.nextActionTime" type="time" aria-label="Time (optional)" class="w-[104px]" />
            </div>
          </div>
          <div v-if="form.nextAction.trim()" class="flex flex-wrap items-center gap-1.5">
            <span class="text-[11px] text-muted-foreground mr-1">Type:</span>
            <button v-for="t in NEXT_ACTION_TYPES" :key="t.key" type="button" class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors"
              :class="(form.nextActionType || autoNextType) === t.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground hover:text-foreground hover:bg-muted'" @click="form.nextActionType = t.key">
              <component :is="INTERACTION_ICONS[t.icon]" class="size-3" />{{ t.label }}
            </button>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <button v-for="q in QUICK_DATES" :key="q.d" type="button" class="rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" @click="quickDate(q.d)">{{ q.label }}</button>
            <button v-if="form.nextActionDate" type="button" class="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1" @click="form.nextActionDate = ''">Clear date</button>
          </div>
        </section>

        <p v-if="leavesNoNextStep" class="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle class="size-4 shrink-0 mt-px" /> No dated next action — {{ dealership?.name }} will show as “No next step” on the Today board until one is planned.
        </p>

        <!-- Side effects (create only) -->
        <section v-if="!isEdit && (suggestedStage || openNextActions)" class="space-y-2">
          <label v-if="suggestedStage" class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer select-none">
            <div class="min-w-0">
              <p class="text-sm font-medium flex items-center gap-1.5 flex-wrap">
                Move stage
                <span class="inline-flex items-center gap-1 text-xs"><span class="size-1.5 rounded-full" :class="STAGE_STYLE[dealership!.stage]?.dot" />{{ dealership!.stage }}</span>
                <ArrowRight class="size-3 text-muted-foreground" />
                <span class="inline-flex items-center gap-1 text-xs font-semibold"><span class="size-1.5 rounded-full" :class="STAGE_STYLE[suggestedStage]?.dot" />{{ suggestedStage }}</span>
              </p>
              <p class="text-[11px] text-muted-foreground">{{ suggestedStage === WON_STAGE ? 'Opens "Mark as won" next, which promotes this account to Dealers.' : 'Recorded in the stage history with this activity.' }}</p>
            </div>
            <Switch v-model="moveStage" />
          </label>
          <div v-if="losing" class="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-3">
            <CrmLostReasonFields v-model="lost" :error="errors.lost" />
          </div>
          <label v-if="openNextActions" class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer select-none">
            <div>
              <p class="text-sm font-medium flex items-center gap-1.5"><CircleCheck class="size-3.5 text-emerald-600" /> Mark previous next action{{ openNextActions > 1 ? 's' : '' }} as done</p>
              <p class="text-[11px] text-muted-foreground">{{ openNextActions }} open follow-up{{ openNextActions > 1 ? 's' : '' }} on this dealership.</p>
            </div>
            <Switch v-model="completePrevious" />
          </label>
        </section>
      </form>

      <SheetFooter class="px-6 py-4 border-t flex-row justify-end gap-2">
        <Button type="button" variant="ghost" :disabled="saving" @click="isOpen = false">Cancel</Button>
        <Button type="submit" form="interaction-form" :disabled="saving" class="min-w-32"><Loader2 v-if="saving" class="size-4 animate-spin" /><span v-else>{{ isEdit ? 'Save changes' : 'Log activity' }}</span></Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
