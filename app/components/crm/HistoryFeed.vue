<script setup lang="ts">
import type { CrmActivity, CrmContact, CrmInteraction } from '~/composables/useCrmDealerships'
import { dueState } from '~/composables/useCrmDealerships'
import {
  Building2, Pencil, Archive, ArchiveRestore, UserPlus, UserPen, UserMinus, RotateCcw, ArrowLeftRight, ShieldCheck,
  Trophy, Undo2, ClipboardCheck, Plus, Search, MoreHorizontal, Target, CheckCircle2, Circle, Ban, Settings2, X,
  ChevronDown, FileDown, Phone, Send, StickyNote, CalendarPlus, Bot, User,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format, formatDistanceToNow, isToday, isYesterday, parseISO } from 'date-fns'
import { INTERACTION_TYPES, INTERACTION_TYPE_MAP, NEXT_ACTION_TYPE_MAP } from '~/constants/crm'
import { INTERACTION_ICONS } from '~/constants/crm-icons'

/**
 * The full relationship history of one dealership, newest first:
 * every logged interaction (calls, emails, meetings, notes…) merged with the
 * system log (stage changes, contacts, audits, conversion).
 */
const props = withDefaults(defineProps<{
  dealershipId: string
  dealershipCode?: string
  interactions: CrmInteraction[]
  activity: CrmActivity[]
  contacts: CrmContact[]
  canEdit?: boolean
  /** Overview mode: show only the latest N entries, no filters */
  limit?: number
}>(), { canEdit: false, limit: 0, dealershipCode: '' })
const emit = defineEmits<{ log: [type?: string], edit: [i: CrmInteraction], changed: [], more: [] }>()
const { updateInteraction } = useCrmDealerships()

const SYS: Record<string, { icon: any, cls: string }> = {
  'dealership.created': { icon: Building2, cls: 'text-primary' },
  'dealership.updated': { icon: Pencil, cls: 'text-sky-600 dark:text-sky-400' },
  'dealership.archived': { icon: Archive, cls: 'text-zinc-500' },
  'dealership.restored': { icon: ArchiveRestore, cls: 'text-emerald-600 dark:text-emerald-400' },
  'contact.added': { icon: UserPlus, cls: 'text-emerald-600 dark:text-emerald-400' },
  'contact.updated': { icon: UserPen, cls: 'text-sky-600 dark:text-sky-400' },
  'contact.deactivated': { icon: UserMinus, cls: 'text-amber-600 dark:text-amber-400' },
  'contact.reactivated': { icon: RotateCcw, cls: 'text-emerald-600 dark:text-emerald-400' },
  'contact.handover': { icon: ArrowLeftRight, cls: 'text-violet-600 dark:text-violet-400' },
  'contact.verified': { icon: ShieldCheck, cls: 'text-emerald-600 dark:text-emerald-400' },
  'dealership.converted': { icon: Trophy, cls: 'text-emerald-600 dark:text-emerald-400' },
  'dealership.reverted': { icon: Undo2, cls: 'text-amber-600 dark:text-amber-400' },
  'audit.recorded': { icon: ClipboardCheck, cls: 'text-violet-600 dark:text-violet-400' },
  'interaction.updated': { icon: Pencil, cls: 'text-muted-foreground' },
  'interaction.voided': { icon: Ban, cls: 'text-rose-500' },
  'interaction.restored': { icon: RotateCcw, cls: 'text-emerald-600' },
}
const FIELD: Record<string, string> = { stage: 'Stage', assignedUserName: 'Assigned to', leadSource: 'Lead source', name: 'Name', dealer: 'Dealer', type: 'Type', occurredAt: 'Date/time', contactName: 'Contact', notes: 'Notes', outcome: 'Outcome', nextAction: 'Next action', nextActionDate: 'Next-action date', user: 'User' }

type Entry = { kind: 'interaction', at: string, key: string, i: CrmInteraction } | { kind: 'system', at: string, key: string, a: CrmActivity }

// ─── Filters ───
const view = ref<'all' | 'interactions' | 'system'>('all')
const typeFilter = ref('all')
const contactFilter = ref('all')
const search = ref('')
const showVoided = ref(false)
const filtersActive = computed(() => view.value !== 'all' || typeFilter.value !== 'all' || contactFilter.value !== 'all' || !!search.value.trim())
function clearFilters() { view.value = 'all'; typeFilter.value = 'all'; contactFilter.value = 'all'; search.value = '' }

