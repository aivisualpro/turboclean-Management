<script setup lang="ts">
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { CrmDealership } from '~/composables/useCrmDealerships'
import type { Batch, BatchItem } from '~/composables/useBatchScan'
import type { EmailTemplate } from '~/composables/useCrmEmail'
import { loadPreviewContext, renderEmail } from '~/composables/useTemplatePreview'
import { useInventoryScanner } from '~/composables/useInventoryScanner'
import type { PreviewContext } from '~/composables/useTemplatePreview'
import {
  X, Radar, Play, Pause, Square, Loader2, CheckCircle2, AlertTriangle, CircleDashed, Car, ImageOff, Clock, Mail, Send, Eye, ChevronRight, ListChecks,
  RotateCcw, Globe, Sparkles, Inbox, ExternalLink, Users, Check, Ban, Zap, Archive, Pencil, Wand2, DoorOpen, Cloud, WifiOff, ShieldCheck,
  FileDown, FileText, FileBarChart, ChevronDown,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { SCOPE_META, checkScanPage, pagePath } from '~/lib/scanScope'
import { formatDistanceToNow } from 'date-fns'

/**
 * Mission Control — scan many dealerships in one go and email them.
 *  1. Pages   — confirm the inventory pages per dealership (saved on the dealership for next time)
 *  2. Scan    — live console: every dealership streams its progress, frames and log; audits auto-save
 *  3. Emails  — one template for everyone or a different one per dealership; send now or queue
 *  4. Sent    — what went where
 * The batch lives on the server, so closing this window pauses it and "Resume" picks it up.
 */
const props = defineProps<{ dealershipIds?: string[], batchId?: string | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ done: [] }>()

const { dealerships, fetchDealerships } = useCrmDealerships()
const { templates, loadLibrary } = useCrmEmail()
const bs = useBatchScan()
const { batch, live, driving, concurrency, feed, emailDealers, error: linkError, offlineFor } = bs

type Step = 'setup' | 'scan' | 'email' | 'sent'
const step = ref<Step>('setup')
const STEPS: { key: Step, n: number, label: string }[] = [{ key: 'setup', n: 1, label: 'Pages' }, { key: 'scan', n: 2, label: 'Crawl' }, { key: 'email', n: 3, label: 'Emails' }, { key: 'sent', n: 4, label: 'Sent' }]
const stepIndex = computed(() => STEPS.findIndex(s => s.key === step.value))

// ─── Setup ───
interface SetupRow { id: string, name: string, website: string, pages: string[], detecting: boolean, detectNote: string
  /** A saved address that can never be crawled (the home page, one vehicle's page) — why. */
  bad: string }
const setupRows = ref<SetupRow[]>([])
const editing = ref<CrmDealership | null>(null)
const showPages = ref(false)
function buildSetup() {
  const ids = props.dealershipIds || []
  setupRows.value = ids.map((id) => {
    const d = dealerships.value.find(x => x.id === id)
    // Only picked / verified pages count — a bare website is never scanned blind any more.
    const saved = d?.scanPages || []
    const unusable = saved.map(p => checkScanPage(p.url)).find(c => !c.ok)
    // Only real inventory lists count — the home page is never crawled, even when an older version saved it as a scan page.
    return { id, name: d?.name || id, website: d?.website || '', pages: saved.filter(p => checkScanPage(p.url).ok).map(p => p.url), detecting: false, detectNote: '', bad: unusable ? unusable.short : '' }
  })
}
function editPages(row: { id: string }) { editing.value = dealerships.value.find(x => x.id === row.id) || null; showPages.value = !!editing.value }
function pagesSaved(pages: { url: string, label: string }[]) {
  const row = setupRows.value.find(r => r.id === editing.value?.id)
  if (row) { row.pages = pages.filter(p => checkScanPage(p.url).ok).map(p => p.url); row.bad = '' }
}
/** Find + verify a dealership's inventory pages on the server and save them (the "magic" button). */
async function detectFor(row: SetupRow) {
  if (row.detecting || !row.website) return
  row.detecting = true
  row.detectNote = 'Opening the website…'
  try {
    const r = await $fetch<any>('/api/scanner/discover', { method: 'POST', body: { dealershipId: row.id, save: true } })
    row.pages = (r.pages || []).map((p: any) => p.url)
    if (row.pages.length) row.bad = ''
    row.detectNote = r.pages?.length ? `${r.pages.length} page${r.pages.length === 1 ? '' : 's'} verified · ${r.pages.reduce((n: number, p: any) => n + (p.total || p.cards || 0), 0)} vehicles${r.aiUsed ? ' · AI helped' : ''}` : 'No inventory pages found — pick them by hand'
    const d = dealerships.value.find(x => x.id === row.id)
    if (d) d.scanPages = r.saved || []
  }
  catch (e: any) { row.detectNote = e?.data?.message || e?.data?.statusMessage || 'Could not open the website' }
  finally { row.detecting = false }
}
const missingPages = computed(() => setupRows.value.filter(r => !r.pages.length && r.website))
const detectingAll = ref(false)
async function detectAll() {
  if (detectingAll.value) return
  detectingAll.value = true
  try {
    // Two sites at a time — each takes 20–60 s.
    const queue = [...missingPages.value]
    const worker = async () => { while (queue.length) { const row = queue.shift()!; await detectFor(row) } }
    await Promise.all([worker(), worker()])
    const found = setupRows.value.filter(r => r.pages.length).length
    toast.success(`Pages ready for ${found} of ${setupRows.value.length} dealerships`)
  }
  finally { detectingAll.value = false }
}
const ready = computed(() => setupRows.value.filter(r => r.pages.length))
/** Scan pages of a finished crawl that need a look (forward to the home page, show no vehicles, would not open). */
function scopeIssue(i: BatchItem) {
  const off = (i.scope || []).filter(e => ['redirected', 'empty', 'error'].includes(e.status))
  if (!off.length) return ''
  return `${off.length} scan page${off.length === 1 ? ' needs' : 's need'} attention: ${off.map(e => `${e.label || pagePath(e.url)} — ${(SCOPE_META[e.status as keyof typeof SCOPE_META]?.label || e.status).toLowerCase()}`).join(' · ')}`
}
const starting = ref(false)
async function start() {
  if (!ready.value.length) return toast.error('No pages to crawl yet', { description: 'Detect or pick the inventory pages first — the scanner never starts from a bare home page.' })
  starting.value = true
  try {
    // No page lists are sent: the server crawls each dealership's saved scan pages, and nothing else.
    await bs.create(setupRows.value.map(r => r.id), { concurrency: concurrency.value })
    step.value = 'scan'
    t0.value = Date.now()
    bs.drive()
  }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not start the batch') }
  finally { starting.value = false }
}

// ─── Scan console ───
const t0 = ref(Date.now())
const elapsed = ref(0)
let clock: ReturnType<typeof setInterval> | null = null
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const items = computed<BatchItem[]>(() => batch.value?.items || [])
const activeItems = computed(() => items.value.filter(i => i.status === 'running'))
const doneItems = computed(() => items.value.filter(i => i.status === 'done' || i.status === 'stopped'))
const pct = computed(() => batch.value ? Math.round(((batch.value.counts.total - batch.value.counts.queued - batch.value.counts.running) / Math.max(1, batch.value.counts.total)) * 100) : 0)
const withoutPct = computed(() => { const t = batch.value?.totals; return t && t.vehicles ? Math.round((t.withoutReal / t.vehicles) * 1000) / 10 : null })
const focus = ref<string | null>(null)
const focused = computed(() => items.value.find(i => i.dealershipId === focus.value) || null)
// Full results for the picked dealership — same review screen as a single crawl (re-label photos,
// image groups, rules). Saving corrects that dealership's audit, so emails use the corrected numbers.
const rv = useInventoryScanner()
const rvLoading = ref(false)
const rvSaving = ref(false)
const showResults = ref(true)
const focusedScanId = computed(() => focused.value && (focused.value.status === 'done' || focused.value.status === 'stopped') ? focused.value.scanId : null)
watch(focusedScanId, async (id) => {
  rv.results.value = null
  if (!id) return
  rvLoading.value = true
  try { await rv.refresh(id) } catch { toast.error('Could not load the crawl results') } finally { rvLoading.value = false }
}, { immediate: true })
const rvDirty = computed(() => !!rv.results.value && !rv.results.value.savedAuditId)
async function saveCorrections() {
  if (!rv.results.value || !focused.value) return
  rvSaving.value = true
  try {
    const r = await rv.save()
    toast.success('Corrections saved', { description: `${focused.value.name}: ${r.summary.withoutReal} of ${r.summary.total} without a real photo (${r.summary.withoutRealPct ?? 0}%). The report and emails use these numbers.` })
    if (batch.value?.id) await bs.load(batch.value.id).catch(() => {})
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save the corrections') } finally { rvSaving.value = false }
}
const STATUS: Record<string, { icon: any, cls: string, label: string }> = {
  queued: { icon: CircleDashed, cls: 'text-zinc-500', label: 'Queued' },
  running: { icon: Loader2, cls: 'text-emerald-400', label: 'Crawling' },
  done: { icon: CheckCircle2, cls: 'text-emerald-400', label: 'Done' },
  stopped: { icon: AlertTriangle, cls: 'text-amber-400', label: 'Partial' },
  failed: { icon: X, cls: 'text-rose-400', label: 'Failed' },
  skipped: { icon: Ban, cls: 'text-zinc-500', label: 'Skipped' },
  cancelled: { icon: Ban, cls: 'text-zinc-500', label: 'Cancelled' },
}
const itemPct = (i: BatchItem) => { const r = live.value[i.dealershipId]; const p = r?.progress; if (!p) return 0; if (p.phase === 'analyzing') return 55 + Math.round((p.analyzed / Math.max(1, p.toAnalyze)) * 45); if (p.phase === 'collecting') return p.advertised ? Math.min(55, Math.round((p.vehicles / p.advertised) * 55)) : Math.min(50, 4 + p.page * 6); return 100 }
const feedEl = ref<HTMLElement | null>(null)
watch(() => feed.value.length, () => nextTick(() => { if (feedEl.value) feedEl.value.scrollTop = feedEl.value.scrollHeight }))
const clockText = (at: number) => new Date(at).toLocaleTimeString([], { hour12: false })
const FEED_CLS: Record<string, string> = { info: 'text-emerald-300/80', ok: 'text-emerald-300 font-semibold', warn: 'text-amber-300', err: 'text-rose-300' }

async function pause() { await bs.pause(); toast('Pausing…', { description: 'Running scans save the page they are on and stop. Resume continues from there.' }) }
async function resume() { bs.drive() }
const cancelAsk = ref(false)
async function cancelAll() { cancelAsk.value = false; await bs.cancel(); toast('Cancelled the rest', { description: 'Running scans stop and keep what they found. Everything scanned so far is saved.' }) }
async function retry(i: BatchItem) { await bs.requeue(i.dealershipId); toast(`${i.name} queued again`) }

// ─── Email step ───
interface Row { dealershipId: string, name: string, include: boolean, templateId: string, contactId: string | null, mode: 'now' | 'queue', allowDuplicate: boolean }
const rows = ref<Row[]>([])
const globalTemplate = ref('')
const globalMode = ref<'now' | 'queue'>('now')
const loadingEmail = ref(false)
const tplList = computed<EmailTemplate[]>(() => templates.value.filter(t => !t.archivedAt))
const dealerCtx = (id: string) => emailDealers.value.find(d => d.dealershipId === id)
async function goEmail() {
  step.value = 'email'
  loadingEmail.value = true
  try {
    await Promise.all([bs.loadEmailContext(), loadLibrary().catch(() => {})])
    const def = tplList.value.find(t => t.category === 'First touch' && /missing photos/i.test(t.name)) || tplList.value.find(t => t.category === 'First touch') || tplList.value[0]
    globalTemplate.value = def?.id || ''
    rows.value = doneItems.value.map((i) => {
      const c = dealerCtx(i.dealershipId)
      return { dealershipId: i.dealershipId, name: i.name, include: !!c?.bestContactId, templateId: def?.id || '', contactId: c?.bestContactId || null, mode: globalMode.value, allowDuplicate: false }
    })
  }
  finally { loadingEmail.value = false }
}
function applyTemplateToAll() { for (const r of rows.value) r.templateId = globalTemplate.value; toast('Template applied to every dealership') }
watch(globalMode, (m) => { for (const r of rows.value) r.mode = m })
const toSend = computed(() => rows.value.filter(r => r.include && r.templateId && r.contactId))
const sending = ref(false)
const sentResults = ref<any[]>([])
async function sendAll() {
  if (!toSend.value.length) return toast.error('Nothing to send — pick a contact and a template')
  const now = toSend.value.filter(r => r.mode === 'now').length
  if (!confirm(`${now ? `Send ${now} email${now === 1 ? '' : 's'} now` : ''}${now && toSend.value.length - now ? ' and ' : ''}${toSend.value.length - now ? `queue ${toSend.value.length - now} for the next sending window` : ''}?`)) return
  sending.value = true
  try {
    sentResults.value = await bs.send(toSend.value.map(r => ({ dealershipId: r.dealershipId, templateId: r.templateId, contactId: r.contactId, mode: r.mode, allowDuplicate: r.allowDuplicate })))
    step.value = 'sent'
    const ok = sentResults.value.filter(r => r.status !== 'failed').length
    toast[ok === sentResults.value.length ? 'success' : 'warning'](`${ok} of ${sentResults.value.length} emails ${globalMode.value === 'now' ? 'sent' : 'queued'}`)
    emit('done')
  }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Sending failed') }
  finally { sending.value = false }
}
// Preview of one dealer's email with its real data
const previewRow = ref<Row | null>(null)
const previewCtx = shallowRef<PreviewContext | null>(null)
const previewLoading = ref(false)
const previewDevice = ref<'desktop' | 'mobile'>('desktop')
async function previewFor(r: Row) {
  previewRow.value = r
  previewLoading.value = true
  previewCtx.value = null
  try { previewCtx.value = await loadPreviewContext(r.dealershipId) } catch { toast.error('Could not load preview data') } finally { previewLoading.value = false }
}
// Downloads: the email as a PDF (nothing is sent) and the dealer's inventory report PDF.
const emailPdfUrl = (r: Row, download = true) => `/api/crm/dealerships/${r.dealershipId}/emails/pdf?templateId=${encodeURIComponent(r.templateId)}${r.contactId ? `&contactId=${encodeURIComponent(r.contactId)}` : ''}${download ? '&download=1' : ''}`
const reportPdfUrl = (r: Row) => { const a = items.value.find(i => i.dealershipId === r.dealershipId)?.auditId; return a ? `/api/crm/audits/${a}/report?format=pdf&download=1` : '' }
const pdfBusy = ref<string | null>(null)
async function downloadPdf(url: string, key: string) {
  if (!url || pdfBusy.value) return
  pdfBusy.value = key
  const t = toast.loading('Preparing the PDF…', { description: 'The first one can take ~10 seconds.' })
  try {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) { let msg = `PDF failed (${res.status})`; try { msg = (await res.json())?.statusMessage || msg } catch {} ; throw new Error(msg) }
    const name = decodeURIComponent((res.headers.get('content-disposition') || '').match(/filename="?([^";]+)"?/)?.[1] || 'document.pdf')
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    toast.success('PDF downloaded', { id: t, description: name })
  } catch (e: any) { toast.error(e?.message || 'Could not make the PDF', { id: t }) } finally { pdfBusy.value = null }
}
const previewRendered = computed(() => {
  const r = previewRow.value
  const t = r ? tplList.value.find(x => x.id === r.templateId) : null
  const v = t ? (t.versions.find(x => x.version === t.currentVersion) || t.versions.find(x => x.status === 'active')) : null
  const subject = t?.subjects.find(s => s.status === 'active')?.text || ''
  return v && previewCtx.value ? renderEmail(v, subject, previewCtx.value) : null
})
const viewId = ref<string | null>(null)
const viewOpen = ref(false)

// ─── Lifecycle ───
/** Closing while scans run: autopilot keeps going on the server — or pause / cancel. */
const closeAsk = ref(false)
bs.whenFinished((b, reason) => {
  if (open.value || !b) return
  if (reason === 'finished') toast.success(`Batch finished — ${b.counts.done} of ${b.counts.total} dealerships scanned`, { description: `${b.totals.vehicles} vehicles · ${b.totals.withoutReal} without a real photo. Open Mission Control to send the emails.`, duration: 15_000, action: { label: 'Open', onClick: () => { open.value = true } } })
})
watch(open, async (v) => {
  if (!v) {
    // The server keeps scanning; keep a light watch so "finished" can be announced.
    if (!driving.value) bs.unwatch()
    if (clock) clearInterval(clock); clock = null
    return
  }
  // Re-opened while the watched batch is still running → just show it (unless another batch was picked).
  if (driving.value && batch.value && (!props.batchId || props.batchId === batch.value.id) && !props.dealershipIds?.length) {
    step.value = 'scan'
    bs.watchBatch()
    if (clock) clearInterval(clock)
    clock = setInterval(() => { elapsed.value = Math.round((Date.now() - t0.value) / 1000) }, 1000)
    return
  }
  step.value = 'setup'
  sentResults.value = []
  focus.value = null
  if (!dealerships.value.length) await fetchDealerships().catch(() => {})
  if (props.batchId) {
    try {
      await bs.load(props.batchId)
      step.value = batch.value?.finished ? 'email' : 'scan'
      t0.value = new Date(batch.value?.createdAt || Date.now()).getTime()
      if (step.value === 'email') await goEmail()
      else if (batch.value?.paused) bs.watchBatch()
      else bs.drive()
    }
    catch { toast.error('Could not load that batch'); open.value = false; return }
  }
  else buildSetup()
  if (clock) clearInterval(clock)
  clock = setInterval(() => { elapsed.value = Math.round((Date.now() - t0.value) / 1000) }, 1000)
}, { immediate: true })
onBeforeUnmount(() => { if (clock) clearInterval(clock) })
function closeDialog() {
  if (driving.value) { closeAsk.value = true; return }
  open.value = false
}
function closeKeepRunning() { closeAsk.value = false; open.value = false; toast('Autopilot is on — crawling continues on our servers', { description: 'You can close this tab, shut the laptop or go offline. Open Batches any time to see where it is.', duration: 8000 }) }
async function closePause() { closeAsk.value = false; await bs.pause(); open.value = false; toast('Paused', { description: 'Each dealership saved the exact page it was on. Resume from Batches whenever you like — it continues from there.' }) }
async function closeCancel() { closeAsk.value = false; await bs.cancel(); open.value = false; toast('Batch cancelled', { description: 'Scanned dealerships keep their audits. Waiting ones were dropped.' }) }
const short = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
const ago = (iso?: string | null) => { try { return iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : '' } catch { return '' } }
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogContent class="mission fixed inset-2 z-50 flex flex-col overflow-hidden rounded-xl border border-emerald-500/30 bg-[#070b09] text-zinc-100 shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95" @escape-key-down="(e: Event) => { e.preventDefault(); closeDialog() }" @interact-outside="(e: Event) => e.preventDefault()" @open-auto-focus="(e: Event) => e.preventDefault()">
        <!-- Title bar -->
        <header class="relative z-10 shrink-0 h-14 flex items-center gap-4 px-4 border-b border-white/10 bg-[#0b100d]">
          <div class="flex items-center gap-3 min-w-0">
            <span class="relative size-9 rounded-xl bg-emerald-500/15 ring-1 ring-emerald-400/30 flex items-center justify-center"><Radar class="size-5 text-emerald-300" :class="driving && 'animate-pulse'" /><span v-if="driving" class="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-400 animate-ping" /></span>
            <div class="min-w-0 leading-tight">
              <DialogTitle class="text-sm font-semibold tracking-wide">Mission Control <span class="text-emerald-400/80 font-normal">· batch crawl &amp; outreach</span></DialogTitle>
              <DialogDescription class="text-[11px] text-zinc-400 truncate">{{ batch?.name || `${setupRows.length} dealership${setupRows.length === 1 ? '' : 's'} selected` }}</DialogDescription>
            </div>
          </div>
          <ol class="ml-4 hidden md:flex items-center gap-1" aria-label="Steps">
            <li v-for="(s, i) in STEPS" :key="s.key" class="flex items-center gap-1">
              <button type="button" class="inline-flex items-center gap-2 rounded-full px-3 h-8 text-xs font-medium transition-colors disabled:cursor-default" :class="step === s.key ? 'bg-emerald-500 text-black' : i < stepIndex ? 'text-emerald-300 hover:bg-white/5' : 'text-zinc-500'" :disabled="i > stepIndex || (s.key === 'scan' && !batch) || (s.key === 'sent' && !sentResults.length)" @click="step = s.key"><span class="size-5 rounded-full flex items-center justify-center text-[10px] font-bold" :class="step === s.key ? 'bg-black/20' : i < stepIndex ? 'bg-emerald-500/20' : 'bg-white/5'"><Check v-if="i < stepIndex" class="size-3" /><template v-else>{{ s.n }}</template></span>{{ s.label }}</button>
              <ChevronRight v-if="i < STEPS.length - 1" class="size-3.5 text-zinc-600" />
            </li>
          </ol>
          <div class="ml-auto flex items-center gap-2">
            <span v-if="batch" class="hidden lg:inline-flex items-center gap-1.5 font-mono text-xs text-zinc-400"><Clock class="size-3.5" /> {{ mmss(elapsed) }}</span>
            <Button variant="ghost" size="icon" class="size-8 text-zinc-300 hover:text-white hover:bg-white/10" aria-label="Close" @click="closeDialog"><X class="size-4" /></Button>
          </div>
        </header>

        <!-- ═══ 1. Pages ═══ -->
        <div v-if="step === 'setup'" class="relative flex-1 min-h-0 overflow-y-auto p-6">
          <div class="max-w-5xl mx-auto space-y-5">
            <div class="flex flex-wrap items-end gap-4">
              <div>
                <p class="text-[11px] font-semibold tracking-[0.2em] text-emerald-400">STEP 1 · PAGES</p>
                <h2 class="mt-1 text-2xl font-bold tracking-tight">Which pages should we read?</h2>
                <p class="mt-1 text-sm text-zinc-400 max-w-2xl">Each dealership's inventory pages (used, new, certified…). They're saved on the dealership, so next time this is one click. Every page is followed through all of its result pages, photos are checked, and the audit is saved to the CRM automatically.</p>
              </div>
              <div class="ml-auto flex items-center gap-3">
                <div class="text-xs text-zinc-400">Scan <Select v-model="concurrency"><SelectTrigger class="inline-flex h-8 w-16 ml-1 mr-1 bg-white/5 border-white/10 text-zinc-100"><SelectValue /></SelectTrigger><SelectContent><SelectItem :value="1">1</SelectItem><SelectItem :value="2">2</SelectItem><SelectItem :value="3">3</SelectItem></SelectContent></Select> at a time</div>
                <Button v-if="missingPages.length" variant="outline" class="h-10 gap-2 bg-transparent border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200" :disabled="detectingAll" @click="detectAll"><Loader2 v-if="detectingAll" class="size-4 animate-spin" /><Wand2 v-else class="size-4" /> Detect pages for {{ missingPages.length }}</Button>
                <Button class="h-10 gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-5" :disabled="starting || detectingAll || !ready.length" @click="start"><Loader2 v-if="starting" class="size-4 animate-spin" /><Play v-else class="size-4" /> Start crawling {{ ready.length }} dealership{{ ready.length === 1 ? '' : 's' }}<span v-if="setupRows.length - ready.length" class="ml-1 rounded bg-black/20 px-1.5 text-[11px] font-medium">{{ setupRows.length - ready.length }} skipped</span></Button>
              </div>
            </div>
            <div class="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
              <table class="w-full text-sm">
                <thead class="text-[10px] uppercase tracking-wider text-zinc-500 bg-white/[0.03]"><tr><th class="text-left font-medium px-4 py-2.5 w-10">#</th><th class="text-left font-medium px-3 py-2.5">Dealership</th><th class="text-left font-medium px-3 py-2.5">Pages to crawl</th><th class="px-3 py-2.5" /></tr></thead>
                <tbody class="divide-y divide-white/5">
                  <tr v-for="(r, i) in setupRows" :key="r.id" :class="!r.pages.length && !r.detecting && 'bg-amber-500/[0.04]'">
                    <td class="px-4 py-3 font-mono text-xs text-zinc-500">{{ String(i + 1).padStart(2, '0') }}</td>
                    <td class="px-3 py-3"><p class="font-medium">{{ r.name }}</p><p class="text-[11px] text-zinc-500">{{ r.website ? short(r.website) : 'No website — will be skipped' }}</p></td>
                    <td class="px-3 py-3">
                      <div class="flex flex-wrap gap-1.5">
                        <span v-for="p in r.pages" :key="p" class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/25 text-emerald-200 px-2 py-0.5 text-[11px] font-mono max-w-[320px] truncate" :title="p"><Globe class="size-3 shrink-0" />{{ short(p).replace(/^[^/]+/, '') || '/' }}</span>
                        <span v-if="r.detecting" class="inline-flex items-center gap-1.5 text-[11px] text-emerald-300"><Loader2 class="size-3 animate-spin" /> {{ r.detectNote || 'Looking for inventory pages…' }}</span>
                        <span v-else-if="!r.pages.length && r.bad" class="inline-flex items-center gap-1.5 text-[11px] text-rose-300"><AlertTriangle class="size-3" /> The saved scan page is not an inventory list ({{ r.bad.toLowerCase() }}) — never crawled. Detect or pick the inventory pages.</span>
                        <span v-else-if="!r.pages.length && r.website" class="inline-flex items-center gap-1.5 text-[11px] text-amber-300"><AlertTriangle class="size-3" /> No pages yet — will be skipped{{ r.detectNote ? ` · ${r.detectNote}` : '' }}</span>
                        <span v-else-if="!r.pages.length" class="text-[11px] text-zinc-500">—</span>
                        <span v-else-if="r.detectNote" class="text-[11px] text-zinc-500">{{ r.detectNote }}</span>
                      </div>
                    </td>
                    <td class="px-3 py-3 text-right whitespace-nowrap space-x-1.5">
                      <Button variant="outline" size="sm" class="h-7 gap-1.5 text-xs bg-transparent border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200" :disabled="!r.website || r.detecting || detectingAll" @click="detectFor(r)"><Wand2 class="size-3.5" /> {{ r.pages.length ? 'Re-detect' : 'Detect' }}</Button>
                      <Button variant="outline" size="sm" class="h-7 gap-1.5 text-xs bg-transparent border-white/15 text-zinc-200 hover:bg-white/10 hover:text-white" :disabled="!r.website || r.detecting" @click="editPages(r)"><Pencil class="size-3.5" /> {{ r.pages.length ? 'Edit' : 'Pick' }}</Button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="text-[11px] text-zinc-500 flex items-center gap-1.5"><Zap class="size-3.5 text-emerald-400" /> "Detect" opens the site in the cloud browser, finds its inventory menus (AI helps with odd wording), opens each candidate and keeps only pages that really list vehicles — then saves them on the dealership. Dealerships without pages are skipped, never scanned blind.</p>
          </div>
        </div>

        <!-- ═══ 2. Scan ═══ -->
        <div v-else-if="step === 'scan' && batch" class="relative flex-1 min-h-0 flex flex-col">
          <CrmBatchMatrixRain :opacity="driving ? 0.16 : 0.07" />
          <!-- KPI strip -->
          <div class="relative z-10 shrink-0 grid grid-cols-2 md:grid-cols-5 gap-px bg-white/5 border-b border-white/10">
            <div class="bg-[#070b09] px-4 py-3">
              <p class="text-[10px] uppercase tracking-wider text-zinc-500">Dealerships</p>
              <div class="mt-1 flex items-end gap-2"><p class="text-2xl font-bold tabular-nums leading-none">{{ batch.counts.done + batch.counts.stopped }}<span class="text-sm text-zinc-500 font-normal">/{{ batch.counts.total }}</span></p><span v-if="batch.counts.failed" class="text-[11px] text-rose-400 mb-0.5">{{ batch.counts.failed }} failed</span><span v-if="batch.counts.skipped" class="text-[11px] text-zinc-500 mb-0.5">{{ batch.counts.skipped }} skipped</span></div>
              <div class="mt-2 h-1 rounded-full bg-white/10 overflow-hidden"><div class="h-full bg-emerald-400 transition-all duration-700" :style="{ width: `${pct}%` }" /></div>
            </div>
            <div class="bg-[#070b09] px-4 py-3"><p class="text-[10px] uppercase tracking-wider text-zinc-500">Vehicles found</p><p class="mt-1 text-2xl font-bold tabular-nums leading-none">{{ batch.totals.vehicles.toLocaleString() }}</p><p class="mt-1.5 text-[11px] text-zinc-500 flex items-center gap-1"><Car class="size-3" /> across {{ batch.counts.done + batch.counts.stopped }} site{{ batch.counts.done + batch.counts.stopped === 1 ? '' : 's' }}</p></div>
            <div class="bg-[#070b09] px-4 py-3"><p class="text-[10px] uppercase tracking-wider text-zinc-500">Without a real photo</p><p class="mt-1 text-2xl font-bold tabular-nums leading-none text-rose-400">{{ batch.totals.withoutReal.toLocaleString() }}<span v-if="withoutPct !== null" class="text-sm font-semibold text-rose-400/70 ml-1.5">{{ withoutPct }}%</span></p><p class="mt-1.5 text-[11px] text-zinc-500 flex items-center gap-1"><ImageOff class="size-3" /> placeholders, no image, stock</p></div>
            <div class="bg-[#070b09] px-4 py-3"><p class="text-[10px] uppercase tracking-wider text-zinc-500">Right now</p><p class="mt-1 text-2xl font-bold tabular-nums leading-none text-emerald-300">{{ batch.counts.running }}<span class="text-sm text-zinc-500 font-normal"> crawling</span></p><p class="mt-1.5 text-[11px] text-zinc-500">{{ batch.counts.queued }} waiting · {{ concurrency }} at a time</p></div>
            <div class="bg-[#070b09] px-4 py-3 flex flex-col justify-between">
              <p class="text-[10px] uppercase tracking-wider text-zinc-500">{{ batch.finished ? 'Finished' : driving ? 'Running' : 'Paused' }}</p>
              <div class="flex flex-wrap gap-1.5 mt-1">
                <Button v-if="driving" size="sm" variant="outline" class="h-7 gap-1.5 text-xs bg-transparent border-white/15 text-zinc-100 hover:bg-white/10" @click="pause"><Pause class="size-3.5" /> Pause</Button>
                <Button v-else-if="!batch.finished" size="sm" class="h-7 gap-1.5 text-xs bg-emerald-500 hover:bg-emerald-400 text-black" @click="resume"><Play class="size-3.5" /> Resume</Button>
                <Button v-if="!batch.finished" size="sm" variant="ghost" class="h-7 gap-1.5 text-xs text-zinc-400 hover:text-rose-300 hover:bg-rose-500/10" @click="cancelAsk = true"><Square class="size-3 fill-current" /> Cancel rest</Button>
                <Button size="sm" class="h-7 gap-1.5 text-xs" :class="batch.finished ? 'bg-white text-black hover:bg-zinc-200' : 'bg-white/10 text-white hover:bg-white/20'" :disabled="!doneItems.length" @click="goEmail"><Mail class="size-3.5" /> Emails <span v-if="doneItems.length" class="rounded-full bg-black/20 px-1.5 text-[10px] tabular-nums">{{ doneItems.length }}</span></Button>
              </div>
            </div>
          </div>

          <!-- Autopilot / connection strip -->
          <div class="relative z-10 shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 border-b border-white/10 text-[11px]" :class="linkError ? 'bg-amber-500/10 text-amber-200' : 'bg-emerald-500/[0.06] text-emerald-200/80'">
            <span class="inline-flex items-center gap-1.5 font-semibold tracking-wide"><Cloud class="size-3.5" /> AUTOPILOT</span>
            <span v-if="linkError" class="inline-flex items-center gap-1.5"><WifiOff class="size-3.5" /> {{ linkError }}<span v-if="offlineFor > 5" class="text-amber-300/70">· {{ offlineFor }}s</span></span>
            <span v-else class="text-zinc-400">Runs on our servers — closing this window, sleep, a dead battery or no internet won't stop it.</span>
            <span class="ml-auto inline-flex items-center gap-1.5 text-zinc-400"><ShieldCheck class="size-3.5 text-emerald-400" /> Every result page is checkpointed · auto-retry on crashes</span>
          </div>

          <div class="relative z-10 flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
            <!-- Dealer rail -->
            <aside class="min-h-0 overflow-y-auto border-r border-white/10 bg-[#070b09]/80 backdrop-blur-sm">
              <ul class="divide-y divide-white/5">
                <li v-for="i in items" :key="i.dealershipId">
                  <button type="button" class="w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors" :class="focus === i.dealershipId && 'bg-emerald-500/10'" @click="focus = i.dealershipId">
                    <div class="flex items-center gap-2">
                      <component :is="STATUS[i.status]!.icon" class="size-4 shrink-0" :class="[STATUS[i.status]!.cls, i.status === 'running' && 'animate-spin']" />
                      <span class="text-sm font-medium truncate flex-1">{{ i.name }}</span>
                      <span v-if="i.summary" class="font-mono text-[11px] tabular-nums" :class="(i.summary.withoutRealPct || 0) >= 20 ? 'text-rose-300' : 'text-emerald-300'">{{ i.summary.withoutRealPct ?? 0 }}%</span>
                      <span v-else class="text-[10px] uppercase tracking-wider" :class="STATUS[i.status]!.cls">{{ STATUS[i.status]!.label }}</span>
                    </div>
                    <div v-if="i.status === 'running'" class="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden"><div class="h-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all duration-500" :style="{ width: `${itemPct(i)}%` }" /></div>
                    <p v-else-if="i.summary" class="mt-0.5 text-[11px] text-zinc-500 font-mono">{{ i.summary.total }} vehicles · {{ i.summary.withoutReal }} without photo{{ i.email ? ` · ${i.email.status}` : '' }}</p>
                    <p v-if="i.summary && i.error && i.status === 'stopped'" class="mt-0.5 text-[11px] leading-snug text-amber-300/90 line-clamp-2" :title="i.error">{{ i.error }}</p>
                    <p v-else-if="i.error" class="mt-0.5 text-[11px] leading-snug text-rose-400/80 line-clamp-2" :title="i.error">{{ i.error }}</p>
                    <p v-else-if="scopeIssue(i)" class="mt-0.5 text-[11px] leading-snug text-amber-300/90 line-clamp-2" :title="scopeIssue(i)">{{ scopeIssue(i) }}</p>
                    <p v-else class="mt-0.5 text-[11px] text-zinc-600 font-mono">{{ i.urls.length }} page{{ i.urls.length === 1 ? '' : 's' }}</p>
                  </button>
                </li>
              </ul>
            </aside>

            <!-- Consoles -->
            <section class="min-h-0 flex flex-col">
              <div class="flex-1 min-h-0 overflow-y-auto p-3">
                <!-- Focused finished / failed dealer -->
                <div v-if="focused && focused.status !== 'running' && focused.status !== 'queued'" class="mb-3 rounded-2xl border border-white/10 bg-[#0b100d]/90 backdrop-blur p-4">
                  <div class="flex flex-wrap items-center gap-3">
                    <component :is="STATUS[focused.status]!.icon" class="size-5" :class="STATUS[focused.status]!.cls" />
                    <div class="min-w-0 flex-1"><p class="font-semibold">{{ focused.name }}</p><p class="text-[11px] text-zinc-500">{{ STATUS[focused.status]!.label }}{{ focused.finishedAt ? ` · ${ago(focused.finishedAt)}` : '' }}{{ focused.error ? ` · ${focused.error}` : '' }}</p></div>
                    <div v-if="focused.summary" class="flex gap-5 font-mono text-sm">
                      <div><p class="text-[10px] uppercase tracking-wider text-zinc-500">Vehicles</p><p class="text-xl font-bold tabular-nums">{{ focused.summary.total }}</p></div>
                      <div><p class="text-[10px] uppercase tracking-wider text-zinc-500">No real photo</p><p class="text-xl font-bold tabular-nums text-rose-400">{{ focused.summary.withoutReal }} <span class="text-sm">({{ focused.summary.withoutRealPct ?? 0 }}%)</span></p></div>
                      <div v-if="focused.summary.by"><p class="text-[10px] uppercase tracking-wider text-zinc-500">Breakdown</p><p class="text-xs tabular-nums text-zinc-300 mt-1">{{ focused.summary.by.placeholder || 0 }} placeholder · {{ focused.summary.by.missing || 0 }} no image · {{ focused.summary.by.stock || 0 }} stock</p></div>
                    </div>
                    <div class="flex gap-1.5">
                      <Button v-if="focused.status === 'failed' || focused.status === 'cancelled' || focused.status === 'skipped'" size="sm" variant="outline" class="h-7 gap-1.5 text-xs bg-transparent border-white/15 text-zinc-100 hover:bg-white/10" :disabled="!focused.urls.length" @click="retry(focused)"><RotateCcw class="size-3.5" /> Retry</Button>
                      <Button as="a" :href="`/crm/dealership/${focused.dealershipId}?tab=audits`" target="_blank" size="sm" variant="outline" class="h-7 gap-1.5 text-xs bg-transparent border-white/15 text-zinc-100 hover:bg-white/10"><ExternalLink class="size-3.5" /> Open in CRM</Button>
                    </div>
                  </div>
                  <p v-if="focused.auditId && !rvDirty" class="mt-2 text-[11px] text-emerald-400/90 flex items-center gap-1.5"><CheckCircle2 class="size-3.5" /> Inventory audit saved — the email step uses these numbers.<button v-if="focusedScanId" type="button" class="ml-auto text-zinc-400 hover:text-white underline underline-offset-2" @click="showResults = !showResults">{{ showResults ? 'Hide results' : 'Review results' }}</button></p>
                </div>

                <!-- Full results: review + train, exactly like a single crawl -->
                <div v-if="focusedScanId && showResults" class="mb-3 rounded-2xl border border-white/10 overflow-hidden flex flex-col">
                  <div v-if="rvDirty" class="shrink-0 flex flex-wrap items-center gap-3 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 text-sm text-amber-100">
                    <Pencil class="size-4 text-amber-300" />
                    <span>You changed some verdicts — now <b class="tabular-nums">{{ rv.results.value!.summary.withoutReal }}</b> of {{ rv.results.value!.summary.total }} without a real photo ({{ rv.results.value!.summary.withoutRealPct ?? 0 }}%). Save to update the audit, report and emails.</span>
                    <Button size="sm" class="ml-auto h-8 gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold" :disabled="rvSaving" @click="saveCorrections"><Loader2 v-if="rvSaving" class="size-3.5 animate-spin" /><Check v-else class="size-3.5" /> Save corrections</Button>
                  </div>
                  <div class="dark h-[72vh] min-h-[520px] bg-background text-foreground">
                    <div v-if="rvLoading || !rv.results.value" class="h-full flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 class="size-4 animate-spin" /> Loading {{ focused?.name }}'s results…</div>
                    <CrmScannerResults v-else :results="rv.results.value" :review="rv.review" :list-rules="rv.listRules" :add-rule="rv.addRule" :remove-rule="rv.removeRule" />
                  </div>
                </div>

                <!-- Live consoles -->
                <div v-if="activeItems.length" class="grid gap-3" :class="activeItems.length > 1 ? 'xl:grid-cols-2' : ''">
                  <article v-for="i in activeItems" :key="i.dealershipId" class="rounded-2xl border border-emerald-500/25 bg-[#0b100d]/90 backdrop-blur overflow-hidden ring-1 ring-emerald-400/10">
                    <header class="flex items-center gap-2 px-3 py-2 border-b border-white/10">
                      <span class="relative flex size-2"><span class="absolute inline-flex size-full rounded-full bg-emerald-400 opacity-60 animate-ping" /><span class="relative inline-flex size-2 rounded-full bg-emerald-400" /></span>
                      <p class="text-sm font-semibold truncate">{{ i.name }}</p>
                      <span class="ml-auto font-mono text-[11px] text-emerald-300">{{ live[i.dealershipId]?.progress?.phase === 'analyzing' ? 'CHECKING PHOTOS' : 'COLLECTING' }}</span>
                      <span class="font-mono text-[11px] text-zinc-500">{{ mmss(Math.round((Date.now() - (live[i.dealershipId]?.startedAt || Date.now())) / 1000)) }}</span>
                    </header>
                    <div class="grid grid-cols-[180px_minmax(0,1fr)] gap-0">
                      <div class="relative aspect-[16/10] bg-zinc-900 border-r border-white/10 overflow-hidden">
                        <img v-if="live[i.dealershipId]?.frame" :src="live[i.dealershipId]!.frame!" alt="" class="size-full object-cover opacity-90">
                        <div v-else class="size-full flex items-center justify-center text-zinc-600"><Loader2 class="size-4 animate-spin" /></div>
                        <div class="pointer-events-none absolute inset-x-0 h-10 bg-gradient-to-b from-transparent via-emerald-400/20 to-transparent animate-[scanner-sweep_2.4s_linear_infinite]" />
                      </div>
                      <div class="p-3 min-w-0">
                        <div class="flex gap-4 font-mono">
                          <div><p class="text-[9px] uppercase tracking-wider text-zinc-500">Vehicles</p><p class="text-lg font-bold tabular-nums leading-none text-emerald-200">{{ live[i.dealershipId]?.progress?.vehicles || 0 }}<span v-if="live[i.dealershipId]?.progress?.advertised" class="text-xs text-zinc-500">/{{ live[i.dealershipId]!.progress!.advertised }}</span></p></div>
                          <div><p class="text-[9px] uppercase tracking-wider text-zinc-500">Page</p><p class="text-lg font-bold tabular-nums leading-none">{{ live[i.dealershipId]?.progress?.page || 1 }}</p></div>
                          <div v-if="i.urls.length > 1"><p class="text-[9px] uppercase tracking-wider text-zinc-500">Lists</p><p class="text-lg font-bold tabular-nums leading-none">{{ live[i.dealershipId]?.progress?.doneUrls?.length || 0 }}<span class="text-xs text-zinc-500">/{{ i.urls.length }}</span></p></div>
                          <div v-if="(i.attempts || 1) > 1"><p class="text-[9px] uppercase tracking-wider text-amber-500/80">Attempt</p><p class="text-lg font-bold tabular-nums leading-none text-amber-300">{{ i.attempts }}</p></div>
                          <div v-if="live[i.dealershipId]?.progress?.toAnalyze"><p class="text-[9px] uppercase tracking-wider text-zinc-500">Photos</p><p class="text-lg font-bold tabular-nums leading-none">{{ live[i.dealershipId]!.progress!.analyzed }}<span class="text-xs text-zinc-500">/{{ live[i.dealershipId]!.progress!.toAnalyze }}</span></p></div>
                        </div>
                        <div class="mt-2 h-1 rounded-full bg-white/10 overflow-hidden"><div class="h-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all duration-500" :style="{ width: `${itemPct(i)}%` }" /></div>
                        <ul class="mt-2 font-mono text-[11px] leading-5 text-emerald-300/80 h-[5.5rem] overflow-hidden flex flex-col justify-end">
                          <li v-for="(l, k) in (live[i.dealershipId]?.log || []).slice(-4)" :key="k" class="truncate"><span class="text-zinc-600">{{ clockText(new Date(l.at).getTime()) }}</span> {{ l.text }}</li>
                        </ul>
                      </div>
                    </div>
                  </article>
                </div>
                <div v-else-if="!batch.finished && !driving" class="rounded-2xl border border-dashed border-white/15 p-10 text-center text-zinc-400">
                  <Pause class="size-6 mx-auto mb-2" /> Paused — {{ batch.counts.queued }} dealership{{ batch.counts.queued === 1 ? '' : 's' }} waiting. <button type="button" class="text-emerald-300 hover:underline" @click="resume">Resume</button>
                </div>
                <div v-else-if="batch.finished && !doneItems.length" class="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6 text-center">
                  <AlertTriangle class="size-8 mx-auto text-rose-400" />
                  <p class="mt-2 text-lg font-semibold">Nothing was scanned</p>
                  <p class="text-sm text-zinc-400">{{ batch.counts.failed }} failed{{ batch.counts.skipped ? `, ${batch.counts.skipped} skipped` : '' }}{{ batch.counts.cancelled ? `, ${batch.counts.cancelled} cancelled` : '' }}. Pick a dealership on the left to see why — most often its inventory pages are not picked yet. Fix the pages, then press Retry.</p>
                </div>
                <div v-else-if="batch.finished" class="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
                  <CheckCircle2 class="size-8 mx-auto text-emerald-400" />
                  <p class="mt-2 text-lg font-semibold">All done — {{ batch.totals.vehicles.toLocaleString() }} vehicles checked across {{ doneItems.length }} dealership{{ doneItems.length === 1 ? '' : 's' }}</p>
                  <p class="text-sm text-zinc-400">{{ batch.totals.withoutReal.toLocaleString() }} without a real photo{{ withoutPct !== null ? ` (${withoutPct}%)` : '' }}.{{ batch.counts.failed ? ` ${batch.counts.failed} failed — see the left rail.` : '' }} Audits are saved. Pick a dealership on the left for details, or go to Emails.</p>
                  <Button class="mt-4 h-10 gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold" @click="goEmail"><Mail class="size-4" /> Continue to emails</Button>
                </div>
              </div>
              <!-- Activity stream -->
              <div ref="feedEl" class="shrink-0 h-36 overflow-y-auto border-t border-white/10 bg-black/60 backdrop-blur px-3 py-2 font-mono text-[11px] leading-5 [scrollbar-width:thin]">
                <p v-for="(f, k) in feed" :key="k" class="truncate"><span class="text-zinc-600">{{ clockText(f.at) }}</span> <span class="text-zinc-400">[{{ f.name.slice(0, 22) }}]</span> <span :class="FEED_CLS[f.kind]">{{ f.text }}</span></p>
                <p v-if="!feed.length" class="text-zinc-600">Waiting for the first scan to start…</p>
              </div>
            </section>
          </div>
        </div>

        <!-- ═══ 3. Emails ═══ -->
        <div v-else-if="step === 'email'" class="relative flex-1 min-h-0 overflow-y-auto p-6">
          <div class="max-w-6xl mx-auto space-y-5">
            <div class="flex flex-wrap items-end gap-4">
              <div>
                <p class="text-[11px] font-semibold tracking-[0.2em] text-emerald-400">STEP 3 · EMAILS</p>
                <h2 class="mt-1 text-2xl font-bold tracking-tight">Now the magic: one email per dealership, with its own numbers.</h2>
                <p class="mt-1 text-sm text-zinc-400 max-w-2xl">Pick one template for everyone or change it per dealership. Each email is filled with that dealership's fresh audit, goes through the normal CRM send (tracking, replies, A/B credit) and is stored exactly as sent.</p>
              </div>
            </div>
            <div v-if="loadingEmail" class="flex items-center gap-2 text-zinc-400 py-10 justify-center"><Loader2 class="size-4 animate-spin" /> Loading contacts and templates…</div>
            <template v-else>
              <div class="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex flex-wrap items-center gap-3">
                <Sparkles class="size-4 text-emerald-400" />
                <span class="text-sm font-medium">Template for everyone</span>
                <Select v-model="globalTemplate"><SelectTrigger class="h-9 w-72 bg-white/5 border-white/10 text-zinc-100"><SelectValue placeholder="Pick a template" /></SelectTrigger><SelectContent><SelectItem v-for="t in tplList" :key="t.id" :value="t.id">{{ t.name }} <span class="text-muted-foreground">· {{ t.category }}</span></SelectItem></SelectContent></Select>
                <Button variant="outline" size="sm" class="h-9 bg-transparent border-white/15 text-zinc-100 hover:bg-white/10" :disabled="!globalTemplate" @click="applyTemplateToAll">Apply to all</Button>
                <div class="ml-auto inline-flex rounded-lg border border-white/10 bg-white/5 p-0.5">
                  <button type="button" class="rounded-md px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5" :class="globalMode === 'now' ? 'bg-emerald-500 text-black' : 'text-zinc-400'" @click="globalMode = 'now'"><Send class="size-3.5" /> Send now</button>
                  <button type="button" class="rounded-md px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5" :class="globalMode === 'queue' ? 'bg-emerald-500 text-black' : 'text-zinc-400'" @click="globalMode = 'queue'"><Inbox class="size-3.5" /> Queue for sending hours</button>
                </div>
              </div>
              <div class="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                <table class="w-full text-sm">
                  <thead class="text-[10px] uppercase tracking-wider text-zinc-500 bg-white/[0.03]"><tr><th class="px-3 py-2.5 w-10" /><th class="text-left font-medium px-3 py-2.5">Dealership</th><th class="text-left font-medium px-3 py-2.5">Scan result</th><th class="text-left font-medium px-3 py-2.5">To</th><th class="text-left font-medium px-3 py-2.5">Template</th><th class="px-3 py-2.5" /></tr></thead>
                  <tbody class="divide-y divide-white/5">
                    <tr v-for="r in rows" :key="r.dealershipId" :class="!r.include && 'opacity-50'">
                      <td class="px-3 py-3"><Checkbox :model-value="r.include" :disabled="!dealerCtx(r.dealershipId)?.contacts.length" class="border-white/30 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500" @update:model-value="(v: any) => { r.include = !!v }" /></td>
                      <td class="px-3 py-3"><p class="font-medium">{{ r.name }}</p><p v-if="dealerCtx(r.dealershipId)?.lastEmail" class="text-[11px] flex items-center gap-1" :class="dealerCtx(r.dealershipId)!.lastEmail!.replied ? 'text-emerald-400' : 'text-amber-300/90'"><Mail class="size-3" /> Emailed {{ ago(dealerCtx(r.dealershipId)!.lastEmail!.sentAt) }}{{ dealerCtx(r.dealershipId)!.lastEmail!.replied ? ' · replied' : '' }}</p><p v-else class="text-[11px] text-zinc-500">Never emailed</p></td>
                      <td class="px-3 py-3 font-mono text-xs tabular-nums"><template v-if="items.find(i => i.dealershipId === r.dealershipId)?.summary"><span>{{ items.find(i => i.dealershipId === r.dealershipId)!.summary!.total }} vehicles</span> · <span class="text-rose-300">{{ items.find(i => i.dealershipId === r.dealershipId)!.summary!.withoutReal }} without ({{ items.find(i => i.dealershipId === r.dealershipId)!.summary!.withoutRealPct ?? 0 }}%)</span></template></td>
                      <td class="px-3 py-3">
                        <Select v-if="dealerCtx(r.dealershipId)?.contacts.length" :model-value="r.contactId || ''" @update:model-value="(v: any) => { r.contactId = v || null }"><SelectTrigger class="h-8 w-60 bg-white/5 border-white/10 text-zinc-100 text-xs"><SelectValue placeholder="Pick a contact" /></SelectTrigger><SelectContent><SelectItem v-for="c in dealerCtx(r.dealershipId)!.contacts" :key="c.id" :value="c.id" :disabled="c.doNotEmail || c.bounced">{{ c.name || c.email }} <span class="text-muted-foreground">· {{ c.title || c.email }}{{ c.doNotEmail ? ' · do not email' : c.bounced ? ' · bounced' : '' }}</span></SelectItem></SelectContent></Select>
                        <span v-else class="inline-flex items-center gap-1.5 text-xs text-amber-300"><Users class="size-3.5" /> No contact with an email — <a :href="`/crm/dealership/${r.dealershipId}?tab=contacts`" target="_blank" class="underline underline-offset-2">add one</a></span>
                      </td>
                      <td class="px-3 py-3">
                        <Select :model-value="r.templateId" @update:model-value="(v: any) => { r.templateId = v }"><SelectTrigger class="h-8 w-56 bg-white/5 border-white/10 text-zinc-100 text-xs" :class="r.templateId !== globalTemplate && 'border-emerald-500/50'"><SelectValue placeholder="Template" /></SelectTrigger><SelectContent><SelectItem v-for="t in tplList" :key="t.id" :value="t.id">{{ t.name }}</SelectItem></SelectContent></Select>
                      </td>
                      <td class="px-3 py-3 text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" class="h-7 gap-1.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10" :disabled="!r.templateId" @click="previewFor(r)"><Eye class="size-3.5" /> Preview</Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger as-child>
                            <Button variant="ghost" size="sm" class="h-7 gap-1 text-xs text-zinc-300 hover:text-white hover:bg-white/10" :disabled="!!pdfBusy" title="Download as PDF"><Loader2 v-if="pdfBusy?.endsWith(r.dealershipId)" class="size-3.5 animate-spin" /><FileDown v-else class="size-3.5" /> PDF <ChevronDown class="size-3 opacity-60" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" class="w-64">
                            <DropdownMenuItem :disabled="!r.templateId" @select="downloadPdf(emailPdfUrl(r), `email:${r.dealershipId}`)"><FileText class="size-4" /><div><p class="text-sm">This email</p><p class="text-[11px] text-muted-foreground">Filled for {{ r.name }} — not sent</p></div></DropdownMenuItem>
                            <DropdownMenuItem :disabled="!reportPdfUrl(r)" @select="downloadPdf(reportPdfUrl(r), `report:${r.dealershipId}`)"><FileBarChart class="size-4" /><div><p class="text-sm">Inventory report</p><p class="text-[11px] text-muted-foreground">{{ reportPdfUrl(r) ? 'Full findings, grouped by page' : 'No saved audit yet' }}</p></div></DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <label v-if="dealerCtx(r.dealershipId)?.lastEmail && !dealerCtx(r.dealershipId)!.lastEmail!.replied" class="ml-1 inline-flex items-center gap-1 text-[10px] text-zinc-500 cursor-pointer" title="Send even though this dealership was emailed recently"><Checkbox :model-value="r.allowDuplicate" class="size-3 border-white/30" @update:model-value="(v: any) => { r.allowDuplicate = !!v }" /> again</label>
                      </td>
                    </tr>
                    <tr v-if="!rows.length"><td colspan="6" class="px-4 py-10 text-center text-zinc-500">No finished scans yet.</td></tr>
                  </tbody>
                </table>
              </div>
              <div class="flex flex-wrap items-center gap-3">
                <p class="text-sm text-zinc-400"><b class="text-white tabular-nums">{{ toSend.length }}</b> email{{ toSend.length === 1 ? '' : 's' }} ready · {{ rows.filter(r => !dealerCtx(r.dealershipId)?.contacts.length).length }} without a contact</p>
                <Button class="ml-auto h-10 gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-5" :disabled="sending || !toSend.length" @click="sendAll"><Loader2 v-if="sending" class="size-4 animate-spin" /><component :is="globalMode === 'now' ? Send : Inbox" v-else class="size-4" /> {{ globalMode === 'now' ? `Send ${toSend.length} email${toSend.length === 1 ? '' : 's'} now` : `Queue ${toSend.length} email${toSend.length === 1 ? '' : 's'}` }}</Button>
              </div>
              <p class="text-[11px] text-zinc-500">"Queue" hands them to the approval queue already approved — the sender goes out inside your sending hours and daily limit. Duplicate protection: a dealership emailed in the last few days is skipped unless you tick "again".</p>
            </template>
          </div>
        </div>

        <!-- ═══ 4. Sent ═══ -->
        <div v-else-if="step === 'sent'" class="relative flex-1 min-h-0 overflow-y-auto p-6">
          <div class="max-w-4xl mx-auto space-y-5">
            <div>
              <p class="text-[11px] font-semibold tracking-[0.2em] text-emerald-400">STEP 4 · DONE</p>
              <h2 class="mt-1 text-2xl font-bold tracking-tight">{{ sentResults.filter(r => r.status !== 'failed').length }} of {{ sentResults.length }} emails {{ sentResults.some(r => r.status === 'queued') ? 'on their way' : 'sent' }}</h2>
              <p class="mt-1 text-sm text-zinc-400">Every email is stored exactly as sent. Replies land in CRM → Email → Replies and follow-ups are scheduled automatically.</p>
            </div>
            <ul class="rounded-2xl border border-white/10 bg-white/[0.03] divide-y divide-white/5">
              <li v-for="r in sentResults" :key="r.dealershipId" class="flex items-center gap-3 px-4 py-3 text-sm">
                <component :is="r.status === 'failed' ? AlertTriangle : r.status === 'queued' ? Inbox : CheckCircle2" class="size-4 shrink-0" :class="r.status === 'failed' ? 'text-rose-400' : 'text-emerald-400'" />
                <div class="min-w-0 flex-1"><p class="font-medium">{{ r.name }}</p><p class="text-[11px] text-zinc-500 truncate">{{ r.status === 'failed' ? r.error : `${r.subject} → ${r.to}` }}</p></div>
                <span class="text-[11px] uppercase tracking-wider" :class="r.status === 'failed' ? 'text-rose-400' : 'text-emerald-400'">{{ r.status }}</span>
                <Button v-if="r.emailId" variant="outline" size="sm" class="h-7 gap-1.5 text-xs bg-transparent border-white/15 text-zinc-100 hover:bg-white/10" @click="viewId = r.emailId; viewOpen = true"><Archive class="size-3.5" /> View as sent</Button>
                <Button v-else-if="r.status === 'queued'" as="a" href="/automations/approvals" target="_blank" variant="outline" size="sm" class="h-7 gap-1.5 text-xs bg-transparent border-white/15 text-zinc-100 hover:bg-white/10"><ExternalLink class="size-3.5" /> Queue</Button>
              </li>
            </ul>
            <div class="flex gap-2"><Button variant="outline" class="bg-transparent border-white/15 text-zinc-100 hover:bg-white/10" @click="step = 'email'">Back</Button><Button class="bg-white text-black hover:bg-zinc-200" @click="open = false">Close</Button></div>
          </div>
        </div>

        <!-- Email preview dialog -->
        <Dialog :open="!!previewRow" @update:open="(o: boolean) => { if (!o) previewRow = null }">
          <DialogContent class="sm:max-w-4xl max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col">
            <DialogHeader class="px-5 pt-5 pb-3 border-b"><DialogTitle class="text-base">{{ previewRow?.name }} — {{ tplList.find(t => t.id === previewRow?.templateId)?.name }}</DialogTitle><DialogDescription class="text-xs flex flex-wrap items-center gap-2"><span>Filled with this dealership's latest audit and contact — exactly what will be sent.</span><span v-if="previewRow" class="ml-auto flex gap-2"><Button v-if="reportPdfUrl(previewRow)" size="sm" variant="outline" class="h-7 gap-1.5 text-xs" :disabled="!!pdfBusy" @click="downloadPdf(reportPdfUrl(previewRow!), `report:${previewRow!.dealershipId}`)"><FileBarChart class="size-3.5" /> Report PDF</Button><Button size="sm" class="h-7 gap-1.5 text-xs" :disabled="!!pdfBusy || !previewRow.templateId" @click="downloadPdf(emailPdfUrl(previewRow!), `email:${previewRow!.dealershipId}`)"><Loader2 v-if="pdfBusy" class="size-3.5 animate-spin" /><FileDown v-else class="size-3.5" /> Download PDF</Button></span></DialogDescription></DialogHeader>
            <CrmEmailPreview v-model:device="previewDevice" class="flex-1 min-h-0 rounded-none border-0" :html="previewRendered?.html || ''" :subject="previewRendered?.subject" :preheader="previewRendered?.preheader" :from="previewCtx?.from" :to="previewCtx?.to" :loading="previewLoading" max-height="calc(92vh - 110px)" />
          </DialogContent>
        </Dialog>
        <!-- Close while running -->
        <Dialog v-model:open="closeAsk">
          <DialogContent class="sm:max-w-md">
            <DialogHeader>
              <DialogTitle class="flex items-center gap-2"><DoorOpen class="size-4 text-emerald-600" /> Crawls are still running</DialogTitle>
              <DialogDescription>{{ batch?.counts.running || 0 }} crawling now, {{ batch?.counts.queued || 0 }} waiting. Everything found so far is already saved — choose what happens next.</DialogDescription>
            </DialogHeader>
            <div class="grid gap-2">
              <button type="button" class="rounded-xl border p-3 text-left hover:bg-accent/60 transition-colors" @click="closeKeepRunning">
                <p class="text-sm font-semibold flex items-center gap-2"><Zap class="size-4 text-emerald-600" /> Keep running on autopilot <span class="rounded-full bg-emerald-500/15 px-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">Recommended</span></p>
                <p class="text-xs text-muted-foreground mt-0.5">Scanning runs on our servers, not in this browser. Close the tab, shut the laptop or lose Wi-Fi — it carries on, and every page is checkpointed.</p>
              </button>
              <button type="button" class="rounded-xl border p-3 text-left hover:bg-accent/60 transition-colors" @click="closePause">
                <p class="text-sm font-semibold flex items-center gap-2"><Pause class="size-4 text-amber-600" /> Pause and close</p>
                <p class="text-xs text-muted-foreground mt-0.5">Running scans stop and keep their vehicles. Resume any time from Batches — they continue where they left off.</p>
              </button>
              <button type="button" class="rounded-xl border border-rose-500/30 p-3 text-left hover:bg-rose-500/5 transition-colors" @click="closeCancel">
                <p class="text-sm font-semibold flex items-center gap-2 text-rose-600"><Ban class="size-4" /> Cancel the rest</p>
                <p class="text-xs text-muted-foreground mt-0.5">Drop the waiting dealerships. Finished audits stay in the CRM.</p>
              </button>
            </div>
            <DialogFooter><Button variant="ghost" @click="closeAsk = false">Keep watching</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <!-- Cancel the rest -->
        <Dialog v-model:open="cancelAsk">
          <DialogContent class="sm:max-w-md">
            <DialogHeader>
              <DialogTitle class="flex items-center gap-2"><Ban class="size-4 text-rose-600" /> Cancel the waiting dealerships?</DialogTitle>
              <DialogDescription>{{ batch?.counts.queued || 0 }} waiting will be dropped. Running scans stop and keep what they found; finished audits stay in the CRM. You can still email the finished ones.</DialogDescription>
            </DialogHeader>
            <DialogFooter class="gap-2"><Button variant="ghost" @click="cancelAsk = false">Keep going</Button><Button variant="destructive" @click="cancelAll">Cancel the rest</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <CrmScanPagesEditor v-model:open="showPages" :dealership="editing" @saved="pagesSaved" />
        <CrmEmailSentViewer v-model:open="viewOpen" :email-id="viewId" />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
.mission { color-scheme: dark; }
@keyframes scanner-sweep { 0% { top: -2.5rem } 100% { top: 100% } }
</style>
