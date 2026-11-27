<script setup lang="ts">
import type { CrmAudit, CrmAuditPage, CrmDealership } from '~/composables/useCrmDealerships'
import { ClipboardCheck, Plus, Car, ImageOff, Camera, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight, ExternalLink, Bot, User, FileDown, FileText, Layers, Link2, FileBarChart, Mail, Trash2, Loader2 } from 'lucide-vue-next'
import { pagePath } from '~/lib/scanScope'
import { toast } from 'vue-sonner'
import { format, formatDistanceToNow } from 'date-fns'

const props = defineProps<{
  dealership: CrmDealership, audits: CrmAudit[], canEdit: boolean
  /** The signed-in user may email this dealership (not archived, edit rights). */
  canEmail?: boolean
  /** The signed-in user may delete audits (a wrong crawl, a test). */
  canDelete?: boolean
}>()
const emit = defineEmits<{ record: [], email: [], changed: [] }>()

// ─── Delete an audit (asked first; can be undone) ───
const toDelete = ref<CrmAudit | null>(null)
const deleteOpen = ref(false)
const deleting = ref(false)
function askDelete(a: CrmAudit) { toDelete.value = a; deleteOpen.value = true }
async function undoDelete(token: string) {
  try { await $fetch('/api/crm/audits/restore', { method: 'POST', body: { undoToken: token } }); toast.success('Audit restored'); emit('changed') }
  catch (e: any) { toast.error('Could not restore the audit', { description: e?.data?.statusMessage || 'Try again.' }) }
}
async function confirmDelete() {
  const a = toDelete.value
  if (!a || deleting.value) return
  deleting.value = true
  try {
    const r = await $fetch<{ undoToken: string }>(`/api/crm/audits/${a.id}`, { method: 'DELETE' })
    deleteOpen.value = false
    emit('changed')
    toast.success(`Audit of ${format(new Date(a.auditedAt), 'MMM d, yyyy')} deleted`, { description: 'Its report is gone too. Emails already sent are kept.', duration: 15_000, action: { label: 'Undo', onClick: () => undoDelete(r.undoToken) } })
  } catch (e: any) { toast.error('The audit was not deleted', { description: e?.data?.statusMessage || 'Try again.' }) } finally { deleting.value = false }
}
/** The audit email as a PDF (nothing is sent) — to print or hand over. It is always built from the latest audit. */
const emailPdfUrl = computed(() => `/api/crm/dealerships/${props.dealership.id}/emails/pdf?templateId=audit&download=1`)

const sorted = computed(() => [...props.audits].sort((a, b) => b.auditedAt.localeCompare(a.auditedAt) || b.createdAt.localeCompare(a.createdAt)))
/** The newest audit of all — the one emails and the "Latest" badge refer to, whatever tab is open. */
const latest = computed(() => sorted.value[0] || null)

// ─── Page tabs: Combined, then one per inventory page the audits covered. Every number below follows the tab. ───
const pagesOf = (a: CrmAudit): CrmAuditPage[] => (a.pages || []).filter(p => p && p.url && p.total > 0)
const norm = (u: string) => String(u || '').trim().replace(/\/+$/, '').toLowerCase()
interface PageTab { key: string, label: string, kind: string, urls: Set<string> }
/** A page keeps its tab when its address changes but its name stays (and the other way round). Newest audit first, so today's pages lead. */
const pageTabs = computed<PageTab[]>(() => {
  const tabs: PageTab[] = []
  for (const a of sorted.value) {
    const taken = new Set<PageTab>()
    for (const p of pagesOf(a)) {
      const u = norm(p.url), name = (p.label || '').trim().toLowerCase()
      let t = tabs.find(x => !taken.has(x) && x.urls.has(u)) || tabs.find(x => !taken.has(x) && !!name && x.label.trim().toLowerCase() === name)
      if (!t) { t = { key: u, label: p.label || pagePath(p.url), kind: p.kind || '', urls: new Set() }; tabs.push(t) }
      t.urls.add(u); taken.add(t)
    }
  }
  return tabs.length > 1 ? tabs : []
})
const tab = ref('all')
watch(pageTabs, (t) => { if (tab.value !== 'all' && !t.some(x => x.key === tab.value)) tab.value = 'all' })
const activeTab = computed(() => pageTabs.value.find(t => t.key === tab.value) || null)
/** Audits recorded by hand only have new / used totals: they stand in for the "New" and "Pre-owned" pages when those are the only two. */
const splitByCondition = computed(() => pageTabs.value.length === 2 && pageTabs.value.some(t => t.kind === 'new') && pageTabs.value.some(t => t.kind === 'used'))

