<script setup lang="ts">
import type { ExperimentReport, ExperimentRow } from '~/composables/useCrmEmail'
import { Loader2, Trophy, FlaskConical, Info, FileDown, AlertTriangle, Code2, Type } from 'lucide-vue-next'
import { format, subDays } from 'date-fns'

/**
 * "Which message actually produces dealerships?"
 * Compares templates, body versions and subject lines on outcomes (replies → meetings → won → revenue),
 * not opens. Small samples are flagged so nobody crowns a winner after 6 emails.
 */
const { getExperiments, templates, campaigns } = useCrmEmail()
const level = ref<'template' | 'version' | 'subject' | 'combo'>('version')
const model = ref<'email' | 'sequence'>('sequence')
const range = ref<'90' | '180' | '365' | 'all'>('all')
const templateId = ref('all')
const campaignId = ref('all')
const report = ref<ExperimentReport | null>(null)
const loading = ref(false)
async function load() {
  loading.value = true
  try {
    report.value = await getExperiments({
      level: level.value, model: model.value,
      from: range.value === 'all' ? undefined : format(subDays(new Date(), Number(range.value)), 'yyyy-MM-dd'),
      templateId: templateId.value === 'all' ? undefined : templateId.value,
      campaignId: campaignId.value === 'all' ? undefined : campaignId.value,
    })
  } finally { loading.value = false }
}
watch([level, model, range, templateId, campaignId], load, { immediate: true })

const rows = computed(() => report.value?.rows || [])
const unitWord = computed(() => model.value === 'email' ? 'emails' : 'sequences')
const money = (n: number) => n ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '—'
const r = (v: number | null) => v == null ? '—' : `${v}%`
function label(x: ExperimentRow) {
  const parts = [x.templateName]
  if (x.version != null) parts.push(x.versionLabel)
  if (x.subjectVariant) parts.push(x.subjectVariant === 'custom' ? 'custom subject' : x.subjectVariant)
  return parts.join(' · ')
}

/** The headline answer — only claims a winner with enough data. */
const answer = computed(() => {
  const withWins = rows.value.filter(x => x.templateId && x.won > 0)
  if (!withWins.length) return null
  const best = [...withWins].sort((a, b) => b.won - a.won || b.revenueInvoiced - a.revenueInvoiced || (b.winRate || 0) - (a.winRate || 0))[0]!
  return { best, reliable: best.enoughData }
})
/** Head-to-head inside each template (versions or subject lines), using reply-rate confidence intervals. */
const headToHead = computed(() => {
  if (level.value === 'template') return []
  const byT = new Map<string, ExperimentRow[]>()
  for (const x of rows.value) if (x.templateId) byT.set(x.templateId, [...(byT.get(x.templateId) || []), x])
  return [...byT.values()].filter(l => l.length > 1).map((l) => {
    const sorted = [...l].sort((a, b) => (b.positiveRate || 0) - (a.positiveRate || 0) || (b.replyRate || 0) - (a.replyRate || 0))
    const [a, b] = sorted as [ExperimentRow, ExperimentRow]
    const enough = a.enoughData && b.enoughData
    const separated = !!(a.replyCI && b.replyCI && a.replyCI.low > b.replyCI.high)
    return { name: a.templateName, a, b, verdict: !enough ? 'not-enough' : separated ? 'leader' : 'too-close' }
  })
})

function exportCsv() {
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['Template', 'Version', 'Format', 'Subject line', 'Subject text', `${unitWord.value}`, 'Emails', 'Dealerships', 'Delivered', 'Delivery rate %', 'Replies', 'Reply rate %', 'Reply rate 95% CI', 'Positive replies', 'Positive reply rate %', 'Meetings', 'Opportunities', 'Proposals', 'Won dealerships', 'Win rate %', 'Revenue invoiced', 'Est. contract value', 'Revenue per unit', 'Enough data']
  const lines = rows.value.map(x => [x.templateName, x.versionLabel, x.versionFormat, x.subjectVariant, x.subjectText, x.units, x.emails, x.dealerships, x.delivered, x.deliveryRate, x.replied, x.replyRate, x.replyCI ? `${x.replyCI.low}–${x.replyCI.high}` : '', x.positive, x.positiveRate, x.meetings, x.opportunities, x.proposals, x.won, x.winRate, x.revenueInvoiced, x.contractValue, x.revenuePerUnit, x.enoughData ? 'yes' : 'no'].map(esc).join(','))
  const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `template_experiments_${level.value}_${model.value}_${format(new Date(), 'yyyy-MM-dd')}.csv` })
  a.click(); URL.revokeObjectURL(a.href)
}
</script>

