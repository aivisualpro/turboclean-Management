<script setup lang="ts">
import type { FollowupBoardItem } from '~/composables/useCrmFollowups'
import { localDay } from '~/composables/useCrmDealerships'
import {
  RefreshCw, CalendarCheck, Phone, ListTodo, Search, Send, AlarmClock, Moon, Flame, CircleOff, CheckCircle2,
  ShieldCheck, Hourglass, CalendarRange, ChevronDown, Loader2,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { addDays, format } from 'date-fns'

/**
 * Follow-up board — "no active prospect disappears because I forgot about them".
 * Every row opens the dealership.
 */
const TITLE = { title: 'Today', description: 'CRM · follow-ups, meetings, calls, and anything slipping through the cracks', icon: 'i-lucide-calendar-check' }
const { setHeader } = usePageHeader()
setHeader(TITLE)

const { board, loading, load } = useCrmFollowups()
const { updateInteraction } = useCrmDealerships()
const { isActionAllowed } = usePermissions()
const { user: me } = useAuth()
const canEdit = computed(() => isActionAllowed('crm_dealership', 'Edit'))

const scope = useLocalStorage<string>('crm-today-scope', 'all')
const users = ref<{ id: string, name: string }[]>([])
onMounted(async () => {
  try { const res = await $fetch<any[]>('/api/users'); users.value = (res || []).filter(u => u.status !== 'Inactive').map(u => ({ id: u.id, name: u.name || u.email })).sort((a, b) => a.name.localeCompare(b.name)) } catch {}
})
async function reload(quiet = true) {
  try { await load(scope.value); if (!quiet) toast.success('Board refreshed') } catch { toast.error('Could not load follow-ups') }
}
watch(scope, () => reload(), { immediate: true })
// Keep the board honest when the tab regains focus (another rep may have logged something).
onMounted(() => { const f = () => document.visibilityState === 'visible' && reload(); document.addEventListener('visibilitychange', f); onBeforeUnmount(() => document.removeEventListener('visibilitychange', f)) })

const b = computed(() => board.value)
const open = (i: FollowupBoardItem) => navigateTo(`/crm/dealership/${i.dealershipId}?tab=history`)
const busy = ref<string | null>(null)
async function done(i: FollowupBoardItem) {
  if (!i.nextAction) return
  busy.value = i.nextAction.interactionId
  try {
    await updateInteraction(i.dealershipId, i.nextAction.interactionId, { nextActionDone: true })
    toast.success(`Done: ${i.nextAction.text}`, { description: `${i.name} needs its next step.`, action: { label: 'Plan next step', onClick: () => navigateTo(`/crm/dealership/${i.dealershipId}?tab=history&log=follow_up`) } })
    await reload()
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not update') } finally { busy.value = null }
}
async function reschedule(i: FollowupBoardItem, days: number) {
  if (!i.nextAction) return
  busy.value = i.nextAction.interactionId
  const date = localDay(addDays(new Date(), days))
  try { await updateInteraction(i.dealershipId, i.nextAction.interactionId, { nextActionDate: date }); toast.success(`Moved to ${format(new Date(`${date}T12:00:00`), 'EEE, MMM d')}`); await reload() } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not update') } finally { busy.value = null }
}

type Section = { key: string, title: string, hint: string, icon: any, tone: 'default' | 'danger' | 'warn', items: FollowupBoardItem[], showAction?: boolean, empty: string }
const todaySections = computed<Section[]>(() => !b.value ? [] : [
  { key: 'meetings', title: 'Meetings today', hint: 'Next actions of type “Meeting” dated today', icon: CalendarCheck, tone: 'default', items: b.value.meetingsToday, empty: 'No meetings today.' },
  { key: 'followups', title: 'Follow-ups due today', hint: 'Every next action dated today (except calls and meetings)', icon: ListTodo, tone: 'default', items: b.value.followUpsToday, empty: 'Nothing due today.' },
  { key: 'calls', title: 'Calls due', hint: 'Call next actions dated today or earlier', icon: Phone, tone: 'default', items: b.value.callsDue, empty: 'No calls due.' },
  { key: 'revisits', title: 'Revisits due', hint: 'Nurture / Lost dealerships whose revisit date has arrived', icon: Moon, tone: 'default', items: b.value.revisitsDue, showAction: false, empty: 'No revisits due.' },
  { key: 'research', title: 'Dealers to research', hint: 'Stage “Research Needed” — oldest first', icon: Search, tone: 'default', items: b.value.toResearch, showAction: false, empty: 'Research queue is empty.' },
  { key: 'contact', title: 'Dealers to contact', hint: 'Researched / Ready to Contact, not contacted yet', icon: Send, tone: 'default', items: b.value.toContact, showAction: false, empty: 'No one waiting for first contact.' },
])
const overdueSections = computed<Section[]>(() => !b.value ? [] : [
  { key: 'overdue', title: 'Overdue follow-ups', hint: 'Next actions whose date has passed', icon: AlarmClock, tone: 'danger', items: b.value.overdueFollowUps, empty: 'Nothing overdue.' },
  { key: 'nonext', title: 'No next step', hint: 'Active prospects without a dated next action, Won, Lost or a Nurture revisit date', icon: CircleOff, tone: 'danger', items: b.value.noNextStep, empty: 'Every active prospect has a next step.' },
  { key: 'stale', title: 'Opportunities gone stale', hint: `Meeting Completed → Negotiating with no activity for ${b.value.rules.STALE_OPP_TOUCH_DAYS}+ days or ${b.value.rules.STALE_OPP_STAGE_DAYS}+ days in stage`, icon: Flame, tone: 'warn', items: b.value.staleOpportunities, showAction: false, empty: 'No stale opportunities.' },
  { key: 'quiet', title: 'No recent activity', hint: `Active prospects with nothing logged for ${b.value.rules.NO_ACTIVITY_DAYS}+ days`, icon: Hourglass, tone: 'warn', items: b.value.noRecentActivity, showAction: false, empty: 'Everyone has been touched recently.' },
])
const LIMIT = 8
const expanded = ref<Set<string>>(new Set())
function toggle(k: string) { const s = new Set(expanded.value); s.has(k) ? s.delete(k) : s.add(k); expanded.value = s }
const coverPct = computed(() => b.value && b.value.coverage.active ? Math.round(((b.value.coverage.active - b.value.coverage.uncovered) / b.value.coverage.active) * 100) : 100)
const todayLabel = computed(() => format(new Date(), 'EEEE, MMMM d'))
</script>

<template>
  <div class="space-y-5">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <Select v-model="scope">
          <SelectTrigger class="h-9 w-[170px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent class="max-h-72">
            <SelectItem value="all">Everyone</SelectItem>
            <SelectItem value="mine">Mine{{ (me as any)?.name ? ` (${(me as any).name})` : '' }}</SelectItem>
            <SelectItem v-for="u in users.filter(u => u.id !== (me as any)?.id)" :key="u.id" :value="u.id">{{ u.name }}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" class="size-9" aria-label="Refresh" :disabled="loading" @click="reload(false)"><RefreshCw class="size-4" :class="loading && 'animate-spin'" /></Button>
      </Teleport>
    </ClientOnly>

    <!-- Summary strip -->
    <div class="rounded-xl border bg-card px-5 py-3.5 flex flex-wrap items-center gap-x-6 gap-y-2">
      <div>
        <p class="text-[11px] uppercase tracking-wider text-muted-foreground">{{ todayLabel }}</p>
        <p class="text-sm"><span class="font-bold tabular-nums">{{ (b?.followUpsToday.length || 0) + (b?.meetingsToday.length || 0) + (b?.callsDue.length || 0) }}</span> due today · <span class="font-bold tabular-nums" :class="b?.overdueFollowUps.length && 'text-rose-600'">{{ b?.overdueFollowUps.length || 0 }}</span> overdue</p>
      </div>
      <div class="h-8 w-px bg-border hidden sm:block" />
      <div class="flex items-center gap-3">
        <component :is="b?.coverage.uncovered ? CircleOff : ShieldCheck" class="size-5" :class="b?.coverage.uncovered ? 'text-rose-500' : 'text-emerald-600'" />
        <div>
          <p class="text-sm"><span class="font-bold tabular-nums">{{ coverPct }}%</span> of active prospects have a next step</p>
          <p class="text-[11px] text-muted-foreground">{{ b?.coverage.active || 0 }} active · {{ b?.coverage.queued || 0 }} in research/contact queues · {{ b?.coverage.parked || 0 }} in nurture · <span :class="b?.coverage.uncovered && 'text-rose-600 font-medium'">{{ b?.coverage.uncovered || 0 }} without a next step</span></p>
        </div>
      </div>
      <div v-if="b?.upcoming.length" class="ml-auto text-[11px] text-muted-foreground inline-flex items-center gap-1.5"><CalendarRange class="size-3.5" /> {{ b.upcoming.length }} more due in the next 7 days</div>
    </div>

    <div v-if="loading && !b" class="flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Building your board…</div>

    <div v-else-if="b" class="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
      <!-- TODAY -->
      <div class="space-y-4">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><CalendarCheck class="size-4" /> Today</h2>
        <section v-for="s in todaySections" :key="s.key" class="rounded-xl border bg-card overflow-hidden">
          <header class="px-4 py-2.5 border-b flex items-center gap-2" :title="s.hint">
            <component :is="s.icon" class="size-4 text-muted-foreground" />
            <h3 class="text-sm font-semibold">{{ s.title }}</h3>
            <span class="rounded-full px-1.5 py-0.5 text-[10px] tabular-nums leading-none font-semibold" :class="s.items.length ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'">{{ s.items.length }}</span>
          </header>
          <ul v-if="s.items.length" class="divide-y">
            <CrmFollowupItem v-for="i in (expanded.has(s.key) ? s.items : s.items.slice(0, LIMIT))" :key="`${s.key}-${i.dealershipId}-${i.nextAction?.interactionId || ''}`" :item="i" :tone="s.tone" :show-action="s.showAction" :can-edit="canEdit" :busy="busy === i.nextAction?.interactionId" @open="open(i)" @done="done(i)" @reschedule="(d: number) => reschedule(i, d)" />
          </ul>
          <p v-else class="px-4 py-3 text-xs text-muted-foreground flex items-center gap-1.5"><CheckCircle2 class="size-3.5 text-emerald-500" /> {{ s.empty }}</p>
          <button v-if="s.items.length > LIMIT" type="button" class="w-full border-t px-4 py-2 text-xs text-primary hover:bg-muted/40 inline-flex items-center justify-center gap-1" @click="toggle(s.key)">{{ expanded.has(s.key) ? 'Show less' : `Show all ${s.items.length}` }}<ChevronDown class="size-3 transition-transform" :class="expanded.has(s.key) && 'rotate-180'" /></button>
        </section>
      </div>

      <!-- OVERDUE -->
      <div class="space-y-4">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400 flex items-center gap-2"><AlarmClock class="size-4" /> Overdue &amp; at risk</h2>
        <section v-for="s in overdueSections" :key="s.key" class="rounded-xl border bg-card overflow-hidden" :class="s.items.length && s.tone === 'danger' && 'border-rose-500/30'">
          <header class="px-4 py-2.5 border-b flex items-center gap-2" :title="s.hint">
            <component :is="s.icon" class="size-4" :class="s.items.length ? (s.tone === 'danger' ? 'text-rose-500' : 'text-amber-500') : 'text-muted-foreground'" />
            <h3 class="text-sm font-semibold">{{ s.title }}</h3>
            <span class="rounded-full px-1.5 py-0.5 text-[10px] tabular-nums leading-none font-semibold" :class="s.items.length ? (s.tone === 'danger' ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300') : 'bg-muted text-muted-foreground'">{{ s.items.length }}</span>
            <span class="ml-auto text-[10px] text-muted-foreground hidden md:inline truncate max-w-[55%]">{{ s.hint }}</span>
          </header>
          <ul v-if="s.items.length" class="divide-y">
            <CrmFollowupItem v-for="i in (expanded.has(s.key) ? s.items : s.items.slice(0, LIMIT))" :key="`${s.key}-${i.dealershipId}-${i.nextAction?.interactionId || ''}`" :item="i" :tone="s.tone" :show-action="s.showAction" :can-edit="canEdit" :busy="busy === i.nextAction?.interactionId" @open="open(i)" @done="done(i)" @reschedule="(d: number) => reschedule(i, d)" />
          </ul>
          <p v-else class="px-4 py-3 text-xs text-muted-foreground flex items-center gap-1.5"><CheckCircle2 class="size-3.5 text-emerald-500" /> {{ s.empty }}</p>
          <button v-if="s.items.length > LIMIT" type="button" class="w-full border-t px-4 py-2 text-xs text-primary hover:bg-muted/40 inline-flex items-center justify-center gap-1" @click="toggle(s.key)">{{ expanded.has(s.key) ? 'Show less' : `Show all ${s.items.length}` }}<ChevronDown class="size-3 transition-transform" :class="expanded.has(s.key) && 'rotate-180'" /></button>
        </section>
      </div>
    </div>
  </div>
</template>
