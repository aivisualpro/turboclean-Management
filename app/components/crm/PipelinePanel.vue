<script setup lang="ts">
import type { CrmDealership, CrmStageChange, CrmStageDurations } from '~/composables/useCrmDealerships'
import { formatDuration } from '~/composables/useCrmDealerships'
import { ArrowRight, FileDown, Timer, Flag, Trophy, XCircle, Clock, User, Bot, Layers } from 'lucide-vue-next'
import { format, formatDistanceToNow } from 'date-fns'
import { DEALERSHIP_STAGES, OPEN_STAGES, STAGE_STYLE } from '~/constants/crm'

const props = defineProps<{ dealership: CrmDealership, history: CrmStageChange[], durations: CrmStageDurations }>()

const newestFirst = computed(() => [...props.history].sort((a, b) => b.changedAt.localeCompare(a.changedAt)))
const enteredAt = computed(() => props.dealership.stageChangedAt || props.history.at(-1)?.changedAt || props.dealership.createdAt)
const inStageMs = computed(() => enteredAt.value ? Date.now() - new Date(enteredAt.value).getTime() : null)
const startedAt = computed(() => props.history[0]?.changedAt || props.dealership.createdAt)
const closedEntry = computed(() => ['Won', 'Lost'].includes(props.dealership.stage) ? [...props.history].reverse().find(h => h.toStage === props.dealership.stage) : null)
const cycleMs = computed(() => startedAt.value ? (closedEntry.value ? new Date(closedEntry.value.changedAt).getTime() : Date.now()) - new Date(startedAt.value).getTime() : null)
const currentIdx = computed(() => OPEN_STAGES.indexOf(props.dealership.stage))
const reachedIdx = computed(() => Math.max(-1, ...props.history.map(h => OPEN_STAGES.indexOf(h.toStage))))

/** Time per stage, in pipeline order — only stages the record actually visited. */
const perStage = computed(() => {
  const rows = DEALERSHIP_STAGES.filter(s => props.durations[s]).map(s => ({ stage: s, ...props.durations[s]! }))
  const max = Math.max(1, ...rows.map(r => r.totalMs))
  return rows.map(r => ({ ...r, pct: Math.max(2, Math.round((r.totalMs / max) * 100)) }))
})

const SOURCE_LABEL: Record<string, string> = { create: 'Created', manual: 'Manual', bulk: 'Bulk update', convert: 'Won → Dealer', revert: 'Dealer deleted', backfill: 'Backfilled', migration: 'Pipeline upgrade', api: 'API' }

