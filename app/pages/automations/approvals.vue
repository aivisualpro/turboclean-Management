<script setup lang="ts">
import type { OutreachDraft, ReplyToConfirm } from '~/composables/useAutomations'
import { REPLY_CATEGORY_STYLE, ago } from '~/composables/useAutomations'
import {
  Inbox, MessageSquareReply, RefreshCw, Loader2, Send, Pencil, SkipForward, CheckCircle2, AlertTriangle, Sparkles, FileText,
  Clock, Mail, ExternalLink, ChevronDown, X, Check, Bot,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * Approval queue — automation 8. Nothing reaches a dealership until someone approves it here.
 * Tab 2 is the reply inbox (automation 11): each reply comes with a suggested classification;
 * one click confirms it and the CRM does the rest (next action, stop follow-ups, opt-out).
 */
const { setHeader } = usePageHeader()
setHeader({ title: 'Approval Queue', description: 'Automations · approve outreach before it goes out, confirm what replies mean', icon: 'i-lucide-inbox' })

const route = useRoute()
const router = useRouter()
const { loadDrafts, updateDraft, approveDraft, rejectDraft, bulkDrafts, loadReplies, confirmReply, loadOverview, overview } = useAutomations()
const { isActionAllowed } = usePermissions()
const canEdit = computed(() => isActionAllowed('automations', 'Edit'))

const tab = ref<'drafts' | 'replies'>(route.query.tab === 'replies' ? 'replies' : 'drafts')
const status = ref<string>(typeof route.query.status === 'string' ? route.query.status : 'pending')
watch([tab, status], () => {
  router.replace({ query: { ...(tab.value === 'replies' ? { tab: 'replies' } : {}), ...(tab.value === 'drafts' && status.value !== 'pending' ? { status: status.value } : {}) } })
  setHeader({ title: 'Approval Queue', description: 'Automations · approve outreach before it goes out, confirm what replies mean', icon: 'i-lucide-inbox' })
})

// ── Drafts ──
const drafts = ref<OutreachDraft[]>([])
const counts = ref<Record<string, number>>({})
const loading = ref(false)
async function reloadDrafts() {
  loading.value = true
  try { const r = await loadDrafts(status.value); drafts.value = r.drafts; counts.value = r.counts }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not load drafts') }
  finally { loading.value = false }
}
// ── Replies ──
const replies = ref<ReplyToConfirm[]>([])
const categories = ref<Record<string, { label: string, sentiment: string }>>({})
const accuracy = ref<Record<string, { n: number, agreed: number, pct: number | null }>>({})
async function reloadReplies() {
  loading.value = true
  try { const r = await loadReplies(); replies.value = r.replies; categories.value = r.categories; accuracy.value = r.accuracy }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not load replies') }
  finally { loading.value = false }
}
async function reload() { await Promise.all([tab.value === 'drafts' ? reloadDrafts() : reloadReplies(), loadOverview().catch(() => {})]) }
watch(status, reloadDrafts)
watch(tab, reload)
onMounted(reload)

const STATUSES = [
  { key: 'pending', label: 'To approve' }, { key: 'approved', label: 'Approved · waiting' }, { key: 'failed', label: 'Failed' },
  { key: 'sent', label: 'Sent' }, { key: 'rejected', label: 'Skipped' }, { key: 'cancelled', label: 'Stopped' },
]
const SKIP_REASONS = ['Not a good fit', 'Wrong contact', 'Bad timing', 'Already talking to them', 'Message needs work']

const selected = ref<Set<string>>(new Set())
const toggleSel = (id: string) => { const s = new Set(selected.value); s.has(id) ? s.delete(id) : s.add(id); selected.value = s }
const allSelected = computed(() => drafts.value.length > 0 && drafts.value.every(d => selected.value.has(d.id)))
const toggleAll = () => { selected.value = allSelected.value ? new Set() : new Set(drafts.value.map(d => d.id)) }
watch(drafts, () => { selected.value = new Set([...selected.value].filter(id => drafts.value.some(d => d.id === id))) })

const busy = ref<string | null>(null)
async function approve(d: OutreachDraft, sendNow = false) {
  busy.value = d.id
  try {
    const r = await approveDraft(d.id, sendNow)
    r.sent ? toast.success(r.message, { description: d.dealershipName }) : (r.draft?.status === 'failed' ? toast.error(r.message) : toast.info(r.message))
    await reload()
  }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not approve') }
  finally { busy.value = null }
}
async function skip(d: OutreachDraft, reason: string) {
  busy.value = d.id
  try { await rejectDraft(d.id, reason); toast.success(`Skipped — ${d.dealershipName}`); await reload() }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not skip') }
  finally { busy.value = null }
}
const bulkBusy = ref(false)
async function bulk(action: 'approve' | 'reject', reason = '') {
  const ids = [...selected.value]
  if (!ids.length) return
  if (action === 'approve' && !confirm(`Approve ${ids.length} email${ids.length === 1 ? '' : 's'}? They go out inside sending hours, up to the daily limit.`)) return
  bulkBusy.value = true
  try {
    const r = await bulkDrafts(ids, action, reason)
    toast.success(action === 'approve' ? `${r.sent} sent, ${r.queued} queued for sending hours${r.failed ? `, ${r.failed} failed` : ''}` : `${ids.length} skipped`)
    selected.value = new Set()
    await reload()
  }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Bulk action failed') }
  finally { bulkBusy.value = false }
}

// Edit
const editing = ref<string | null>(null)
const edit = ref({ subject: '', body: '' })
function startEdit(d: OutreachDraft) {
  editing.value = d.id
  // HTML templates are edited as plain text (the designed version is kept only when sent unchanged).
  const tmp = typeof document !== 'undefined' ? document.createElement('div') : null
  let text = d.body
  if (!text && tmp) { tmp.innerHTML = d.previewHtml; text = (tmp.innerText || '').replace(/\n{3,}/g, '\n\n').trim() }
  edit.value = { subject: d.subject, body: text }
}
async function saveEdit(d: OutreachDraft, thenApprove = false) {
  busy.value = d.id
  try {
    await updateDraft(d.id, { subject: edit.value.subject, body: edit.value.body })
    editing.value = null
    if (thenApprove) await approve(d)
    else { toast.success('Draft updated'); await reloadDrafts() }
  }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save') }
  finally { busy.value = null }
}

const expanded = ref<Set<string>>(new Set())
const toggleExpand = (id: string) => { const s = new Set(expanded.value); s.has(id) ? s.delete(id) : s.add(id); expanded.value = s }
const frameDoc = (html: string) => `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:12px;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#111}</style></head><body>${html}</body></html>`
const kindLabel = (d: OutreachDraft) => d.kind === 'follow_up' ? `Follow-up #${d.followUpNumber}` : 'First email'

// ── Replies ──
const confirming = ref<string | null>(null)
async function confirmAs(r: ReplyToConfirm, category: string) {
  confirming.value = r.id
  try {
    const res = await confirmReply(r.id, category)
    toast.success(`Confirmed: ${categories.value[category]?.label || category}`, { description: res.effects.join(' · ') || r.dealershipName })
    replies.value = replies.value.filter(x => x.id !== r.id)
    loadOverview().catch(() => {})
  }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not confirm') }
  finally { confirming.value = null }
}
const accuracyLine = computed(() => {
  const parts = Object.entries(accuracy.value).filter(([, v]) => v.n).map(([k, v]) => `${k === 'ai' ? 'AI' : 'Rules'}: right ${v.pct}% of ${v.n}`)
  return parts.join(' · ')
})
</script>

<template>
  <div class="space-y-4">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <Button variant="outline" size="icon" class="size-8" aria-label="Refresh" :disabled="loading" @click="reload"><RefreshCw class="size-4" :class="loading && 'animate-spin'" /></Button>
      </Teleport>
    </ClientOnly>

    <!-- Tabs -->
    <div class="flex flex-wrap items-center gap-2">
      <div role="tablist" class="inline-flex rounded-lg border bg-muted/40 p-0.5">
        <button type="button" role="tab" :aria-selected="tab === 'drafts'" class="rounded-md px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5" :class="tab === 'drafts' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'" @click="tab = 'drafts'">
          <Inbox class="size-4" /> Emails to approve <span class="rounded-full px-1.5 py-0.5 text-[10px] tabular-nums leading-none font-semibold bg-background/80 text-foreground">{{ overview?.needsYou.draftsPending ?? counts.pending ?? 0 }}</span>
        </button>
        <button type="button" role="tab" :aria-selected="tab === 'replies'" class="rounded-md px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5" :class="tab === 'replies' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'" @click="tab = 'replies'">
          <MessageSquareReply class="size-4" /> Replies to confirm <span class="rounded-full px-1.5 py-0.5 text-[10px] tabular-nums leading-none font-semibold bg-background/80 text-foreground">{{ overview?.needsYou.repliesToConfirm ?? replies.length }}</span>
        </button>
      </div>
      <span v-if="overview && tab === 'drafts'" class="ml-auto text-[11px] text-muted-foreground hidden md:inline">
        {{ overview.sending.sentToday }}/{{ overview.sending.limit }} sent today · {{ overview.sending.inWindow ? 'sending hours now' : `next sending window ${overview.sending.nextWindow}` }}
      </span>
    </div>

    <!-- ───────── DRAFTS ───────── -->
    <template v-if="tab === 'drafts'">
      <div class="flex flex-wrap items-center gap-2">
        <button v-for="s in STATUSES" :key="s.key" type="button" class="rounded-full border px-3 py-1 text-xs inline-flex items-center gap-1.5" :class="status === s.key ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'" @click="status = s.key">
          {{ s.label }} <span class="tabular-nums opacity-70">{{ counts[s.key] || 0 }}</span>
        </button>
        <div v-if="status === 'pending' && drafts.length && canEdit" class="ml-auto flex items-center gap-2">
          <label class="text-xs inline-flex items-center gap-1.5 cursor-pointer"><Checkbox :model-value="allSelected" @update:model-value="toggleAll" /> Select all</label>
          <Button size="sm" class="h-8 gap-1.5" :disabled="!selected.size || bulkBusy" @click="bulk('approve')"><Loader2 v-if="bulkBusy" class="size-3.5 animate-spin" /><Send v-else class="size-3.5" /> Approve {{ selected.size || '' }}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child><Button size="sm" variant="outline" class="h-8 gap-1.5" :disabled="!selected.size || bulkBusy"><SkipForward class="size-3.5" /> Skip</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuItem v-for="r in SKIP_REASONS" :key="r" @click="bulk('reject', r)">{{ r }}</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div v-if="loading && !drafts.length" class="flex items-center justify-center py-20 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Loading…</div>
      <div v-else-if="!drafts.length" class="rounded-xl border bg-card px-6 py-14 text-center space-y-2">
        <CheckCircle2 class="size-8 text-emerald-500 mx-auto" />
        <p class="text-sm font-medium">{{ status === 'pending' ? 'Nothing waiting for approval' : 'Nothing here' }}</p>
        <p v-if="status === 'pending'" class="text-xs text-muted-foreground max-w-md mx-auto">Drafts appear here automatically for dealerships that are researched, audited and have a contact with an email — plus follow-ups when someone doesn’t reply.</p>
      </div>

      <div v-else class="space-y-3">
        <article v-for="d in drafts" :key="d.id" class="rounded-xl border bg-card overflow-hidden" :class="selected.has(d.id) && 'ring-2 ring-primary/40'">
          <header class="px-4 py-3 border-b flex flex-wrap items-start gap-3">
            <Checkbox v-if="d.status === 'pending' && canEdit" class="mt-1" :model-value="selected.has(d.id)" @update:model-value="toggleSel(d.id)" />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <NuxtLink :to="`/crm/dealership/${d.dealershipId}`" class="text-sm font-semibold hover:underline">{{ d.dealershipName }}</NuxtLink>
                <span class="text-[11px] text-muted-foreground">{{ d.dealershipCode }} · {{ d.stage }}</span>
                <span class="rounded-full px-2 py-0.5 text-[10px] font-medium" :class="d.kind === 'follow_up' ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300' : 'bg-primary/10 text-primary'">{{ kindLabel(d) }}</span>
                <span v-if="d.writtenBy === 'ai'" class="rounded-full px-2 py-0.5 text-[10px] font-medium bg-violet-500/15 text-violet-700 dark:text-violet-300 inline-flex items-center gap-1"><Sparkles class="size-3" /> AI-personalized</span>
                <span v-else-if="d.templateName" class="rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground inline-flex items-center gap-1"><FileText class="size-3" /> {{ d.templateName }} {{ d.templateVersionLabel }}{{ d.subjectVariant ? ` · ${d.subjectVariant}` : '' }}</span>
                <span v-if="d.edited" class="rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-300">Edited</span>
                <span v-if="d.priorityScore != null" class="rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums bg-rose-500/10 text-rose-700 dark:text-rose-300" title="Priority score">{{ d.priorityScore }}</span>
              </div>
              <p class="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5"><Mail class="size-3.5" /> {{ d.contactName || 'Contact' }}<span v-if="d.contactRole"> · {{ d.contactRole }}</span> · {{ d.toEmail }}</p>
              <div v-if="d.why?.length" class="mt-1.5 flex flex-wrap gap-1">
                <span v-for="w in d.why" :key="w" class="rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">{{ w }}</span>
              </div>
            </div>
            <span class="text-[11px] text-muted-foreground whitespace-nowrap">{{ d.status === 'sent' ? `Sent ${ago(d.sentAt)}` : `Drafted ${ago(d.createdAt)}` }}</span>
          </header>

          <!-- Status notes -->
          <p v-if="d.status === 'failed' && d.error" class="px-4 py-2 text-xs bg-rose-500/10 text-rose-700 dark:text-rose-300 flex items-start gap-1.5"><AlertTriangle class="size-3.5 mt-0.5 shrink-0" /> Not sent: {{ d.error }}</p>
          <p v-if="d.status === 'approved'" class="px-4 py-2 text-xs bg-sky-500/10 text-sky-700 dark:text-sky-300 flex items-start gap-1.5"><Clock class="size-3.5 mt-0.5 shrink-0" /> Approved by {{ d.approvedBy?.name || 'you' }} — {{ d.queuedNote || 'waiting for sending hours' }}</p>
          <p v-if="d.status === 'cancelled'" class="px-4 py-2 text-xs bg-muted text-muted-foreground flex items-start gap-1.5"><Bot class="size-3.5 mt-0.5 shrink-0" /> Stopped automatically: {{ d.cancelledReason }}</p>
          <p v-if="d.status === 'rejected'" class="px-4 py-2 text-xs bg-muted text-muted-foreground">Skipped: {{ d.rejectReason }}</p>
          <p v-if="d.missingFields?.length && d.status === 'pending'" class="px-4 py-2 text-xs bg-amber-500/10 text-amber-700 dark:text-amber-300 flex items-start gap-1.5"><AlertTriangle class="size-3.5 mt-0.5 shrink-0" /> Blank in this email: {{ d.missingFields.join(', ') }}</p>

          <!-- Preview / editor -->
          <div v-if="editing === d.id" class="px-4 py-3 space-y-2.5">
            <div class="space-y-1"><Label :for="`subj-${d.id}`" class="text-xs">Subject</Label><Input :id="`subj-${d.id}`" v-model="edit.subject" /></div>
            <div class="space-y-1">
              <Label :for="`body-${d.id}`" class="text-xs">Message</Label>
              <Textarea :id="`body-${d.id}`" v-model="edit.body" rows="12" class="text-sm font-mono" />
              <p v-if="d.format === 'html'" class="text-[11px] text-muted-foreground">Editing sends a plain-text email (the designed template is only used when sent unchanged). It is recorded as personalized.</p>
            </div>
            <div class="flex justify-end gap-2">
              <Button size="sm" variant="ghost" @click="editing = null"><X class="size-3.5 mr-1" /> Cancel</Button>
              <Button size="sm" variant="outline" :disabled="busy === d.id" @click="saveEdit(d)">Save</Button>
              <Button size="sm" :disabled="busy === d.id" @click="saveEdit(d, true)"><Send class="size-3.5 mr-1" /> Save & approve</Button>
            </div>
          </div>
          <div v-else class="px-4 py-3 space-y-2">
            <p class="text-sm"><span class="text-muted-foreground text-xs mr-1">Subject</span><span class="font-medium">{{ d.subject }}</span></p>
            <div class="relative rounded-lg border bg-white overflow-hidden" :class="expanded.has(d.id) ? '' : 'max-h-[260px]'">
              <iframe :srcdoc="frameDoc(d.previewHtml)" sandbox="allow-popups" class="w-full block" :style="{ height: expanded.has(d.id) ? '720px' : '260px' }" :title="`Preview of the email to ${d.dealershipName}`" />
            </div>
            <button type="button" class="text-[11px] text-primary inline-flex items-center gap-1" @click="toggleExpand(d.id)">{{ expanded.has(d.id) ? 'Show less' : 'Show the whole email' }} <ChevronDown class="size-3 transition-transform" :class="expanded.has(d.id) && 'rotate-180'" /></button>
          </div>

          <!-- Actions -->
          <footer v-if="canEdit && editing !== d.id && ['pending', 'failed', 'approved'].includes(d.status)" class="px-4 py-2.5 border-t bg-muted/20 flex flex-wrap items-center gap-2">
            <Button v-if="d.status !== 'approved'" size="sm" class="h-8 gap-1.5" :disabled="busy === d.id" @click="approve(d)">
              <Loader2 v-if="busy === d.id" class="size-3.5 animate-spin" /><Send v-else class="size-3.5" /> {{ d.status === 'failed' ? 'Try again' : (overview?.sending.inWindow ? 'Approve & send' : 'Approve') }}
            </Button>
            <Button v-if="d.status === 'approved' || (d.status === 'pending' && overview && !overview.sending.inWindow)" size="sm" :variant="d.status === 'approved' ? 'default' : 'outline'" class="h-8 gap-1.5" :disabled="busy === d.id" @click="approve(d, true)"><Send class="size-3.5" /> Send now</Button>
            <Button v-if="d.status !== 'approved'" size="sm" variant="outline" class="h-8 gap-1.5" @click="startEdit(d)"><Pencil class="size-3.5" /> Edit</Button>
            <DropdownMenu>
              <DropdownMenuTrigger as-child><Button size="sm" variant="ghost" class="h-8 gap-1.5 text-muted-foreground"><SkipForward class="size-3.5" /> Skip</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem v-for="r in SKIP_REASONS" :key="r" @click="skip(d, r)">{{ r }}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span v-if="d.kind === 'follow_up'" class="ml-auto text-[11px] text-muted-foreground">Skipping a follow-up ends this sequence.</span>
          </footer>
          <footer v-else-if="d.status === 'sent'" class="px-4 py-2.5 border-t bg-muted/20 text-xs text-muted-foreground flex items-center gap-2">
            <CheckCircle2 class="size-3.5 text-emerald-500" /> Sent{{ d.approvedBy ? ` · approved by ${d.approvedBy.name}` : '' }}
            <NuxtLink :to="`/crm/dealership/${d.dealershipId}?tab=emails`" class="ml-auto text-primary inline-flex items-center gap-1">Open emails <ExternalLink class="size-3" /></NuxtLink>
          </footer>
        </article>
      </div>
    </template>

    <!-- ───────── REPLIES ───────── -->
    <template v-else>
      <p v-if="accuracyLine" class="text-[11px] text-muted-foreground">Suggestion accuracy so far — {{ accuracyLine }}</p>
      <div v-if="loading && !replies.length" class="flex items-center justify-center py-20 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Loading…</div>
      <div v-else-if="!replies.length" class="rounded-xl border bg-card px-6 py-14 text-center space-y-2">
        <CheckCircle2 class="size-8 text-emerald-500 mx-auto" />
        <p class="text-sm font-medium">Every reply is confirmed</p>
        <p class="text-xs text-muted-foreground">New replies are read within about 5 minutes and wait here with a suggested meaning.</p>
      </div>
      <div v-else class="space-y-3">
        <article v-for="r in replies" :key="r.id" class="rounded-xl border bg-card overflow-hidden">
          <header class="px-4 py-3 border-b flex flex-wrap items-start gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <NuxtLink v-if="r.dealershipId" :to="`/crm/dealership/${r.dealershipId}?tab=emails`" class="text-sm font-semibold hover:underline">{{ r.dealershipName }}</NuxtLink>
                <NuxtLink v-else to="/crm/email" class="text-sm font-semibold text-amber-600 hover:underline">Not matched to a dealership — attach it in CRM → Email → Replies</NuxtLink>
              </div>
              <p class="text-xs text-muted-foreground">{{ r.fromName || r.contactName || r.fromEmail }} &lt;{{ r.fromEmail }}&gt; · {{ r.subject }}</p>
            </div>
            <span class="text-[11px] text-muted-foreground whitespace-nowrap">{{ ago(r.receivedAt) }}</span>
          </header>
          <div class="px-4 py-3 space-y-3">
            <p class="text-sm whitespace-pre-line" :class="!expanded.has(r.id) && 'line-clamp-5'">{{ expanded.has(r.id) ? r.bodyText : (r.snippet || r.bodyText) }}</p>
            <button v-if="(r.bodyText || '').length > (r.snippet || '').length" type="button" class="text-[11px] text-primary" @click="toggleExpand(r.id)">{{ expanded.has(r.id) ? 'Show less' : 'Show the full email' }}</button>
            <div v-if="r.aiSuggestion" class="rounded-lg border bg-muted/30 px-3 py-2.5 space-y-1">
              <p class="text-xs flex flex-wrap items-center gap-2">
                <span class="inline-flex items-center gap-1 text-muted-foreground"><Sparkles v-if="r.aiSuggestion.by === 'ai'" class="size-3.5 text-violet-500" /><Bot v-else class="size-3.5" /> Suggested</span>
                <span class="rounded-full px-2 py-0.5 text-[11px] font-medium" :class="REPLY_CATEGORY_STYLE[r.aiSuggestion.category]">{{ r.aiSuggestion.label }}</span>
                <span v-if="r.aiSuggestion.confidence != null" class="text-[10px] text-muted-foreground">{{ Math.round(r.aiSuggestion.confidence * 100) }}% sure</span>
                <span v-if="r.aiSuggestion.by === 'rules'" class="text-[10px] text-muted-foreground">({{ r.aiSuggestion.reason }})</span>
              </p>
              <p v-if="r.aiSuggestion.summary" class="text-xs">{{ r.aiSuggestion.summary }}</p>
              <p class="text-xs text-muted-foreground">Next: <span class="text-foreground">{{ r.aiSuggestion.nextAction }}</span><span v-if="r.aiSuggestion.returnDate"> · back {{ r.aiSuggestion.returnDate }}</span><span v-if="r.aiSuggestion.referralName"> · referred to {{ r.aiSuggestion.referralName }}{{ r.aiSuggestion.referralEmail ? ` (${r.aiSuggestion.referralEmail})` : '' }}</span></p>
            </div>
            <p v-else class="text-[11px] text-muted-foreground">Not read yet — pick what it is.</p>
          </div>
          <footer v-if="canEdit" class="px-4 py-2.5 border-t bg-muted/20 flex flex-wrap items-center gap-1.5">
            <Button v-if="r.aiSuggestion" size="sm" class="h-8 gap-1.5" :disabled="confirming === r.id" @click="confirmAs(r, r.aiSuggestion.category)">
              <Loader2 v-if="confirming === r.id" class="size-3.5 animate-spin" /><Check v-else class="size-3.5" /> Confirm: {{ r.aiSuggestion.label }}
            </Button>
            <span class="text-[11px] text-muted-foreground mx-1">{{ r.aiSuggestion ? 'or it is:' : 'It is:' }}</span>
            <button v-for="(c, key) in categories" v-show="key !== r.aiSuggestion?.category" :key="key" type="button" class="rounded-full px-2 py-0.5 text-[11px] font-medium hover:ring-1 hover:ring-foreground/20 disabled:opacity-50" :class="REPLY_CATEGORY_STYLE[key]" :disabled="confirming === r.id" @click="confirmAs(r, String(key))">{{ c.label }}</button>
          </footer>
        </article>
      </div>
    </template>
  </div>
</template>
