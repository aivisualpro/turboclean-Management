<script setup lang="ts">
import { Loader2, Save, Undo2, Sparkles, Copy, Eraser, Users, User, History, Clock, Scale, Target, Info, Check } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format, parseISO, startOfWeek } from 'date-fns'
import { localDay } from '~/composables/useCrmDealerships'
import type { CrmGoalConfig, CrmGoalDay, CrmGoalHistory, CrmGoalMetric, CrmGoalPlan } from '~/composables/useCrmGoals'
import { CRM_GOAL_DAYS, CRM_GOAL_METRICS, crmGoalEmptyPlan, crmGoalWeekTotal, useCrmGoals } from '~/composables/useCrmGoals'

/**
 * Activity goals — a number per activity for each day of the week, for the team or for each salesperson.
 * Saving starts the new goals today; earlier weeks keep the goals that were in force then.
 */
const { setHeader } = usePageHeader()
setHeader({ title: 'Goals', icon: 'i-lucide-target' })
const { isActionAllowed } = usePermissions()
const canEdit = computed(() => isActionAllowed('crm_dealership', 'Edit'))
const api = useCrmGoals()

const config = ref<CrmGoalConfig | null>(null)
const saved = ref('')
const seeded = ref(false)
const history = ref<CrmGoalHistory[]>([])
const loading = ref(true)
const saving = ref(false)
const suggesting = ref(false)
const users = ref<{ id: string, name: string, role?: string }[]>([])
/** Which plan the grid shows: 'default' (team / everyone's default) or a person's id. */
const editing = ref<string>('default')

const snapshot = (c: CrmGoalConfig | null) => JSON.stringify(c)
const dirty = computed(() => !!config.value && snapshot(config.value) !== saved.value)

