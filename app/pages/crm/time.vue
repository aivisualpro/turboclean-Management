<script setup lang="ts">
import type { TimeEntry, TimeReport } from '~/composables/useCrmTime'
import { money } from '~/composables/useCrmWon'
import { localDay } from '~/composables/useCrmDealerships'
import { RefreshCw, Loader2, Plus, ArrowRight, Clock, CalendarCheck, Trophy, DollarSign, Pencil, Trash2, Check, X, Timer as TimerIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format, subDays, startOfYear, startOfWeek, parseISO } from 'date-fns'
import { TIME_CATEGORIES, TIME_CATEGORY_MAP, formatMinutes } from '~/constants/crm'
import { INTERACTION_ICONS } from '~/constants/crm-icons'

/**
 * Time & ROI — where the time goes, and what it produces:
 * hours → meetings → dealerships won → revenue.
 */
const { setHeader } = usePageHeader()
setHeader({ title: 'Time & ROI', description: 'CRM · where prospecting time goes and what it produces', icon: 'i-lucide-timer' })

const { version, list, report: getReport, update, remove } = useCrmTime()
const { user: me } = useAuth()

const RANGES = [
  { key: 'week', label: 'This week' }, { key: '7', label: 'Last 7 days' }, { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' }, { key: 'ytd', label: 'This year' }, { key: 'all', label: 'All time' },
] as const
const range = useLocalStorage<string>('crm-time-range', '30')
const scope = useLocalStorage<string>('crm-time-scope', 'mine')
const users = ref<{ id: string, name: string }[]>([])
onMounted(async () => {
  try { const res = await $fetch<any[]>('/api/users'); users.value = (res || []).filter(u => u.status !== 'Inactive').map(u => ({ id: u.id, name: u.name || u.email })).sort((a, b) => a.name.localeCompare(b.name)) } catch {}
})
const fromDate = computed(() => {
  const now = new Date()
  if (range.value === 'all') return undefined
  if (range.value === 'week') return localDay(startOfWeek(now, { weekStartsOn: 1 }))
  if (range.value === 'ytd') return localDay(startOfYear(now))
  return localDay(subDays(now, Number(range.value) - 1))
})

const report = ref<TimeReport | null>(null)
const entries = ref<TimeEntry[]>([])
const loading = ref(false)
async function reload(quiet = true) {
  loading.value = true
  try {
    const q = { from: fromDate.value, scope: scope.value }
    const [rep, l] = await Promise.all([getReport(q), list(q)])
    report.value = rep
    entries.value = l.entries
    if (!quiet) toast.success('Refreshed')
  } catch { toast.error('Could not load time') } finally { loading.value = false }
}
watch([range, scope, version], () => reload(), { immediate: true })

const r = computed(() => report.value)
const maxCat = computed(() => Math.max(1, ...(r.value?.byCategory.map(c => c.minutes) || [1])))
const maxWeek = computed(() => Math.max(1, ...(r.value?.byWeek.map(w => w.minutes) || [1])))
const weekTitle = (w: TimeReport['byWeek'][number]) => `Week of ${format(parseISO(w.week), 'MMM d')}: ${formatMinutes(w.minutes)}\n` + TIME_CATEGORIES.filter(c => w.categories[c.key]).map(c => `${c.short}: ${formatMinutes(w.categories[c.key]!)}`).join('\n')
const hrs = (h: number | null | undefined) => h == null ? '—' : `${h}h`

// Entries grouped by day
const days = computed(() => {
  const m = new Map<string, TimeEntry[]>()
  for (const e of entries.value) m.set(e.date, [...(m.get(e.date) || []), e])
  return [...m.entries()].map(([date, list]) => ({ date, list, minutes: list.reduce((a, e) => a + (e.minutes || 0), 0) }))
})
const dayLabel = (d: string) => d === localDay(new Date()) ? 'Today' : d === localDay(subDays(new Date(), 1)) ? 'Yesterday' : format(parseISO(d), 'EEE, MMM d')
const canChange = (e: TimeEntry) => e.userId === (me.value as any)?.id || (me.value as any)?.role === 'Admin'
const SOURCE_LABEL: Record<string, string> = { timer: 'Timer', manual: 'Added', activity: 'Activity' }

const editing = ref<string | null>(null)
const editForm = ref({ minutes: 0 as number | string, category: '' })
function startEdit(e: TimeEntry) { editing.value = e.id; editForm.value = { minutes: e.minutes, category: e.category } }
async function saveEdit(e: TimeEntry) {
  try { await update(e.id, { minutes: Number(editForm.value.minutes), category: editForm.value.category }); editing.value = null; toast.success('Time updated') } catch (err: any) { toast.error(err?.data?.statusMessage || 'Could not update') }
}
async function del(e: TimeEntry) {
  try { await remove(e.id); toast.success(`Removed ${formatMinutes(e.minutes)} of ${TIME_CATEGORY_MAP[e.category]?.label.toLowerCase()}`) } catch (err: any) { toast.error(err?.data?.statusMessage || 'Could not delete') }
}

const showAdd = ref(false)
</script>

<template>
  <div class="space-y-5">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <Button size="sm" class="h-9 gap-1.5" @click="showAdd = true"><Plus class="size-4" /> Add time</Button>
        <Button variant="outline" size="icon" class="size-9" aria-label="Refresh" :disabled="loading" @click="reload(false)"><RefreshCw class="size-4" :class="loading && 'animate-spin'" /></Button>
      </Teleport>
    </ClientOnly>

    <div class="flex flex-wrap items-center gap-2">
      <Select v-model="range">
        <SelectTrigger class="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem v-for="o in RANGES" :key="o.key" :value="o.key">{{ o.label }}</SelectItem></SelectContent>
      </Select>
      <Select v-model="scope">
        <SelectTrigger class="h-9 w-[180px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent class="max-h-72">
          <SelectItem value="mine">Mine{{ (me as any)?.name ? ` (${(me as any).name})` : '' }}</SelectItem>
          <SelectItem value="all">Everyone</SelectItem>
          <SelectItem v-for="u in users.filter(u => u.id !== (me as any)?.id)" :key="u.id" :value="u.id">{{ u.name }}</SelectItem>
        </SelectContent>
      </Select>
      <Loader2 v-if="loading && r" class="size-4 animate-spin text-muted-foreground" />
    </div>

    <div v-if="!r" class="flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Loading time…</div>

    <template v-else>
      <!-- Return on time -->
      <section class="rounded-xl border bg-card p-4">
        <p class="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Return on prospecting time · same period{{ scope !== 'all' ? ' · meetings you logged and deals you own' : '' }}</p>
        <div class="flex flex-wrap items-stretch gap-2">
          <div class="flex-1 min-w-[140px] rounded-lg bg-muted/40 px-4 py-3">
            <p class="text-[11px] text-muted-foreground flex items-center gap-1"><Clock class="size-3" /> Hours spent</p>
            <p class="text-2xl font-bold tabular-nums">{{ r.roi.hours }}</p>
            <p class="text-[11px] text-muted-foreground">{{ r.entries }} entries</p>
          </div>
          <ArrowRight class="size-4 self-center text-muted-foreground hidden sm:block" />
          <div class="flex-1 min-w-[140px] rounded-lg bg-muted/40 px-4 py-3">
            <p class="text-[11px] text-muted-foreground flex items-center gap-1"><CalendarCheck class="size-3" /> Meetings held</p>
            <p class="text-2xl font-bold tabular-nums">{{ r.roi.meetingsHeld }}</p>
            <p class="text-[11px] text-muted-foreground">{{ r.roi.meetingsScheduled }} scheduled · {{ r.roi.proposals }} proposals</p>
          </div>
          <ArrowRight class="size-4 self-center text-muted-foreground hidden sm:block" />
          <div class="flex-1 min-w-[140px] rounded-lg bg-muted/40 px-4 py-3">
            <p class="text-[11px] text-muted-foreground flex items-center gap-1"><Trophy class="size-3" /> Dealerships won</p>
            <p class="text-2xl font-bold tabular-nums">{{ r.roi.won }}</p>
            <p class="text-[11px] text-muted-foreground">with deal details</p>
          </div>
          <ArrowRight class="size-4 self-center text-muted-foreground hidden sm:block" />
          <div class="flex-1 min-w-[160px] rounded-lg bg-emerald-500/10 px-4 py-3">
            <p class="text-[11px] text-muted-foreground flex items-center gap-1"><DollarSign class="size-3" /> Annual revenue won</p>
            <p class="text-2xl font-bold tabular-nums">{{ money(r.roi.annualRevenue) }}</p>
            <p class="text-[11px] text-muted-foreground">{{ r.roi.annualProfit != null ? `${money(r.roi.annualProfit)} est. profit` : `${money(r.roi.monthlyRevenue)} per month` }}</p>
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3 text-sm">
          <div class="rounded-lg border px-3 py-2"><span class="text-muted-foreground text-xs">Hours per meeting</span> <span class="font-semibold tabular-nums float-right">{{ hrs(r.roi.hoursPerMeeting) }}</span></div>
          <div class="rounded-lg border px-3 py-2"><span class="text-muted-foreground text-xs">Hours per dealership won</span> <span class="font-semibold tabular-nums float-right">{{ hrs(r.roi.hoursPerWin) }}</span></div>
          <div class="rounded-lg border px-3 py-2"><span class="text-muted-foreground text-xs">Annual revenue per hour</span> <span class="font-semibold tabular-nums float-right">{{ r.roi.annualRevenuePerHour == null ? '—' : money(r.roi.annualRevenuePerHour) }}</span></div>
        </div>
      </section>

      <div class="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <!-- Where the time goes -->
        <section class="rounded-xl border bg-card overflow-hidden">
          <header class="px-4 py-2.5 border-b flex items-baseline justify-between">
            <h3 class="text-sm font-semibold">Where the time goes</h3>
            <span class="text-xs text-muted-foreground tabular-nums">{{ formatMinutes(r.totalMinutes) }} total</span>
          </header>
          <ul class="py-1.5">
            <li v-for="c in r.byCategory" :key="c.key" class="px-4 py-1.5" :title="`${c.label}: ${formatMinutes(c.minutes)} (${c.pct}%)`">
              <div class="flex items-baseline justify-between gap-2 text-xs">
                <span class="flex items-center gap-1.5" :class="!c.minutes && 'text-muted-foreground'"><component :is="INTERACTION_ICONS[TIME_CATEGORY_MAP[c.key]?.icon || 'StickyNote']" class="size-3.5 text-muted-foreground" />{{ c.label }}</span>
                <span class="tabular-nums text-muted-foreground"><span class="text-foreground font-semibold">{{ c.minutes ? formatMinutes(c.minutes) : '0' }}</span> · {{ c.pct }}%</span>
              </div>
              <div class="mt-1 h-2 rounded-full bg-muted overflow-hidden"><div class="h-full rounded-full bg-primary" :style="{ width: `${(c.minutes / maxCat) * 100}%` }" /></div>
            </li>
          </ul>
        </section>

        <div class="space-y-5">
          <!-- Hours per week -->
          <section class="rounded-xl border bg-card overflow-hidden">
            <header class="px-4 py-2.5 border-b"><h3 class="text-sm font-semibold">Hours per week</h3><p class="text-[11px] text-muted-foreground">Hover a week for the breakdown.</p></header>
            <div v-if="r.byWeek.length" class="px-4 pt-4 pb-2">
              <div class="flex items-end gap-1.5 h-36">
                <div v-for="w in r.byWeek.slice(-16)" :key="w.week" class="flex-1 min-w-0 flex flex-col items-center justify-end h-full group" :title="weekTitle(w)">
                  <span class="text-[10px] tabular-nums text-muted-foreground mb-0.5 opacity-0 group-hover:opacity-100">{{ Math.round(w.minutes / 6) / 10 }}h</span>
                  <div class="w-full max-w-10 rounded-t bg-primary/80 group-hover:bg-primary transition-colors" :style="{ height: `${Math.max(2, (w.minutes / maxWeek) * 100)}%` }" />
                </div>
              </div>
              <div class="flex gap-1.5 mt-1 border-t pt-1">
                <span v-for="w in r.byWeek.slice(-16)" :key="w.week" class="flex-1 min-w-0 text-center text-[9px] text-muted-foreground truncate">{{ format(parseISO(w.week), 'M/d') }}</span>
              </div>
            </div>
            <p v-else class="px-4 py-6 text-xs text-muted-foreground text-center">No time logged in this period.</p>
          </section>

          <!-- People / dealerships -->
          <section class="rounded-xl border bg-card overflow-hidden">
            <header class="px-4 py-2.5 border-b"><h3 class="text-sm font-semibold">{{ scope === 'all' ? 'By person' : 'Dealerships taking the most time' }}</h3></header>
            <ul class="divide-y text-xs">
              <template v-if="scope === 'all'">
                <li v-for="u in r.byUser" :key="u.key" class="px-4 py-2 flex justify-between"><span class="font-medium">{{ u.label }}</span><span class="tabular-nums">{{ formatMinutes(u.minutes) }} · {{ u.pct }}%</span></li>
              </template>
              <template v-else>
                <li v-for="d in r.byDealership" :key="d.key" class="px-4 py-2 flex justify-between hover:bg-muted/30 cursor-pointer" @click="navigateTo(`/crm/dealership/${d.key}`)"><span class="font-medium truncate">{{ d.label }}</span><span class="tabular-nums shrink-0">{{ formatMinutes(d.minutes) }}</span></li>
                <li v-if="r.unlinkedMinutes" class="px-4 py-2 flex justify-between text-muted-foreground"><span>Not linked to a dealership</span><span class="tabular-nums">{{ formatMinutes(r.unlinkedMinutes) }}</span></li>
              </template>
              <li v-if="(scope === 'all' ? !r.byUser.length : !r.byDealership.length && !r.unlinkedMinutes)" class="px-4 py-4 text-center text-muted-foreground">Nothing yet.</li>
            </ul>
          </section>
        </div>
      </div>

      <!-- Entries -->
      <section class="rounded-xl border bg-card overflow-hidden">
        <header class="px-4 py-2.5 border-b flex items-center gap-2"><h3 class="text-sm font-semibold">Time entries</h3><span class="text-[11px] text-muted-foreground">Start a timer from “Track time” in the top bar, add time here, or enter minutes when logging an activity.</span></header>
        <div v-if="!days.length" class="px-4 py-10 text-center text-sm text-muted-foreground">No time recorded in this period.</div>
        <div v-for="d in days" :key="d.date">
          <div class="px-4 py-1.5 bg-muted/40 border-b text-[11px] font-semibold flex justify-between"><span>{{ dayLabel(d.date) }}</span><span class="tabular-nums text-muted-foreground">{{ formatMinutes(d.minutes) }}</span></div>
          <ul class="divide-y">
            <li v-for="e in d.list" :key="e.id" class="px-4 py-2 flex items-center gap-3 text-xs">
              <span class="size-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"><component :is="INTERACTION_ICONS[TIME_CATEGORY_MAP[e.category]?.icon || 'StickyNote']" class="size-3.5" /></span>
              <template v-if="editing === e.id">
                <Select v-model="editForm.category">
                  <SelectTrigger class="h-7 w-[190px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem v-for="c in TIME_CATEGORIES" :key="c.key" :value="c.key">{{ c.label }}</SelectItem></SelectContent>
                </Select>
                <div class="relative w-24"><Input v-model="editForm.minutes" type="number" min="1" max="720" class="h-7 pr-9 text-xs tabular-nums" @keydown.enter.prevent="saveEdit(e)" /><span class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">min</span></div>
                <div class="ml-auto flex gap-1">
                  <Button size="icon" class="size-7" aria-label="Save" @click="saveEdit(e)"><Check class="size-3.5" /></Button>
                  <Button size="icon" variant="ghost" class="size-7" aria-label="Cancel" @click="editing = null"><X class="size-3.5" /></Button>
                </div>
              </template>
              <template v-else>
                <div class="min-w-0 flex-1">
                  <p class="font-medium">{{ TIME_CATEGORY_MAP[e.category]?.label || e.category }}
                    <NuxtLink v-if="e.dealershipId" :to="`/crm/dealership/${e.dealershipId}`" class="font-normal text-primary hover:underline"> · {{ e.dealershipName }}</NuxtLink>
                  </p>
                  <p class="text-[11px] text-muted-foreground truncate">
                    <span class="rounded bg-muted px-1 py-px text-[10px] mr-1">{{ SOURCE_LABEL[e.source] || e.source }}</span>
                    <span v-if="scope !== 'mine'">{{ e.userName }} · </span>
                    <span v-if="e.startedAt">{{ format(new Date(e.startedAt), 'h:mm a') }}<template v-if="e.endedAt">–{{ format(new Date(e.endedAt), 'h:mm a') }}</template> · </span>{{ e.note }}
                    <span v-if="e.capped" class="text-amber-600"> · timer ran over 12h and was capped — check the minutes</span>
                  </p>
                </div>
                <span v-if="!e.endedAt" class="inline-flex items-center gap-1 text-emerald-600 font-medium"><TimerIcon class="size-3.5" /> running</span>
                <span v-else class="tabular-nums font-semibold w-14 text-right">{{ formatMinutes(e.minutes) }}</span>
                <div v-if="canChange(e) && e.endedAt" class="flex gap-0.5">
                  <Button size="icon" variant="ghost" class="size-7" aria-label="Edit" @click="startEdit(e)"><Pencil class="size-3.5" /></Button>
                  <Button size="icon" variant="ghost" class="size-7 hover:text-destructive" aria-label="Delete" @click="del(e)"><Trash2 class="size-3.5" /></Button>
                </div>
                <div v-else class="w-[60px]" />
              </template>
            </li>
          </ul>
        </div>
      </section>
    </template>

    <Dialog v-model:open="showAdd">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add time</DialogTitle>
          <DialogDescription class="text-xs">For time you didn't run the timer for.</DialogDescription>
        </DialogHeader>
        <CrmTimeQuickAdd @saved="showAdd = false" />
      </DialogContent>
    </Dialog>
  </div>
</template>
