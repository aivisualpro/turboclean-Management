<script setup lang="ts">
import type { CrmActivity, CrmAudit, CrmContact, CrmDealership, CrmInteraction, CrmStageChange, CrmStageDurations } from '~/composables/useCrmDealerships'
import { dueState, formatDuration, localDay, verificationState } from '~/composables/useCrmDealerships'
import type { CrmEmail } from '~/composables/useCrmEmail'
import { NURTURE_STAGE, OPEN_STAGES, QUEUE_STAGES } from '~/constants/crm'
import {
  ArrowLeft, Pencil, MoreHorizontal, Archive, ArchiveRestore, Users, UserPlus, History,
  Building2, ShieldAlert, Trash2, ShieldCheck, ChevronDown, ExternalLink, Copy, Tag, Store, Trophy, Briefcase, ClipboardCheck, ImageOff, GitBranch, MessageSquarePlus, Target, Mail as MailIcon, ScanSearch, ChevronRight,
} from 'lucide-vue-next'
// Separate binding for the header (inside <ClientOnly>): Nuxt drops imports used only there from the SSR build,
// which would also remove the one the tabs computed needs.
import { Mail as MailHeaderIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format, formatDistanceToNow } from 'date-fns'
import { DEALERSHIP_STAGES, STAGE_STYLE, WON_STAGE } from '~/constants/crm'

// Record page: overview, relationship history, emails, pipeline, contacts, audits.
const route = useRoute()
const router = useRouter()
const id = route.params.id as string
const { setHeader } = usePageHeader()
const { fetchDealershipRecord, updateDealership, updateContact, deleteDealership } = useCrmDealerships()
const { isActionAllowed } = usePermissions()
const canEdit = computed(() => isActionAllowed('crm_dealership', 'Edit'))
const canDelete = computed(() => isActionAllowed('crm_dealership', 'Delete'))

const { data, pending, error, refresh } = await useAsyncData(`crm-dealership-${id}`, () => fetchDealershipRecord(id))
/** Only a real 404 / bad id means "not found"; anything else is a failed load, tried once more in the browser. */
const notFound = computed(() => { const c = (error.value as any)?.statusCode || (error.value as any)?.status; return c === 404 || c === 400 })
onMounted(() => { if (error.value && !notFound.value) refresh() })
const dealership = computed<CrmDealership | null>(() => data.value?.dealership || null)
const contacts = computed<CrmContact[]>(() => data.value?.contacts || [])
const activity = computed<CrmActivity[]>(() => data.value?.activity || [])
const interactions = computed<CrmInteraction[]>(() => data.value?.interactions || [])
const emails = computed<CrmEmail[]>(() => (data.value as any)?.emails || [])
const repliesToReview = computed(() => emails.value.filter(e => e.direction === 'inbound' && !e.sentiment).length)
// ─── Email ───
const showCompose = ref(false)
const composeFollowUp = ref<string | null>(null)
/** Open the composer on the inventory-audit email as a new conversation (from the audit tab). */
const composeAudit = ref(false)
function openCompose(followUpOf?: string) { composeAudit.value = false; composeFollowUp.value = followUpOf || null; showCompose.value = true }
function openAuditEmail() { composeFollowUp.value = null; composeAudit.value = true; showCompose.value = true }
const liveInteractions = computed(() => interactions.value.filter(i => !i.voidedAt))
const openNextActions = computed(() => liveInteractions.value.filter(i => i.nextAction && !i.nextActionDone).sort((a, b) => (a.nextActionDate || '9999').localeCompare(b.nextActionDate || '9999')))
const audits = computed<CrmAudit[]>(() => data.value?.audits || [])
const stageHistory = computed<CrmStageChange[]>(() => data.value?.stageHistory || [])
const stageDurations = computed<CrmStageDurations>(() => data.value?.stageDurations || {})
const inStageMs = computed(() => { const at = dealership.value?.stageChangedAt || stageHistory.value.at(-1)?.changedAt; return at ? Date.now() - new Date(at).getTime() : null })
const latestAudit = computed(() => [...audits.value].sort((a, b) => b.auditedAt.localeCompare(a.auditedAt))[0] || null)
const showAudit = ref(false)
const showScanner = ref(false)
// Re-open the crawl behind the latest automated audit to review / train it.
const showReview = ref(false)
const latestScanId = computed(() => { const a: any = latestAudit.value; return a?.source === 'automated' && a?.collector?.runId ? String(a.collector.runId) : null })
function openLatestAudit() { if (latestScanId.value) showReview.value = true; else tab.value = 'audits' }

const TABS = ['overview', 'history', 'emails', 'pipeline', 'contacts', 'audits']
// `?tab=activity` was the old name of the History tab.
const initialTab = route.query.tab === 'activity' ? 'history' : String(route.query.tab)
const tab = ref<string>(TABS.includes(initialTab) ? initialTab : 'overview')
// Keep the active tab in the URL so links / refreshes land on the same section.
// The global clear-header middleware runs on query changes too, so re-apply the header after each switch.
watch(tab, async (v) => {
  await router.replace({ query: { ...route.query, tab: v === 'overview' ? undefined : v } })
  applyHeader()
})

function applyHeader() {
  if (dealership.value) setHeader({ title: dealership.value.name, icon: 'i-lucide-store' })
}
watchEffect(applyHeader)