async function load() {
  loading.value = true
  try {
    const [res, us] = await Promise.all([api.load(), $fetch<any[]>('/api/users').catch(() => [])])
    config.value = res.config
    saved.value = snapshot(res.config)
    seeded.value = res.seeded
    history.value = res.history
    users.value = (us || []).filter(u => u.status !== 'Inactive').map(u => ({ id: u.id, name: u.name || u.email, role: u.role })).sort((a, b) => a.name.localeCompare(b.name))
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not load goals') } finally { loading.value = false }
}
onMounted(load)

// ─── The plan in the grid ───
const isPerson = computed(() => editing.value !== 'default')
const personName = (id: string) => users.value.find(u => u.id === id)?.name || 'Unknown user'
const hasOwn = computed(() => isPerson.value && !!config.value?.overrides[editing.value])
/** The plan shown (a person without their own plan sees the default, read-only until "Customize"). */
const plan = computed<CrmGoalPlan>(() => {
  const c = config.value
  if (!c) return crmGoalEmptyPlan()
  return isPerson.value ? (c.overrides[editing.value] || c.plan) : c.plan
})
const gridLocked = computed(() => !canEdit.value || (isPerson.value && !hasOwn.value))
function setCell(day: CrmGoalDay, m: CrmGoalMetric, v: string | number) {
  if (gridLocked.value) return
  const n = Math.max(0, Math.min(10000, Math.round(Number(v) || 0)))
  const p = plan.value
  if (n) p[day][m] = n
  else delete p[day][m]
}
function customize() {
  const c = config.value!
  c.overrides[editing.value] = JSON.parse(JSON.stringify(c.plan))
}
function useDefault() {
  delete config.value!.overrides[editing.value]
}
function copyMonday() {
  if (gridLocked.value) return
  for (const d of ['tue', 'wed', 'thu', 'fri'] as CrmGoalDay[]) plan.value[d] = { ...plan.value.mon }
}
function clearWeekend() { if (!gridLocked.value) { plan.value.sat = {}; plan.value.sun = {} } }
function clearAll() { if (!gridLocked.value) for (const d of CRM_GOAL_DAYS) plan.value[d.key] = {} }
const todayKey = computed(() => CRM_GOAL_DAYS[(new Date().getDay() + 6) % 7]!.key)
const monthly = (week: number) => Math.round((week * 52) / 12)

// ─── Who has goals ───
function setMode(mode: 'team' | 'individual') {
  const c = config.value!
  c.mode = mode
  if (mode === 'individual' && !c.people.length) c.people = users.value.filter(u => u.role !== 'Admin').map(u => u.id).slice(0, 20)
  if (mode === 'team') editing.value = 'default'
}
function togglePerson(id: string, on: boolean) {
  const c = config.value!
  if (on) { if (!c.people.includes(id)) c.people.push(id) }
  else { c.people = c.people.filter(p => p !== id); delete c.overrides[id]; if (editing.value === id) editing.value = 'default' }
}
const people = computed(() => (config.value?.people || []).map(id => ({ id, name: personName(id) })))
/** Team goal per week when each salesperson has their own: the sum of everyone's. */
const teamWeek = computed(() => {
  const c = config.value
  if (!c || c.mode !== 'individual') return null
  return Object.fromEntries(CRM_GOAL_METRICS.map(m => [m.key, c.people.reduce((n, id) => n + crmGoalWeekTotal(c.overrides[id] || c.plan, m.key), 0)]))
})

// ─── Weights & hours ───
const weight = (m: CrmGoalMetric) => config.value?.weights[m] ?? CRM_GOAL_METRICS.find(x => x.key === m)!.weight
function setWeight(m: CrmGoalMetric, v: string) {
  const c = config.value!
  const n = Number(v)
  if (n === CRM_GOAL_METRICS.find(x => x.key === m)!.weight) delete c.weights[m]
  else c.weights[m] = n
}
const HOURS = Array.from({ length: 25 }, (_, h) => ({ value: String(h), label: h === 0 || h === 24 ? '12 am' : h === 12 ? '12 pm' : h < 12 ? `${h} am` : `${h - 12} pm` }))

// ─── Suggest from history ───
async function suggest() {
  suggesting.value = true
  try {
    const monday = startOfWeek(new Date(), { weekStartsOn: 1 })
    const c = config.value!
    const userId = isPerson.value ? editing.value : undefined
    const res = await api.suggest({ weekStart: localDay(monday), weekStartTs: monday.toISOString(), userId, weeks: 8 })
    if (!res.activeDays) { toast.info('Not enough history yet', { description: 'Nothing was logged in the last 8 weeks to base goals on.' }); return }
    let next = res.plan
    // Everyone's default in per-person mode: the team's average split across the people.
    if (!isPerson.value && c.mode === 'individual' && c.people.length > 1) {
      const n = c.people.length
      next = Object.fromEntries(CRM_GOAL_DAYS.map(d => [d.key, Object.fromEntries(Object.entries(res.plan[d.key]).map(([m, v]) => [m, Math.max(1, Math.ceil(Number(v) / n))]))])) as CrmGoalPlan
    }
    if (isPerson.value && !hasOwn.value) customize()
    for (const d of CRM_GOAL_DAYS) plan.value[d.key] = { ...next[d.key] }
    toast.success('Filled in from the last 8 weeks', { description: `The average per weekday over the ${res.activeWeeks} week${res.activeWeeks === 1 ? '' : 's'} with activity (${format(parseISO(res.from), 'MMM d')} – ${format(parseISO(res.to), 'MMM d')}), plus 10%. Check it, then Save.` })
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not work out suggestions') } finally { suggesting.value = false }
}

// ─── Save / discard ───
async function save() {
  if (!config.value || !dirty.value) return
  saving.value = true
  try {
    const res = await api.save(config.value, localDay(new Date()))
    config.value = res.config
    saved.value = snapshot(res.config)
    seeded.value = false
    history.value = res.history
    toast.success('Goals saved', { description: 'They count for this whole week (from Monday). Earlier weeks keep the goals they had.' })
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save goals') } finally { saving.value = false }
}
function discard() {
  config.value = JSON.parse(saved.value)
  if (isPerson.value && !config.value!.people.includes(editing.value)) editing.value = 'default'
}
onBeforeRouteLeave(() => !dirty.value || window.confirm('Leave without saving your goal changes?'))
const onUnload = (e: BeforeUnloadEvent) => { if (dirty.value) { e.preventDefault(); e.returnValue = '' } }
onMounted(() => window.addEventListener('beforeunload', onUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onUnload))
onKeyStroke('s', (e) => { if ((e.metaKey || e.ctrlKey) && dirty.value) { e.preventDefault(); save() } })

const fmtDay = (d: string) => d <= '2000-01-01' ? 'the start' : format(parseISO(d), 'MMM d, yyyy')
</script>

<template>
  <div class="space-y-2">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <span v-if="dirty" class="hidden items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 md:inline-flex"><span class="size-1.5 rounded-full bg-amber-500" />Unsaved changes</span>
        <Button v-if="canEdit" variant="outline" size="sm" class="h-8 gap-1.5" :disabled="!config || suggesting || gridLocked" :title="gridLocked && isPerson ? 'Customize this person\'s plan first' : 'Fill in from what was actually done in the last 8 weeks, plus 10%'" @click="suggest">
          <Loader2 v-if="suggesting" class="size-4 animate-spin" /><Sparkles v-else class="size-4" /><span class="hidden lg:inline">Suggest from last 8 weeks</span>
        </Button>
        <Button v-if="dirty" variant="ghost" size="sm" class="h-8 gap-1.5" @click="discard"><Undo2 class="size-4" /><span class="hidden lg:inline">Discard</span></Button>
        <Button v-if="canEdit" size="sm" class="h-8 gap-1.5" :disabled="!dirty || saving" data-testid="save-goals" @click="save">
          <Loader2 v-if="saving" class="size-4 animate-spin" /><Save v-else class="size-4" /> Save goals
        </Button>
      </Teleport>
    </ClientOnly>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-24 text-muted-foreground"><Loader2 class="size-4 animate-spin" /> Loading goals…</div>

    <template v-else-if="config">
      <div v-if="seeded" class="flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/5 px-3 py-2.5 text-sm" data-testid="seeded-banner">
        <Info class="mt-0.5 size-4 shrink-0 text-sky-600" />
        <p><span class="font-medium">Starting from your team sheet</span> <span class="text-muted-foreground">(week of Oct 26: 100 emails, 60 calls, 25 walk-ins, 4 meetings a week). Check the numbers, add goals for the other activities, then Save.</span></p>
      </div>
      <p v-if="!canEdit" class="text-xs text-muted-foreground">You can see the goals; only people who can edit dealerships can change them.</p>

      <div class="grid grid-cols-1 items-start gap-2 xl:grid-cols-3">
        <!-- Weekly plan -->
        <section class="overflow-hidden rounded-xl border bg-card xl:col-span-2" data-testid="plan">
          <header class="flex flex-wrap items-start gap-2 border-b px-3 py-2.5">
            <div class="mr-auto min-w-0">
              <h2 class="flex items-center gap-1.5 text-sm font-semibold"><Target class="size-4 text-muted-foreground" /> Weekly plan
                <CrmHint text="A goal for each activity on each day of the week. Leave a day empty (or 0) for no goal that day.\n\nThe dashboard adds up the days in whatever period you look at, and works out how much should be done by now." label="the weekly plan" />
              </h2>
              <p class="text-[11px] text-muted-foreground">
                <template v-if="config.mode === 'team'">One goal for the whole team together.</template>
                <template v-else-if="!isPerson">Everyone's default — each salesperson gets this unless you customize theirs.</template>
                <template v-else-if="hasOwn">{{ personName(editing) }}'s own plan.</template>
                <template v-else>{{ personName(editing) }} uses everyone's default.</template>
              </p>
            </div>
            <div v-if="config.mode === 'individual'" class="flex min-w-0 max-w-full overflow-x-auto rounded-lg border bg-muted/40 p-0.5 text-xs" role="tablist" aria-label="Whose plan">
              <button type="button" role="tab" :aria-selected="editing === 'default'" class="whitespace-nowrap rounded-md px-2.5 py-1 font-medium" :class="editing === 'default' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'" @click="editing = 'default'">Everyone's default</button>
              <button v-for="p in people" :key="p.id" type="button" role="tab" :aria-selected="editing === p.id" class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 font-medium" :class="editing === p.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'" @click="editing = p.id">
                {{ p.name }}<span v-if="config.overrides[p.id]" class="size-1.5 rounded-full bg-primary" title="Has their own plan" />
              </button>
            </div>
          </header>

          <div v-if="isPerson && !hasOwn" class="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs">
            <span class="text-muted-foreground">Showing everyone's default for {{ personName(editing) }}.</span>
            <Button v-if="canEdit" size="sm" variant="outline" class="ml-auto h-7 text-xs" @click="customize">Customize for {{ personName(editing) }}</Button>
          </div>
          <div v-else-if="isPerson && hasOwn && canEdit" class="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-3 py-2 text-xs">
            <span>{{ personName(editing) }} has their own plan.</span>
            <Button size="sm" variant="ghost" class="ml-auto h-7 text-xs" @click="useDefault">Use everyone's default instead</Button>
          </div>

          <div class="overflow-x-auto">
            <table class="goal-plan w-full text-[13px]">
              <thead>
                <tr>
                  <th class="text-left">Activity</th>
                  <th v-for="d in CRM_GOAL_DAYS" :key="d.key" class="w-16 text-center" :title="d.key === todayKey ? `${d.long} (today)` : d.long">{{ d.label }}<span v-if="d.key === todayKey" class="ml-1 inline-block size-1.5 rounded-full bg-emerald-400 align-middle" /></th>
                  <th class="w-16 text-right">Week</th>
                  <th class="w-20 text-right" title="Week × 52 ÷ 12">≈ Month</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in CRM_GOAL_METRICS" :key="m.key" :data-metric="m.key">
                  <td>
                    <span class="flex items-center gap-1.5 whitespace-nowrap font-medium"><component :is="m.icon" class="size-3.5 shrink-0 text-muted-foreground" />{{ m.label }}<CrmHint :text="m.hint" :label="m.label" /></span>
                  </td>
                  <td v-for="d in CRM_GOAL_DAYS" :key="d.key" class="text-center" :class="d.key === todayKey && 'is-today'">
                    <input
                      type="number" min="0" step="1" inputmode="numeric" :disabled="gridLocked"
                      class="goal-cell" :class="!(plan[d.key][m.key]) && 'is-empty'"
                      :value="plan[d.key][m.key] || ''" placeholder="0"
                      :aria-label="`${m.label} goal on ${d.long}`" :data-cell="`${m.key}-${d.key}`"
                      @input="setCell(d.key, m.key, ($event.target as HTMLInputElement).value)"
                      @focus="($event.target as HTMLInputElement).select()"
                    >
                  </td>
                  <td class="text-right font-semibold tabular-nums">{{ crmGoalWeekTotal(plan, m.key) || '—' }}</td>
                  <td class="text-right tabular-nums text-muted-foreground">{{ crmGoalWeekTotal(plan, m.key) ? monthly(crmGoalWeekTotal(plan, m.key)) : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <footer v-if="canEdit" class="flex flex-wrap items-center gap-1 border-t px-2 py-1.5">
            <Button variant="ghost" size="sm" class="h-7 gap-1.5 text-xs" :disabled="gridLocked" @click="copyMonday"><Copy class="size-3.5" /> Copy Monday to Tue–Fri</Button>
            <Button variant="ghost" size="sm" class="h-7 gap-1.5 text-xs" :disabled="gridLocked" @click="clearWeekend"><Eraser class="size-3.5" /> Clear weekend</Button>
            <Button variant="ghost" size="sm" class="h-7 gap-1.5 text-xs" :disabled="gridLocked" @click="clearAll"><Eraser class="size-3.5" /> Clear all</Button>
            <span class="ml-auto hidden text-[11px] text-muted-foreground sm:inline">Tab moves between days · ⌘S saves</span>
          </footer>
        </section>

        <div class="space-y-2">
          <!-- Who has goals -->
          <section class="rounded-xl border bg-card p-3" data-testid="who">
            <h2 class="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Users class="size-4 text-muted-foreground" /> Who has goals</h2>
            <div class="grid grid-cols-1 gap-1.5" role="radiogroup" aria-label="Who has goals">
              <button type="button" role="radio" :aria-checked="config.mode === 'team'" :disabled="!canEdit" class="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors" :class="config.mode === 'team' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'" @click="setMode('team')">
                <Users class="mt-0.5 size-4 shrink-0" /><span><span class="block font-medium">One goal for the whole team</span><span class="text-muted-foreground">Everyone's activity adds up towards one shared goal.</span></span>
              </button>
              <button type="button" role="radio" :aria-checked="config.mode === 'individual'" :disabled="!canEdit" class="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors" :class="config.mode === 'individual' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'" @click="setMode('individual')">
                <User class="mt-0.5 size-4 shrink-0" /><span><span class="block font-medium">A goal for each salesperson</span><span class="text-muted-foreground">Each person is measured on their own goal; the team goal is everyone's added up. Adds a leaderboard to the dashboard.</span></span>
              </button>
            </div>
            <div v-if="config.mode === 'individual'" class="mt-2.5 space-y-1">
              <p class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Salespeople</p>
              <label v-for="u in users" :key="u.id" class="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50">
                <Checkbox :model-value="config.people.includes(u.id)" :disabled="!canEdit" @update:model-value="togglePerson(u.id, !!$event)" />
                <span class="flex-1 truncate">{{ u.name }}</span>
                <span v-if="config.overrides[u.id]" class="text-[10px] text-primary">own plan</span>
              </label>
              <p v-if="!config.people.length" class="text-[11px] text-amber-700 dark:text-amber-400">Tick at least one person.</p>
              <div v-if="teamWeek && config.people.length" class="mt-2 rounded-lg bg-muted/40 px-2.5 py-2 text-[11px]">
                <p class="mb-1 font-medium">Team goal per week (everyone added up)</p>
                <p class="text-muted-foreground"><template v-for="(m, i) in CRM_GOAL_METRICS.filter(x => teamWeek![x.key])" :key="m.key"><span v-if="i"> · </span>{{ teamWeek![m.key] }} {{ m.label.toLowerCase() }}</template></p>
              </div>
            </div>
          </section>

          <!-- Weights -->
          <section class="rounded-xl border bg-card p-3">
            <h2 class="mb-1 flex items-center gap-1.5 text-sm font-semibold"><Scale class="size-4 text-muted-foreground" /> What matters most
              <CrmHint text="The goal score on the dashboard is a weighted average: how close each activity is to where it should be by now. A meeting moves the score more than an email." label="weights" />
            </h2>
            <p class="mb-2 text-[11px] text-muted-foreground">How much each activity counts in the goal score (1 = a little, 5 = a lot).</p>
            <div class="space-y-1">
              <div v-for="m in CRM_GOAL_METRICS" :key="m.key" class="flex items-center gap-2 text-xs">
                <component :is="m.icon" class="size-3.5 shrink-0 text-muted-foreground" /><span class="flex-1 truncate">{{ m.label }}</span>
                <div class="inline-flex rounded-md border p-0.5" role="radiogroup" :aria-label="`${m.label} weight`">
                  <button v-for="w in [1, 2, 3, 4, 5]" :key="w" type="button" role="radio" :aria-checked="weight(m.key) === w" :disabled="!canEdit" class="size-6 rounded text-[11px] tabular-nums" :class="weight(m.key) === w ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'" @click="setWeight(m.key, String(w))">{{ w }}</button>
                </div>
              </div>
            </div>
          </section>

          <!-- Working hours -->
          <section class="rounded-xl border bg-card p-3">
            <h2 class="mb-1 flex items-center gap-1.5 text-sm font-semibold"><Clock class="size-4 text-muted-foreground" /> Working hours</h2>
            <p class="mb-2 text-[11px] text-muted-foreground">Used for “due by now”: halfway through the working day, half of today's goal should be done.</p>
            <div class="flex items-center gap-2 text-xs">
              <Select :model-value="String(config.workdayStart)" :disabled="!canEdit" @update:model-value="config.workdayStart = Number($event)">
                <SelectTrigger size="sm" class="h-8 w-[100px] text-xs" aria-label="Day starts"><SelectValue /></SelectTrigger>
                <SelectContent class="max-h-64"><SelectItem v-for="h in HOURS.slice(0, 24)" :key="h.value" :value="h.value">{{ h.label }}</SelectItem></SelectContent>
              </Select>
              <span class="text-muted-foreground">to</span>
              <Select :model-value="String(config.workdayEnd)" :disabled="!canEdit" @update:model-value="config.workdayEnd = Number($event)">
                <SelectTrigger size="sm" class="h-8 w-[100px] text-xs" aria-label="Day ends"><SelectValue /></SelectTrigger>
                <SelectContent class="max-h-64"><SelectItem v-for="h in HOURS.slice(config.workdayStart + 1)" :key="h.value" :value="h.value">{{ h.label }}</SelectItem></SelectContent>
              </Select>
            </div>
          </section>

          <!-- History -->
          <section class="rounded-xl border bg-card p-3">
            <h2 class="mb-1 flex items-center gap-1.5 text-sm font-semibold"><History class="size-4 text-muted-foreground" /> History
              <CrmHint text="A save counts from the Monday of the week it's made, so this week uses the new goals in full. Earlier weeks are still measured against the goals that were in force then." label="goal history" />
            </h2>
            <p v-if="!history.length" class="text-[11px] text-muted-foreground">Not saved yet.</p>
            <ul v-else class="space-y-1 text-xs">
              <li v-for="(h, i) in history.slice(0, 8)" :key="h.savedAt + i" class="flex items-center gap-2">
                <Check v-if="i === 0" class="size-3.5 text-emerald-600" /><span v-else class="size-3.5" />
                <span class="flex-1">{{ i === 0 ? 'In force' : 'Used' }} from {{ fmtDay(h.effectiveFrom) }}</span>
                <span class="text-muted-foreground">{{ h.savedBy?.name || '—' }}</span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.goal-plan :is(th, td) { padding: 4px 6px; }
.goal-plan td.is-today { background: color-mix(in oklab, var(--primary) 7%, transparent); }
.goal-cell {
  width: 52px; height: 28px; border-radius: 6px; border: 1px solid var(--border); background: var(--background);
  text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; outline: none; -moz-appearance: textfield;
}
.goal-cell::-webkit-outer-spin-button, .goal-cell::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.goal-cell:focus-visible { border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 40%, transparent); }
.goal-cell.is-empty { font-weight: 400; color: var(--muted-foreground); }
.goal-cell:disabled { background: transparent; border-color: transparent; color: inherit; cursor: default; }
</style>