const live = computed(() => props.interactions.filter(i => !i.voidedAt))
const voidedCount = computed(() => props.interactions.length - live.value.length)

const entries = computed<Entry[]>(() => {
  const needle = search.value.trim().toLowerCase()
  const out: Entry[] = []
  const compact = !!props.limit
  if (compact || view.value !== 'system') {
    for (const i of props.interactions) {
      if (i.voidedAt && (compact || !showVoided.value)) continue
      if (!compact) {
        if (typeFilter.value !== 'all' && i.type !== typeFilter.value) continue
        if (contactFilter.value !== 'all' && (contactFilter.value === '__none' ? !!i.contactId : i.contactId !== contactFilter.value)) continue
        if (needle && ![i.typeLabel, i.notes, i.outcome, i.nextAction, i.contactName, i.user?.name].join(' ').toLowerCase().includes(needle)) continue
      }
      out.push({ kind: 'interaction', at: i.occurredAt, key: `i-${i.id}`, i })
    }
  }
  const systemAllowed = !compact && view.value !== 'interactions' && typeFilter.value === 'all' && contactFilter.value === 'all'
  if (systemAllowed) {
    for (const a of props.activity) {
      if (a.type === 'note') continue
      if (needle && !`${a.message} ${a.actor?.name}`.toLowerCase().includes(needle)) continue
      out.push({ kind: 'system', at: a.at, key: `a-${a.id}`, a })
    }
  }
  out.sort((x, y) => y.at.localeCompare(x.at))
  return props.limit ? out.slice(0, props.limit) : out
})

function dayLabel(iso: string) {
  const d = new Date(iso)
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'EEEE, MMM d, yyyy')
}
const grouped = computed(() => {
  const groups: { key: string, label: string, list: Entry[] }[] = []
  for (const e of entries.value) {
    const k = format(new Date(e.at), 'yyyy-MM-dd')
    const last = groups[groups.length - 1]
    if (last?.key === k) last.list.push(e)
    else groups.push({ key: k, label: dayLabel(e.at), list: [e] })
  }
  return groups
})

// ─── Summary ───
const firstTouch = computed(() => live.value.length ? live.value.reduce((m, i) => i.occurredAt < m ? i.occurredAt : m, live.value[0]!.occurredAt) : null)
const lastTouch = computed(() => live.value[0] || null)
const openNext = computed(() => live.value
  .filter(i => i.nextAction && !i.nextActionDone)
  .sort((a, b) => (a.nextActionDate || '9999').localeCompare(b.nextActionDate || '9999')))
