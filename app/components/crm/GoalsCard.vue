<script setup lang="ts">
import { Flame, Target, Check, ArrowRight, Trophy, Settings2 } from 'lucide-vue-next'
import { format, parseISO } from 'date-fns'
import type { CrmGoalMetric, CrmGoalRow } from '~/composables/useCrmGoals'
import { CRM_GOAL_METRICS, CRM_GOAL_STATUS, crmGoalScoreTone } from '~/composables/useCrmGoals'

/** Goals on the CRM dashboard: score, streak, what's left today, the score day by day, and each salesperson. */
const props = defineProps<{ goals: any, canEdit: boolean, person?: string }>()
const emit = defineEmits<{ pickPerson: [userId: string] }>()

const g = computed(() => props.goals)
const rows = computed<CrmGoalRow[]>(() => CRM_GOAL_METRICS.map(m => g.value?.metrics?.[m.key]).filter((r: CrmGoalRow | undefined) => r && r.goal > 0))
const meta = (k: CrmGoalMetric) => CRM_GOAL_METRICS.find(m => m.key === k)!
const status = computed(() => CRM_GOAL_STATUS[(g.value?.status || 'no-goal') as keyof typeof CRM_GOAL_STATUS])

// Score ring
const R = 30, C = 2 * Math.PI * R
const ringDash = computed(() => `${(Math.min(100, g.value?.score ?? 0) / 100) * C} ${C}`)
const ringTone = computed(() => { const s = g.value?.score; return s == null ? 'stroke-muted-foreground/30' : s >= 100 ? 'stroke-emerald-500' : s >= 90 ? 'stroke-sky-500' : s >= 60 ? 'stroke-amber-500' : 'stroke-rose-500' })

// Today
const todayRows = computed(() => rows.value.filter(r => r.today && r.today.goal > 0))
const todayLeft = computed(() => todayRows.value.filter(r => r.today!.actual < r.today!.goal).length)
// For finished periods: the biggest gaps
const gaps = computed(() => [...rows.value].filter(r => r.actual < r.goal).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0)).slice(0, 4))

// Trend
const trend = computed<any[]>(() => g.value?.trend || [])
const trendLabel = (t: any) => g.value?.trendBucket === 'week' ? `Week of ${format(parseISO(t.key), 'MMM d')}` : format(parseISO(t.key), 'EEE, MMM d')
const trendTitle = (t: any) => `${trendLabel(t)}: ${t.score == null ? 'no goals (rest day)' : `${t.score}% of the day's goals`}${t.partial ? ' — so far today' : ''}`
const labelEvery = computed(() => Math.max(1, Math.ceil(trend.value.length / 7)))

const lb = computed<any[]>(() => g.value?.leaderboard || [])
const lbMetrics = computed(() => CRM_GOAL_METRICS.filter(m => lb.value.some(p => p.metrics[m.key])))
</script>

