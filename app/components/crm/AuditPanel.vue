<script setup lang="ts">
import type { CrmAudit, CrmDealership } from '~/composables/useCrmDealerships'
import { ClipboardCheck, Plus, Car, ImageOff, Camera, TrendingUp, TrendingDown, Minus, ChevronDown, ExternalLink, Bot, User, FileDown, Link2, FileBarChart } from 'lucide-vue-next'
import { format, formatDistanceToNow } from 'date-fns'

const props = defineProps<{ dealership: CrmDealership, audits: CrmAudit[], canEdit: boolean }>()
const emit = defineEmits<{ record: [] }>()

const sorted = computed(() => [...props.audits].sort((a, b) => b.auditedAt.localeCompare(a.auditedAt) || b.createdAt.localeCompare(a.createdAt)))
const latest = computed(() => sorted.value[0] || null)
const previous = computed(() => sorted.value[1] || null)
const delta = computed(() => latest.value?.missingPhotoPct != null && previous.value?.missingPhotoPct != null ? Math.round((latest.value.missingPhotoPct - previous.value.missingPhotoPct) * 10) / 10 : null)
const inventoryDelta = computed(() => latest.value && previous.value ? latest.value.totalVehicles - previous.value.totalVehicles : null)
const daysSinceLatest = computed(() => latest.value ? Math.floor((Date.now() - new Date(latest.value.auditedAt).getTime()) / 86_400_000) : null)

const tone = (p: number | null) => p === null ? 'text-muted-foreground' : p >= 25 ? 'text-rose-600 dark:text-rose-400' : p >= 10 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
const expanded = ref<Set<string>>(new Set())
function toggle(id: string) { const s = new Set(expanded.value); s.has(id) ? s.delete(id) : s.add(id); expanded.value = s }
onMounted(() => { if (latest.value) expanded.value = new Set([latest.value.id]) })

