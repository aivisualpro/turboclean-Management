<script setup lang="ts">
import type { EmailStats, EmailStatsRow } from '~/composables/useCrmEmail'
import { pct } from '~/composables/useCrmEmail'
import { Loader2, Inbox, Info, MailOpen, MousePointerClick, ShieldAlert, ArrowRight, FileDown } from 'lucide-vue-next'
import { format, subDays } from 'date-fns'
import { EMAIL_FUNNEL } from '~/constants/crm'

/**
 * Email performance. The funnel (replies → conversations → meetings → proposals → won) is the headline;
 * opens/clicks are shown separately and labelled as reported engagement.
 */
const emit = defineEmits<{ go: [tab: string] }>()
const { getStats } = useCrmEmail()

const range = ref<'30' | '90' | '365' | 'all'>('90')
const groupBy = ref<'template' | 'campaign' | 'user' | 'followUp'>('template')
const total = ref<EmailStats | null>(null)
const breakdown = ref<EmailStats | null>(null)
const loading = ref(false)

const from = computed(() => range.value === 'all' ? undefined : format(subDays(new Date(), Number(range.value)), 'yyyy-MM-dd'))
async function load() {
  loading.value = true
  try {
    const [t, b] = await Promise.all([getStats({ groupBy: 'none', from: from.value }), getStats({ groupBy: groupBy.value, from: from.value })])
    total.value = t; breakdown.value = b
  } finally { loading.value = false }
}
watch([range, groupBy], load, { immediate: true })

const row = computed<EmailStatsRow | null>(() => total.value?.rows[0] || null)
const funnel = computed(() => {
  const r = row.value
  if (!r) return []
  const vals: Record<string, number> = { replied: r.replied, conversation: r.conversation, meeting: r.meeting, proposal: r.proposal, won: r.won }
  return EMAIL_FUNNEL.map((f, i) => {
    const v = vals[f.key] ?? 0
    const prev = i === 0 ? r.sent : (vals[EMAIL_FUNNEL[i - 1]!.key] ?? 0)
    return { ...f, value: v, ofSent: pct(v, r.sent), step: pct(v, prev), width: r.sent ? Math.max(2, (v / r.sent) * 100) : 0 }
  })
})
function rowLabel(r: EmailStatsRow) {
  const k = r.key || {}
  if (groupBy.value === 'template') return k.id ? `${k.name || 'Template'} · v${k.version}` : 'No template'
  if (groupBy.value === 'campaign') return k.id ? k.name || 'Campaign' : 'No campaign'
  if (groupBy.value === 'user') return k.name || 'Unknown sender'
  return k.id === '0' ? 'First email' : k.id === '3+' ? 'Follow-up #3+' : `Follow-up #${k.id}`
}
const sortedRows = computed(() => [...(breakdown.value?.rows || [])].sort((a, b) => (b.replied / (b.sent || 1)) - (a.replied / (a.sent || 1)) || b.sent - a.sent))
const fmtPct = (v: number | null) => v === null ? '—' : `${v}%`