<template>
  <div class="space-y-5">
    <!-- Controls -->
    <div class="flex flex-wrap items-center gap-2">
      <div class="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
        <button v-for="l in [{ k: 'template', t: 'Template' }, { k: 'version', t: 'Body version' }, { k: 'subject', t: 'Subject line' }, { k: 'combo', t: 'Version × subject' }]" :key="l.k" type="button" class="rounded-md px-2.5 py-1 text-xs font-medium" :class="level === l.k ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'" @click="level = l.k as any">{{ l.t }}</button>
      </div>
      <Select v-model="model">
        <SelectTrigger class="h-8 w-[230px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="sequence">Credit the first email of each sequence</SelectItem>
          <SelectItem value="email">Credit each email individually</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="templateId">
        <SelectTrigger class="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent class="max-h-72"><SelectItem value="all">All templates</SelectItem><SelectItem v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</SelectItem></SelectContent>
      </Select>
      <Select v-model="campaignId">
        <SelectTrigger class="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent class="max-h-72"><SelectItem value="all">All campaigns</SelectItem><SelectItem v-for="c in campaigns" :key="c.id" :value="c.id">{{ c.name }}</SelectItem></SelectContent>
      </Select>
      <div class="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
        <button v-for="x in [{ k: '90', t: '90d' }, { k: '180', t: '6m' }, { k: '365', t: '12m' }, { k: 'all', t: 'All' }]" :key="x.k" type="button" class="rounded-md px-2 py-1 text-xs font-medium" :class="range === x.k ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'" @click="range = x.k as any">{{ x.t }}</button>
      </div>
      <Loader2 v-if="loading" class="size-4 animate-spin text-muted-foreground" />
      <Button variant="outline" size="sm" class="h-8 gap-1.5 text-xs ml-auto" :disabled="!rows.length" @click="exportCsv"><FileDown class="size-3.5" /> CSV</Button>
    </div>

    <!-- The answer -->
    <section class="rounded-xl border bg-card px-5 py-4 flex items-start gap-4">
      <div class="size-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0"><Trophy class="size-5 text-emerald-600" /></div>
      <div class="min-w-0">
        <p class="text-[11px] uppercase tracking-wider text-muted-foreground">Which message produces dealerships?</p>
        <template v-if="answer">
          <p class="mt-1 text-base font-semibold">{{ label(answer.best) }}</p>
          <p class="text-sm text-muted-foreground">{{ answer.best.won }} dealership{{ answer.best.won === 1 ? '' : 's' }} won<span v-if="answer.best.revenueInvoiced"> · {{ money(answer.best.revenueInvoiced) }} invoiced</span><span v-if="answer.best.contractValue"> · {{ money(answer.best.contractValue) }} est. contract value</span> from {{ answer.best.units }} {{ unitWord }} ({{ r(answer.best.winRate) }} win rate).</p>
          <p v-if="!answer.reliable" class="mt-1 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1"><AlertTriangle class="size-3.5" /> Early signal only — fewer than {{ report?.minSample }} {{ unitWord }}. Keep sending before deciding.</p>
        </template>
        <p v-else class="mt-1 text-sm text-muted-foreground">No won dealerships are credited to an email yet. Until then, compare <b>positive reply rate</b> and <b>meetings</b> below — they're the earliest reliable signals.</p>
      </div>
    </section>

    <!-- Head to head -->
    <section v-if="headToHead.length" class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div v-for="h in headToHead" :key="h.name + h.a.versionLabel + h.a.subjectVariant" class="rounded-xl border px-4 py-3" :class="h.verdict === 'leader' ? 'border-emerald-500/30 bg-emerald-500/[0.04]' : 'bg-card'">
        <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><FlaskConical class="size-3.5" /> {{ h.name }} — A/B</p>
        <p class="mt-1 text-sm"><b>{{ level === 'subject' ? h.a.subjectVariant : h.a.versionLabel }}{{ level === 'combo' ? ` · ${h.a.subjectVariant}` : '' }}</b> {{ r(h.a.positiveRate) }} positive · {{ r(h.a.replyRate) }} replies <span class="text-muted-foreground">({{ h.a.units }})</span> vs <b>{{ level === 'subject' ? h.b.subjectVariant : h.b.versionLabel }}{{ level === 'combo' ? ` · ${h.b.subjectVariant}` : '' }}</b> {{ r(h.b.positiveRate) }} · {{ r(h.b.replyRate) }} <span class="text-muted-foreground">({{ h.b.units }})</span></p>
        <p class="text-xs mt-0.5" :class="h.verdict === 'leader' ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'">{{ h.verdict === 'leader' ? 'Clear leader — the reply-rate ranges do not overlap.' : h.verdict === 'too-close' ? 'Too close to call — the ranges overlap. Keep both running.' : `Not enough data yet — aim for ${report?.minSample}+ each.` }}</p>
      </div>
    </section>

    <!-- Leaderboard -->
    <section class="rounded-xl border bg-card overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th class="text-left font-medium px-4 py-2">Message</th>
              <th class="text-right font-medium px-2 py-2">{{ model === 'email' ? 'Emails' : 'Sequences' }}</th>
              <th class="text-right font-medium px-2 py-2">Delivered</th>
              <th class="text-right font-medium px-2 py-2">Reply rate</th>
              <th class="text-right font-medium px-2 py-2">Positive</th>
              <th class="text-right font-medium px-2 py-2">Meetings</th>
              <th class="text-right font-medium px-2 py-2">Opps</th>
              <th class="text-right font-medium px-2 py-2">Won</th>
              <th class="text-right font-medium px-2 py-2">Revenue</th>
              <th class="text-right font-medium px-3 py-2" title="Invoiced revenue per email / sequence">Per {{ model === 'email' ? 'email' : 'seq.' }}</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr v-for="x in rows" :key="`${x.templateId}|${x.version}|${x.subjectVariant}`" class="hover:bg-muted/30 align-top">
              <td class="px-4 py-2.5 min-w-[220px]">
                <p class="font-medium flex flex-wrap items-center gap-1.5">
                  {{ x.templateName }}
                  <Badge v-if="x.version != null" variant="outline" class="text-[10px] gap-1"><component :is="x.versionFormat === 'html' ? Code2 : Type" class="size-3" />{{ x.versionLabel }}</Badge>
                  <Badge v-if="x.subjectVariant" variant="outline" class="text-[10px]">{{ x.subjectVariant === 'custom' ? 'custom subject' : x.subjectVariant }}</Badge>
                  <Badge v-if="x.versionStatus === 'retired' || x.subjectStatus === 'retired'" variant="outline" class="text-[9px] text-muted-foreground">retired</Badge>
                </p>
                <p v-if="x.subjectText && x.subjectVariant" class="text-[11px] text-muted-foreground line-clamp-1">{{ x.subjectText }}</p>
                <p v-if="!x.enoughData && x.templateId" class="text-[10px] text-amber-600">Too early · n={{ x.units }}</p>
              </td>
              <td class="px-2 py-2.5 text-right tabular-nums">{{ x.units }}<span v-if="model === 'sequence'" class="block text-[10px] text-muted-foreground">{{ x.emails }} emails</span></td>
              <td class="px-2 py-2.5 text-right tabular-nums text-xs">{{ r(x.deliveryRate) }}</td>
              <td class="px-2 py-2.5 text-right tabular-nums" :title="x.replyCI ? `95% range ${x.replyCI.low}%–${x.replyCI.high}%` : ''"><span class="font-semibold">{{ r(x.replyRate) }}</span><span class="block text-[10px] text-muted-foreground">{{ x.replied }}</span></td>
              <td class="px-2 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400"><span class="font-semibold">{{ r(x.positiveRate) }}</span><span class="block text-[10px] text-muted-foreground">{{ x.positive }}</span></td>
              <td class="px-2 py-2.5 text-right tabular-nums">{{ x.meetings || '—' }}</td>
              <td class="px-2 py-2.5 text-right tabular-nums">{{ x.opportunities || '—' }}</td>
              <td class="px-2 py-2.5 text-right tabular-nums font-bold">{{ x.won || '—' }}</td>
              <td class="px-2 py-2.5 text-right tabular-nums whitespace-nowrap"><span class="font-semibold">{{ money(x.revenueInvoiced) }}</span><span v-if="x.contractValue" class="block text-[10px] text-muted-foreground">est. {{ money(x.contractValue) }}</span></td>
              <td class="px-3 py-2.5 text-right tabular-nums text-xs">{{ x.revenuePerUnit ? money(x.revenuePerUnit) : '—' }}</td>
            </tr>
            <tr v-if="!rows.length && !loading"><td colspan="10" class="px-4 py-10 text-center text-sm text-muted-foreground">No emails sent with these filters yet.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <div class="text-[11px] text-muted-foreground space-y-1">
      <p class="flex items-start gap-1.5"><Info class="size-3.5 shrink-0 mt-px" /> <span><b>First email of each sequence</b> answers “which opener starts deals”: a sequence is judged by the template that opened it, even if a follow-up got the reply. <b>Each email individually</b> credits the email that got the reply.</span></p>
      <p class="pl-5">Rates use delivered emails when delivery tracking is on. Revenue = invoiced (pre-tax) for dealerships won and now in Dealers; “est.” = contract value entered when marking won. Opens are deliberately not used here.</p>
    </div>
  </div>
</template>
