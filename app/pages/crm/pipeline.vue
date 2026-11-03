<script setup lang="ts">
import type { PipelineReport } from '~/composables/useCrmDealerships'
import { RefreshCw, FileDown, Trophy, XCircle, ArrowUpRight, Loader2, Timer, Info } from 'lucide-vue-next'
import { format } from 'date-fns'
import { toast } from 'vue-sonner'
import { STAGE_STYLE, STALLED_STAGE_DAYS, WON_STAGE } from '~/constants/crm'

const { setHeader } = usePageHeader()
setHeader({ title: 'Sales pipeline', description: 'CRM · how long dealerships stay in each stage and how long deals take to close', icon: 'i-lucide-git-branch' })

const { fetchPipelineReport } = useCrmDealerships()
const assignee = ref('all')
const users = ref<{ id: string, name: string }[]>([])
onMounted(async () => {
  try { const res = await $fetch<any[]>('/api/users'); users.value = (res || []).filter(u => u.status !== 'Inactive').map(u => ({ id: u.id, name: u.name || u.email })).sort((a, b) => a.name.localeCompare(b.name)) } catch {}
})

const { data: report, pending, refresh } = await useAsyncData<PipelineReport>('crm-pipeline-report',
  () => fetchPipelineReport({ assignedUserId: assignee.value === 'all' ? undefined : assignee.value }),
  { watch: [assignee], server: false })

const stages = computed(() => report.value?.stages || [])
const maxAvg = computed(() => Math.max(1, ...stages.value.map(s => s.avgDays ?? 0), ...stages.value.map(s => s.currentAvgDays ?? 0)))
const maxCount = computed(() => Math.max(1, ...stages.value.map(s => s.currentCount)))
const won = computed(() => report.value?.timeToClose.won)
const lost = computed(() => report.value?.timeToClose.lost)
const fmtDays = (d: number | null | undefined) => {
  if (d == null) return '—'
  if (d < 1) { const h = Math.round(d * 24); return h < 1 ? '<1h' : `${h}h` }
  return `${Math.round(d * 10) / 10}d`
}
const openStage = (stage: string) => navigateTo({ path: '/crm/dealership', query: { stage } })

async function reload() { try { await refresh(); toast.success('Pipeline refreshed') } catch { toast.error('Refresh failed') } }

function exportCsv() {
  if (!report.value) return
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['Stage', 'In stage now', 'Avg days in stage (current)', 'Longest current (days)', 'Completed stints', 'Avg days in stage (completed)', 'Median days', 'Longest (days)']
  const rows = stages.value.map(s => [s.stage, s.currentCount, s.currentAvgDays, s.currentMaxDays, s.completedCount, s.avgDays, s.medianDays, s.maxDays].map(esc).join(','))
  const closes = [[], ['Time to close', 'Count', 'Avg days', 'Median days', 'Fastest', 'Slowest'],
    ['Won', won.value?.count, won.value?.avgDays, won.value?.medianDays, won.value?.minDays, won.value?.maxDays],
    ['Lost', lost.value?.count, lost.value?.avgDays, lost.value?.medianDays, lost.value?.minDays, lost.value?.maxDays]].map(r => r.map(esc).join(','))
  const blob = new Blob([[head.map(esc).join(','), ...rows, ...closes].join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `pipeline_${new Date().toISOString().slice(0, 10)}.csv` })
  a.click(); URL.revokeObjectURL(a.href)
}
</script>