/** One audit as the open tab sees it: the whole audit, or just one of its pages. */
interface View {
  a: CrmAudit
  /** The audit has numbers for this tab (false: the page was not part of that audit). */
  has: boolean
  from: 'audit' | 'page' | 'condition'
  total: number, missing: number, pct: number | null
  /** Photo verdicts (null on audits recorded by hand). `real` includes the blurry ones. */
  real: number | null, stock: number | null, noPhoto: number | null, blurry: number | null
  page: CrmAuditPage | null
}
const rate = (n: number, of: number) => of ? Math.round((n / of) * 1000) / 10 : null
function viewOf(a: CrmAudit, t: PageTab | null): View {
  const none = { real: null, stock: null, noPhoto: null, blurry: null, page: null }
  if (!t) {
    const pb = a.photoBreakdown
    return { a, has: true, from: 'audit', total: a.totalVehicles, missing: a.totalMissingPhotos, pct: a.missingPhotoPct, ...(pb ? { real: pb.real + pb.blurry, stock: pb.stock, noPhoto: pb.placeholder + pb.missing, blurry: pb.blurry } : none), page: null }
  }
  const pages = pagesOf(a)
  const p = pages.find(x => t.urls.has(norm(x.url)))
  if (p) return { a, has: true, from: 'page', total: p.total, missing: p.withoutReal, pct: p.withoutRealPct ?? rate(p.withoutReal, p.total), real: p.real + p.blurry, stock: p.stock, noPhoto: p.placeholder + p.missing, blurry: p.blurry, page: p }
  if (!pages.length && splitByCondition.value) {
    const isNew = t.kind === 'new'
    const total = isNew ? a.newTotal : a.usedTotal, missing = isNew ? a.newMissingPhotos : a.usedMissingPhotos
    if (total > 0) return { a, has: true, from: 'condition', total, missing, pct: rate(missing, total), ...none }
  }
  return { a, has: false, from: 'page', total: 0, missing: 0, pct: null, ...none }
}
/** Every audit through the open tab (newest first) — and only the ones that have numbers for it. */
const views = computed(() => sorted.value.map(a => viewOf(a, activeTab.value)))
const shown = computed(() => views.value.filter(v => v.has))
const latestV = computed(() => shown.value[0] || null)
const previousV = computed(() => shown.value[1] || null)
const delta = computed(() => latestV.value?.pct != null && previousV.value?.pct != null ? Math.round((latestV.value.pct - previousV.value.pct) * 10) / 10 : null)
const inventoryDelta = computed(() => latestV.value && previousV.value ? latestV.value.total - previousV.value.total : null)
const daysSinceLatest = computed(() => latestV.value ? Math.floor((Date.now() - new Date(latestV.value.a.auditedAt).getTime()) / 86_400_000) : null)
/** The tabs with the numbers of the newest audit that has them. */
const tabList = computed(() => {
  if (!pageTabs.value.length) return []
  const names = pageTabs.value.map(t => t.label.trim().toLowerCase())
  const head = (t: PageTab | null) => sorted.value.map(a => viewOf(a, t)).find(v => v.has) || null
  return [
    { key: 'all', label: 'Combined', hint: `All ${pageTabs.value.length} pages together`, combined: true, v: head(null) },
    // Two pages with the same name are told apart by their address.
    ...pageTabs.value.map((t, i) => ({ key: t.key, label: names.indexOf(names[i]!) !== names.lastIndexOf(names[i]!) ? `${t.label} · ${pagePath(t.key)}` : t.label, hint: [...t.urls][0] || '', combined: false, v: head(t) })),
  ]
})
/** The trend chart reads the same fields as an audit — given the open tab's numbers. */
const trendAudits = computed(() => shown.value.map(v => ({ ...v.a, missingPhotoPct: v.pct, totalMissingPhotos: v.missing, totalVehicles: v.total })) as CrmAudit[])
/** Flagged listings of an audit — on a page tab, the ones found on that page. */
function examplesOf(v: View) {
  const t = activeTab.value
  if (!t || !v.a.examples.some(e => e.listUrl)) return v.a.examples
  return v.a.examples.filter(e => e.listUrl && t.urls.has(norm(e.listUrl)))
}

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
  const head = ['Audit date', 'Source', 'Inventory URL', 'New total', 'Used total', 'Total', 'New missing photos', 'Used missing photos', 'Missing total', 'Missing %', 'New missing %', 'Used missing %', 'By page', 'Poor photo sets', 'Poor set notes', 'Merchandising issues', 'Merchandising notes', 'Website issues', 'Website notes', 'Notes', 'Examples', 'Audited by']
  const rows = sorted.value.map(a => [a.auditedAt.slice(0, 10), a.source, a.inventoryUrl, a.newTotal, a.usedTotal, a.totalVehicles, a.newMissingPhotos, a.usedMissingPhotos, a.totalMissingPhotos, a.missingPhotoPct, a.newMissingPhotoPct, a.usedMissingPhotoPct, pagesOf(a).map(p => `${p.label || pagePath(p.url)}: ${p.withoutReal} of ${p.total} (${p.withoutRealPct ?? 0}%)`).join(' | '), a.poorPhotoSets, a.poorPhotoSetsNotes, a.merchandisingIssues.join('; '), a.merchandisingNotes, a.websiteIssues.join('; '), a.websiteIssuesNotes, a.notes, a.examples.map(e => e.label ? `${e.label}: ${e.url}` : e.url).join(' | '), a.auditedBy?.name].map(esc).join(','))
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
      <div class="flex flex-wrap items-center gap-2">
        <Button v-if="audits.length" variant="outline" size="sm" class="gap-2" @click="exportCsv"><FileDown class="size-4" /> Export history</Button>
        <Button v-if="audits.length && canEmail" variant="outline" size="sm" class="gap-2" @click="emit('email')"><Mail class="size-4" /> Email this audit</Button>
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
      <!-- Page tabs: Combined, then every inventory page the audits covered. The numbers below follow the tab. -->
      <div class="space-y-3">
      <div v-if="tabList.length" role="tablist" aria-label="Inventory page" class="flex gap-2 overflow-x-auto p-0.5 -m-0.5">
        <button
          v-for="t in tabList" :key="t.key" type="button" role="tab" :aria-selected="tab === t.key" :title="t.hint"
          class="shrink-0 max-w-[300px] rounded-xl border-2 bg-card px-3.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="tab === t.key ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-border hover:border-foreground/30'" @click="tab = t.key"
        >
          <!-- (the app paints the selected tab solid theme colour: its text takes the colour that reads on it) -->
          <span class="flex items-center gap-1.5 text-sm font-semibold" :class="tab === t.key ? 'text-primary-foreground' : 'text-muted-foreground'"><component :is="t.combined ? Layers : FileText" class="size-3.5 shrink-0 opacity-70" /><span class="truncate">{{ t.label }}</span></span>
          <span v-if="t.v" class="block text-[11px] tabular-nums whitespace-nowrap"><b :class="tab === t.key ? 'text-primary-foreground' : tone(t.v.pct)">{{ t.v.pct ?? '—' }}%</b> <span :class="tab === t.key ? 'text-primary-foreground/75' : 'text-muted-foreground'">· {{ t.v.missing }} of {{ t.v.total }} missing photos</span></span>
        </button>
      </div>

      <!-- Latest snapshot (of the open tab) -->
      <div v-if="latestV" class="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <div class="rounded-xl border bg-card p-4">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><ImageOff class="size-3.5" /> Missing photos</p>
          <p class="mt-1 text-2xl font-bold tabular-nums tracking-tight" :class="tone(latestV.pct)">{{ latestV.pct === null ? '—' : `${latestV.pct}%` }}</p>
          <p class="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1 tabular-nums">
            <span>{{ latestV.missing }} of {{ latestV.total }}</span>
            <template v-if="delta !== null"><span aria-hidden="true">·</span><component :is="delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus" class="size-3" :class="delta > 0 ? 'text-rose-500' : delta < 0 ? 'text-emerald-500' : ''" />{{ delta > 0 ? '+' : '' }}{{ delta }} pts vs previous</template>
          </p>
        </div>
        <div class="rounded-xl border bg-card p-4">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Car class="size-3.5" /> {{ activeTab ? 'Vehicles on this page' : 'Inventory' }}</p>
          <p class="mt-1 text-2xl font-bold tabular-nums tracking-tight">{{ latestV.total }}</p>
          <p class="text-[11px] text-muted-foreground mt-0.5 tabular-nums"><template v-if="!activeTab">{{ latestV.a.newTotal }} new · {{ latestV.a.usedTotal }} used</template><template v-else-if="latestV.real !== null">{{ latestV.real }} with a real photo</template><template v-else>{{ activeTab.kind === 'new' ? 'New vehicles' : 'Used vehicles' }}</template><span v-if="inventoryDelta !== null"> · {{ inventoryDelta > 0 ? '+' : '' }}{{ inventoryDelta }} vs previous</span></p>
        </div>
        <!-- What the photos are (automated audits) — or the hand-counted poor photo sets -->
        <div v-if="latestV.stock !== null" class="rounded-xl border bg-card p-4">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Camera class="size-3.5" /> Stock images</p>
          <p class="mt-1 text-2xl font-bold tabular-nums tracking-tight">{{ latestV.stock }}</p>
          <p class="text-[11px] text-muted-foreground mt-0.5 truncate tabular-nums">{{ latestV.noPhoto }} with no photo · {{ latestV.blurry }} blurry</p>
        </div>
        <div v-else class="rounded-xl border bg-card p-4">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Camera class="size-3.5" /> Poor photo sets</p>
          <p class="mt-1 text-2xl font-bold tabular-nums tracking-tight">{{ latestV.a.poorPhotoSets ?? '—' }}</p>
          <p class="text-[11px] text-muted-foreground mt-0.5 truncate">{{ latestV.a.poorPhotoSetsNotes || (latestV.a.poorPhotoSets === null ? 'Not assessed' : 'Incomplete sets') }}</p>
        </div>
        <div class="rounded-xl border bg-card p-4">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><ClipboardCheck class="size-3.5" /> Last audit</p>
          <p class="mt-1 text-2xl font-bold tabular-nums tracking-tight" :class="daysSinceLatest! > 45 ? 'text-amber-600 dark:text-amber-400' : ''">{{ daysSinceLatest }}d <span class="text-sm font-normal text-muted-foreground">ago</span></p>
          <p class="text-[11px] text-muted-foreground mt-0.5"><template v-if="!activeTab">{{ audits.length }} audit{{ audits.length === 1 ? '' : 's' }} on record · {{ latestV.a.merchandisingIssues.length + latestV.a.websiteIssues.length }} issues flagged</template><template v-else>This page is in {{ shown.length }} of {{ audits.length }} audit{{ audits.length === 1 ? '' : 's' }}</template></p>
        </div>
      </div>
      </div>

      <!-- Trend -->
      <section v-if="trendAudits.filter(a => a.missingPhotoPct !== null).length" class="rounded-xl border bg-card">
        <header class="px-4 py-3 border-b flex items-center justify-between gap-2"><h4 class="text-sm font-semibold">Missing-photo rate over time<span v-if="activeTab" class="font-normal text-muted-foreground"> · {{ activeTab.label }}</span></h4><span class="text-[11px] text-muted-foreground">{{ trendAudits.length }} point{{ trendAudits.length === 1 ? '' : 's' }}</span></header>
        <div class="px-2 pt-3 pb-1"><CrmAuditTrend :key="tab" :audits="trendAudits" /></div>
      </section>

      <!-- History -->
      <section class="space-y-2">
        <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Audit history<span v-if="activeTab" class="normal-case tracking-normal font-normal"> · {{ activeTab.label }} only</span></h4>
        <article v-for="(v, idx) in views" :key="v.a.id" class="rounded-xl border bg-card overflow-hidden" :class="!v.has && 'opacity-70'">
          <button type="button" class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/40 transition-colors" :aria-expanded="expanded.has(v.a.id)" @click="toggle(v.a.id)">
            <div class="size-9 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0"><ClipboardCheck class="size-4 text-violet-600 dark:text-violet-400" /></div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-semibold text-sm">{{ format(new Date(v.a.auditedAt), 'EEE, MMM d, yyyy') }}</span>
                <Badge v-if="idx === 0" variant="secondary" class="text-[10px]">Latest</Badge>
                <Badge variant="outline" class="text-[10px] gap-1"><component :is="v.a.source === 'manual' ? User : Bot" class="size-3" />{{ v.a.source }}</Badge>
              </div>
              <p class="text-xs text-muted-foreground">
                <template v-if="!activeTab">{{ v.a.totalVehicles }} vehicles · {{ v.a.newTotal }} new / {{ v.a.usedTotal }} used</template>
                <template v-else-if="v.has">{{ v.total }} {{ v.from === 'condition' ? (activeTab.kind === 'new' ? 'new vehicles' : 'used vehicles') : `vehicle${v.total === 1 ? '' : 's'} on this page` }} · {{ v.missing }} missing {{ v.missing === 1 ? 'a photo' : 'photos' }}</template>
                <template v-else>This page was not part of this audit</template>
                · by {{ v.a.auditedBy?.name || 'System' }} {{ formatDistanceToNow(new Date(v.a.createdAt), { addSuffix: true }) }}
              </p>
            </div>
            <div class="text-right shrink-0">
              <p class="text-lg font-bold tabular-nums leading-tight" :class="tone(v.pct)">{{ v.pct === null ? '—' : `${v.pct}%` }}</p>
              <p class="text-[10px] text-muted-foreground">missing photos</p>
            </div>
            <ChevronDown class="size-4 text-muted-foreground transition-transform shrink-0" :class="expanded.has(v.a.id) && 'rotate-180'" />
          </button>
          <div v-if="expanded.has(v.a.id)" class="border-t px-4 pt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" class="h-8 gap-1.5 bg-violet-600 hover:bg-violet-600/90 text-white" @click="openReport(v.a)"><FileBarChart class="size-4" /> Inventory report</Button>
            <Button as="a" :href="`/api/crm/audits/${v.a.id}/report?format=pdf&download=1`" size="sm" variant="outline" class="h-8 gap-1.5"><FileDown class="size-4" /> Report PDF</Button>
            <template v-if="idx === 0">
              <span class="h-5 w-px bg-border" aria-hidden="true" />
              <Button v-if="canEmail" size="sm" class="h-8 gap-1.5" @click="emit('email')"><Mail class="size-4" /> Email this audit</Button>
              <Button as="a" :href="emailPdfUrl" size="sm" variant="outline" class="h-8 gap-1.5"><FileDown class="size-4" /> Email PDF</Button>
            </template>
            <Button v-if="canDelete" size="sm" variant="ghost" class="h-8 gap-1.5 ml-auto text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 dark:text-rose-400" @click="askDelete(v.a)"><Trash2 class="size-4" /> Delete audit</Button>
            <span class="text-[11px] text-muted-foreground basis-full">Stored as it read on this date.{{ activeTab ? ' The report, the PDFs and the email always cover the whole audit — every page.' : idx === 0 ? ' The email is built from this audit: subject, numbers and the flagged listings with their photos.' : sorted.length > 1 ? ' Emails always use the latest audit.' : '' }}</span>
          </div>
          <div v-if="expanded.has(v.a.id)" class="px-4 py-4 grid grid-cols-1 lg:grid-cols-2 gap-5 text-sm">
            <div class="space-y-4">
              <!-- Combined: new / used, then every page -->
              <template v-if="!activeTab">
                <table class="w-full text-xs">
                  <thead class="text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th class="text-left font-medium pb-1"></th><th class="text-right font-medium pb-1">Total</th><th class="text-right font-medium pb-1">Missing photos</th><th class="text-right font-medium pb-1">Rate</th></tr></thead>
                  <tbody class="divide-y">
                    <tr><td class="py-1.5">New vehicles</td><td class="py-1.5 text-right tabular-nums">{{ v.a.newTotal }}</td><td class="py-1.5 text-right tabular-nums">{{ v.a.newMissingPhotos }}</td><td class="py-1.5 text-right tabular-nums font-medium">{{ v.a.newMissingPhotoPct ?? '—' }}%</td></tr>
                    <tr><td class="py-1.5">Used vehicles</td><td class="py-1.5 text-right tabular-nums">{{ v.a.usedTotal }}</td><td class="py-1.5 text-right tabular-nums">{{ v.a.usedMissingPhotos }}</td><td class="py-1.5 text-right tabular-nums font-medium">{{ v.a.usedMissingPhotoPct ?? '—' }}%</td></tr>
                    <tr class="font-semibold"><td class="py-1.5">Total</td><td class="py-1.5 text-right tabular-nums">{{ v.a.totalVehicles }}</td><td class="py-1.5 text-right tabular-nums">{{ v.a.totalMissingPhotos }}</td><td class="py-1.5 text-right tabular-nums" :class="tone(v.a.missingPhotoPct)">{{ v.a.missingPhotoPct ?? '—' }}%</td></tr>
                  </tbody>
                </table>
                <table v-if="pagesOf(v.a).length > 1" class="w-full text-xs">
                  <thead class="text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th class="text-left font-medium pb-1">By page</th><th class="text-right font-medium pb-1">Total</th><th class="text-right font-medium pb-1">Missing photos</th><th class="text-right font-medium pb-1">Rate</th></tr></thead>
                  <tbody class="divide-y">
                    <tr v-for="p in pagesOf(v.a)" :key="p.url">
                      <td class="py-1.5"><button v-if="pageTabs.some(t => t.urls.has(norm(p.url)))" type="button" class="inline-flex items-center gap-1 text-primary hover:underline focus-visible:outline-none focus-visible:underline" :title="`Show ${p.label || 'this page'} only`" @click="tab = pageTabs.find(t => t.urls.has(norm(p.url)))!.key">{{ p.label || pagePath(p.url) }} <ChevronRight class="size-3" /></button><span v-else>{{ p.label || pagePath(p.url) }}</span></td>
                      <td class="py-1.5 text-right tabular-nums">{{ p.total }}</td><td class="py-1.5 text-right tabular-nums">{{ p.withoutReal }}</td><td class="py-1.5 text-right tabular-nums font-medium" :class="tone(p.withoutRealPct)">{{ p.withoutRealPct ?? '—' }}%</td>
                    </tr>
                  </tbody>
                </table>
              </template>
              <!-- One page: what its photos are -->
              <template v-else-if="v.has">
                <table class="w-full text-xs">
                  <thead class="text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th class="text-left font-medium pb-1">{{ activeTab.label }}</th><th class="text-right font-medium pb-1">Vehicles</th></tr></thead>
                  <tbody class="divide-y">
                    <template v-if="v.real !== null">
                      <tr><td class="py-1.5"><span class="inline-block size-2 rounded-full bg-emerald-500 mr-1.5 align-middle" aria-hidden="true" />Real photo<span v-if="v.blurry" class="text-muted-foreground"> ({{ v.blurry }} blurry)</span></td><td class="py-1.5 text-right tabular-nums">{{ v.real }}</td></tr>
                      <tr><td class="py-1.5"><span class="inline-block size-2 rounded-full bg-violet-500 mr-1.5 align-middle" aria-hidden="true" />Stock image</td><td class="py-1.5 text-right tabular-nums">{{ v.stock }}</td></tr>
                      <tr><td class="py-1.5"><span class="inline-block size-2 rounded-full bg-rose-500 mr-1.5 align-middle" aria-hidden="true" />No photo</td><td class="py-1.5 text-right tabular-nums">{{ v.noPhoto }}</td></tr>
                    </template>
                    <tr><td class="py-1.5">Missing photos</td><td class="py-1.5 text-right tabular-nums">{{ v.missing }} <span class="font-medium" :class="tone(v.pct)">({{ v.pct ?? '—' }}%)</span></td></tr>
                    <tr class="font-semibold"><td class="py-1.5">Total on this page</td><td class="py-1.5 text-right tabular-nums">{{ v.total }}</td></tr>
                  </tbody>
                </table>
                <p v-if="v.from === 'condition'" class="text-[11px] text-muted-foreground">This audit was recorded by hand as new and used totals — the {{ activeTab.kind === 'new' ? 'new' : 'used' }} vehicles are shown here.</p>
              </template>
              <p v-else class="text-xs text-muted-foreground">This audit did not read “{{ activeTab.label }}”. <button type="button" class="text-primary hover:underline" @click="tab = 'all'">Show the whole audit</button></p>
              <div v-if="!activeTab && (v.a.poorPhotoSets !== null || v.a.poorPhotoSetsNotes)" class="text-xs"><span class="text-muted-foreground">Poor photo sets:</span> <span class="font-medium">{{ v.a.poorPhotoSets ?? '—' }}</span><span v-if="v.a.poorPhotoSetsNotes" class="text-muted-foreground"> — {{ v.a.poorPhotoSetsNotes }}</span></div>
              <div v-if="!activeTab && v.a.photoBreakdown?.blurry" class="text-xs"><span class="inline-block size-2 rounded-full bg-amber-500 mr-1.5 align-middle" aria-hidden="true" /><span class="text-muted-foreground">Blurry photos:</span> <span class="font-medium tabular-nums">{{ v.a.photoBreakdown.blurry }}</span><span class="text-muted-foreground"> — real photos that are out of focus; listed in the report, not counted as missing</span></div>
              <div v-if="(v.page?.url || v.a.inventoryUrl)" class="text-xs flex items-center gap-1.5 min-w-0"><Link2 class="size-3.5 text-muted-foreground shrink-0" /><a :href="v.page?.url || v.a.inventoryUrl" target="_blank" rel="noopener" class="text-primary hover:underline truncate">{{ v.page?.url || v.a.inventoryUrl }}</a><ExternalLink class="size-3 opacity-50 shrink-0" /></div>
            </div>
            <div class="space-y-4">
              <div v-if="v.a.merchandisingIssues.length || v.a.merchandisingNotes">
                <p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Missing merchandising</p>
                <div class="flex flex-wrap gap-1"><Badge v-for="m in v.a.merchandisingIssues" :key="m" variant="outline" class="text-[10px] bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20">{{ m }}</Badge></div>
                <p v-if="v.a.merchandisingNotes" class="text-xs text-muted-foreground mt-1.5">{{ v.a.merchandisingNotes }}</p>
              </div>
              <div v-if="v.a.websiteIssues.length || v.a.websiteIssuesNotes">
                <p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Website / inventory problems</p>
                <div class="flex flex-wrap gap-1"><Badge v-for="w in v.a.websiteIssues" :key="w" variant="outline" class="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20">{{ w }}</Badge></div>
                <p v-if="v.a.websiteIssuesNotes" class="text-xs text-muted-foreground mt-1.5">{{ v.a.websiteIssuesNotes }}</p>
              </div>
              <div v-if="v.a.notes"><p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Notes<span v-if="activeTab" class="normal-case tracking-normal"> (whole audit)</span></p><p class="text-xs whitespace-pre-wrap leading-relaxed">{{ v.a.notes }}</p></div>
              <div v-if="examplesOf(v).length">
                <p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Examples<span v-if="activeTab" class="normal-case tracking-normal"> on this page</span></p>
                <ul class="space-y-1">
                  <li v-for="(e, i) in examplesOf(v)" :key="i" class="text-xs flex items-center gap-1.5 min-w-0"><ExternalLink class="size-3 text-muted-foreground shrink-0" /><a :href="e.url" target="_blank" rel="noopener" class="text-primary hover:underline truncate">{{ e.label || e.url }}</a></li>
                </ul>
              </div>
              <p v-if="!v.a.merchandisingIssues.length && !v.a.websiteIssues.length && !v.a.notes && !v.a.examples.length" class="text-xs italic text-muted-foreground">No issues or notes recorded.</p>
            </div>
          </div>
        </article>
      </section>
    </template>
    <!-- Delete an audit -->
    <Dialog v-model:open="deleteOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <div class="flex items-start gap-3">
            <div class="size-10 shrink-0 rounded-xl bg-rose-500/10 flex items-center justify-center"><Trash2 class="size-5 text-rose-600" /></div>
            <div class="min-w-0">
              <DialogTitle class="text-base">Delete this audit?</DialogTitle>
              <DialogDescription v-if="toDelete" class="text-xs mt-1">
                <b class="text-foreground">{{ format(new Date(toDelete.auditedAt), 'EEE, MMM d, yyyy') }}</b> — {{ toDelete.totalMissingPhotos }} of {{ toDelete.totalVehicles }} vehicles without a photo ({{ toDelete.missingPhotoPct ?? '—' }}%).
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <p class="text-sm text-muted-foreground">It disappears from this dealership's history and trend, together with its report and the “research completed” line it added. Emails already sent stay as they are. You can undo this right after.</p>
        <DialogFooter>
          <Button variant="ghost" :disabled="deleting" @click="deleteOpen = false">Cancel</Button>
          <Button variant="destructive" class="gap-1.5 min-w-32" :disabled="deleting" @click="confirmDelete"><Loader2 v-if="deleting" class="size-4 animate-spin" /><Trash2 v-else class="size-4" /> Delete audit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <CrmAuditReport v-model:open="reportOpen" :audit-id="reportFor?.id || null" :audited-at="reportFor?.auditedAt" :dealership-name="dealership.name" :can-email="!!canEmail && !!latest && reportFor?.id === latest.id" @email="reportOpen = false; emit('email')" />
  </div>
</template>