<template>
  <!-- No goals for this view -->
  <section v-if="!g?.active" class="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-3 py-3" data-testid="goals-empty">
    <span class="grid size-9 place-items-center rounded-full bg-primary/10"><Target class="size-4 text-primary" /></span>
    <div class="min-w-0 flex-1">
      <p class="text-sm font-semibold">
        <template v-if="g?.reason === 'team'">Goals are set for the whole team</template>
        <template v-else-if="g?.reason === 'not-included'">{{ person ? `${person[0]!.toUpperCase()}${person.slice(1)} has` : 'This person has' }} no goal of their own</template>
        <template v-else>No activity goals yet</template>
      </p>
      <p class="text-xs text-muted-foreground">
        <template v-if="g?.reason === 'team'">Switch to “Everyone” to see goal vs actual — or give each salesperson their own goal.</template>
        <template v-else-if="g?.reason === 'not-included'">Add them under “A goal for each salesperson” on the Goals page.</template>
        <template v-else>Set a daily goal for emails, calls, walk-ins, meetings and more — every number here then shows goal vs actual.</template>
      </p>
    </div>
    <Button v-if="canEdit" as-child size="sm" class="h-8 gap-1.5"><NuxtLink to="/crm/goals"><Settings2 class="size-4" /> {{ g?.reason === 'none' ? 'Set goals' : 'Goals' }}</NuxtLink></Button>
  </section>

  <section v-else class="overflow-hidden rounded-xl border bg-card" data-testid="goals-card">
    <header class="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
      <h2 class="flex items-center gap-1.5 text-sm font-semibold"><Target class="size-4 text-muted-foreground" /> Goals
        <CrmHint text="Activity compared with the goals for this period and person.\n\nDue by now = the goal for the days already gone, plus the share of today's goal for the hours already worked.\n\nAhead = at or above that · On track = at least 90% of it · Behind = at least 60% · At risk = below 60%." label="goals" />
      </h2>
      <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1" :class="status.chip" data-testid="goals-status">{{ status.label }}</span>
      <span v-if="g.seeded" class="text-[11px] text-muted-foreground">From your team sheet —
        <NuxtLink to="/crm/goals" class="text-primary hover:underline">review and save</NuxtLink></span>
      <NuxtLink to="/crm/goals" class="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">{{ canEdit ? 'Edit goals' : 'See goals' }} <ArrowRight class="size-3" /></NuxtLink>
    </header>

    <div class="grid grid-cols-1 divide-y lg:grid-cols-3 lg:divide-x lg:divide-y-0">
      <!-- Score -->
      <div class="flex items-center gap-3 p-3">
        <div class="relative size-[76px] shrink-0">
          <svg viewBox="0 0 76 76" class="size-full -rotate-90" aria-hidden="true">
            <circle cx="38" cy="38" :r="R" class="fill-none stroke-muted" stroke-width="8" />
            <circle cx="38" cy="38" :r="R" class="fill-none transition-all duration-500" :class="ringTone" stroke-width="8" stroke-linecap="round" :stroke-dasharray="ringDash" />
          </svg>
          <span class="absolute inset-0 grid place-items-center text-lg font-bold tabular-nums" data-testid="goals-score">{{ g.score == null ? '—' : `${g.score}%` }}</span>
        </div>
        <div class="min-w-0 space-y-1 text-xs">
          <p class="flex items-center gap-1 font-medium">Goal score <CrmHint text="How close each activity is to where it should be by now, capped at 100% each, weighted by what matters most (meetings count more than emails — change it on the Goals page)." label="goal score" /></p>
          <p class="text-muted-foreground"><b class="text-foreground tabular-nums">{{ g.onPace }}</b> of {{ g.withGoal }} activities {{ g.state === 'past' ? 'hit their goal' : 'on pace' }}</p>
          <p v-if="g.streak" class="flex items-center gap-1 text-orange-600 dark:text-orange-400" data-testid="goals-streak"><Flame class="size-3.5" /><b class="tabular-nums">{{ g.streak }}</b>-day streak <span class="text-muted-foreground">— every goal hit</span></p>
          <p v-if="g.state === 'live' && g.includesToday" class="text-muted-foreground">{{ g.workday.doneShare }}% through today's working hours</p>
        </div>
      </div>

      <!-- Today / gaps -->
      <div class="p-3" data-testid="goals-today">
        <template v-if="g.state === 'live' && todayRows.length">
          <p class="mb-1.5 flex items-center gap-1.5 text-xs font-medium">Today
            <span class="text-muted-foreground font-normal">· {{ todayLeft ? `${todayLeft} to finish` : 'all done' }}</span>
          </p>
          <ul class="space-y-1">
            <li v-for="r in todayRows" :key="r.metric" class="flex items-center gap-2 text-xs">
              <component :is="meta(r.metric).icon" class="size-3.5 shrink-0 text-muted-foreground" />
              <span class="w-24 truncate">{{ meta(r.metric).label }}</span>
              <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span class="block h-full rounded-full" :class="r.today!.actual >= r.today!.goal ? 'bg-emerald-500' : 'bg-primary'" :style="{ width: `${Math.min(100, (r.today!.actual / r.today!.goal) * 100)}%` }" /></span>
              <span class="w-12 text-right tabular-nums">{{ r.today!.actual }}/{{ r.today!.goal }}</span>
              <span class="w-14 text-right">
                <Check v-if="r.today!.actual >= r.today!.goal" class="ml-auto size-3.5 text-emerald-600" />
                <span v-else class="tabular-nums text-muted-foreground">{{ r.today!.goal - r.today!.actual }} to go</span>
              </span>
            </li>
          </ul>
        </template>
        <template v-else-if="g.state === 'past'">
          <p class="mb-1.5 text-xs font-medium">{{ gaps.length ? 'Biggest gaps' : 'Every goal hit' }}</p>
          <p v-if="!gaps.length" class="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><Trophy class="size-4" /> All {{ g.withGoal }} activity goals were met.</p>
          <ul v-else class="space-y-1">
            <li v-for="r in gaps" :key="r.metric" class="flex items-center gap-2 text-xs">
              <component :is="meta(r.metric).icon" class="size-3.5 shrink-0 text-muted-foreground" /><span class="flex-1 truncate">{{ meta(r.metric).label }}</span>
              <span class="tabular-nums">{{ r.actual }}/{{ r.goal }}</span><span class="w-16 text-right tabular-nums text-rose-600">−{{ r.needed }}</span>
            </li>
          </ul>
        </template>
        <template v-else-if="g.state === 'future'">
          <p class="text-xs text-muted-foreground">This period hasn't started yet.</p>
        </template>
        <template v-else>
          <p class="mb-1.5 text-xs font-medium">Still to do this period</p>
          <ul class="space-y-1">
            <li v-for="r in rows.filter(x => x.needed).slice(0, 4)" :key="r.metric" class="flex items-center gap-2 text-xs">
              <component :is="meta(r.metric).icon" class="size-3.5 shrink-0 text-muted-foreground" /><span class="flex-1 truncate">{{ meta(r.metric).label }}</span>
              <span class="tabular-nums">{{ r.needed }} more</span><span v-if="r.perDay" class="w-20 text-right tabular-nums text-muted-foreground">≈ {{ r.perDay }}/day</span>
            </li>
          </ul>
          <p v-if="!rows.some(x => x.needed)" class="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><Trophy class="size-4" /> Every goal already met.</p>
        </template>
      </div>

      <!-- Score by day -->
      <div class="p-3" data-testid="goals-trend">
        <p class="mb-1.5 flex items-center gap-1.5 text-xs font-medium">Score by {{ g.trendBucket }}
          <CrmHint text="For each day: how much of that day's goals was done (100% = every goal hit). Rest days with no goals are left empty." label="score by day" />
        </p>
        <p v-if="!trend.length" class="text-xs text-muted-foreground">Nothing to show yet.</p>
        <template v-else>
          <div class="relative h-16">
            <span class="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-emerald-500/50" />
            <span class="pointer-events-none absolute -top-2 right-0 bg-card pl-1 text-[9px] text-emerald-700 dark:text-emerald-400">100%</span>
            <div class="absolute inset-0 flex items-end gap-0.5 pt-1">
              <div v-for="t in trend" :key="t.key" class="flex h-full min-w-0 flex-1 items-end" :title="trendTitle(t)" :data-score="t.score ?? ''">
                <div v-if="t.score != null" class="mx-auto w-full max-w-6 rounded-t" :class="[crmGoalScoreTone(t.score), t.partial && 'opacity-50']" :style="{ height: `${Math.max(4, Math.min(100, t.score))}%` }" />
                <div v-else class="mx-auto h-px w-full max-w-6 bg-border" />
              </div>
            </div>
          </div>
          <div class="mt-1 flex gap-0.5 text-[9px] text-muted-foreground">
            <span v-for="(t, i) in trend" :key="t.key" class="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center"><template v-if="i % labelEvery === 0 || i === trend.length - 1">{{ format(parseISO(t.key), g.trendBucket === 'week' ? 'MMM d' : 'EEEEE d') }}</template></span>
          </div>
        </template>
      </div>
    </div>

    <!-- Each salesperson -->
    <div v-if="lb.length" class="border-t" data-testid="goals-leaderboard">
      <div class="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5 text-xs font-medium">Each salesperson
        <CrmHint text="Each person against their own goal for this period. Click a name to see their numbers." label="each salesperson" />
      </div>
      <div class="overflow-x-auto px-3 pb-3">
        <table class="w-full text-xs">
          <thead>
            <tr>
              <th class="w-8 text-left">#</th>
              <th class="text-left">Salesperson</th>
              <th class="w-40 text-left">Score</th>
              <th v-for="m in lbMetrics" :key="m.key" class="text-right whitespace-nowrap">{{ m.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in lb" :key="p.userId">
              <td class="tabular-nums text-muted-foreground">{{ i + 1 }}</td>
              <td><button type="button" class="font-medium hover:text-primary hover:underline" @click="emit('pickPerson', p.userId)">{{ p.name }}</button></td>
              <td>
                <span class="flex items-center gap-2">
                  <span class="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><span class="block h-full rounded-full" :class="crmGoalScoreTone(p.score)" :style="{ width: `${Math.min(100, p.score ?? 0)}%` }" /></span>
                  <span class="tabular-nums font-semibold">{{ p.score == null ? '—' : `${p.score}%` }}</span>
                </span>
              </td>
              <td v-for="m in lbMetrics" :key="m.key" class="text-right tabular-nums" :title="p.metrics[m.key] ? CRM_GOAL_STATUS[p.metrics[m.key].status as keyof typeof CRM_GOAL_STATUS].label : 'No goal'">
                <template v-if="p.metrics[m.key]"><span class="font-semibold" :class="CRM_GOAL_STATUS[p.metrics[m.key].status as keyof typeof CRM_GOAL_STATUS].text">{{ p.metrics[m.key].actual }}</span><span class="text-muted-foreground">/{{ p.metrics[m.key].goal }}</span></template>
                <span v-else class="text-muted-foreground">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