const typeCounts = computed(() => {
  const m = new Map<string, number>()
  for (const i of live.value) m.set(i.type, (m.get(i.type) || 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
})

// ─── Actions ───
const busy = ref<string | null>(null)
async function setDone(i: CrmInteraction, done: boolean) {
  busy.value = i.id
  try { await updateInteraction(props.dealershipId, i.id, { nextActionDone: done }); toast.success(done ? 'Next action done' : 'Next action reopened'); emit('changed') } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not update') } finally { busy.value = null }
}
const voidTarget = ref<CrmInteraction | null>(null)
const voidReason = ref('')
function askVoid(i: CrmInteraction) { voidTarget.value = i; voidReason.value = '' }
async function confirmVoid() {
  const i = voidTarget.value
  if (!i) return
  busy.value = i.id
  try { await updateInteraction(props.dealershipId, i.id, { voided: true, voidReason: voidReason.value.trim() }); toast.success('Activity voided — kept in history'); voidTarget.value = null; emit('changed') } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not void') } finally { busy.value = null }
}
async function restore(i: CrmInteraction) {
  busy.value = i.id
  try { await updateInteraction(props.dealershipId, i.id, { voided: false }); toast.success('Activity restored'); emit('changed') } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not restore') } finally { busy.value = null }
}

const expanded = ref<Set<string>>(new Set())
function toggleExpand(id: string) { const s = new Set(expanded.value); s.has(id) ? s.delete(id) : s.add(id); expanded.value = s }
const isLong = (t: string) => t.length > 360 || t.split('\n').length > 6

const DUE_CLS: Record<string, string> = {
  overdue: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25',
  today: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25',
  soon: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25',
  later: 'bg-muted text-muted-foreground border-border',
  none: 'bg-muted text-muted-foreground border-border',
}
function dueLabel(date: string | null) {
  if (!date) return 'No date'
  const s = dueState(date)
  const d = parseISO(date)
  if (s === 'today') return 'Due today'
  if (s === 'overdue') return `Overdue · ${format(d, 'MMM d')}`
  return format(d, 'EEE, MMM d')
}
function fmtVal(k: string, v: any) {
  if (v === null || v === undefined || v === '') return '—'
  if (k === 'occurredAt' && typeof v === 'string') return format(new Date(v), 'MMM d, yyyy h:mm a')
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}
const sysChanges = (a: CrmActivity) => a.changes ? Object.entries(a.changes).filter(([k]) => FIELD[k] && k !== 'notes').map(([k, v]) => ({ k, label: FIELD[k], ...v })) : []

function exportCsv() {
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['Date', 'Time', 'Dealership', 'Contact', 'Contact title', 'Activity type', 'User', 'Notes', 'Result / outcome', 'Next action', 'Next-action date', 'Next action done', 'Voided', 'Source']
  const rows = [...props.interactions].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map(i => [
    format(new Date(i.occurredAt), 'yyyy-MM-dd'), format(new Date(i.occurredAt), 'HH:mm'), `${i.dealershipName} (${i.dealershipCode})`, i.contactName, i.contactTitle, i.typeLabel,
    i.user?.name, i.notes, i.outcome, i.nextAction, i.nextActionDate, i.nextActionDone ? 'Yes' : '', i.voidedAt ? `Yes — ${i.voidReason}` : '', i.source,
  ].map(esc).join(','))
  const blob = new Blob([[head.map(esc).join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' })
  const el = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${props.dealershipCode || 'dealership'}_history.csv` })
  el.click(); URL.revokeObjectURL(el.href)
}
</script>

<template>
  <div class="space-y-5">
    <!-- Header / quick log (full mode) -->
    <template v-if="!limit">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 class="font-semibold">Relationship history</h3>
          <p class="text-xs text-muted-foreground">Every interaction with this dealership, newest first — calls, emails, visits, meetings, notes — with stage changes and record updates in between.</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <Button v-if="interactions.length" variant="outline" size="sm" class="gap-2" @click="exportCsv"><FileDown class="size-4" /> Export</Button>
          <template v-if="canEdit">
            <div class="hidden md:flex items-center rounded-md border bg-background p-0.5">
              <Button variant="ghost" size="sm" class="h-7 gap-1.5 text-xs" title="Log a phone call" @click="emit('log', 'phone_call')"><Phone class="size-3.5" /> Call</Button>
              <Button variant="ghost" size="sm" class="h-7 gap-1.5 text-xs" title="Log an email" @click="emit('log', 'email_sent')"><Send class="size-3.5" /> Email</Button>
              <Button variant="ghost" size="sm" class="h-7 gap-1.5 text-xs" title="Log a meeting" @click="emit('log', 'meeting_scheduled')"><CalendarPlus class="size-3.5" /> Meeting</Button>
              <Button variant="ghost" size="sm" class="h-7 gap-1.5 text-xs" title="Add a note" @click="emit('log', 'note')"><StickyNote class="size-3.5" /> Note</Button>
            </div>
            <Button size="sm" class="gap-2" @click="emit('log')"><Plus class="size-4" /> Log activity</Button>
          </template>
        </div>
      </div>

      <!-- Summary -->
      <div class="rounded-xl border bg-card grid grid-cols-1 md:grid-cols-[1fr_1fr_1.4fr] divide-y md:divide-y-0 md:divide-x">
        <div class="px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground">Relationship</p>
          <p class="mt-1 text-sm"><span class="text-lg font-bold tabular-nums">{{ live.length }}</span> interaction{{ live.length === 1 ? '' : 's' }}</p>
          <p class="text-[11px] text-muted-foreground">{{ firstTouch ? `since ${format(new Date(firstTouch), 'MMM d, yyyy')}` : 'Nothing logged yet' }}</p>
          <div v-if="typeCounts.length" class="mt-2 flex flex-wrap gap-1">
            <span v-for="[t, n] in typeCounts" :key="t" class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]" :class="INTERACTION_TYPE_MAP[t]?.tone"><component :is="INTERACTION_ICONS[INTERACTION_TYPE_MAP[t]?.icon || 'StickyNote']" class="size-3" />{{ n }}</span>
          </div>
        </div>
        <div class="px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground">Last touch</p>
          <template v-if="lastTouch">
            <p class="mt-1 text-sm font-semibold flex items-center gap-1.5"><component :is="INTERACTION_ICONS[INTERACTION_TYPE_MAP[lastTouch.type]?.icon || 'StickyNote']" class="size-3.5" />{{ lastTouch.typeLabel }}</p>
            <p class="text-[11px] text-muted-foreground">{{ formatDistanceToNow(new Date(lastTouch.occurredAt), { addSuffix: true }) }} · {{ lastTouch.user?.name }}<span v-if="lastTouch.contactName"> with {{ lastTouch.contactName }}</span></p>
          </template>
          <p v-else class="mt-1 text-sm text-muted-foreground">—</p>
        </div>
        <div class="px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Target class="size-3.5" /> Next action{{ openNext.length > 1 ? `s (${openNext.length})` : '' }}</p>
          <ul v-if="openNext.length" class="mt-1 space-y-1">
            <li v-for="n in openNext.slice(0, 3)" :key="n.id" class="flex items-center gap-2 text-sm">
              <Badge variant="outline" class="text-[10px] shrink-0 font-medium" :class="DUE_CLS[dueState(n.nextActionDate)]">{{ dueLabel(n.nextActionDate) }}</Badge>
              <span class="truncate">{{ n.nextAction }}</span>
              <button v-if="canEdit" type="button" class="ml-auto shrink-0 text-muted-foreground hover:text-emerald-600" title="Mark done" :disabled="busy === n.id" @click="setDone(n, true)"><CheckCircle2 class="size-4" /></button>
            </li>
          </ul>
          <p v-else class="mt-1 text-sm text-muted-foreground">None planned<button v-if="canEdit" type="button" class="ml-2 text-xs text-primary hover:underline underline-offset-2" @click="emit('log', 'follow_up')">Plan one</button></p>
        </div>
      </div>

      <!-- Filters -->
      <div class="flex flex-wrap items-center gap-2">
        <div class="inline-flex items-center rounded-lg border bg-muted/40 p-0.5" role="tablist" aria-label="Show">
          <button v-for="v in [{ k: 'all', l: 'Everything' }, { k: 'interactions', l: 'Interactions' }, { k: 'system', l: 'Record changes' }]" :key="v.k" type="button" role="tab" :aria-selected="view === v.k"
            class="rounded-md px-2.5 py-1 text-xs font-medium transition-all" :class="view === v.k ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'" @click="view = v.k as any">{{ v.l }}</button>
        </div>
        <Select v-model="typeFilter">
          <SelectTrigger class="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent class="max-h-80">
            <SelectItem value="all">All activity types</SelectItem>
            <SelectItem v-for="t in INTERACTION_TYPES" :key="t.key" :value="t.key"><span class="flex items-center gap-2"><component :is="INTERACTION_ICONS[t.icon]" class="size-3.5" />{{ t.label }}</span></SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="contactFilter">
          <SelectTrigger class="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent class="max-h-72">
            <SelectItem value="all">All contacts</SelectItem>
            <SelectItem value="__none">No specific contact</SelectItem>
            <SelectItem v-for="c in contacts" :key="c.id" :value="c.id">{{ c.fullName }}<span v-if="!c.isActive" class="text-muted-foreground"> · former</span></SelectItem>
          </SelectContent>
        </Select>
        <div class="relative">
          <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input v-model="search" placeholder="Search notes, outcomes…" class="h-8 w-56 pl-8 text-xs" />
        </div>
        <Button v-if="filtersActive" variant="ghost" size="sm" class="h-8 gap-1 text-xs" @click="clearFilters"><X class="size-3.5" /> Clear</Button>
        <label v-if="voidedCount" class="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none"><Switch v-model="showVoided" /> Show voided ({{ voidedCount }})</label>
      </div>
    </template>

    <!-- Empty -->
    <div v-if="!entries.length" class="rounded-xl border-2 border-dashed py-12 flex flex-col items-center text-center">
      <div class="size-12 rounded-2xl bg-muted flex items-center justify-center"><StickyNote class="size-5 text-muted-foreground/60" /></div>
      <h4 class="mt-3 font-semibold text-sm">{{ filtersActive ? 'Nothing matches these filters' : 'No interactions yet' }}</h4>
      <p class="mt-1 text-xs text-muted-foreground max-w-xs">{{ filtersActive ? 'Try clearing the filters.' : 'Log the first call, email or visit so the whole team can see where this relationship stands.' }}</p>
      <Button v-if="canEdit && !filtersActive" size="sm" class="mt-4 gap-2" @click="emit('log')"><Plus class="size-4" /> Log activity</Button>
    </div>

    <!-- Timeline -->
    <section v-for="g in grouped" :key="g.key">
      <div class="sticky top-0 z-[1] bg-background/90 backdrop-blur py-1.5 flex items-center gap-3">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{{ g.label }}</span>
        <span class="h-px flex-1 bg-border" />
      </div>
      <ol class="relative ml-4 border-l border-border/70 pt-2">
        <li v-for="e in g.list" :key="e.key" class="relative pl-6" :class="e.kind === 'interaction' ? 'pb-4' : 'pb-2.5'">
          <!-- Interaction -->
          <template v-if="e.kind === 'interaction'">
            <span class="absolute -left-[15px] top-1 size-7 rounded-full border-2 border-background flex items-center justify-center" :class="INTERACTION_TYPE_MAP[e.i.type]?.tone || 'bg-muted'">
              <component :is="INTERACTION_ICONS[INTERACTION_TYPE_MAP[e.i.type]?.icon || 'StickyNote']" class="size-3.5" />
            </span>
            <article class="rounded-xl border bg-card px-4 py-3 transition-colors" :class="e.i.voidedAt && 'opacity-60 border-dashed'">
              <header class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                  <p class="text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="font-semibold" :class="e.i.voidedAt && 'line-through'">{{ e.i.typeLabel }}</span>
                    <span v-if="e.i.contactName" class="text-muted-foreground">with <span class="text-foreground font-medium">{{ e.i.contactName }}</span><span v-if="e.i.contactTitle" class="text-xs"> · {{ e.i.contactTitle }}</span></span>
                    <Badge v-if="e.i.outcome" variant="secondary" class="text-[10px] font-medium">{{ e.i.outcome }}</Badge>
                    <Badge v-if="e.i.voidedAt" variant="outline" class="text-[10px] text-rose-600 border-rose-500/30">Voided</Badge>
                  </p>
                  <p class="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5">
                    <time :datetime="e.i.occurredAt" :title="format(new Date(e.i.occurredAt), 'PPpp')">{{ format(new Date(e.i.occurredAt), limit ? 'MMM d · h:mm a' : 'h:mm a') }}</time>
                    <span>·</span>
                    <span class="inline-flex items-center gap-1"><component :is="e.i.user?.id === 'system' ? Bot : User" class="size-3" />{{ e.i.user?.name || '—' }}</span>
                    <span v-if="e.i.source === 'audit'" class="inline-flex items-center gap-1">· <ClipboardCheck class="size-3" /> from inventory audit</span>
                    <span v-else-if="e.i.source === 'conversion'">· recorded on conversion</span>
                    <span v-if="e.i.createdBy && e.i.user && e.i.createdBy.id !== e.i.user.id">· logged by {{ e.i.createdBy.name }}</span>
                  </p>
                </div>
                <DropdownMenu v-if="canEdit && !limit">
                  <DropdownMenuTrigger as-child><Button variant="ghost" size="icon" class="size-7 -mr-1.5 -mt-0.5 text-muted-foreground" aria-label="Activity actions"><MoreHorizontal class="size-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem v-if="!e.i.voidedAt" @click="emit('edit', e.i)"><Pencil class="size-4" /> Edit</DropdownMenuItem>
                    <DropdownMenuItem v-if="!e.i.voidedAt && e.i.nextAction" @click="setDone(e.i, !e.i.nextActionDone)"><CheckCircle2 class="size-4" /> {{ e.i.nextActionDone ? 'Reopen next action' : 'Mark next action done' }}</DropdownMenuItem>
                    <DropdownMenuSeparator v-if="!e.i.voidedAt" />
                    <DropdownMenuItem v-if="!e.i.voidedAt" class="text-rose-600 focus:text-rose-600" @click="askVoid(e.i)"><Ban class="size-4" /> Void (keep in history)</DropdownMenuItem>
                    <DropdownMenuItem v-else @click="restore(e.i)"><RotateCcw class="size-4" /> Restore</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </header>

              <div v-if="e.i.notes" class="mt-2">
                <p class="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed" :class="!expanded.has(e.i.id) && isLong(e.i.notes) && (limit ? 'line-clamp-2' : 'line-clamp-6')">{{ e.i.notes }}</p>
                <button v-if="isLong(e.i.notes) && !limit" type="button" class="mt-1 text-[11px] text-primary hover:underline underline-offset-2 inline-flex items-center gap-1" @click="toggleExpand(e.i.id)">{{ expanded.has(e.i.id) ? 'Show less' : 'Show more' }}<ChevronDown class="size-3 transition-transform" :class="expanded.has(e.i.id) && 'rotate-180'" /></button>
              </div>

              <div v-if="e.i.nextAction" class="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs">
                <button v-if="canEdit && !e.i.voidedAt && !limit" type="button" class="shrink-0 transition-colors" :class="e.i.nextActionDone ? 'text-emerald-600' : 'text-muted-foreground hover:text-emerald-600'" :title="e.i.nextActionDone ? 'Reopen' : 'Mark done'" :disabled="busy === e.i.id" @click="setDone(e.i, !e.i.nextActionDone)">
                  <component :is="e.i.nextActionDone ? CheckCircle2 : Circle" class="size-4" />
                </button>
                <Target v-else class="size-3.5 text-muted-foreground shrink-0" />
                <span class="font-medium text-muted-foreground">Next{{ e.i.nextActionType && NEXT_ACTION_TYPE_MAP[e.i.nextActionType] ? ` (${NEXT_ACTION_TYPE_MAP[e.i.nextActionType]!.label.toLowerCase()}${e.i.nextActionTime ? ` · ${e.i.nextActionTime}` : ''})` : '' }}:</span>
                <span :class="e.i.nextActionDone && 'line-through text-muted-foreground'">{{ e.i.nextAction }}</span>
                <Badge v-if="!e.i.nextActionDone" variant="outline" class="text-[10px] font-medium" :class="DUE_CLS[dueState(e.i.nextActionDate)]">{{ dueLabel(e.i.nextActionDate) }}</Badge>
                <span v-else class="text-[10px] text-emerald-700 dark:text-emerald-400">Done{{ e.i.nextActionDoneAt ? ` ${format(new Date(e.i.nextActionDoneAt), 'MMM d')}` : '' }}{{ e.i.nextActionDoneBy?.name ? ` · ${e.i.nextActionDoneBy.name}` : '' }}</span>
              </div>

              <p v-if="e.i.voidedAt" class="mt-2 text-[11px] text-rose-600/90">Voided {{ format(new Date(e.i.voidedAt), 'MMM d, yyyy') }} by {{ e.i.voidedBy?.name }}<span v-if="e.i.voidReason"> — {{ e.i.voidReason }}</span></p>
            </article>
          </template>

          <!-- System event -->
          <template v-else>
            <span class="absolute -left-[9px] top-1 size-4 rounded-full border-2 border-background bg-muted flex items-center justify-center">
              <component :is="(SYS[e.a.type] || { icon: Settings2 }).icon" class="size-2.5" :class="(SYS[e.a.type] || { cls: 'text-muted-foreground' }).cls" />
            </span>
            <div class="text-xs text-muted-foreground flex flex-wrap items-baseline gap-x-1.5">
              <span class="text-foreground/80">{{ e.a.message }}</span>
              <span>· {{ e.a.actor?.name || 'System' }} · {{ format(new Date(e.a.at), 'h:mm a') }}</span>
            </div>
            <div v-if="sysChanges(e.a).length" class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              <span v-for="c in sysChanges(e.a)" :key="c.k">{{ c.label }}: <span class="line-through opacity-70">{{ fmtVal(c.k, c.from) }}</span> → <span class="text-foreground/80 font-medium">{{ fmtVal(c.k, c.to) }}</span></span>
            </div>
          </template>
        </li>
      </ol>
    </section>

    <div v-if="limit && interactions.length > entries.length" class="pt-1">
      <Button variant="ghost" size="sm" class="w-full text-xs" @click="emit('more')">See full history ({{ live.length }} interactions)</Button>
    </div>

    <!-- Void dialog -->
    <Dialog :open="!!voidTarget" @update:open="(o: boolean) => { if (!o) voidTarget = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Void this activity?</DialogTitle>
          <DialogDescription class="text-xs">It stays in the history (greyed out, with your reason) so the record remains complete. You can restore it later.</DialogDescription>
        </DialogHeader>
        <Textarea v-model="voidReason" rows="2" placeholder="Reason, e.g. logged on the wrong dealership" class="text-sm" />
        <DialogFooter>
          <Button variant="ghost" @click="voidTarget = null">Cancel</Button>
          <Button variant="destructive" :disabled="busy === voidTarget?.id" @click="confirmVoid">Void activity</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