<template>
  <div class="space-y-5">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <Select v-model="assignee">
          <SelectTrigger class="h-9 w-[180px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent class="max-h-72">
            <SelectItem value="all">All salespeople</SelectItem>
            <SelectItem v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" class="h-9 gap-2" :disabled="!report" @click="exportCsv"><FileDown class="size-4" /><span class="hidden lg:inline">Export</span></Button>
        <Button variant="outline" size="icon" class="size-9" aria-label="Refresh" :disabled="pending" @click="reload"><RefreshCw class="size-4" :class="pending && 'animate-spin'" /></Button>
      </Teleport>
    </ClientOnly>

    <div v-if="pending && !report" class="flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Calculating pipeline…</div>

    <template v-else-if="report">
      <!-- Time to close -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div v-for="c in [{ key: 'won', label: 'Time to win', icon: Trophy, tone: 'text-emerald-600 dark:text-emerald-400', s: won }, { key: 'lost', label: 'Time to lose', icon: XCircle, tone: 'text-rose-600 dark:text-rose-400', s: lost }]" :key="c.key" class="rounded-xl border bg-card px-5 py-4 flex items-center gap-5">
          <div>
            <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><component :is="c.icon" class="size-3.5" :class="c.tone" /> {{ c.label }}</p>
            <p class="mt-1 text-2xl font-bold tabular-nums tracking-tight">{{ fmtDays(c.s?.avgDays) }} <span class="text-xs font-normal text-muted-foreground">avg</span></p>
          </div>
          <div class="h-10 w-px bg-border" />
          <dl class="grid grid-cols-4 gap-4 text-xs flex-1">
            <div><dt class="text-muted-foreground">Deals</dt><dd class="font-semibold tabular-nums">{{ c.s?.count ?? 0 }}</dd></div>
            <div><dt class="text-muted-foreground">Median</dt><dd class="font-semibold tabular-nums">{{ fmtDays(c.s?.medianDays) }}</dd></div>
            <div><dt class="text-muted-foreground">Fastest</dt><dd class="font-semibold tabular-nums">{{ fmtDays(c.s?.minDays) }}</dd></div>
            <div><dt class="text-muted-foreground">Slowest</dt><dd class="font-semibold tabular-nums">{{ fmtDays(c.s?.maxDays) }}</dd></div>
          </dl>
        </div>
      </div>

      <!-- Stage velocity -->
      <section class="rounded-xl border bg-card overflow-hidden">
        <header class="px-5 py-3.5 border-b flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 class="font-semibold text-sm flex items-center gap-2"><Timer class="size-4 text-muted-foreground" /> Time in each stage</h3>
            <p class="text-[11px] text-muted-foreground">“Now” = dealerships currently sitting in the stage. “Completed” = past visits that moved on. {{ report.totalDealerships }} active dealerships.</p>
          </div>
          <NuxtLink :to="{ path: '/crm/dealership', query: { view: 'stalled' } }" class="text-xs text-orange-600 dark:text-orange-400 hover:underline underline-offset-2 inline-flex items-center gap-1">Stalled {{ STALLED_STAGE_DAYS }}d+ <ArrowUpRight class="size-3" /></NuxtLink>
        </header>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th class="text-left font-medium px-4 py-2 w-8">#</th>
                <th class="text-left font-medium px-4 py-2">Stage</th>
                <th class="text-right font-medium px-4 py-2 border-l">Now</th>
                <th class="text-left font-medium px-4 py-2 w-[18%]" />
                <th class="text-right font-medium px-4 py-2 whitespace-nowrap">Avg wait</th>
                <th class="text-right font-medium px-4 py-2">Oldest</th>
                <th class="text-right font-medium px-4 py-2 border-l">Completed</th>
                <th class="text-right font-medium px-4 py-2 whitespace-nowrap">Avg days</th>
                <th class="text-left font-medium px-4 py-2 w-[18%]" />
                <th class="text-right font-medium px-4 py-2">Median</th>
                <th class="text-right font-medium px-4 py-2">Longest</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr v-for="(s, i) in stages" :key="s.stage" class="hover:bg-muted/30 cursor-pointer transition-colors" :class="s.stage === WON_STAGE && 'border-t-2'" @click="openStage(s.stage)">
                <td class="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">{{ i + 1 }}</td>
                <td class="px-4 py-2.5 whitespace-nowrap"><span class="inline-flex items-center gap-2 font-medium"><span class="size-2 rounded-full" :class="STAGE_STYLE[s.stage]?.dot" />{{ s.stage }}</span></td>
                <td class="px-4 py-2.5 text-right tabular-nums font-semibold border-l">{{ s.currentCount || '—' }}</td>
                <td class="px-4 py-2.5"><div class="h-1.5 rounded-full bg-muted overflow-hidden"><div class="h-full rounded-full opacity-70" :class="STAGE_STYLE[s.stage]?.bar" :style="{ width: `${(s.currentCount / maxCount) * 100}%` }" /></div></td>
                <td class="px-4 py-2.5 text-right tabular-nums text-xs">{{ s.currentCount ? fmtDays(s.currentAvgDays) : '—' }}</td>
                <td class="px-4 py-2.5 text-right tabular-nums text-xs" :class="(s.currentMaxDays ?? 0) > STALLED_STAGE_DAYS && !['Won', 'Lost', 'Nurture / Follow Up Later'].includes(s.stage) && 'text-orange-600 dark:text-orange-400 font-medium'">{{ s.currentCount ? fmtDays(s.currentMaxDays) : '—' }}</td>
                <td class="px-4 py-2.5 text-right tabular-nums border-l">{{ s.completedCount || '—' }}</td>
                <td class="px-4 py-2.5 text-right tabular-nums font-semibold">{{ fmtDays(s.avgDays) }}</td>
                <td class="px-4 py-2.5"><div class="h-1.5 rounded-full bg-muted overflow-hidden"><div class="h-full rounded-full" :class="STAGE_STYLE[s.stage]?.bar" :style="{ width: `${((s.avgDays ?? 0) / maxAvg) * 100}%` }" /></div></td>
                <td class="px-4 py-2.5 text-right tabular-nums text-xs">{{ fmtDays(s.medianDays) }}</td>
                <td class="px-4 py-2.5 text-right tabular-nums text-xs">{{ fmtDays(s.maxDays) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="px-5 py-2 border-t text-[10px] text-muted-foreground flex items-center gap-1.5"><Info class="size-3" /> Click a stage to see those dealerships. Based on the stage history saved on every change (previous stage, new stage, date, time, user).</p>
      </section>

      <!-- Recent closes -->
      <section class="rounded-xl border bg-card overflow-hidden">
        <header class="px-5 py-3.5 border-b"><h3 class="font-semibold text-sm flex items-center gap-2"><Trophy class="size-4 text-emerald-600" /> Recently won</h3></header>
        <table v-if="report.recentWins.length" class="w-full text-sm">
          <thead class="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr><th class="text-left font-medium px-4 py-2">Dealership</th><th class="text-left font-medium px-4 py-2">Owner</th><th class="text-left font-medium px-4 py-2">Entered pipeline</th><th class="text-left font-medium px-4 py-2">Won</th><th class="text-left font-medium px-4 py-2">Won by</th><th class="text-right font-medium px-4 py-2">Stage changes</th><th class="text-right font-medium px-4 py-2">Days to close</th></tr>
          </thead>
          <tbody class="divide-y">
            <tr v-for="w in report.recentWins" :key="w.id" class="hover:bg-muted/30 cursor-pointer" @click="navigateTo(`/crm/dealership/${w.id}?tab=pipeline`)">
              <td class="px-4 py-2.5"><span class="font-medium">{{ w.name }}</span> <span class="font-mono text-[10px] text-muted-foreground ml-1">{{ w.dealershipId }}</span></td>
              <td class="px-4 py-2.5 text-xs">{{ w.assignedUserName || '—' }}</td>
              <td class="px-4 py-2.5 text-xs tabular-nums">{{ format(new Date(w.startedAt), 'MMM d, yyyy') }}</td>
              <td class="px-4 py-2.5 text-xs tabular-nums">{{ format(new Date(w.closedAt), 'MMM d, yyyy · h:mm a') }}</td>
              <td class="px-4 py-2.5 text-xs">{{ w.closedBy || '—' }}</td>
              <td class="px-4 py-2.5 text-right tabular-nums text-xs">{{ w.stageChanges }}</td>
              <td class="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{{ fmtDays(w.days) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="px-5 py-8 text-sm text-muted-foreground text-center">No won deals yet. When a dealership is marked Won, its full cycle time appears here.</p>
      </section>
    </template>
  </div>
</template>