function exportCsv() {
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['Group', 'Sent', 'First emails', 'Follow-ups', 'Delivered', 'Bounced', 'Replies', 'Reply rate %', 'Positive', 'Negative', 'Conversations', 'Meetings', 'Opportunities', 'Proposals', 'Won', 'Opened (reported)', 'Clicked (reported)']
  const lines = sortedRows.value.map(r => [rowLabel(r), r.sent, r.firstEmails, r.followUps, r.delivered, r.bounced, r.replied, pct(r.replied, r.sent), r.positive, r.negative, r.conversation, r.meeting, r.opportunity, r.proposal, r.won, r.opened, r.clicked].map(esc).join(','))
  const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `email_performance_${groupBy.value}_${format(new Date(), 'yyyy-MM-dd')}.csv` })
  a.click(); URL.revokeObjectURL(a.href)
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center gap-2">
      <div class="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
        <button v-for="r in [{ k: '30', l: '30 days' }, { k: '90', l: '90 days' }, { k: '365', l: '12 months' }, { k: 'all', l: 'All time' }]" :key="r.k" type="button" class="rounded-md px-2.5 py-1 text-xs font-medium" :class="range === r.k ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'" @click="range = r.k as any">{{ r.l }}</button>
      </div>
      <Loader2 v-if="loading" class="size-4 animate-spin text-muted-foreground" />
      <button v-if="(total?.unclassifiedReplies || 0) + (total?.unmatchedReplies || 0)" type="button" class="ml-auto inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-500/15" @click="emit('go', 'replies')">
        <Inbox class="size-3.5" /> {{ total!.unclassifiedReplies }} to classify<span v-if="total!.unmatchedReplies"> · {{ total!.unmatchedReplies }} unmatched</span><ArrowRight class="size-3" />
      </button>
    </div>

    <div v-if="!row && !loading" class="rounded-xl border-2 border-dashed py-14 text-center">
      <p class="font-semibold text-sm">No emails sent in this period</p>
      <p class="text-xs text-muted-foreground mt-1">Send emails from a dealership record (Emails tab) — results appear here.</p>
    </div>

    <template v-else-if="row">
      <!-- Funnel -->
      <section class="rounded-xl border bg-card">
        <header class="px-5 py-3.5 border-b flex items-center justify-between gap-2">
          <div>
            <h3 class="font-semibold text-sm">What emails produced</h3>
            <p class="text-[11px] text-muted-foreground">{{ row.sent }} emails sent ({{ row.firstEmails }} first, {{ row.followUps }} follow-ups) to {{ row.dealershipsReached }} dealership{{ row.dealershipsReached === 1 ? '' : 's' }}</p>
          </div>
        </header>
        <ol class="p-5 space-y-3">
          <li v-for="(f, i) in funnel" :key="f.key" class="grid grid-cols-[120px_1fr_150px] items-center gap-3">
            <span class="text-sm font-medium">{{ f.label }}</span>
            <div class="h-7 rounded-md bg-muted/50 overflow-hidden">
              <div class="h-full rounded-md flex items-center px-2 text-[11px] font-semibold text-white transition-all" :class="['bg-sky-500', 'bg-teal-500', 'bg-indigo-500', 'bg-fuchsia-500', 'bg-emerald-500'][i]" :style="{ width: `${f.width}%` }"><span v-if="f.width > 8">{{ f.value }}</span></div>
            </div>
            <span class="text-xs tabular-nums text-right"><span class="font-bold text-sm">{{ f.value }}</span> <span class="text-muted-foreground">· {{ fmtPct(f.ofSent) }} of sent</span><br><span v-if="i > 0" class="text-[10px] text-muted-foreground">{{ fmtPct(f.step) }} from {{ funnel[i - 1]!.label.toLowerCase() }}</span><span v-else class="text-[10px] text-muted-foreground">{{ row.positive }} positive · {{ row.negative }} negative</span></span>
          </li>
        </ol>
        <p class="px-5 pb-4 text-[11px] text-muted-foreground flex items-start gap-1.5"><Info class="size-3.5 shrink-0 mt-px" /> A step is credited to the most recent replied email to that dealership in the {{ total?.attributionDays }} days before the stage change or activity. A later step implies the earlier ones.</p>
      </section>

      <!-- Secondary -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="rounded-xl border bg-card px-5 py-4">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><ShieldAlert class="size-3.5" /> Deliverability</p>
          <p class="mt-1 text-sm"><span class="font-bold tabular-nums">{{ fmtPct(pct(row.delivered, row.sent)) }}</span> delivered · <span class="font-bold tabular-nums" :class="(pct(row.bounced, row.sent) || 0) > 5 && 'text-rose-600'">{{ fmtPct(pct(row.bounced, row.sent)) }}</span> bounced<span v-if="row.complained"> · <span class="text-rose-600 font-bold">{{ row.complained }}</span> spam reports</span></p>
          <p class="text-[11px] text-muted-foreground mt-0.5">Keep bounces under 2–5% to protect the sending domain.</p>
        </div>
        <div class="rounded-xl border border-dashed bg-muted/20 px-5 py-4">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground">Reported engagement · not a success metric</p>
          <p class="mt-1 text-sm text-muted-foreground"><MailOpen class="size-3.5 inline -mt-0.5" /> {{ fmtPct(pct(row.opened, row.sent)) }} opened · <MousePointerClick class="size-3.5 inline -mt-0.5" /> {{ fmtPct(pct(row.clicked, row.sent)) }} clicked</p>
          <p class="text-[11px] text-muted-foreground mt-0.5">Opens are inflated by privacy features (e.g. Apple Mail) and blocked by others. Judge emails by replies and meetings.</p>
        </div>
      </div>

      <!-- Breakdown -->
      <section class="rounded-xl border bg-card overflow-hidden">
        <header class="px-5 py-3 border-b flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-semibold text-sm">Breakdown</h3>
          <div class="flex items-center gap-2">
            <div class="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
              <button v-for="g in [{ k: 'template', l: 'Template & version' }, { k: 'campaign', l: 'Campaign' }, { k: 'user', l: 'Sender' }, { k: 'followUp', l: 'First vs follow-up' }]" :key="g.k" type="button" class="rounded-md px-2.5 py-1 text-xs font-medium" :class="groupBy === g.k ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'" @click="groupBy = g.k as any">{{ g.l }}</button>
            </div>
            <Button variant="outline" size="sm" class="h-8 gap-1.5 text-xs" :disabled="!sortedRows.length" @click="exportCsv"><FileDown class="size-3.5" /> CSV</Button>
          </div>
        </header>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th class="text-left font-medium px-4 py-2">{{ { template: 'Template', campaign: 'Campaign', user: 'Sender', followUp: 'Position' }[groupBy] }}</th>
                <th class="text-right font-medium px-3 py-2">Sent</th>
                <th class="text-right font-medium px-3 py-2">Replies</th>
                <th class="text-right font-medium px-3 py-2">Reply rate</th>
                <th class="text-right font-medium px-3 py-2">Positive</th>
                <th class="text-right font-medium px-3 py-2">Conv.</th>
                <th class="text-right font-medium px-3 py-2">Meetings</th>
                <th class="text-right font-medium px-3 py-2">Proposals</th>
                <th class="text-right font-medium px-3 py-2">Won</th>
                <th class="text-right font-medium px-3 py-2">Bounced</th>
                <th class="text-right font-medium px-3 py-2 text-muted-foreground/70" title="Reported — not reliable">Opened*</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr v-for="r in sortedRows" :key="JSON.stringify(r.key)" class="hover:bg-muted/30">
                <td class="px-4 py-2.5 font-medium">{{ rowLabel(r) }}</td>
                <td class="px-3 py-2.5 text-right tabular-nums">{{ r.sent }}</td>
                <td class="px-3 py-2.5 text-right tabular-nums">{{ r.replied }}</td>
                <td class="px-3 py-2.5 text-right tabular-nums font-semibold">{{ fmtPct(pct(r.replied, r.sent)) }}</td>
                <td class="px-3 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{{ r.positive || '—' }}</td>
                <td class="px-3 py-2.5 text-right tabular-nums">{{ r.conversation || '—' }}</td>
                <td class="px-3 py-2.5 text-right tabular-nums">{{ r.meeting || '—' }}</td>
                <td class="px-3 py-2.5 text-right tabular-nums">{{ r.proposal || '—' }}</td>
                <td class="px-3 py-2.5 text-right tabular-nums font-semibold">{{ r.won || '—' }}</td>
                <td class="px-3 py-2.5 text-right tabular-nums" :class="r.bounced && 'text-rose-600'">{{ r.bounced || '—' }}</td>
                <td class="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{{ fmtPct(pct(r.opened, r.sent)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