// Stored analysis report per audit (then vs now, history, evidence) — view / PDF / dealer link
const reportFor = ref<{ id: string, auditedAt: string } | null>(null)
const reportOpen = ref(false)
function openReport(a: { id: string, auditedAt: string }) { reportFor.value = a; reportOpen.value = true }
function exportCsv() {
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['Audit date', 'Source', 'Inventory URL', 'New total', 'Used total', 'Total', 'New missing photos', 'Used missing photos', 'Missing total', 'Missing %', 'New missing %', 'Used missing %', 'Poor photo sets', 'Poor set notes', 'Merchandising issues', 'Merchandising notes', 'Website issues', 'Website notes', 'Notes', 'Examples', 'Audited by']
  const rows = sorted.value.map(a => [a.auditedAt.slice(0, 10), a.source, a.inventoryUrl, a.newTotal, a.usedTotal, a.totalVehicles, a.newMissingPhotos, a.usedMissingPhotos, a.totalMissingPhotos, a.missingPhotoPct, a.newMissingPhotoPct, a.usedMissingPhotoPct, a.poorPhotoSets, a.poorPhotoSetsNotes, a.merchandisingIssues.join('; '), a.merchandisingNotes, a.websiteIssues.join('; '), a.websiteIssuesNotes, a.notes, a.examples.map(e => e.label ? `${e.label}: ${e.url}` : e.url).join(' | '), a.auditedBy?.name].map(esc).join(','))
  const blob = new Blob([[head.map(esc).join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' })
  const el = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${props.dealership.dealershipId}_audits.csv` })
  el.click(); URL.revokeObjectURL(el.href)
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h3 class="font-semibold">Dealership research / inventory audit</h3>
        <p class="text-xs text-muted-foreground">Every audit is kept as its own dated snapshot, so you can show a dealer exactly how their inventory has changed.</p>
      </div>
      <div class="flex items-center gap-2">
        <Button v-if="audits.length" variant="outline" size="sm" class="gap-2" @click="exportCsv"><FileDown class="size-4" /> Export history</Button>
        <Button v-if="canEdit" size="sm" class="gap-2 bg-violet-600 hover:bg-violet-600/90 text-white" @click="emit('record')"><Plus class="size-4" /> Record audit</Button>
      </div>
    </div>

    <!-- Empty -->
    <div v-if="!audits.length" class="rounded-xl border-2 border-dashed py-14 flex flex-col items-center text-center">
      <div class="size-14 rounded-2xl bg-violet-500/10 flex items-center justify-center"><ClipboardCheck class="size-6 text-violet-600/60" /></div>
      <h4 class="mt-4 font-semibold">No audits yet</h4>
      <p class="mt-1 text-sm text-muted-foreground max-w-sm">Research the dealership's website before the first call: count the inventory, spot missing photos and weak merchandising, and save it here as the baseline.</p>
      <Button v-if="canEdit" size="sm" class="mt-4 gap-2 bg-violet-600 hover:bg-violet-600/90 text-white" @click="emit('record')"><Plus class="size-4" /> Record first audit</Button>
    </div>

    <template v-else>
      <!-- Latest snapshot -->
      <div class="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <div class="rounded-xl border bg-card p-4">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><ImageOff class="size-3.5" /> Missing photos</p>
          <p class="mt-1 text-2xl font-bold tabular-nums tracking-tight" :class="tone(latest!.missingPhotoPct)">{{ latest!.missingPhotoPct === null ? '—' : `${latest!.missingPhotoPct}%` }}</p>
          <p class="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
            <template v-if="delta !== null"><component :is="delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus" class="size-3" :class="delta > 0 ? 'text-rose-500' : delta < 0 ? 'text-emerald-500' : ''" />{{ delta > 0 ? '+' : '' }}{{ delta }} pts vs previous</template>
            <template v-else>{{ latest!.totalMissingPhotos }} of {{ latest!.totalVehicles }} vehicles</template>
          </p>
        </div>
        <div class="rounded-xl border bg-card p-4">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Car class="size-3.5" /> Inventory</p>
          <p class="mt-1 text-2xl font-bold tabular-nums tracking-tight">{{ latest!.totalVehicles }}</p>
          <p class="text-[11px] text-muted-foreground mt-0.5">{{ latest!.newTotal }} new · {{ latest!.usedTotal }} used<span v-if="inventoryDelta !== null"> · {{ inventoryDelta > 0 ? '+' : '' }}{{ inventoryDelta }} vs previous</span></p>
        </div>
        <div class="rounded-xl border bg-card p-4">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Camera class="size-3.5" /> Poor photo sets</p>
          <p class="mt-1 text-2xl font-bold tabular-nums tracking-tight">{{ latest!.poorPhotoSets ?? '—' }}</p>
          <p class="text-[11px] text-muted-foreground mt-0.5 truncate">{{ latest!.poorPhotoSetsNotes || (latest!.poorPhotoSets === null ? 'Not assessed' : 'Incomplete sets') }}</p>
        </div>
        <div class="rounded-xl border bg-card p-4">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><ClipboardCheck class="size-3.5" /> Last audit</p>
          <p class="mt-1 text-2xl font-bold tabular-nums tracking-tight" :class="daysSinceLatest! > 45 ? 'text-amber-600 dark:text-amber-400' : ''">{{ daysSinceLatest }}d <span class="text-sm font-normal text-muted-foreground">ago</span></p>
          <p class="text-[11px] text-muted-foreground mt-0.5">{{ audits.length }} audit{{ audits.length === 1 ? '' : 's' }} on record · {{ latest!.merchandisingIssues.length + latest!.websiteIssues.length }} issues flagged</p>
        </div>
      </div>

      <!-- Trend -->
      <section v-if="audits.filter(a => a.missingPhotoPct !== null).length" class="rounded-xl border bg-card">
        <header class="px-4 py-3 border-b flex items-center justify-between"><h4 class="text-sm font-semibold">Missing-photo rate over time</h4><span class="text-[11px] text-muted-foreground">{{ audits.length }} point{{ audits.length === 1 ? '' : 's' }}</span></header>
        <div class="px-2 pt-3 pb-1"><CrmAuditTrend :audits="audits" /></div>
      </section>

      <!-- History -->
      <section class="space-y-2">
        <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Audit history</h4>
        <article v-for="(a, idx) in sorted" :key="a.id" class="rounded-xl border bg-card overflow-hidden">
          <button type="button" class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/40 transition-colors" :aria-expanded="expanded.has(a.id)" @click="toggle(a.id)">
            <div class="size-9 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0"><ClipboardCheck class="size-4 text-violet-600 dark:text-violet-400" /></div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-semibold text-sm">{{ format(new Date(a.auditedAt), 'EEE, MMM d, yyyy') }}</span>
                <Badge v-if="idx === 0" variant="secondary" class="text-[10px]">Latest</Badge>
                <Badge variant="outline" class="text-[10px] gap-1"><component :is="a.source === 'manual' ? User : Bot" class="size-3" />{{ a.source }}</Badge>
              </div>
              <p class="text-xs text-muted-foreground">{{ a.totalVehicles }} vehicles · {{ a.newTotal }} new / {{ a.usedTotal }} used · by {{ a.auditedBy?.name || 'System' }} {{ formatDistanceToNow(new Date(a.createdAt), { addSuffix: true }) }}</p>
            </div>
            <div class="text-right shrink-0">
              <p class="text-lg font-bold tabular-nums leading-tight" :class="tone(a.missingPhotoPct)">{{ a.missingPhotoPct === null ? '—' : `${a.missingPhotoPct}%` }}</p>
              <p class="text-[10px] text-muted-foreground">missing photos</p>
            </div>
            <ChevronDown class="size-4 text-muted-foreground transition-transform shrink-0" :class="expanded.has(a.id) && 'rotate-180'" />
          </button>
          <div v-if="expanded.has(a.id)" class="border-t px-4 pt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" class="h-8 gap-1.5 bg-violet-600 hover:bg-violet-600/90 text-white" @click="openReport(a)"><FileBarChart class="size-4" /> Inventory report</Button>
            <Button as="a" :href="`/api/crm/audits/${a.id}/report?format=pdf&download=1`" size="sm" variant="outline" class="h-8 gap-1.5"><FileDown class="size-4" /> PDF</Button>
            <span class="text-[11px] text-muted-foreground">Stored as it read on this date{{ idx < sorted.length - 1 ? ' — includes then vs now' : ' — the baseline' }}.</span>
          </div>
          <div v-if="expanded.has(a.id)" class="px-4 py-4 grid grid-cols-1 lg:grid-cols-2 gap-5 text-sm">
            <div class="space-y-4">
              <table class="w-full text-xs">
                <thead class="text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th class="text-left font-medium pb-1"></th><th class="text-right font-medium pb-1">Total</th><th class="text-right font-medium pb-1">Missing photos</th><th class="text-right font-medium pb-1">Rate</th></tr></thead>
                <tbody class="divide-y">
                  <tr><td class="py-1.5">New vehicles</td><td class="py-1.5 text-right tabular-nums">{{ a.newTotal }}</td><td class="py-1.5 text-right tabular-nums">{{ a.newMissingPhotos }}</td><td class="py-1.5 text-right tabular-nums font-medium">{{ a.newMissingPhotoPct ?? '—' }}%</td></tr>
                  <tr><td class="py-1.5">Used vehicles</td><td class="py-1.5 text-right tabular-nums">{{ a.usedTotal }}</td><td class="py-1.5 text-right tabular-nums">{{ a.usedMissingPhotos }}</td><td class="py-1.5 text-right tabular-nums font-medium">{{ a.usedMissingPhotoPct ?? '—' }}%</td></tr>
                  <tr class="font-semibold"><td class="py-1.5">Total</td><td class="py-1.5 text-right tabular-nums">{{ a.totalVehicles }}</td><td class="py-1.5 text-right tabular-nums">{{ a.totalMissingPhotos }}</td><td class="py-1.5 text-right tabular-nums" :class="tone(a.missingPhotoPct)">{{ a.missingPhotoPct ?? '—' }}%</td></tr>
                </tbody>
              </table>
              <div v-if="a.poorPhotoSets !== null || a.poorPhotoSetsNotes" class="text-xs"><span class="text-muted-foreground">Poor photo sets:</span> <span class="font-medium">{{ a.poorPhotoSets ?? '—' }}</span><span v-if="a.poorPhotoSetsNotes" class="text-muted-foreground"> — {{ a.poorPhotoSetsNotes }}</span></div>
              <div v-if="a.inventoryUrl" class="text-xs flex items-center gap-1.5 min-w-0"><Link2 class="size-3.5 text-muted-foreground shrink-0" /><a :href="a.inventoryUrl" target="_blank" rel="noopener" class="text-primary hover:underline truncate">{{ a.inventoryUrl }}</a><ExternalLink class="size-3 opacity-50 shrink-0" /></div>
            </div>
            <div class="space-y-4">
              <div v-if="a.merchandisingIssues.length || a.merchandisingNotes">
                <p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Missing merchandising</p>
                <div class="flex flex-wrap gap-1"><Badge v-for="m in a.merchandisingIssues" :key="m" variant="outline" class="text-[10px] bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20">{{ m }}</Badge></div>
                <p v-if="a.merchandisingNotes" class="text-xs text-muted-foreground mt-1.5">{{ a.merchandisingNotes }}</p>
              </div>
              <div v-if="a.websiteIssues.length || a.websiteIssuesNotes">
                <p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Website / inventory problems</p>
                <div class="flex flex-wrap gap-1"><Badge v-for="w in a.websiteIssues" :key="w" variant="outline" class="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20">{{ w }}</Badge></div>
                <p v-if="a.websiteIssuesNotes" class="text-xs text-muted-foreground mt-1.5">{{ a.websiteIssuesNotes }}</p>
              </div>
              <div v-if="a.notes"><p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Notes</p><p class="text-xs whitespace-pre-wrap leading-relaxed">{{ a.notes }}</p></div>
              <div v-if="a.examples.length">
                <p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Examples</p>
                <ul class="space-y-1">
                  <li v-for="(e, i) in a.examples" :key="i" class="text-xs flex items-center gap-1.5 min-w-0"><ExternalLink class="size-3 text-muted-foreground shrink-0" /><a :href="e.url" target="_blank" rel="noopener" class="text-primary hover:underline truncate">{{ e.label || e.url }}</a></li>
                </ul>
              </div>
              <p v-if="!a.merchandisingIssues.length && !a.websiteIssues.length && !a.notes && !a.examples.length" class="text-xs italic text-muted-foreground">No issues or notes recorded.</p>
            </div>
          </div>
        </article>
      </section>
    </template>
    <CrmAuditReport v-model:open="reportOpen" :audit-id="reportFor?.id || null" :audited-at="reportFor?.auditedAt" :dealership-name="dealership.name" />
  </div>
</template>