function exportCsv() {
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['Dealership ID', 'Dealership', 'Previous stage', 'New stage', 'Date', 'Time', 'Time zone', 'Changed at (UTC)', 'User', 'User email', 'Days in previous stage', 'Source', 'Note']
  const rows = props.history.map(h => [h.dealershipCode, h.dealershipName, h.fromStage || '', h.toStage, h.date, h.time, h.timeZone, h.changedAt, h.user?.name, h.user?.email, h.durationInPreviousStageMs == null ? '' : (h.durationInPreviousStageMs / 86_400_000).toFixed(2), SOURCE_LABEL[h.source] || h.source, h.note].map(esc).join(','))
  const blob = new Blob([[head.map(esc).join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' })
  const el = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${props.dealership.dealershipId}_stage_history.csv` })
  el.click(); URL.revokeObjectURL(el.href)
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h3 class="font-semibold">Sales pipeline</h3>
        <p class="text-xs text-muted-foreground">Every stage change is saved automatically with the previous stage, new stage, date, time and user.</p>
      </div>
      <Button v-if="history.length" variant="outline" size="sm" class="gap-2" @click="exportCsv"><FileDown class="size-4" /> Export history</Button>
    </div>

    <!-- Funnel progress -->
    <div class="rounded-xl border bg-card p-4">
      <div class="flex items-center gap-1" role="list" aria-label="Pipeline progress">
        <div v-for="(s, i) in OPEN_STAGES" :key="s" role="listitem" class="flex-1 min-w-0 group relative">
          <div
            class="h-2 rounded-full transition-colors"
            :class="dealership.stage === 'Won' ? 'bg-emerald-500'
              : i === currentIdx ? STAGE_STYLE[s]?.bar
                : i < currentIdx || (currentIdx === -1 && i <= reachedIdx) ? 'bg-primary/40' : 'bg-muted'"
          />
          <p class="mt-1.5 text-[10px] leading-tight truncate" :class="i === currentIdx ? 'font-semibold text-foreground' : 'text-muted-foreground'" :title="s">{{ s }}</p>
        </div>
      </div>
      <p v-if="!OPEN_STAGES.includes(dealership.stage)" class="mt-3 text-xs flex items-center gap-1.5" :class="dealership.stage === 'Won' ? 'text-emerald-700 dark:text-emerald-300' : dealership.stage === 'Lost' ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground'">
        <component :is="dealership.stage === 'Won' ? Trophy : dealership.stage === 'Lost' ? XCircle : Clock" class="size-3.5" />
        Currently <span class="font-semibold">{{ dealership.stage }}</span><span v-if="reachedIdx >= 0 && dealership.stage !== 'Won'"> · furthest reached: {{ OPEN_STAGES[reachedIdx] }}</span>
      </p>
    </div>

    <!-- Key timers -->
    <div class="grid grid-cols-2 xl:grid-cols-4 gap-3">
      <div class="rounded-xl border bg-card p-4">
        <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Timer class="size-3.5" /> In current stage</p>
        <p class="mt-1 text-2xl font-bold tabular-nums tracking-tight">{{ formatDuration(inStageMs) }}</p>
        <p class="text-[11px] text-muted-foreground mt-0.5">since {{ enteredAt ? format(new Date(enteredAt), 'MMM d, yyyy · h:mm a') : '—' }}</p>
      </div>
      <div class="rounded-xl border bg-card p-4">
        <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Flag class="size-3.5" /> {{ closedEntry ? `Time to ${dealership.stage.toLowerCase()}` : 'In pipeline' }}</p>
        <p class="mt-1 text-2xl font-bold tabular-nums tracking-tight" :class="closedEntry && dealership.stage === 'Won' && 'text-emerald-600 dark:text-emerald-400'">{{ formatDuration(cycleMs) }}</p>
        <p class="text-[11px] text-muted-foreground mt-0.5">from {{ startedAt ? format(new Date(startedAt), 'MMM d, yyyy') : '—' }}{{ closedEntry ? ` to ${format(new Date(closedEntry.changedAt), 'MMM d, yyyy')}` : ' to today' }}</p>
      </div>
      <div class="rounded-xl border bg-card p-4">
        <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Layers class="size-3.5" /> Stage changes</p>
        <p class="mt-1 text-2xl font-bold tabular-nums tracking-tight">{{ Math.max(0, history.length - 1) }}</p>
        <p class="text-[11px] text-muted-foreground mt-0.5">{{ perStage.length }} stage{{ perStage.length === 1 ? '' : 's' }} visited</p>
      </div>
      <div class="rounded-xl border bg-card p-4">
        <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><User class="size-3.5" /> Last moved by</p>
        <p class="mt-1 text-sm font-semibold truncate">{{ newestFirst[0]?.user?.name || '—' }}</p>
        <p class="text-[11px] text-muted-foreground mt-0.5">{{ newestFirst[0] ? formatDistanceToNow(new Date(newestFirst[0].changedAt), { addSuffix: true }) : '' }}</p>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-5 gap-5">
      <!-- Time per stage -->
      <section class="xl:col-span-2 rounded-xl border bg-card">
        <header class="px-5 py-3.5 border-b"><h4 class="font-semibold text-sm">Time spent per stage</h4></header>
        <ul v-if="perStage.length" class="p-5 space-y-3">
          <li v-for="r in perStage" :key="r.stage">
            <div class="flex items-center justify-between text-xs gap-2">
              <span class="flex items-center gap-1.5 min-w-0"><span class="size-2 rounded-full shrink-0" :class="STAGE_STYLE[r.stage]?.dot" /><span class="truncate">{{ r.stage }}</span><span v-if="r.current" class="text-[10px] text-primary font-semibold">NOW</span><span v-if="r.stints > 1" class="text-[10px] text-muted-foreground">×{{ r.stints }}</span></span>
              <span class="tabular-nums font-medium shrink-0">{{ formatDuration(r.totalMs) }}</span>
            </div>
            <div class="mt-1 h-1.5 rounded-full bg-muted overflow-hidden"><div class="h-full rounded-full" :class="STAGE_STYLE[r.stage]?.bar" :style="{ width: `${r.pct}%` }" /></div>
          </li>
        </ul>
        <p v-else class="px-5 py-8 text-sm text-muted-foreground text-center">No stage history yet.</p>
      </section>

      <!-- History log -->
      <section class="xl:col-span-3 rounded-xl border bg-card overflow-hidden">
        <header class="px-5 py-3.5 border-b flex items-center justify-between"><h4 class="font-semibold text-sm">Stage history</h4><span class="text-[11px] text-muted-foreground">{{ history.length }} entr{{ history.length === 1 ? 'y' : 'ies' }}</span></header>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th class="text-left font-medium px-4 py-2">Change</th>
                <th class="text-left font-medium px-4 py-2">Date</th>
                <th class="text-left font-medium px-4 py-2">Time</th>
                <th class="text-left font-medium px-4 py-2">User</th>
                <th class="text-right font-medium px-4 py-2 whitespace-nowrap">Time in prev.</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr v-for="h in newestFirst" :key="h.id" class="align-top">
                <td class="px-4 py-2.5">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <template v-if="h.fromStage">
                      <Badge variant="outline" class="gap-1 text-[11px] font-normal" :class="STAGE_STYLE[h.fromStage]?.badge"><span class="size-1.5 rounded-full" :class="STAGE_STYLE[h.fromStage]?.dot" />{{ h.fromStage }}</Badge>
                      <ArrowRight class="size-3 text-muted-foreground" />
                    </template>
                    <span v-else class="text-[11px] text-muted-foreground">Entered at</span>
                    <Badge variant="outline" class="gap-1 text-[11px] font-medium" :class="STAGE_STYLE[h.toStage]?.badge"><span class="size-1.5 rounded-full" :class="STAGE_STYLE[h.toStage]?.dot" />{{ h.toStage }}</Badge>
                  </div>
                  <p v-if="h.note || !['manual'].includes(h.source)" class="text-[10px] text-muted-foreground mt-1">{{ SOURCE_LABEL[h.source] || h.source }}<span v-if="h.note"> · {{ h.note }}</span></p>
                </td>
                <td class="px-4 py-2.5 whitespace-nowrap tabular-nums text-xs">{{ format(new Date(h.changedAt), 'MMM d, yyyy') }}</td>
                <td class="px-4 py-2.5 whitespace-nowrap tabular-nums text-xs">{{ format(new Date(h.changedAt), 'h:mm a') }}</td>
                <td class="px-4 py-2.5 text-xs">
                  <span class="inline-flex items-center gap-1.5"><component :is="h.user?.id === 'system' ? Bot : User" class="size-3 text-muted-foreground" />{{ h.user?.name || '—' }}</span>
                </td>
                <td class="px-4 py-2.5 text-right tabular-nums text-xs whitespace-nowrap">{{ h.fromStage ? formatDuration(h.durationInPreviousStageMs) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="px-5 py-2 border-t text-[10px] text-muted-foreground">Dates and times shown in your local time. Exports also include the date/time in {{ history[0]?.timeZone || 'the CRM time zone' }} and UTC.</p>
      </section>
    </div>
  </div>
</template>