// ─── Derived ───
const activeContacts = computed(() => contacts.value.filter(c => c.isActive))
const formerContacts = computed(() => contacts.value.filter(c => !c.isActive).sort((a, b) => (b.inactiveAt || '').localeCompare(a.inactiveAt || '')))
const byId = computed(() => new Map(contacts.value.map(c => [c.id, c])))
const location = computed(() => dealership.value ? [dealership.value.address, [dealership.value.city, dealership.value.state].filter(Boolean).join(', '), dealership.value.zip].filter(Boolean).join(' · ') : '')
const mapsHref = computed(() => dealership.value ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([dealership.value.name, dealership.value.address, dealership.value.city, dealership.value.state, dealership.value.zip].filter(Boolean).join(' '))}` : '#')
/** Rows of the "Basic information" box (stage is rendered separately as a picker). */
const basicInfo = computed(() => {
  const d = dealership.value
  if (!d) return []
  const rows: { label: string, value?: string, href?: string, copy?: boolean }[] = [
    { label: 'Dealership ID', value: d.dealershipId, copy: true },
    { label: 'Dealership name', value: d.name },
    { label: 'Dealer group / parent', value: d.dealerGroup },
    { label: 'Franchise / brands', value: d.brands?.join(', ') },
    { label: 'Website', value: d.website?.replace(/^https?:\/\//, '').replace(/\/$/, ''), href: d.website },
    { label: 'Main phone', value: d.phone, href: d.phone ? `tel:${d.phone}` : undefined },
    { label: 'Address', value: d.address, href: location.value ? mapsHref.value : undefined },
    { label: 'City', value: d.city },
    { label: 'State', value: d.state },
    { label: 'ZIP', value: d.zip },
    { label: 'Territory / market', value: d.territory },
    { label: 'Route / day', value: d.route },
    { label: 'Assigned salesperson', value: d.assignedUserName },
    { label: 'Lead source', value: d.leadSource + (d.leadSourceDetail ? ` — ${d.leadSourceDetail}` : '') },
    { label: 'Date added', value: format(new Date(d.createdAt), 'PPP') },
  ]
  return rows
})
const showFormer = ref(false)

// ─── Actions ───
const showEdit = ref(false)
const showContactForm = ref(false)
const editingContact = ref<CrmContact | null>(null)
const showHandover = ref(false)
const handoverTarget = ref<CrmContact | null>(null)
const busy = ref<string | null>(null)
// ─── Permanent delete (type the name to confirm) ───
const showDelete = ref(false)
const deleteConfirm = ref('')
const deleting = ref(false)
async function confirmDelete() {
  if (!dealership.value || deleteConfirm.value.trim() !== dealership.value.name.trim()) return
  deleting.value = true
  try {
    const name = dealership.value.name
    await deleteDealership(id)
    showDelete.value = false
    toast.success(`${name} deleted`)
    navigateTo('/crm/dealership')
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not delete') } finally { deleting.value = false }
}

function openAddContact() { editingContact.value = null; showContactForm.value = true }
function openEditContact(c: CrmContact) { editingContact.value = c; showContactForm.value = true }
function openHandover(c: CrmContact) { handoverTarget.value = c; showHandover.value = true }

async function run(key: string, fn: () => Promise<any>, ok: string) {
  busy.value = key
  try { await fn(); await refresh(); if (ok) toast.success(ok) } catch (e: any) { toast.error(e?.data?.statusMessage || e?.message || 'Action failed') } finally { busy.value = null }
}
const verifyContact = (c: CrmContact) => run(`verify-${c.id}`, () => updateContact(id, c.id, { verified: true }), `${c.fullName} verified`)
const setPrimary = (c: CrmContact) => run(`primary-${c.id}`, () => updateContact(id, c.id, { isPrimary: true }), `${c.fullName} is now the primary contact`)
const reactivate = (c: CrmContact) => run(`react-${c.id}`, () => updateContact(id, c.id, { isActive: true }), `${c.fullName} reactivated`)
const showConvert = ref(false)
function setStage(s: string) {
  if (dealership.value?.stage === s) return
  // Winning the account is a hand-off, not a label change — confirm what gets created.
  if (s === WON_STAGE && !dealership.value?.dealerId) { showConvert.value = true; return }
  // Parking a dealership needs a date to come back to it, so it never silently disappears.
  if (s === NURTURE_STAGE || s === 'Lost') { openPark(s); return }
  run('stage', () => updateDealership(id, { stage: s }), `Stage → ${s}`)
}

// ─── Park (Nurture / Lost) ───
const showPark = ref(false)
const park = ref({ stage: NURTURE_STAGE, revisitDate: '', note: '' })
const lost = ref({ lostReason: '', lostNotes: '', lostCompetitor: '' })
const lostError = ref('')
const PARK_QUICK = [{ l: '1 month', d: 30 }, { l: '3 months', d: 90 }, { l: '6 months', d: 182 }, { l: '1 year', d: 365 }]
function openPark(stage: string) {
  const d = dealership.value
  park.value = { stage, revisitDate: d?.revisitDate || (stage === NURTURE_STAGE ? localDay(new Date(Date.now() + 90 * 86_400_000)) : ''), note: '' }
  lost.value = { lostReason: d?.lostReason || '', lostNotes: d?.lostNotes || '', lostCompetitor: d?.lostCompetitor || '' }
  lostError.value = ''
  showPark.value = true
}
async function savePark() {
  if (park.value.stage === NURTURE_STAGE && !park.value.revisitDate) return toast.error('Pick a revisit date')
  if (park.value.stage === 'Lost') {
    if (!lost.value.lostReason) { lostError.value = 'Pick a reason — it drives the lost-deal report'; return }
    if (lost.value.lostReason === 'Other' && !lost.value.lostNotes.trim()) { lostError.value = 'Add a note explaining “Other”'; return }
  }
  showPark.value = false
  await run('stage', () => updateDealership(id, { stage: park.value.stage, revisitDate: park.value.revisitDate || null, parkedNote: park.value.note, ...(park.value.stage === 'Lost' ? lost.value : {}) } as any),
    park.value.stage === NURTURE_STAGE ? `Nurture — revisit ${park.value.revisitDate}` : 'Marked Lost')
}

// ─── Coverage: does this dealership have a next step? ───
const datedNextAction = computed(() => openNextActions.value.find(n => n.nextActionDate) || null)
const coverage = computed<'ok' | 'none' | 'undated' | 'queued' | 'parked' | 'closed'>(() => {
  const d = dealership.value
  if (!d || d.dealerId || d.stage === WON_STAGE) return 'closed'
  if (d.stage === NURTURE_STAGE || d.stage === 'Lost') return 'parked'
  if (datedNextAction.value) return 'ok'
  if (QUEUE_STAGES.includes(d.stage)) return 'queued'
  if (!OPEN_STAGES.includes(d.stage)) return 'closed'
  return openNextActions.value.length ? 'undated' : 'none'
})
// Deep link from the Today board: ?log=follow_up opens the activity form.
onMounted(() => {
  const t = route.query.log
  if (t && canEdit.value) { openLog(String(t)); router.replace({ query: { ...route.query, log: undefined } }).then(applyHeader) }
})
const isConverted = computed(() => !!dealership.value?.dealerId)
const dealerHref = computed(() => isConverted.value ? `/dealers/${dealership.value!.dealerId}/details` : '')
const toggleArchive = () => run('archive', () => updateDealership(id, { archived: !dealership.value?.archivedAt }), dealership.value?.archivedAt ? 'Dealership restored' : 'Dealership archived')
// ─── Relationship history ───
const showLog = ref(false)
const logType = ref<string | undefined>(undefined)
const editingInteraction = ref<CrmInteraction | null>(null)
function openLog(type?: string) { editingInteraction.value = null; logType.value = type; showLog.value = true }
function openEditInteraction(i: CrmInteraction) { editingInteraction.value = i; logType.value = undefined; showLog.value = true }
const DUE_TONE: Record<string, string> = { overdue: 'text-rose-600 dark:text-rose-400', today: 'text-amber-600 dark:text-amber-400', soon: 'text-sky-600 dark:text-sky-400', later: 'text-muted-foreground', none: 'text-muted-foreground' }
async function copyId() { try { await navigator.clipboard.writeText(dealership.value!.dealershipId); toast.success('ID copied') } catch {} }

const tabs = computed(() => [
  { key: 'overview', label: 'Overview', icon: Building2, count: null },
  { key: 'history', label: 'History', icon: History, count: liveInteractions.value.length },
  { key: 'emails', icon: MailIcon, label: repliesToReview.value ? 'Emails · ' + repliesToReview.value + ' new' : 'Emails', count: emails.value.filter(e => e.direction === 'outbound').length },
  { key: 'pipeline', label: 'Pipeline', icon: GitBranch, count: Math.max(0, stageHistory.value.length - 1) },
  { key: 'contacts', label: 'Contacts', icon: Users, count: activeContacts.value.length },
  { key: 'audits', label: 'Audits', icon: ClipboardCheck, count: audits.value.length },
])
</script>

<template>
  <div class="absolute inset-0 flex flex-col overflow-hidden">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <Button variant="ghost" size="icon" class="size-8" title="All dealerships" aria-label="All dealerships" @click="navigateTo('/crm/dealership')"><ArrowLeft class="size-4" /></Button>
        <Button v-if="canEdit && dealership && !dealership.archivedAt" size="sm" class="h-8 gap-1.5 bg-red-600 hover:bg-red-700 text-white shadow-sm shadow-red-600/25" title="Crawl the dealership website for vehicles without real photos" @click="showScanner = true"><ScanSearch class="size-4" /><span class="hidden lg:inline">Crawl</span></Button>
        <Button v-if="canEdit && dealership && !dealership.archivedAt" variant="outline" size="sm" class="h-8 gap-1.5" @click="openCompose()"><MailHeaderIcon class="size-4" /><span class="hidden lg:inline">Email</span></Button>
        <Button v-if="canEdit && dealership" size="sm" class="h-8 gap-1.5" @click="openLog()"><MessageSquarePlus class="size-4" /><span class="hidden lg:inline">Log activity</span></Button>
        <Button v-if="dealership && isConverted" size="sm" class="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-600/90 text-white" @click="navigateTo(dealerHref)"><Briefcase class="size-4" /><span class="hidden lg:inline">Continue in Dealers</span></Button>
        <Button v-else-if="canEdit && dealership && !dealership.archivedAt" size="sm" class="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-600/90 text-white" @click="showConvert = true"><Trophy class="size-4" /><span class="hidden lg:inline">Mark as won</span></Button>
        <DropdownMenu v-if="dealership && (canEdit || canDelete)">
          <DropdownMenuTrigger as-child><Button variant="outline" size="icon" class="size-8" aria-label="More actions"><MoreHorizontal class="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-52">
            <template v-if="canEdit">
              <DropdownMenuItem @click="showEdit = true"><Pencil class="size-4" /> Edit details</DropdownMenuItem>
              <DropdownMenuItem v-if="!isConverted" @click="openAddContact"><UserPlus class="size-4" /> Add contact</DropdownMenuItem>
              <DropdownMenuItem @click="showAudit = true"><ClipboardCheck class="size-4" /> Record audit</DropdownMenuItem>
            </template>
            <template v-if="canDelete">
              <DropdownMenuSeparator />
              <DropdownMenuItem :disabled="busy === 'archive'" @click="toggleArchive">
                <component :is="dealership.archivedAt ? ArchiveRestore : Archive" class="size-4" /> {{ dealership.archivedAt ? 'Restore dealership' : 'Archive dealership' }}
              </DropdownMenuItem>
              <DropdownMenuItem class="text-destructive focus:text-destructive" @click="deleteConfirm = ''; showDelete = true"><Trash2 class="size-4" /> Delete permanently…</DropdownMenuItem>
            </template>
          </DropdownMenuContent>
        </DropdownMenu>
      </Teleport>
    </ClientOnly>

    <!-- Loading -->
    <div v-if="pending && !dealership" class="p-6 space-y-2">
      <div class="flex items-center gap-2"><Skeleton class="size-16 rounded-2xl" /><div class="space-y-2 flex-1"><Skeleton class="h-6 w-64" /><Skeleton class="h-4 w-96" /></div></div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2"><Skeleton v-for="i in 4" :key="i" class="h-20 rounded-xl" /></div>
      <Skeleton class="h-64 rounded-xl" />
    </div>

    <!-- Could not load (a failed request is not "not found") -->
    <div v-else-if="error && !notFound" class="flex-1 flex flex-col items-center justify-center text-center p-6" role="alert">
      <div class="size-16 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center"><Store class="size-7" /></div>
      <h2 class="mt-2 text-lg font-semibold">This dealership could not be loaded</h2>
      <p class="text-sm text-muted-foreground mt-1">The record is safe — the page just did not get its data.</p>
      <div class="mt-2 flex gap-2">
        <Button size="sm" @click="refresh()">Try again</Button>
        <Button variant="outline" size="sm" class="gap-2" @click="navigateTo('/crm/dealership')"><ArrowLeft class="size-4" /> Back to dealerships</Button>
      </div>
    </div>

    <!-- Not found -->
    <div v-else-if="error || !dealership" class="flex-1 flex flex-col items-center justify-center text-center p-6">
      <div class="size-16 rounded-2xl bg-muted flex items-center justify-center"><Store class="size-7 text-muted-foreground/50" /></div>
      <h2 class="mt-2 text-lg font-semibold">Dealership not found</h2>
      <p class="text-sm text-muted-foreground mt-1">It may have been removed, or the link is incorrect.</p>
      <Button variant="outline" size="sm" class="mt-2 gap-2" @click="navigateTo('/crm/dealership')"><ArrowLeft class="size-4" /> Back to dealerships</Button>
    </div>

    <div v-else class="flex-1 min-h-0 overflow-auto p-2 flex flex-col gap-2">
      <!-- Sections -->
      <nav class="shrink-0 flex w-full overflow-x-auto rounded-lg border bg-muted/40 p-0.5 gap-0.5" role="tablist" aria-label="Record sections">
        <button
          v-for="t in tabs" :key="t.key" type="button" role="tab" :aria-selected="tab === t.key"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-sm whitespace-nowrap transition-colors"
          :class="tab === t.key ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'" @click="tab = t.key"
        >
          <component :is="t.icon" class="size-4" />{{ t.label }}
          <span v-if="t.count !== null" class="rounded-full bg-black/10 dark:bg-white/15 px-1.5 py-px text-[10px] tabular-nums leading-none">{{ t.count }}</span>
        </button>
      </nav>
      <!-- Archived -->
      <div v-if="dealership.archivedAt" class="rounded-lg border border-zinc-500/30 bg-zinc-500/10 px-2 py-1.5 text-xs flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
        <Archive class="size-3.5" /> Archived {{ formatDistanceToNow(new Date(dealership.archivedAt), { addSuffix: true }) }} — hidden from the main list; history fully preserved.
        <Button v-if="canDelete" variant="link" size="sm" class="h-auto p-0 text-xs ml-auto" @click="toggleArchive">Restore</Button>
      </div>

      <!-- Follow-up coverage -->
      <div v-if="!dealership.archivedAt && (coverage === 'none' || coverage === 'undated')" class="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-2 py-1.5 flex flex-wrap items-center gap-2 text-sm">
        <Target class="size-4 text-rose-600 shrink-0" />
        <span class="text-rose-800 dark:text-rose-300"><b>No next step.</b> {{ coverage === 'undated' ? 'The next action has no date, so it won’t come up on the Today board.' : 'Plan a dated next action, or move it to Nurture with a revisit date.' }}</span>
        <div v-if="canEdit" class="ml-auto flex gap-2">
          <Button size="sm" class="h-7 text-xs gap-1.5" @click="openLog('follow_up')"><Target class="size-3.5" /> Plan next step</Button>
          <Button size="sm" variant="outline" class="h-7 text-xs" @click="openPark(NURTURE_STAGE)">Nurture…</Button>
        </div>
      </div>
      <div v-else-if="coverage === 'parked'" class="rounded-lg border bg-zinc-500/[0.06] px-2 py-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span><b class="text-foreground">{{ dealership.stage === 'Lost' ? 'Lost' : 'Nurture' }}</b><span v-if="dealership.lostReason"> · <b class="text-foreground">{{ dealership.lostReason }}</b><span v-if="dealership.lostCompetitor"> ({{ dealership.lostCompetitor }})</span></span><span v-if="dealership.lostNotes" class="italic"> — “{{ dealership.lostNotes }}”</span><span v-if="dealership.revisitDate"> · revisit <b class="text-foreground">{{ format(new Date(`${dealership.revisitDate}T12:00:00`), 'MMM d, yyyy') }}</b></span><span v-else-if="dealership.stage === 'Lost'"> · no revisit date</span><span v-if="dealership.stage === 'Lost' && !dealership.lostReason" class="text-rose-600 font-medium"> · no reason recorded</span></span>
        <Button v-if="canEdit" variant="link" size="sm" class="h-auto p-0 text-xs" @click="openPark(dealership.stage)">Change</Button>
      </div>

      <!-- Won -->
      <div v-if="isConverted" class="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06]">
        <div class="px-2 py-2 flex flex-wrap items-center gap-2">
          <Trophy class="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <p class="text-sm min-w-0 flex-1"><b class="text-emerald-800 dark:text-emerald-300">Won — this account lives in Dealers.</b> <span class="text-xs text-muted-foreground">Promoted {{ dealership.convertedAt ? formatDistanceToNow(new Date(dealership.convertedAt), { addSuffix: true }) : '' }}<span v-if="dealership.convertedBy?.name"> by {{ dealership.convertedBy.name }}</span>; this record is kept as the sales history.</span></p>
          <Button size="sm" class="h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-600/90 text-white shrink-0" @click="navigateTo(dealerHref)">Open dealer <ArrowLeft class="size-3.5 rotate-180" /></Button>
        </div>
        <CrmWonDealCard :key="dealership.convertedAt || 'won'" :dealership-id="id" :lead-source="dealership.leadSource" :can-edit="canEdit" />
      </div>

      <!-- Tab content fills the rest of the page height -->
      <div class="flex-1 flex flex-col" :class="tab === 'overview' && 'xl:min-h-0'">
        <!-- ═══ OVERVIEW ═══ -->
        <div v-if="tab === 'overview'" class="grid grid-cols-1 xl:grid-cols-3 xl:grid-rows-[minmax(0,1fr)] gap-2 xl:flex-1 xl:min-h-0">
          <div class="xl:col-span-2 flex flex-col gap-2 xl:min-h-0 xl:overflow-y-auto">
            <section class="shrink-0 rounded-xl border bg-card">
              <header class="px-5 py-3.5 border-b flex items-center justify-between"><h3 class="font-semibold text-sm flex items-center gap-2"><Building2 class="size-4 text-muted-foreground" /> Basic information</h3><Button v-if="canEdit" variant="ghost" size="sm" class="h-7 text-xs gap-1" @click="showEdit = true"><Pencil class="size-3" /> Edit</Button></header>
              <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-2 divide-y sm:divide-y-0 text-sm">
                <div class="px-5 py-2.5 grid grid-cols-[150px_1fr] items-center gap-2 sm:border-b">
                  <dt class="text-muted-foreground text-xs">Stage</dt>
                  <dd class="min-w-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger as-child :disabled="!canEdit">
                        <button type="button" class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors" :class="[STAGE_STYLE[dealership.stage]?.badge, canEdit && 'hover:brightness-95 cursor-pointer']">
                          <span class="size-1.5 rounded-full" :class="STAGE_STYLE[dealership.stage]?.dot" />{{ dealership.stage }}<ChevronDown v-if="canEdit" class="size-3 opacity-60" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" class="w-64 max-h-[70vh] overflow-y-auto">
                        <DropdownMenuLabel class="text-[11px] text-muted-foreground flex items-center justify-between gap-2">Move to stage <span v-if="inStageMs !== null" class="font-normal">{{ formatDuration(inStageMs) }} in current</span></DropdownMenuLabel>
                        <template v-for="(s, i) in DEALERSHIP_STAGES" :key="s">
                          <DropdownMenuSeparator v-if="s === WON_STAGE" />
                          <DropdownMenuItem :disabled="busy === 'stage' || (isConverted && s !== WON_STAGE)" @click="setStage(s)">
                            <span class="w-4 text-[10px] tabular-nums text-muted-foreground">{{ i + 1 }}</span>
                            <span class="size-2 rounded-full" :class="STAGE_STYLE[s]?.dot" />{{ s }}
                            <span v-if="s === WON_STAGE && !isConverted" class="text-[10px] text-muted-foreground ml-1">· promotes to Dealer</span>
                            <ShieldCheck v-if="s === dealership.stage" class="size-3.5 ml-auto text-primary" />
                          </DropdownMenuItem>
                        </template>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </dd>
                </div>
                <div v-for="f in basicInfo" :key="f.label" class="px-5 py-2.5 grid grid-cols-[150px_1fr] gap-2 sm:border-b">
                  <dt class="text-muted-foreground text-xs pt-0.5">{{ f.label }}</dt>
                  <dd class="min-w-0 truncate" :class="!f.value && 'text-muted-foreground/60 italic'">
                    <template v-if="!f.value">Not set</template>
                    <button v-else-if="f.copy" type="button" class="inline-flex items-center gap-1 font-mono text-xs hover:text-primary" title="Copy ID" @click="copyId">{{ f.value }}<Copy class="size-3 opacity-50" /></button>
                    <a v-else-if="f.href" :href="f.href" :target="f.href.startsWith('http') ? '_blank' : undefined" rel="noopener" class="hover:text-primary hover:underline underline-offset-2">{{ f.value }}</a>
                    <template v-else>{{ f.value }}</template>
                  </dd>
                </div>
              </dl>
            </section>
            <section v-if="dealership.notes" class="shrink-0 rounded-xl border bg-card p-5">
              <h3 class="font-semibold text-sm flex items-center gap-2 mb-2"><Tag class="size-4 text-muted-foreground" /> Internal notes</h3>
              <p class="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{{ dealership.notes }}</p>
            </section>
            <section class="rounded-xl border bg-card flex flex-col min-h-[320px] xl:flex-1">
              <header class="shrink-0 px-5 py-3.5 border-b flex items-center justify-between gap-2">
                <h3 class="font-semibold text-sm flex items-center gap-2"><History class="size-4 text-muted-foreground" /> Relationship history <span class="text-xs font-normal text-muted-foreground">· {{ liveInteractions.length }} interaction{{ liveInteractions.length === 1 ? '' : 's' }}</span></h3>
                <div class="flex items-center gap-1">
                  <Button variant="ghost" size="sm" class="h-7 text-xs" @click="tab = 'history'">Full history</Button>
                  <Button v-if="canEdit" size="sm" class="h-7 text-xs gap-1" @click="openLog()"><MessageSquarePlus class="size-3.5" /> Log activity</Button>
                </div>
              </header>
              <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                <CrmHistoryFeed :dealership-id="id" :interactions="interactions" :activity="activity" :contacts="contacts" :can-edit="canEdit" :limit="20" @log="openLog" @more="tab = 'history'" />
              </div>
            </section>
          </div>
          <aside class="flex flex-col gap-2 xl:min-h-0 xl:overflow-y-auto">
            <section class="shrink-0 rounded-xl border bg-card" :class="openNextActions[0] && dueState(openNextActions[0].nextActionDate) === 'overdue' && 'border-rose-500/30'">
              <header class="px-5 py-3.5 border-b flex items-center justify-between"><h3 class="font-semibold text-sm flex items-center gap-2"><Target class="size-4 text-muted-foreground" /> Next action</h3><span v-if="openNextActions.length > 1" class="text-[11px] text-muted-foreground">{{ openNextActions.length }} open</span></header>
              <ul v-if="openNextActions.length" class="divide-y">
                <li v-for="n in openNextActions.slice(0, 3)" :key="n.id" class="px-5 py-2.5">
                  <p class="text-sm font-medium">{{ n.nextAction }}</p>
                  <p class="text-[11px] mt-0.5" :class="DUE_TONE[dueState(n.nextActionDate)]">
                    {{ n.nextActionDate ? (dueState(n.nextActionDate) === 'overdue' ? 'Overdue — ' : dueState(n.nextActionDate) === 'today' ? 'Today — ' : '') + format(new Date(`${n.nextActionDate}T00:00:00`), 'EEE, MMM d') : 'No date set' }}
                    <span class="text-muted-foreground"> · from {{ n.typeLabel.toLowerCase() }} by {{ n.user?.name }}</span>
                  </p>
                </li>
              </ul>
              <div v-else class="px-5 py-5 text-center">
                <p class="text-sm text-muted-foreground">Nothing planned.</p>
                <Button v-if="canEdit" size="sm" variant="outline" class="mt-2 gap-1.5" @click="openLog('follow_up')"><Target class="size-3.5" /> Plan a follow-up</Button>
              </div>
            </section>
            <section class="rounded-xl border bg-card xl:flex-1">
              <header class="px-5 py-3.5 border-b flex items-center justify-between"><h3 class="font-semibold text-sm flex items-center gap-2"><Users class="size-4 text-muted-foreground" /> Key people</h3><Button variant="ghost" size="sm" class="h-7 text-xs" @click="tab = 'contacts'">View all</Button></header>
              <ul v-if="activeContacts.length" class="divide-y">
                <li v-for="c in activeContacts.slice(0, 10)" :key="c.id" class="px-5 py-2.5 flex items-center gap-2">
                  <div class="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-[11px] font-bold shrink-0">{{ (c.firstName?.[0] || '') + (c.lastName?.[0] || '') }}</div>
                  <div class="min-w-0 flex-1"><p class="text-sm font-medium truncate">{{ c.fullName }} <span v-if="c.isPrimary" class="text-[10px] text-amber-600 dark:text-amber-400 font-semibold ml-1">PRIMARY</span></p><p class="text-xs text-muted-foreground truncate">{{ c.jobTitle || c.role }}</p></div>
                  <ShieldAlert v-if="verificationState(c.lastVerifiedAt) === 'stale'" class="size-4 text-amber-500 shrink-0" title="Needs verification" />
                </li>
              </ul>
              <div v-else class="px-5 py-8 text-center">
                <p class="text-sm text-muted-foreground">No contacts yet.</p>
                <Button v-if="canEdit" size="sm" variant="outline" class="mt-2 gap-1.5" @click="openAddContact"><UserPlus class="size-3.5" /> Add the first contact</Button>
              </div>
            </section>
            <section class="shrink-0 rounded-xl border bg-card">
              <header class="px-5 py-3.5 border-b flex items-center justify-between"><h3 class="font-semibold text-sm flex items-center gap-2"><ClipboardCheck class="size-4 text-muted-foreground" /> Inventory audit</h3><Button variant="ghost" size="sm" class="h-7 text-xs" @click="tab = 'audits'">{{ audits.length ? 'History' : 'Open' }}</Button></header>
              <button v-if="latestAudit" type="button" class="group w-full text-left px-5 py-4 flex items-center gap-2 rounded-b-xl hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :title="latestScanId ? 'Open the crawl results — review and correct the photos' : 'Open the audit history'" @click="openLatestAudit">
                <div>
                  <p class="text-2xl font-bold tabular-nums leading-none" :class="latestAudit.missingPhotoPct === null ? 'text-muted-foreground' : latestAudit.missingPhotoPct >= 25 ? 'text-rose-600 dark:text-rose-400' : latestAudit.missingPhotoPct >= 10 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'">{{ latestAudit.missingPhotoPct === null ? '—' : `${latestAudit.missingPhotoPct}%` }}</p>
                  <p class="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">missing photos</p>
                </div>
                <div class="h-9 w-px bg-border" />
                <div class="text-xs space-y-0.5 min-w-0">
                  <p><span class="font-medium">{{ latestAudit.totalVehicles }}</span> vehicles · {{ latestAudit.newTotal }} new / {{ latestAudit.usedTotal }} used</p>
                  <p class="text-muted-foreground">Audited {{ formatDistanceToNow(new Date(latestAudit.auditedAt), { addSuffix: true }) }} · {{ audits.length }} on record</p>
                  <p v-if="latestAudit.merchandisingIssues.length + latestAudit.websiteIssues.length" class="text-amber-700 dark:text-amber-300 flex items-center gap-1"><ImageOff class="size-3" /> {{ latestAudit.merchandisingIssues.length + latestAudit.websiteIssues.length }} issues flagged</p>
                </div>
                <span class="ml-auto shrink-0 text-xs font-medium text-muted-foreground group-hover:text-foreground inline-flex items-center gap-1">{{ latestScanId ? 'Review & train' : 'Details' }} <ChevronRight class="size-3.5 transition-transform group-hover:translate-x-0.5" /></span>
              </button>
              <div v-else class="px-5 py-6 text-center">
                <p class="text-sm text-muted-foreground">Not audited yet.</p>
                <Button v-if="canEdit" size="sm" variant="outline" class="mt-2 gap-1.5" @click="showAudit = true"><ClipboardCheck class="size-3.5" /> Record first audit</Button>
              </div>
            </section>
          </aside>
        </div>

        <!-- ═══ PIPELINE ═══ -->
        <div v-else-if="tab === 'pipeline'" class="max-w-6xl">
          <CrmPipelinePanel :dealership="dealership" :history="stageHistory" :durations="stageDurations" />
        </div>

        <!-- ═══ CONTACTS ═══ -->
        <div v-else-if="tab === 'contacts'" class="space-y-2">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h3 class="font-semibold">Current roster</h3>
              <p class="text-xs text-muted-foreground">People who should be contacted today. Staff who leave are kept as former contacts — never deleted.</p>
            </div>
            <Button v-if="canEdit && isConverted" size="sm" variant="outline" class="gap-2" @click="navigateTo(`/dealers/${dealership.dealerId}/contacts`)"><Briefcase class="size-4" /> Manage contacts in Dealers</Button>
            <Button v-else-if="canEdit" size="sm" class="gap-2" @click="openAddContact"><UserPlus class="size-4" /> Add contact</Button>
          </div>
          <div v-if="isConverted" class="rounded-lg border border-dashed bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground flex items-center gap-2">
            <Trophy class="size-3.5 text-emerald-600" /> The roster below was carried into the dealer record on conversion. Day-to-day contact changes should be made in Dealers so invoices and emails stay accurate.
          </div>

          <div v-if="activeContacts.length" class="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2">
            <CrmContactCard
              v-for="c in activeContacts" :key="c.id" :contact="c" :predecessor="c.precededById ? byId.get(c.precededById) : null" :can-edit="canEdit" :verifying="busy === `verify-${c.id}`"
              @edit="openEditContact(c)" @handover="openHandover(c)" @verify="verifyContact(c)" @set-primary="setPrimary(c)"
            />
          </div>
          <div v-else class="rounded-xl border-2 border-dashed py-14 flex flex-col items-center text-center">
            <div class="size-14 rounded-2xl bg-muted flex items-center justify-center"><Users class="size-6 text-muted-foreground/50" /></div>
            <h4 class="mt-2 font-semibold">No active contacts</h4>
            <p class="mt-1 text-sm text-muted-foreground max-w-xs">Add the owner, GM, or whoever you're working with. Each person gets their own permanent record.</p>
            <Button v-if="canEdit" size="sm" class="mt-2 gap-2" @click="openAddContact"><UserPlus class="size-4" /> Add contact</Button>
          </div>

          <div v-if="formerContacts.length" class="pt-2">
            <button type="button" class="w-full flex items-center gap-2 text-left group" @click="showFormer = !showFormer">
              <span class="h-px flex-1 bg-border" />
              <span class="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors"><History class="size-3.5" /> Former contacts ({{ formerContacts.length }}) <ChevronDown class="size-3.5 transition-transform" :class="showFormer && 'rotate-180'" /></span>
              <span class="h-px flex-1 bg-border" />
            </button>
            <Transition name="fade">
              <div v-if="showFormer" class="mt-2 grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2">
                <CrmContactCard v-for="c in formerContacts" :key="c.id" :contact="c" :successor="c.succeededById ? byId.get(c.succeededById) : null" :can-edit="canEdit" @reactivate="reactivate(c)" />
              </div>
            </Transition>
          </div>
        </div>

        <!-- ═══ AUDITS ═══ -->
        <div v-else-if="tab === 'audits'" class="max-w-5xl">
          <CrmAuditPanel :dealership="dealership" :audits="audits" :can-edit="canEdit" :can-email="canEdit && !dealership.archivedAt" :can-delete="canDelete" @record="showAudit = true" @email="openAuditEmail" @changed="refresh()" />
        </div>

        <!-- ═══ EMAILS ═══ -->
        <div v-else-if="tab === 'emails'" class="max-w-5xl">
          <CrmEmailPanel :emails="emails" :can-edit="canEdit && !dealership.archivedAt" @compose="openCompose" @changed="refresh()" />
        </div>

        <!-- ═══ HISTORY ═══ -->
        <div v-else-if="tab === 'history'" class="max-w-4xl">
          <CrmHistoryFeed :dealership-id="id" :dealership-code="dealership.dealershipId" :interactions="interactions" :activity="activity" :contacts="contacts" :can-edit="canEdit" @log="openLog" @edit="openEditInteraction" @changed="refresh()" />
        </div>
      </div>
    </div>

    <CrmDealershipForm v-model:open="showEdit" :dealership="dealership" @saved="refresh()" />
    <CrmContactForm v-model:open="showContactForm" :dealership-id="id" :contact="editingContact" @saved="refresh()" />
    <CrmHandoverDialog v-model:open="showHandover" :dealership-id="id" :contact="handoverTarget" @done="refresh()" />
    <Dialog v-model:open="showDelete">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2 text-destructive"><Trash2 class="size-4" /> Delete {{ dealership?.name }}?</DialogTitle>
          <DialogDescription class="text-xs">This permanently removes the dealership with its contacts, activity, emails, audits, stage history and time entries. It can't be undone in the app (daily backups keep a copy). To just hide it, use Archive instead.</DialogDescription>
        </DialogHeader>
        <div class="space-y-1.5">
          <Label for="del-confirm" class="text-xs">Type <b>{{ dealership?.name }}</b> to confirm</Label>
          <Input id="del-confirm" v-model="deleteConfirm" autocomplete="off" @keydown.enter.prevent="confirmDelete" />
        </div>
        <DialogFooter>
          <Button variant="ghost" @click="showDelete = false">Cancel</Button>
          <Button variant="destructive" :disabled="deleting || deleteConfirm.trim() !== dealership?.name.trim()" @click="confirmDelete">Delete permanently</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <CrmConvertDialog v-model:open="showConvert" :dealership="dealership" :contacts="contacts" @converted="refresh()" />
    <CrmAuditForm v-model:open="showAudit" :dealership="dealership" :previous="latestAudit" @saved="refresh()" />
    <ClientOnly><CrmInventoryScanner v-if="dealership" v-model:open="showScanner" :dealership="{ id, name: dealership.name, website: dealership.website }" @saved="refresh()" @email="openAuditEmail" /></ClientOnly>
    <ClientOnly><CrmScannerReviewDialog v-if="dealership" v-model:open="showReview" :scan-id="latestScanId" :dealership-name="dealership.name" :audit-id="latestAudit ? String((latestAudit as any).id) : null" :audited-at="latestAudit?.auditedAt" @saved="refresh()" :can-email="canEdit && !dealership.archivedAt" @email="showReview = false; openAuditEmail()" /></ClientOnly>
    <Dialog v-model:open="showPark">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ park.stage === NURTURE_STAGE ? 'Move to Nurture' : 'Mark as Lost' }}</DialogTitle>
          <DialogDescription class="text-xs">{{ park.stage === NURTURE_STAGE ? 'Pick when to look at this dealership again — it will come back on the Today board that day.' : 'Pick the reason — every loss feeds the lost-deal report. Optionally set a date to try again.' }}</DialogDescription>
        </DialogHeader>
        <div class="space-y-2">
          <CrmLostReasonFields v-if="park.stage === 'Lost'" v-model="lost" :error="lostError" />
          <div class="space-y-1.5">
            <Label class="text-xs">Revisit date <span v-if="park.stage === NURTURE_STAGE" class="text-destructive">*</span><span v-else class="text-muted-foreground font-normal">(optional)</span></Label>
            <Input v-model="park.revisitDate" type="date" :min="localDay()" />
            <div class="flex flex-wrap gap-1.5"><button v-for="q in PARK_QUICK" :key="q.d" type="button" class="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted" @click="park.revisitDate = localDay(new Date(Date.now() + q.d * 86_400_000))">{{ q.l }}</button></div>
          </div>
          <div class="space-y-1.5"><Label class="text-xs">Note <span class="text-muted-foreground font-normal">(optional)</span></Label><Input v-model="park.note" placeholder="e.g. Contract with current vendor ends in March" /></div>
        </div>
        <DialogFooter><Button variant="ghost" @click="showPark = false">Cancel</Button><Button @click="savePark">{{ park.stage === NURTURE_STAGE ? 'Move to Nurture' : 'Mark Lost' }}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <CrmEmailComposer v-model:open="showCompose" :dealership="dealership" :contacts="contacts" :emails="emails" :follow-up-of="composeFollowUp" :audit-email="composeAudit" @sent="refresh()" @crawl="showScanner = true" />
    <CrmInteractionForm v-model:open="showLog" :dealership="dealership" :contacts="contacts" :interaction="editingInteraction" :default-type="logType" :open-next-actions="openNextActions.length" @saved="refresh()" @won="showConvert = true" />
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity .2s ease, transform .2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
