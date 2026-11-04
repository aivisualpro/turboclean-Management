<script setup lang="ts">
import type { CrmDealership } from '~/composables/useCrmDealerships'
import { dueState, formatDuration, verificationState } from '~/composables/useCrmDealerships'
import type { Condition, DealershipFacts } from '~/composables/useCrmFilters'
import { matchAll } from '~/composables/useCrmFilters'
import { INTERACTION_TYPE_MAP } from '~/constants/crm'
import { INTERACTION_ICONS } from '~/constants/crm-icons'
import {
  Plus, Search, Store, ShieldAlert, Download, RefreshCw, ChevronUp, ChevronDown,
  ChevronsUpDown, X, Filter, UserCircle2,
  CheckSquare, Tag, UserCheck, Loader2, ExternalLink, Briefcase, Trophy, SlidersHorizontal, Upload, Binoculars,
  ScanSearch, Radar, Layers, Mail, CheckCircle2, CircleDashed, Route, Grid3x3, Trash2, ArchiveRestore, ShieldCheck, AlertTriangle,
} from 'lucide-vue-next'
import type { Batch as ScanBatch } from '~/composables/useBatchScan'
import { toast } from 'vue-sonner'
import { format, formatDistanceToNow } from 'date-fns'
import { OPEN_STAGES, QUEUE_STAGES, CLOSED_STAGES, DEALERSHIP_STAGES, LEAD_SOURCES, LEAD_SOURCE_STYLE, STAGE_STYLE, STALLED_STAGE_DAYS, WON_STAGE } from '~/constants/crm'

const { setHeader } = usePageHeader()
setHeader({ title: 'Dealerships', description: 'CRM · every dealership, its people and its history', icon: 'i-lucide-store' })

const { dealerships, isLoading, lastFetchedAt, fetchDealerships, updateDealership } = useCrmDealerships()
const { isActionAllowed } = usePermissions()
const canAdd = computed(() => isActionAllowed('crm_dealership', 'Add'))
const canEdit = computed(() => isActionAllowed('crm_dealership', 'Edit'))
const canDelete = computed(() => isActionAllowed('crm_dealership', 'Delete'))

const { pending } = await useAsyncData('crm-dealerships-bootstrap', async () => {
  if (dealerships.value.length === 0) await fetchDealerships()
  return true
}, { lazy: false })

// ─── Column model — one value per column ───
type ColKey = 'dealershipId' | 'name' | 'dealerGroup' | 'route' | 'brands' | 'stage' | 'inStage' | 'leadSource' | 'city' | 'state' | 'zip' | 'phone' | 'website' | 'scanPages'
  | 'territory' | 'lastTouch' | 'nextAction' | 'primaryContact' | 'primaryTitle' | 'primaryEmail' | 'contacts' | 'owner' | 'lastAudit' | 'missingPhotos' | 'inventory' | 'added' | 'updated'
interface Col { key: ColKey, label: string, sortable?: boolean, default: boolean, align?: 'right' }
const COLUMNS: Col[] = [
  { key: 'name', label: 'Dealership', sortable: true, default: true },
  { key: 'dealerGroup', label: 'Dealer group', sortable: true, default: true },
  { key: 'route', label: 'Route', sortable: true, default: true },
  { key: 'brands', label: 'Brands', default: true },
  { key: 'stage', label: 'Stage', sortable: true, default: true },
  { key: 'inStage', label: 'In stage', sortable: true, default: true, align: 'right' },
  { key: 'leadSource', label: 'Lead source', sortable: true, default: true },
  { key: 'city', label: 'City', sortable: true, default: true },
  { key: 'state', label: 'State', sortable: true, default: true },
  { key: 'zip', label: 'ZIP', sortable: true, default: false },
  { key: 'phone', label: 'Phone', default: true },
  { key: 'website', label: 'Website', default: false },
  { key: 'scanPages', label: 'Scan pages', sortable: true, default: true, align: 'right' },
  { key: 'territory', label: 'Territory', sortable: true, default: false },
  { key: 'lastTouch', label: 'Last touch', sortable: true, default: true },
  { key: 'nextAction', label: 'Next action', sortable: true, default: true },
  { key: 'primaryContact', label: 'Primary contact', sortable: true, default: true },
  { key: 'primaryTitle', label: 'Contact title', default: true },
  { key: 'primaryEmail', label: 'Contact email', default: false },
  { key: 'contacts', label: 'Contacts', sortable: true, default: true, align: 'right' },
  { key: 'owner', label: 'Owner', sortable: true, default: true },
  { key: 'missingPhotos', label: 'Missing photos', sortable: true, default: true, align: 'right' },
  { key: 'inventory', label: 'Inventory', sortable: true, default: false, align: 'right' },
  { key: 'lastAudit', label: 'Last audit', sortable: true, default: true },
  { key: 'added', label: 'Added', sortable: true, default: false },
  { key: 'updated', label: 'Updated', sortable: true, default: true },
]
// Every column is always shown (no column picker on this page).
const shownColumns = COLUMNS
const density = ref<'comfortable' | 'compact'>('compact')
const rowPad = computed(() => density.value === 'compact' ? 'py-1' : 'py-3')

// ─── Filters & sort ───
const search = ref('')
const q = refDebounced(search, 200)
const route = useRoute()
// Deep links from the Pipeline report: /crm/dealership?stage=Replied or ?view=stalled
const stage = ref(DEALERSHIP_STAGES.includes(String(route.query.stage) as any) ? String(route.query.stage) : 'all')
const leadSource = ref('all')
const state = ref('all')
const assignee = ref('all')
// More filters (all live in the single "Filters" button in the header)
const brand = ref('all')
const group = ref('all')
const city = ref('all')
const territory = ref('all')
const routeF = ref(String(route.query.route || 'all'))
const nextActionF = ref<'all' | 'overdue' | 'today' | 'upcoming' | 'none'>('all')
const lastTouchF = ref<'all' | '7' | '30' | 'older30' | 'never'>('all')
const auditF = ref<'all' | 'audited' | 'not' | 'gt10' | 'gt20'>('all')
const contactsF = ref<'all' | 'yes' | 'no'>('all')
const addedF = ref<'all' | '7' | '30' | '90'>('all')
const filtersOpen = ref(false)
const quick = ref<'all' | 'won' | 'stalled' | 'followUps' | 'neverContacted' | 'noNextStep' | 'stale' | 'unassigned' | 'noContacts' | 'notAudited'>(['stalled', 'followUps', 'neverContacted', 'noNextStep'].includes(String(route.query.view)) ? String(route.query.view) as any : 'all')
// Advanced conditions (search & filtering) — evaluated against facts computed from each dealership's history.
const conditions = useLocalStorage<Condition[]>('crm-dealership-conditions', [])
const factsById = ref(new Map<string, DealershipFacts>())
const factsLoading = ref(false)
async function loadFacts() {
  factsLoading.value = true
  try { const r = await $fetch<{ facts: DealershipFacts[] }>('/api/crm/facts'); factsById.value = new Map(r.facts.map(f => [f.id, f])) } catch {} finally { factsLoading.value = false }
}
onMounted(loadFacts)
const sortKey = ref<ColKey>('updated')
const sortDir = ref<'asc' | 'desc'>('desc')

const states = computed(() => [...new Set(dealerships.value.map(d => d.state).filter(Boolean))].sort())
const uniq = (xs: (string | undefined | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b))
const brandOptions = computed(() => uniq(dealerships.value.flatMap(d => d.brands || [])))
const groupOptions = computed(() => uniq(dealerships.value.map(d => d.dealerGroup)))
const cityOptions = computed(() => uniq(dealerships.value.filter(d => state.value === 'all' || d.state === state.value).map(d => d.city)))
const territoryOptions = computed(() => uniq(dealerships.value.map(d => d.territory)))
const routeOptions = computed(() => uniq(dealerships.value.map(d => d.route || '')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
const daysSince = (iso?: string | null) => iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : null
function matchesMore(d: CrmDealership) {
  if (brand.value !== 'all' && !(d.brands || []).includes(brand.value)) return false
  if (group.value !== 'all' && (group.value === '__none' ? !!d.dealerGroup : d.dealerGroup !== group.value)) return false
  if (city.value !== 'all' && d.city !== city.value) return false
  if (territory.value !== 'all' && d.territory !== territory.value) return false
  if (routeF.value !== 'all' && (d.route || '') !== (routeF.value === '__none' ? '' : routeF.value)) return false
  if (nextActionF.value !== 'all') {
    const na = d.interactionSummary?.nextAction
    const st = dueState(na?.date)
    if (nextActionF.value === 'none' && na?.date) return false
    if (nextActionF.value === 'overdue' && st !== 'overdue') return false
    if (nextActionF.value === 'today' && st !== 'today') return false
    if (nextActionF.value === 'upcoming' && (!na?.date || st === 'overdue' || st === 'today')) return false
  }
  if (lastTouchF.value !== 'all') {
    const age = daysSince(d.interactionSummary?.last?.occurredAt)
    if (lastTouchF.value === 'never' && age !== null) return false
    if (lastTouchF.value === '7' && (age === null || age > 7)) return false
    if (lastTouchF.value === '30' && (age === null || age > 30)) return false
    if (lastTouchF.value === 'older30' && (age === null || age <= 30)) return false
  }
  if (auditF.value !== 'all') {
    const a = d.auditSummary?.latest
    if (auditF.value === 'audited' && !a) return false
    if (auditF.value === 'not' && a) return false
    if (auditF.value === 'gt10' && !(a && (a.missingPhotoPct ?? 0) > 10)) return false
    if (auditF.value === 'gt20' && !(a && (a.missingPhotoPct ?? 0) > 20)) return false
  }
  if (contactsF.value === 'yes' && !d.contactSummary?.active) return false
  if (contactsF.value === 'no' && d.contactSummary?.active) return false
  if (addedF.value !== 'all') { const age = daysSince(d.createdAt); if (age === null || age > Number(addedF.value)) return false }
  return true
}
const OPT = {
  nextAction: [{ v: 'all', l: 'Any' }, { v: 'overdue', l: 'Overdue' }, { v: 'today', l: 'Due today' }, { v: 'upcoming', l: 'Upcoming' }, { v: 'none', l: 'None planned' }],
  lastTouch: [{ v: 'all', l: 'Any time' }, { v: '7', l: 'Last 7 days' }, { v: '30', l: 'Last 30 days' }, { v: 'older30', l: 'Over 30 days ago' }, { v: 'never', l: 'Never contacted' }],
  audit: [{ v: 'all', l: 'Any' }, { v: 'audited', l: 'Audited' }, { v: 'not', l: 'Not audited' }, { v: 'gt10', l: 'Over 10% missing photos' }, { v: 'gt20', l: 'Over 20% missing photos' }],
  contacts: [{ v: 'all', l: 'Any' }, { v: 'yes', l: 'Has contacts' }, { v: 'no', l: 'No contacts' }],
  added: [{ v: 'all', l: 'Any time' }, { v: '7', l: 'Last 7 days' }, { v: '30', l: 'Last 30 days' }, { v: '90', l: 'Last 90 days' }],
} as const
const lbl = (list: readonly { v: string, l: string }[], v: string) => list.find(x => x.v === v)?.l || v
/** One chip per active filter (shown under the toolbar), each removable. */
const activeChips = computed(() => {
  const c: { key: string, label: string, clear: () => void }[] = []
  if (stage.value !== 'all') c.push({ key: 'stage', label: `Stage: ${stage.value}`, clear: () => { stage.value = 'all' } })
  if (leadSource.value !== 'all') c.push({ key: 'source', label: `Source: ${leadSource.value}`, clear: () => { leadSource.value = 'all' } })
  if (assignee.value !== 'all') c.push({ key: 'owner', label: `Owner: ${assignee.value === '__none' ? 'Unassigned' : assignees.value.find(u => u.id === assignee.value)?.name || '—'}`, clear: () => { assignee.value = 'all' } })
  if (state.value !== 'all') c.push({ key: 'state', label: `State: ${state.value}`, clear: () => { state.value = 'all'; city.value = 'all' } })
  if (city.value !== 'all') c.push({ key: 'city', label: `City: ${city.value}`, clear: () => { city.value = 'all' } })
  if (territory.value !== 'all') c.push({ key: 'territory', label: `Territory: ${territory.value}`, clear: () => { territory.value = 'all' } })
  if (routeF.value !== 'all') c.push({ key: 'route', label: `Route: ${routeF.value === '__none' ? 'No route' : routeF.value}`, clear: () => { routeF.value = 'all' } })
  if (brand.value !== 'all') c.push({ key: 'brand', label: `Brand: ${brand.value}`, clear: () => { brand.value = 'all' } })
  if (group.value !== 'all') c.push({ key: 'group', label: `Group: ${group.value === '__none' ? 'Independent' : group.value}`, clear: () => { group.value = 'all' } })
  if (nextActionF.value !== 'all') c.push({ key: 'na', label: `Next action: ${lbl(OPT.nextAction, nextActionF.value)}`, clear: () => { nextActionF.value = 'all' } })
  if (lastTouchF.value !== 'all') c.push({ key: 'lt', label: `Last touch: ${lbl(OPT.lastTouch, lastTouchF.value)}`, clear: () => { lastTouchF.value = 'all' } })
  if (auditF.value !== 'all') c.push({ key: 'audit', label: `Audit: ${lbl(OPT.audit, auditF.value)}`, clear: () => { auditF.value = 'all' } })
  if (contactsF.value !== 'all') c.push({ key: 'contacts', label: lbl(OPT.contacts, contactsF.value), clear: () => { contactsF.value = 'all' } })
  if (addedF.value !== 'all') c.push({ key: 'added', label: `Added: ${lbl(OPT.added, addedF.value)}`, clear: () => { addedF.value = 'all' } })
  return c
})
const assignees = computed(() => {
  const m = new Map<string, string>()
  for (const d of dealerships.value) if (d.assignedUserId) m.set(d.assignedUserId, d.assignedUserName || 'Unknown')
  return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
})

/** Milliseconds the dealership has been in its current stage. */
function stageAgeMs(d: CrmDealership) {
  const at = d.stageChangedAt || d.createdAt
  return at ? Date.now() - new Date(at).getTime() : 0
}
function isStalled(d: CrmDealership) {
  return !CLOSED_STAGES.includes(d.stage) && d.stage !== 'Nurture / Follow Up Later' && stageAgeMs(d) > STALLED_STAGE_DAYS * 86_400_000
}
/** Active (past the research/contact queues), not won/parked, and no dated next action. */
function hasNoNextStep(d: CrmDealership) {
  return !d.dealerId && OPEN_STAGES.includes(d.stage) && !QUEUE_STAGES.includes(d.stage) && !d.interactionSummary?.nextAction?.date
}
/** Has an open next action dated today or earlier. */
function isFollowUpDue(d: CrmDealership) {
  const s = dueState(d.interactionSummary?.nextAction?.date)
  return s === 'overdue' || s === 'today'
}
function needsVerification(d: CrmDealership) {
  const s = d.contactSummary
  if (!s || s.active === 0) return false
  return verificationState(s.oldestVerification) === 'stale' || !s.oldestVerification
}
const quickCounts = computed(() => ({
  all: dealerships.value.length,
  won: dealerships.value.filter(d => d.stage === WON_STAGE).length,
  stalled: dealerships.value.filter(isStalled).length,
  followUps: dealerships.value.filter(isFollowUpDue).length,
  noNextStep: dealerships.value.filter(hasNoNextStep).length,
  neverContacted: dealerships.value.filter(d => !d.interactionSummary?.count).length,
  stale: dealerships.value.filter(needsVerification).length,
  unassigned: dealerships.value.filter(d => !d.assignedUserId).length,
  noContacts: dealerships.value.filter(d => !(d.contactSummary?.active)).length,
  notAudited: dealerships.value.filter(d => !d.auditSummary?.latest).length,
}))
const QUICK: { key: typeof quick.value, label: string, tone?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'won', label: 'Won', tone: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'followUps', label: 'Follow-ups due', tone: 'text-rose-600 dark:text-rose-400' },
  { key: 'noNextStep', label: 'No next step', tone: 'text-rose-600 dark:text-rose-400' },
  { key: 'stalled', label: `Stalled ${STALLED_STAGE_DAYS}d+`, tone: 'text-orange-600 dark:text-orange-400' },
  { key: 'neverContacted', label: 'Never contacted' },
  { key: 'stale', label: 'Needs verification', tone: 'text-amber-600 dark:text-amber-400' },
  { key: 'unassigned', label: 'Unassigned', tone: 'text-rose-600 dark:text-rose-400' },
  { key: 'noContacts', label: 'No contacts' },
  { key: 'notAudited', label: 'Not audited', tone: 'text-violet-600 dark:text-violet-400' },
]

const sortValue = (d: CrmDealership, k: ColKey): string | number => ({
  dealershipId: d.dealershipId, name: d.name, dealerGroup: d.dealerGroup, brands: (d.brands || []).join(', '), stage: DEALERSHIP_STAGES.indexOf(d.stage as any), inStage: stageAgeMs(d), lastTouch: d.interactionSummary?.last?.occurredAt || '', nextAction: d.interactionSummary?.nextAction?.date || (d.interactionSummary?.nextAction ? '9999-12-30' : '9999-12-31'),
  leadSource: d.leadSource, city: d.city, state: d.state, zip: d.zip, phone: d.phone, website: d.website, territory: d.territory, route: d.route || '', scanPages: scanPageCount(d),
  primaryContact: d.contactSummary?.primary?.fullName || '', primaryTitle: d.contactSummary?.primary?.jobTitle || '', primaryEmail: d.contactSummary?.primary?.email || '',
  contacts: d.contactSummary?.active || 0, owner: d.assignedUserName, added: d.createdAt, updated: d.updatedAt,
  lastAudit: d.auditSummary?.latest?.auditedAt || '', missingPhotos: d.auditSummary?.latest?.missingPhotoPct ?? -1, inventory: d.auditSummary?.latest?.totalVehicles ?? -1,
})[k] ?? ''

const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase()
  const list = dealerships.value.filter((d) => {
    if (stage.value !== 'all' && d.stage !== stage.value) return false
    if (leadSource.value !== 'all' && d.leadSource !== leadSource.value) return false
    if (state.value !== 'all' && d.state !== state.value) return false
    if (assignee.value !== 'all' && (assignee.value === '__none' ? !!d.assignedUserId : d.assignedUserId !== assignee.value)) return false
    if (quick.value === 'won' && d.stage !== WON_STAGE) return false
    if (quick.value === 'stalled' && !isStalled(d)) return false
    if (quick.value === 'followUps' && !isFollowUpDue(d)) return false
    if (quick.value === 'noNextStep' && !hasNoNextStep(d)) return false
    if (quick.value === 'neverContacted' && d.interactionSummary?.count) return false
    if (quick.value === 'stale' && !needsVerification(d)) return false
    if (quick.value === 'unassigned' && d.assignedUserId) return false
    if (quick.value === 'noContacts' && d.contactSummary?.active) return false
    if (quick.value === 'notAudited' && d.auditSummary?.latest) return false
    if (conditions.value.length && !matchAll(conditions.value, d, factsById.value.get(d.id))) return false
    if (!matchesMore(d)) return false
    if (!needle) return true
    return [d.dealershipId, d.name, d.dealerGroup, d.city, d.state, d.zip, d.territory, d.route, d.assignedUserName, d.phone, d.website,
      ...(d.brands || []), d.contactSummary?.primary?.fullName, d.contactSummary?.primary?.email].filter(Boolean).join(' ').toLowerCase().includes(needle)
  })
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    const av = sortValue(a, sortKey.value), bv = sortValue(b, sortKey.value)
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir
  })
})
function toggleSort(k: ColKey) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortKey.value = k; sortDir.value = ['updated', 'added', 'contacts', 'inStage', 'lastTouch'].includes(k) ? 'desc' : 'asc' }
}
/** Filters inside the header "Filters" button (quick views are separate tabs). */
const filterCount = computed(() => activeChips.value.length + conditions.value.length)
const activeFilterCount = computed(() => filterCount.value + (quick.value !== 'all' ? 1 : 0))
function resetPanelFilters() {
  stage.value = leadSource.value = state.value = assignee.value = brand.value = group.value = city.value = territory.value = routeF.value = 'all'
  nextActionF.value = 'all'; lastTouchF.value = 'all'; auditF.value = 'all'; contactsF.value = 'all'; addedF.value = 'all'
  conditions.value = []
}
function clearFilters() { resetPanelFilters(); quick.value = 'all'; search.value = '' }

// ─── Pagination ───
// Load more on scroll — rows are added in batches as the bottom of the list comes into view.
const BATCH = 50
const shownCount = ref(BATCH)
const scroller = ref<HTMLElement | null>(null)
watch([q, stage, leadSource, state, assignee, quick, conditions, brand, group, city, territory, nextActionF, lastTouchF, auditF, contactsF, addedF, sortKey, sortDir], () => {
  shownCount.value = BATCH
  scroller.value?.scrollTo({ top: 0 })
}, { deep: true })
const rows = computed(() => filtered.value.slice(0, shownCount.value))
const hasMore = computed(() => shownCount.value < filtered.value.length)
function loadMore() { if (hasMore.value) shownCount.value += BATCH }
useInfiniteScroll(scroller, loadMore, { distance: 400, canLoadMore: () => hasMore.value })
const rangeLabel = computed(() => `${rows.value.length} of ${filtered.value.length}`)

// ─── Selection & bulk actions ───
const selected = ref<Set<string>>(new Set())
const allOnPageSelected = computed(() => rows.value.length > 0 && rows.value.every(d => selected.value.has(d.id)))
const someOnPageSelected = computed(() => rows.value.some(d => selected.value.has(d.id)))
function toggleRow(id: string) { const s = new Set(selected.value); s.has(id) ? s.delete(id) : s.add(id); selected.value = s }
function togglePage() { const s = new Set(selected.value); allOnPageSelected.value ? rows.value.forEach(d => s.delete(d.id)) : rows.value.forEach(d => s.add(d.id)); selected.value = s }
function clearSelection() { selected.value = new Set() }
const bulkBusy = ref(false)
interface UserOpt { id: string, name: string }
const users = ref<UserOpt[]>([])
async function loadUsers() {
  if (users.value.length) return
  try { const res = await $fetch<any[]>('/api/users'); users.value = (res || []).filter(u => u.status !== 'Inactive').map(u => ({ id: u.id, name: u.name || u.email })) } catch {}
}
async function bulk(label: string, patch: (d: CrmDealership) => Record<string, any>) {
  const ids = [...selected.value]
  if (!ids.length) return
  bulkBusy.value = true
  let ok = 0
  for (const id of ids) {
    const d = dealerships.value.find(x => x.id === id)
    if (!d) continue
    try { await updateDealership(id, patch(d)); ok++ } catch {}
  }
  bulkBusy.value = false
  toast[ok === ids.length ? 'success' : 'warning'](`${label} applied to ${ok} of ${ids.length} dealerships`)
  clearSelection()
}
function bulkStage(s: string) {
  if (s === 'Lost') { lostForm.value = { lostReason: '', lostNotes: '', lostCompetitor: '' }; lostError.value = ''; showBulkLost.value = true; return }
  bulk(s === WON_STAGE ? 'Won → promoted to Dealers' : `Stage → ${s}`, () => ({ stage: s, source: 'bulk' as const }))
}
// Marking deals Lost always asks why — one reason applies to the whole selection.
const showBulkLost = ref(false)
const lostForm = ref({ lostReason: '', lostNotes: '', lostCompetitor: '' })
const lostError = ref('')
function confirmBulkLost() {
  const l = lostForm.value
  if (!l.lostReason) { lostError.value = 'Pick the reason these deals were lost'; return }
  if (l.lostReason === 'Other' && !l.lostNotes.trim()) { lostError.value = 'Describe the reason in the notes'; return }
  showBulkLost.value = false
  bulk(`Lost · ${l.lostReason}`, () => ({ stage: 'Lost', source: 'bulk' as const, lostReason: l.lostReason, lostNotes: l.lostNotes.trim(), lostCompetitor: l.lostCompetitor.trim() }))
}
const bulkAssign = (u: UserOpt | null) => bulk(u ? `Assigned to ${u.name}` : 'Unassigned', () => ({ assignedUserId: u?.id || '', assignedUserName: u?.name || '' }))

// ─── Actions ───
const showForm = ref(false)
// "Search Web" — Google Places discovery (deep link: /crm/dealership?discover=1)
// (No URL syncing on open/close: query-only navigations trigger the clear-header middleware.)
const showDiscover = ref(route.query.discover === '1')
async function onDiscoverImported() {
  try { await Promise.all([fetchDealerships(), loadFacts()]) } catch {}
}
const refreshing = ref(false)
async function refresh() {
  refreshing.value = true
  try { await Promise.all([fetchDealerships(), loadFacts()]); toast.success('Dealerships refreshed') } catch { toast.error('Refresh failed') } finally { refreshing.value = false }
}
function open(d: CrmDealership) { navigateTo(`/crm/dealership/${d.id}`) }

function exportCsv(onlySelected = false) {
  const data = onlySelected ? filtered.value.filter(d => selected.value.has(d.id)) : filtered.value
  if (!data.length) return toast.error('Nothing to export')
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['Dealership ID', 'Name', 'Dealer Group', 'Brands', 'Website', 'Address', 'City', 'State', 'ZIP', 'Phone', 'Territory', 'Route', 'Assigned To', 'Stage', 'Stage Since', 'Days In Stage', 'Last Touch', 'Last Touch Type', 'Interactions', 'Next Action', 'Next Action Date', 'Lead Source', 'Primary Contact', 'Primary Title', 'Primary Email', 'Primary Phone', 'Active Contacts', 'Former Contacts', 'Last Audit', 'Inventory', 'Missing Photos %', 'Audits', 'Added', 'Updated']
  const lines = data.map(d => [d.dealershipId, d.name, d.dealerGroup, (d.brands || []).join(' / '), d.website, d.address, d.city, d.state, d.zip, d.phone, d.territory, d.route, d.assignedUserName, d.stage, (d.stageChangedAt || d.createdAt)?.slice(0, 10), (stageAgeMs(d) / 86_400_000).toFixed(1), d.interactionSummary?.last?.occurredAt?.slice(0, 10), d.interactionSummary?.last?.typeLabel, d.interactionSummary?.count ?? 0, d.interactionSummary?.nextAction?.text, d.interactionSummary?.nextAction?.date, d.leadSource,
    d.contactSummary?.primary?.fullName, d.contactSummary?.primary?.jobTitle, d.contactSummary?.primary?.email, d.contactSummary?.primary?.mobile || d.contactSummary?.primary?.phone,
    d.contactSummary?.active ?? 0, d.contactSummary?.inactive ?? 0, d.auditSummary?.latest?.auditedAt?.slice(0, 10), d.auditSummary?.latest?.totalVehicles, d.auditSummary?.latest?.missingPhotoPct, d.auditSummary?.count ?? 0, d.createdAt?.slice(0, 10), d.updatedAt?.slice(0, 10)].map(esc).join(','))
  const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `dealerships_${new Date().toISOString().slice(0, 10)}.csv` })
  a.click(); URL.revokeObjectURL(a.href)
  toast.success(`Exported ${data.length} dealerships`)
}

// ─── Scan pages & batch scanning (Mission Control) ───
/** Pages the batch scanner will visit for a dealership — only picked / detected pages, never a bare website. */
function scanPageCount(d: CrmDealership) { return d.scanPages?.length || 0 }
const showPages = ref(false)
const pagesFor = ref<CrmDealership | null>(null)
function editPages(d: CrmDealership) { pagesFor.value = d; showPages.value = true }

const showBatch = ref(false)
const batchIds = ref<string[]>([])
const batchResumeId = ref<string | null>(null)
const selectedScannable = computed(() => [...selected.value].filter(id => { const d = dealerships.value.find(x => x.id === id); return d && scanPageCount(d) > 0 }).length)
function startBatch() {
  const ids = [...selected.value]
  if (!ids.length) return
  batchResumeId.value = null
  batchIds.value = ids
  showBatch.value = true
}
function resumeBatch(id: string) { batchIds.value = []; batchResumeId.value = id; showBatch.value = true }
// ─── Delete selected (moves to Trash — restorable with every linked record) ───
const showDelete = ref(false)
const deleteConfirm = ref('')
const deleting = ref(false)
const toDelete = computed(() => dealerships.value.filter(d => selected.value.has(d.id)))
const toDeleteWon = computed(() => toDelete.value.filter(d => d.dealerId))
const deletableCount = computed(() => toDelete.value.length - toDeleteWon.value.length)
/** Big deletes ask for the word DELETE, small ones a single click. */
const needsTyping = computed(() => deletableCount.value >= 10)
function askDelete() { deleteConfirm.value = ''; showDelete.value = true }
async function confirmDelete() {
  if (needsTyping.value && deleteConfirm.value.trim().toUpperCase() !== 'DELETE') return
  deleting.value = true
  try {
    const r = await $fetch<{ deleted: { id: string, name: string }[], skipped: { name: string, reason: string }[], undoToken: string | null, backupId: string | null }>('/api/crm/dealerships/bulk-delete', { method: 'POST', body: { ids: toDelete.value.map(d => d.id) } })
    const gone = new Set(r.deleted.map(x => x.id))
    dealerships.value = dealerships.value.filter(d => !gone.has(d.id))
    clearSelection()
    showDelete.value = false
    const token = r.undoToken
    toast.success(`${r.deleted.length} dealership${r.deleted.length === 1 ? '' : 's'} moved to Trash`, {
      description: `${r.skipped.length ? `${r.skipped.length} skipped (won accounts). ` : ''}Contacts, activity, emails and audits went with them — restore any time for 30 days.${r.backupId ? ' A full backup was saved first.' : ''}`,
      duration: 20_000,
      action: token ? { label: 'Undo', onClick: () => restoreToken(token) } : undefined,
    })
    loadFacts().catch(() => {})
  }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not delete') }
  finally { deleting.value = false }
}
async function restoreToken(undoToken: string) {
  try {
    const r = await $fetch<{ restored: any[], failed: any[] }>('/api/crm/dealerships/trash/restore', { method: 'POST', body: { undoToken } })
    toast.success(`Restored ${r.restored.length} dealership${r.restored.length === 1 ? '' : 's'}`, { description: r.failed.length ? `${r.failed.length} could not be restored` : 'Everything is back, history included.' })
    await Promise.all([fetchDealerships(), loadFacts()])
    if (showTrash.value) loadTrash()
  }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not restore') }
}

// ─── Trash ───
interface TrashRow { id: string, undoToken: string | null, code: string, name: string, city: string, state: string, counts: Record<string, number>, deletedAt: string, deletedBy: { name: string } | null, restorable: boolean }
const showTrash = ref(false)
const trash = ref<TrashRow[]>([])
const trashLoading = ref(false)
const trashPick = ref<Set<string>>(new Set())
const trashQ = ref('')
const trashShown = computed(() => { const n = trashQ.value.trim().toLowerCase(); return n ? trash.value.filter(t => `${t.name} ${t.city} ${t.code}`.toLowerCase().includes(n)) : trash.value })
async function loadTrash() {
  trashLoading.value = true
  try { trash.value = (await $fetch<{ items: TrashRow[] }>('/api/crm/dealerships/trash')).items; trashPick.value = new Set() } catch {} finally { trashLoading.value = false }
}
function openTrash() { showTrash.value = true; loadTrash() }
function toggleTrash(id: string) { const s = new Set(trashPick.value); s.has(id) ? s.delete(id) : s.add(id); trashPick.value = s }
const restoring = ref(false)
async function restorePicked(ids?: string[]) {
  const list = ids || [...trashPick.value]
  if (!list.length) return
  restoring.value = true
  try {
    const r = await $fetch<{ restored: any[], failed: { name: string, reason: string }[] }>('/api/crm/dealerships/trash/restore', { method: 'POST', body: { ids: list } })
    toast.success(`Restored ${r.restored.length} dealership${r.restored.length === 1 ? '' : 's'}`, { description: r.failed.length ? r.failed.map(f => `${f.name}: ${f.reason}`).slice(0, 3).join(' · ') : 'Contacts, activity, emails and audits are back too.' })
    await Promise.all([fetchDealerships(), loadFacts(), loadTrash()])
  }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not restore') }
  finally { restoring.value = false }
}
const linkedCount = (c: Record<string, number>) => Object.values(c || {}).reduce((a, b) => a + b, 0)

async function onBatchDone() { try { await Promise.all([fetchDealerships(), loadFacts(), loadBatches()]) } catch {} }

// Recent batches (resume the unfinished ones from here — a closed Mission Control only pauses them).
const batches = ref<ScanBatch[]>([])
const batchesLoading = ref(false)
const openBatches = computed(() => batches.value.filter(b => !b.finished))
async function loadBatches() {
  batchesLoading.value = true
  try { batches.value = (await $fetch<{ batches: ScanBatch[] }>('/api/scanner/batches')).batches.slice(0, 12) } catch {} finally { batchesLoading.value = false }
}
onMounted(loadBatches)
watch(showBatch, (v) => { if (!v) loadBatches() })
// ─── Quick edit (spreadsheet mode) ───
const gridMode = ref(route.query.edit === '1')
const gridRef = ref<{ dirty: boolean } | null>(null)
function toggleGrid() {
  if (gridMode.value && gridRef.value?.dirty && !confirm('You have unsaved changes in quick edit. Leave and lose them?')) return
  gridMode.value = !gridMode.value
  if (gridMode.value) { loadUsers(); clearSelection() }
}
async function onGridSaved() { try { await Promise.all([fetchDealerships(), loadFacts()]) } catch {} }
onKeyStroke('e', (e) => { if (!isTyping(e) && canEdit.value && !showForm.value && !showDiscover.value && !gridMode.value) { e.preventDefault(); toggleGrid() } })

const batchWhen = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true })


// Keyboard: "/" focuses search, "n" new, Esc clears selection
const searchEl = ref<any>(null)
const isTyping = (e: KeyboardEvent) => ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable
onKeyStroke('/', (e) => { if (!isTyping(e)) { e.preventDefault(); (searchEl.value?.$el ?? searchEl.value)?.focus?.() } })
onKeyStroke('n', (e) => { if (!isTyping(e) && canAdd.value && !showForm.value) { e.preventDefault(); showForm.value = true } })
onKeyStroke('d', (e) => { if (!isTyping(e) && canAdd.value && !showForm.value && !showDiscover.value) { e.preventDefault(); showDiscover.value = true } })
onKeyStroke('Escape', () => { if (selected.value.size) clearSelection() })
</script>

<template>
  <div class="absolute inset-0 flex flex-col overflow-hidden">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <div class="relative w-44 xl:w-64">
          <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input ref="searchEl" v-model="search" placeholder="Search dealerships…" class="pl-8 pr-8 h-8 bg-background" />
          <kbd class="absolute right-2 top-1/2 -translate-y-1/2 hidden md:inline-flex h-5 items-center rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">/</kbd>
        </div>
        <Popover v-model:open="filtersOpen">
          <PopoverTrigger as-child>
            <Button :variant="filterCount ? 'default' : 'outline'" size="sm" class="h-8 gap-1.5">
              <SlidersHorizontal class="size-4" /> Filters
              <span v-if="filterCount" class="rounded-full bg-primary-foreground/20 px-1.5 text-[11px] tabular-nums leading-4">{{ filterCount }}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-[min(92vw,640px)] p-0">
            <div class="flex items-center justify-between border-b px-2 py-2">
              <p class="text-sm font-semibold">Filters</p>
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted-foreground"><b class="text-foreground tabular-nums">{{ filtered.length }}</b> of {{ dealerships.length }}</span>
                <Button v-if="filterCount" variant="ghost" size="sm" class="h-7 text-xs" @click="resetPanelFilters">Reset</Button>
              </div>
            </div>
            <div class="max-h-[70vh] overflow-y-auto p-2 space-y-2">
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <label class="space-y-1"><span class="text-[11px] font-medium text-muted-foreground">Stage</span>
                  <Select v-model="stage"><SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent class="max-h-80"><SelectItem value="all">All stages</SelectItem><SelectItem v-for="st in DEALERSHIP_STAGES" :key="st" :value="st"><span class="flex items-center gap-2"><span class="size-1.5 rounded-full" :class="STAGE_STYLE[st]?.dot" />{{ st }}</span></SelectItem></SelectContent></Select>
                </label>
                <label class="space-y-1"><span class="text-[11px] font-medium text-muted-foreground">Lead source</span>
                  <Select v-model="leadSource"><SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All lead sources</SelectItem><SelectItem v-for="ls in LEAD_SOURCES" :key="ls" :value="ls">{{ ls }}</SelectItem></SelectContent></Select>
                </label>
                <label class="space-y-1"><span class="text-[11px] font-medium text-muted-foreground">Salesperson</span>
                  <Select v-model="assignee"><SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent class="max-h-72"><SelectItem value="all">All salespeople</SelectItem><SelectItem value="__none">Unassigned</SelectItem><SelectItem v-for="u in assignees" :key="u.id" :value="u.id">{{ u.name }}</SelectItem></SelectContent></Select>
                </label>
                <label class="space-y-1"><span class="text-[11px] font-medium text-muted-foreground">State</span>
                  <Select v-model="state" @update:model-value="city = 'all'"><SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent class="max-h-72"><SelectItem value="all">All states</SelectItem><SelectItem v-for="st in states" :key="st" :value="st">{{ st }}</SelectItem></SelectContent></Select>
                </label>
                <label class="space-y-1"><span class="text-[11px] font-medium text-muted-foreground">City</span>
                  <Select v-model="city"><SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent class="max-h-72"><SelectItem value="all">All cities</SelectItem><SelectItem v-for="c in cityOptions" :key="c" :value="c">{{ c }}</SelectItem></SelectContent></Select>
                </label>
                <label class="space-y-1"><span class="text-[11px] font-medium text-muted-foreground">Route / day</span>
                  <Select v-model="routeF"><SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent class="max-h-72"><SelectItem value="all">All routes</SelectItem><SelectItem value="__none">No route</SelectItem><SelectItem v-for="r in routeOptions" :key="r" :value="r">{{ r }}</SelectItem></SelectContent></Select>
                </label>
                <label class="space-y-1"><span class="text-[11px] font-medium text-muted-foreground">Territory</span>
                  <Select v-model="territory"><SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent class="max-h-72"><SelectItem value="all">All territories</SelectItem><SelectItem v-for="t in territoryOptions" :key="t" :value="t">{{ t }}</SelectItem></SelectContent></Select>
                </label>
                <label class="space-y-1"><span class="text-[11px] font-medium text-muted-foreground">Brand</span>
                  <Select v-model="brand"><SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent class="max-h-72"><SelectItem value="all">All brands</SelectItem><SelectItem v-for="b in brandOptions" :key="b" :value="b">{{ b }}</SelectItem></SelectContent></Select>
                </label>
                <label class="space-y-1"><span class="text-[11px] font-medium text-muted-foreground">Dealer group</span>
                  <Select v-model="group"><SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent class="max-h-72"><SelectItem value="all">All groups</SelectItem><SelectItem value="__none">Independent (no group)</SelectItem><SelectItem v-for="g in groupOptions" :key="g" :value="g">{{ g }}</SelectItem></SelectContent></Select>
                </label>
                <label class="space-y-1"><span class="text-[11px] font-medium text-muted-foreground">Next action</span>
                  <Select v-model="nextActionF"><SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem v-for="o in OPT.nextAction" :key="o.v" :value="o.v">{{ o.l }}</SelectItem></SelectContent></Select>
                </label>
                <label class="space-y-1"><span class="text-[11px] font-medium text-muted-foreground">Last touch</span>
                  <Select v-model="lastTouchF"><SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem v-for="o in OPT.lastTouch" :key="o.v" :value="o.v">{{ o.l }}</SelectItem></SelectContent></Select>
                </label>
                <label class="space-y-1"><span class="text-[11px] font-medium text-muted-foreground">Inventory audit</span>
                  <Select v-model="auditF"><SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem v-for="o in OPT.audit" :key="o.v" :value="o.v">{{ o.l }}</SelectItem></SelectContent></Select>
                </label>
                <label class="space-y-1"><span class="text-[11px] font-medium text-muted-foreground">Contacts</span>
                  <Select v-model="contactsF"><SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem v-for="o in OPT.contacts" :key="o.v" :value="o.v">{{ o.l }}</SelectItem></SelectContent></Select>
                </label>
                <label class="space-y-1"><span class="text-[11px] font-medium text-muted-foreground">Added</span>
                  <Select v-model="addedF"><SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem v-for="o in OPT.added" :key="o.v" :value="o.v">{{ o.l }}</SelectItem></SelectContent></Select>
                </label>
              </div>
              <div class="rounded-lg border p-2 space-y-1.5">
                <p class="text-[11px] font-medium text-muted-foreground">Activity &amp; history conditions — e.g. “emailed twice, no reply”, “GM replied positively, no meeting”</p>
                <CrmAdvancedFilters v-model="conditions" :loading="factsLoading" />
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Button
          v-if="canEdit" :variant="gridMode ? 'default' : 'outline'" size="sm" class="h-8 gap-1.5" :class="!gridMode && 'border-emerald-500/50 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400'"
          title="Quick edit — edit the list like a spreadsheet (E)" @click="toggleGrid"
        >
          <Grid3x3 class="size-4" /><span class="hidden lg:inline">{{ gridMode ? 'Exit quick edit' : 'Quick edit' }}</span>
        </Button>
        <DropdownMenu @update:open="(v: boolean) => v && loadBatches()">
          <DropdownMenuTrigger as-child>
            <Button variant="outline" size="sm" class="relative h-8 gap-1.5" :class="openBatches.length && 'border-rose-500/50 text-rose-600 hover:text-rose-600 dark:text-rose-400'" title="Scan batches — Mission Control">
              <Radar class="size-4" :class="openBatches.length && 'animate-pulse'" /><span class="hidden xl:inline">Batches</span>
              <span v-if="openBatches.length" class="rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold leading-4 text-white tabular-nums">{{ openBatches.length }}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-80">
            <DropdownMenuLabel class="text-xs text-muted-foreground">Scan batches · Mission Control</DropdownMenuLabel>
            <DropdownMenuItem v-if="batchesLoading && !batches.length" disabled><Loader2 class="size-4 animate-spin" /> Loading…</DropdownMenuItem>
            <DropdownMenuItem v-else-if="!batches.length" disabled class="text-xs">No batches yet — select dealerships below and click <b class="mx-1">Scrape &amp; email</b>.</DropdownMenuItem>
            <DropdownMenuItem v-for="b in batches" :key="b.id" class="flex items-start gap-2.5 py-2" @click="resumeBatch(b.id)">
              <component :is="b.finished ? CheckCircle2 : CircleDashed" class="mt-0.5 size-4 shrink-0" :class="b.finished ? 'text-emerald-500' : 'text-rose-500 animate-spin [animation-duration:3s]'" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{{ b.name }}</span>
                <span class="block text-[11px] text-muted-foreground tabular-nums">
                  {{ b.counts.done }}/{{ b.counts.total }} scanned · {{ b.totals.vehicles }} vehicles
                  <template v-if="b.totals.emailed"> · <Mail class="inline size-3" /> {{ b.totals.emailed }} emailed</template>
                  · {{ batchWhen(b.createdAt) }}
                </span>
              </span>
              <span class="shrink-0 text-[10px] font-semibold uppercase tracking-wider" :class="b.finished ? 'text-muted-foreground' : 'text-rose-600 dark:text-rose-400'">{{ b.finished ? 'Open' : 'Resume' }}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button v-if="canDelete" variant="outline" size="icon" class="size-8" title="Trash — restore deleted dealerships (30 days)" @click="openTrash"><Trash2 class="size-4" /></Button>
        <Button variant="outline" size="icon" class="size-8" title="Refresh" :disabled="refreshing" @click="refresh">
          <RefreshCw class="size-4" :class="refreshing && 'animate-spin'" />
        </Button>
        <Button variant="outline" size="icon" class="size-8" title="Export CSV" @click="exportCsv(false)">
          <Download class="size-4" />
        </Button>
        <Button v-if="canAdd" variant="outline" size="icon" class="size-8" title="Import CSV" @click="navigateTo('/crm/data-quality?tab=import')">
          <Upload class="size-4" />
        </Button>
        <Button v-if="canAdd" variant="outline" size="sm" class="h-8 gap-1.5 border-primary/50 text-primary hover:bg-primary/10 hover:text-primary" title="Search Web — discover dealerships near base (Google Places)" @click="showDiscover = true">
          <Binoculars class="size-4" /><span class="hidden lg:inline">Search Web</span>
        </Button>
        <Button v-if="canAdd" size="sm" class="h-8 gap-1.5" @click="showForm = true">
          <Plus class="size-4" /><span class="hidden lg:inline">New dealership</span>
        </Button>
      </Teleport>
    </ClientOnly>

    <!-- Toolbar -->
    <div class="shrink-0 bg-background px-2 py-3 space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <!-- Quick views -->
        <div class="flex w-full items-center overflow-x-auto rounded-lg border bg-muted/40 p-0.5 gap-0.5" role="tablist" aria-label="Quick views">
          <button
            v-for="qv in QUICK" :key="qv.key" type="button" role="tab" :aria-selected="quick === qv.key"
            class="inline-flex flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-all"
            :class="quick === qv.key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="quick = quick === qv.key ? 'all' : qv.key"
          >
            {{ qv.label }}
            <span class="rounded-full px-1.5 py-px text-[10px] tabular-nums leading-none" :class="[quick === qv.key ? 'bg-muted' : 'bg-transparent', qv.tone && quickCounts[qv.key] ? qv.tone : '']">{{ quickCounts[qv.key] }}</span>
          </button>
        </div>
      </div>

      <!-- Active filters -->
      <div v-if="activeChips.length || conditions.length || q" class="flex flex-wrap items-center gap-1.5">
        <span v-for="c in activeChips" :key="c.key" class="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 pl-2.5 pr-1 py-0.5 text-xs">
          {{ c.label }}<button type="button" class="rounded-full p-0.5 hover:bg-primary/10" :aria-label="`Remove ${c.label}`" @click="c.clear()"><X class="size-3" /></button>
        </span>
        <button v-if="conditions.length" type="button" class="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs" @click="filtersOpen = true">{{ conditions.length }} history condition{{ conditions.length === 1 ? '' : 's' }}</button>
        <Button variant="ghost" size="sm" class="h-6 gap-1 text-xs text-muted-foreground" @click="clearFilters"><X class="size-3.5" /> Clear all</Button>
      </div>

      <!-- Bulk action bar -->
      <Transition name="slide">
        <div v-if="selected.size && !gridMode" class="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <CheckSquare class="size-4 text-primary" />
          <span class="text-sm font-medium tabular-nums">{{ selected.size }} selected</span>
          <Separator orientation="vertical" class="h-4 mx-1" />
          <DropdownMenu v-if="canEdit">
            <DropdownMenuTrigger as-child><Button variant="outline" size="sm" class="h-7 gap-1.5 text-xs bg-background" :disabled="bulkBusy"><Tag class="size-3.5" /> Set stage</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="max-h-[60vh] overflow-y-auto">
              <DropdownMenuItem v-for="s in DEALERSHIP_STAGES" :key="s" @click="bulkStage(s)"><span class="size-2 rounded-full" :class="STAGE_STYLE[s]?.dot" />{{ s }}<span v-if="s === WON_STAGE" class="text-[10px] text-muted-foreground ml-1">· promotes to Dealers</span></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu v-if="canEdit" @update:open="$event && loadUsers()">
            <DropdownMenuTrigger as-child><Button variant="outline" size="sm" class="h-7 gap-1.5 text-xs bg-background" :disabled="bulkBusy"><UserCheck class="size-3.5" /> Assign owner</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="max-h-72 overflow-y-auto">
              <DropdownMenuItem @click="bulkAssign(null)"><UserCircle2 class="size-4" /> Unassigned</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem v-for="u in users" :key="u.id" @click="bulkAssign(u)">{{ u.name }}</DropdownMenuItem>
              <DropdownMenuItem v-if="!users.length" disabled><Loader2 class="size-4 animate-spin" /> Loading…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" class="h-7 gap-1.5 text-xs bg-background" @click="exportCsv(true)"><Download class="size-3.5" /> Export selected</Button>
          <Button v-if="canDelete" variant="outline" size="sm" class="h-7 gap-1.5 text-xs bg-background border-rose-500/40 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400" :disabled="bulkBusy" @click="askDelete"><Trash2 class="size-3.5" /> Delete {{ selected.size }}</Button>
          <Button
            v-if="canEdit" size="sm" class="h-7 gap-1.5 text-xs bg-rose-600 text-white shadow-sm hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-500"
            :disabled="bulkBusy" :title="selectedScannable < selected.size ? `${selected.size - selectedScannable} of the selected have no scan pages yet — Mission Control can detect them before starting` : 'Scrape the selected dealerships in one go, then email them — Mission Control'"
            @click="startBatch"
          >
            <ScanSearch class="size-3.5" /> Scrape &amp; email
            <span v-if="selectedScannable < selected.size" class="rounded bg-white/20 px-1 text-[10px] tabular-nums">{{ selectedScannable }}/{{ selected.size }}</span>
          </Button>
          <Loader2 v-if="bulkBusy" class="size-4 animate-spin text-primary" />
          <Button variant="ghost" size="sm" class="h-7 ml-auto text-xs" @click="clearSelection">Clear <kbd class="ml-1.5 font-mono text-[10px] opacity-60">Esc</kbd></Button>
        </div>
      </Transition>
    </div>

    <!-- Grid + footer: one bordered box, 8px from the page edges -->
    <div class="flex-1 min-h-0 flex flex-col px-2 pb-2">
    <div class="crm-grid-box flex-1 min-h-0 flex flex-col overflow-hidden rounded-lg border-2 border-primary bg-background">
    <div v-if="gridMode" class="relative flex-1 min-h-0">
      <ClientOnly>
        <CrmDealershipGrid ref="gridRef" :rows="filtered" :users="users" :can-edit="canEdit" :can-add="canAdd" @close="toggleGrid" @saved="onGridSaved" />
      </ClientOnly>
    </div>
    <div v-else ref="scroller" class="flex-1 min-h-0 overflow-auto">
      <!-- Loading -->
      <div v-if="(isLoading || pending) && dealerships.length === 0" class="divide-y">
        <div v-for="i in 10" :key="i" class="flex items-center gap-4 px-6 py-3.5">
          <Skeleton class="size-4 rounded" /><Skeleton class="size-9 rounded-lg" />
          <div class="flex-1 space-y-2"><Skeleton class="h-3.5 w-56" /><Skeleton class="h-3 w-36" /></div>
          <Skeleton class="h-5 w-20 rounded-full" /><Skeleton class="h-3 w-28" /><Skeleton class="h-3 w-24" />
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="filtered.length === 0" class="h-full flex flex-col items-center justify-center py-24 text-center px-6">
        <div class="relative">
          <div class="absolute inset-0 bg-primary/5 rounded-full blur-2xl" />
          <div class="relative size-20 rounded-2xl bg-gradient-to-br from-muted to-muted/40 border-2 border-dashed flex items-center justify-center">
            <component :is="dealerships.length ? Filter : Store" class="size-9 text-muted-foreground/40" />
          </div>
        </div>
        <h3 class="mt-6 text-lg font-semibold">{{ dealerships.length ? 'No dealerships match' : 'Your dealership book is empty' }}</h3>
        <p class="mt-2 text-sm text-muted-foreground max-w-sm">
          {{ dealerships.length ? 'Try widening the filters or clearing the search.' : 'Create the first permanent record. Every dealership gets its own ID, contact roster and history.' }}
        </p>
        <Button v-if="dealerships.length" variant="outline" size="sm" class="mt-5" @click="clearFilters">Clear filters</Button>
        <Button v-else-if="canAdd" size="sm" class="mt-5 gap-2" @click="showForm = true"><Plus class="size-4" /> New dealership</Button>
      </div>

      <table v-else class="crm-grid w-full text-[13px] leading-5 border-separate border-spacing-0">
        <thead class="sticky top-0 z-10">
          <tr class="text-[11px] uppercase tracking-wider">
            <th class="w-10 px-3 border-b border-border py-1.5 text-left">
              <Checkbox :model-value="allOnPageSelected ? true : (someOnPageSelected ? 'indeterminate' : false)" aria-label="Select loaded rows" class="border-white/60 data-[state=checked]:border-white" @update:model-value="togglePage" />
            </th>
            <th v-for="c in shownColumns" :key="c.key" class="font-medium px-3 py-1.5 whitespace-nowrap border-b border-border" :class="c.align === 'right' ? 'text-right' : 'text-left'">
              <button v-if="c.sortable" type="button" class="inline-flex items-center gap-1 uppercase tracking-wider hover:text-white transition-colors" :class="sortKey === c.key && 'text-white'" @click="toggleSort(c.key)">
                {{ c.label }}
                <ChevronUp v-if="sortKey === c.key && sortDir === 'asc'" class="size-3" />
                <ChevronDown v-else-if="sortKey === c.key" class="size-3" />
                <ChevronsUpDown v-else class="size-3 opacity-40" />
              </button>
              <span v-else>{{ c.label }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="d in rows" :key="d.id" tabindex="0"
            class="group cursor-pointer transition-colors outline-none hover:bg-accent/40 focus-visible:bg-accent/40"
            :class="selected.has(d.id) && 'bg-primary/5 hover:bg-primary/10'"
            @click="open(d)" @keydown.enter="open(d)"
          >
            <td class="px-3 border-b border-border/60" :class="rowPad" @click.stop>
              <Checkbox :model-value="selected.has(d.id)" :aria-label="`Select ${d.name}`" @update:model-value="toggleRow(d.id)" />
            </td>
            <template v-for="c in shownColumns" :key="c.key">
              <td v-if="c.key === 'name'" class="px-3 border-b border-border/60 whitespace-nowrap" :class="rowPad">
                <span class="font-semibold text-foreground group-hover:text-primary transition-colors">{{ d.name }}</span>
              </td>
              <td v-else-if="c.key === 'dealerGroup'" class="px-3 border-b border-border/60 whitespace-nowrap" :class="rowPad"><span v-if="d.dealerGroup">{{ d.dealerGroup }}</span><span v-else class="text-muted-foreground/50">—</span></td>
              <td v-else-if="c.key === 'brands'" class="px-3 border-b border-border/60 whitespace-nowrap" :class="rowPad">
                <div v-if="d.brands?.length" class="flex items-center gap-1"><Badge v-for="b in d.brands" :key="b" variant="secondary" class="h-[18px] text-[10px] px-1.5 py-0 font-medium">{{ b }}</Badge></div>
                <span v-else class="text-muted-foreground/50">—</span>
              </td>
              <td v-else-if="c.key === 'stage'" class="px-3 border-b border-border/60 whitespace-nowrap" :class="rowPad">
                <div class="flex items-center gap-1.5">
                  <Badge variant="outline" class="h-5 gap-1.5 py-0 text-[11px] font-medium" :class="STAGE_STYLE[d.stage]?.badge"><span class="size-1.5 rounded-full" :class="STAGE_STYLE[d.stage]?.dot" />{{ d.stage }}</Badge>
                  <NuxtLink v-if="d.dealerId" :to="`/dealers/${d.dealerId}/details`" class="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 hover:underline underline-offset-2" title="Open in Dealers" @click.stop><Briefcase class="size-3" /> Dealer</NuxtLink>
                </div>
              </td>
              <td v-else-if="c.key === 'inStage'" class="px-3 border-b border-border/60 whitespace-nowrap text-right tabular-nums text-xs" :class="[rowPad, isStalled(d) ? 'text-orange-600 dark:text-orange-400 font-medium' : 'text-muted-foreground']" :title="`In ${d.stage} since ${format(new Date(d.stageChangedAt || d.createdAt), 'PPpp')}${d.stageChangedBy?.name ? ` · moved by ${d.stageChangedBy.name}` : ''}`">{{ formatDuration(stageAgeMs(d)) }}</td>
              <td v-else-if="c.key === 'lastTouch'" class="px-3 border-b border-border/60 whitespace-nowrap text-xs" :class="rowPad">
                <span v-if="d.interactionSummary?.last" class="inline-flex items-center gap-1.5" :title="`${d.interactionSummary.last.typeLabel} · ${format(new Date(d.interactionSummary.last.occurredAt), 'PPp')} · ${d.interactionSummary.last.userName}${d.interactionSummary.last.outcome ? ` — ${d.interactionSummary.last.outcome}` : ''}`">
                  <component :is="INTERACTION_ICONS[INTERACTION_TYPE_MAP[d.interactionSummary.last.type]?.icon || 'StickyNote']" class="size-3.5 text-muted-foreground" />
                  <span>{{ d.interactionSummary.last.typeLabel }}</span>
                  <span class="text-muted-foreground">· {{ formatDistanceToNow(new Date(d.interactionSummary.last.occurredAt), { addSuffix: true }) }}</span>
                </span>
                <span v-else class="text-muted-foreground/60 italic">Never contacted</span>
              </td>
              <td v-else-if="c.key === 'nextAction'" class="px-3 border-b border-border/60 text-xs max-w-[260px]" :class="rowPad">
                <div v-if="d.interactionSummary?.nextAction" class="flex items-center gap-1.5 min-w-0" :title="d.interactionSummary.nextAction.text">
                  <span class="shrink-0 tabular-nums font-medium" :class="{ overdue: 'text-rose-600 dark:text-rose-400', today: 'text-amber-600 dark:text-amber-400', soon: 'text-sky-600 dark:text-sky-400', later: 'text-muted-foreground', none: 'text-muted-foreground' }[dueState(d.interactionSummary.nextAction.date)]">{{ d.interactionSummary.nextAction.date ? (dueState(d.interactionSummary.nextAction.date) === 'today' ? 'Today' : format(new Date(`${d.interactionSummary.nextAction.date}T00:00:00`), 'MMM d')) : 'No date' }}</span>
                  <span class="truncate text-muted-foreground">{{ d.interactionSummary.nextAction.text }}</span>
                </div>
                <span v-else class="text-muted-foreground/50">—</span>
              </td>
              <td v-else-if="c.key === 'leadSource'" class="px-3 border-b border-border/60 whitespace-nowrap" :class="rowPad">
                <span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span class="size-1.5 rounded-full" :class="LEAD_SOURCE_STYLE[d.leadSource]?.dot" />{{ d.leadSource }}</span>
              </td>
              <td v-else-if="c.key === 'city'" class="px-3 border-b border-border/60 whitespace-nowrap" :class="rowPad">{{ d.city || '—' }}</td>
              <td v-else-if="c.key === 'state'" class="px-3 border-b border-border/60 whitespace-nowrap font-mono text-xs" :class="rowPad">{{ d.state || '—' }}</td>
              <td v-else-if="c.key === 'zip'" class="px-3 border-b border-border/60 whitespace-nowrap tabular-nums" :class="rowPad">{{ d.zip || '—' }}</td>
              <td v-else-if="c.key === 'phone'" class="px-3 border-b border-border/60 whitespace-nowrap tabular-nums" :class="rowPad">
                <a v-if="d.phone" :href="`tel:${d.phone}`" class="hover:text-primary hover:underline underline-offset-2" @click.stop>{{ d.phone }}</a>
                <span v-else class="text-muted-foreground/50">—</span>
              </td>
              <td v-else-if="c.key === 'website'" class="px-3 border-b border-border/60 whitespace-nowrap" :class="rowPad">
                <a v-if="d.website" :href="d.website" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-primary hover:underline underline-offset-2" @click.stop>{{ d.website.replace(/^https?:\/\//, '') }}<ExternalLink class="size-3 opacity-50" /></a>
                <span v-else class="text-muted-foreground/50">—</span>
              </td>
              <td v-else-if="c.key === 'scanPages'" class="px-3 border-b border-border/60 whitespace-nowrap text-right tabular-nums" :class="rowPad" @click.stop>
                <button
                  type="button" class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors"
                  :class="d.scanPages?.length ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300' : d.website ? 'border-amber-500/40 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300' : 'border-dashed border-border/70 text-muted-foreground/60 hover:text-foreground'"
                  :title="d.scanPages?.length ? (d.scanPages.map(p => p.label || p.url).join('\n')) : d.website ? 'No scan pages yet — this dealership is skipped by scans. Click to detect or pick its inventory pages.' : 'No website — add one on the dealership first'"
                  :disabled="!canEdit && !d.scanPages?.length"
                  @click="editPages(d)"
                >
                  <Layers class="size-3" />
                  <template v-if="d.scanPages?.length">{{ d.scanPages.length }} page{{ d.scanPages.length === 1 ? '' : 's' }}</template>
                  <template v-else-if="d.website">Pick pages</template>
                  <template v-else>—</template>
                </button>
              </td>
              <td v-else-if="c.key === 'territory'" class="px-3 border-b border-border/60 whitespace-nowrap" :class="rowPad">{{ d.territory || '—' }}</td>
              <td v-else-if="c.key === 'route'" class="px-3 border-b border-border/60 whitespace-nowrap" :class="rowPad" @click.stop>
                <button v-if="d.route" type="button" class="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/5 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 hover:bg-sky-500/10 dark:text-sky-300" :title="`Show only ${d.route}`" @click="routeF = routeF === d.route ? 'all' : d.route!"><Route class="size-3" />{{ d.route }}</button>
                <span v-else class="text-muted-foreground/50">—</span>
              </td>
              <td v-else-if="c.key === 'primaryContact'" class="px-3 border-b border-border/60 whitespace-nowrap" :class="rowPad">
                <div v-if="d.contactSummary?.primary" class="flex items-center gap-2">
                  <span class="font-medium">{{ d.contactSummary.primary.fullName }}</span>
                  <Badge v-if="needsVerification(d)" variant="outline" class="text-[10px] gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20" title="Contact details unverified for 90+ days"><ShieldAlert class="size-3" /> Verify</Badge>
                </div>
                <span v-else class="text-xs italic text-muted-foreground/70">No contacts yet</span>
              </td>
              <td v-else-if="c.key === 'primaryTitle'" class="px-3 border-b border-border/60 whitespace-nowrap text-muted-foreground" :class="rowPad">{{ d.contactSummary?.primary ? (d.contactSummary.primary.jobTitle || d.contactSummary.primary.role) : '—' }}</td>
              <td v-else-if="c.key === 'primaryEmail'" class="px-3 border-b border-border/60 whitespace-nowrap" :class="rowPad">
                <a v-if="d.contactSummary?.primary?.email" :href="`mailto:${d.contactSummary.primary.email}`" class="hover:text-primary hover:underline underline-offset-2" @click.stop>{{ d.contactSummary.primary.email }}</a>
                <span v-else class="text-muted-foreground/50">—</span>
              </td>
              <td v-else-if="c.key === 'contacts'" class="px-3 border-b border-border/60 whitespace-nowrap text-right tabular-nums" :class="rowPad">
                <span class="font-medium">{{ d.contactSummary?.active ?? 0 }}</span>
                <span v-if="d.contactSummary?.inactive" class="text-[11px] text-muted-foreground ml-1" :title="`${d.contactSummary.inactive} former`">+{{ d.contactSummary.inactive }}</span>
              </td>
              <td v-else-if="c.key === 'owner'" class="px-3 border-b border-border/60 whitespace-nowrap" :class="rowPad">
                <span v-if="d.assignedUserName">{{ d.assignedUserName }}</span>
                <span v-else class="inline-flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400"><UserCircle2 class="size-3.5" /> Unassigned</span>
              </td>
              <td v-else-if="c.key === 'missingPhotos'" class="px-3 border-b border-border/60 whitespace-nowrap text-right tabular-nums" :class="rowPad">
                <template v-if="d.auditSummary?.latest && d.auditSummary.latest.missingPhotoPct !== null">
                  <span class="font-semibold" :class="d.auditSummary.latest.missingPhotoPct >= 25 ? 'text-rose-600 dark:text-rose-400' : d.auditSummary.latest.missingPhotoPct >= 10 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'">{{ d.auditSummary.latest.missingPhotoPct }}%</span>
                  <span v-if="d.auditSummary.previous && d.auditSummary.previous.missingPhotoPct !== null" class="ml-1 text-[10px]" :class="d.auditSummary.latest.missingPhotoPct > d.auditSummary.previous.missingPhotoPct ? 'text-rose-500' : d.auditSummary.latest.missingPhotoPct < d.auditSummary.previous.missingPhotoPct ? 'text-emerald-500' : 'text-muted-foreground'" :title="`Previous ${d.auditSummary.previous.missingPhotoPct}%`">{{ d.auditSummary.latest.missingPhotoPct > d.auditSummary.previous.missingPhotoPct ? '▲' : d.auditSummary.latest.missingPhotoPct < d.auditSummary.previous.missingPhotoPct ? '▼' : '•' }}</span>
                </template>
                <span v-else class="text-muted-foreground/50">—</span>
              </td>
              <td v-else-if="c.key === 'inventory'" class="px-3 border-b border-border/60 whitespace-nowrap text-right tabular-nums" :class="rowPad">
                <span v-if="d.auditSummary?.latest">{{ d.auditSummary.latest.totalVehicles }}</span><span v-else class="text-muted-foreground/50">—</span>
              </td>
              <td v-else-if="c.key === 'lastAudit'" class="px-3 border-b border-border/60 whitespace-nowrap text-xs" :class="rowPad">
                <template v-if="d.auditSummary?.latest">
                  <span class="text-muted-foreground tabular-nums" :title="format(new Date(d.auditSummary.latest.auditedAt), 'PPP')">{{ formatDistanceToNow(new Date(d.auditSummary.latest.auditedAt), { addSuffix: true }) }}</span>
                  <span class="ml-1 text-[10px] text-muted-foreground/70">· {{ d.auditSummary.count }}×</span>
                </template>
                <span v-else class="italic text-muted-foreground/60">Not audited</span>
              </td>
              <td v-else-if="c.key === 'added'" class="px-3 border-b border-border/60 whitespace-nowrap text-xs text-muted-foreground tabular-nums" :class="rowPad" :title="format(new Date(d.createdAt), 'PPpp')">{{ format(new Date(d.createdAt), 'MMM d, yyyy') }}</td>
              <td v-else-if="c.key === 'updated'" class="px-3 border-b border-border/60 whitespace-nowrap text-xs text-muted-foreground tabular-nums" :class="rowPad" :title="format(new Date(d.updatedAt), 'PPpp')">{{ formatDistanceToNow(new Date(d.updatedAt), { addSuffix: true }) }}</td>
            </template>
          </tr>
        </tbody>
      </table>
      <div v-if="filtered.length" class="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
        <template v-if="hasMore">
          <Loader2 class="size-3.5 animate-spin" /> Loading more…
          <Button variant="ghost" size="sm" class="h-7 text-xs" @click="loadMore">Load more</Button>
        </template>
        <span v-else-if="filtered.length > BATCH">All {{ filtered.length }} dealerships loaded</span>
      </div>
    </div>

    <!-- Footer (part of the table box) -->
    <div v-if="filtered.length && !gridMode" class="shrink-0 border-t-2 border-primary bg-muted/40 px-2 py-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span class="tabular-nums">Showing <span class="font-medium text-foreground">{{ rangeLabel }}</span></span>
      <span v-if="hasMore" class="text-muted-foreground/80">· scroll to load more</span>
      <span v-if="selected.size" class="tabular-nums">· {{ selected.size }} selected</span>
    </div>
    </div>
    </div>

    <CrmDealershipForm v-model:open="showForm" @saved="open($event)" />

    <ClientOnly>
      <CrmDiscoverDialog v-model:open="showDiscover" @imported="onDiscoverImported" />
      <CrmScanPagesEditor v-model:open="showPages" :dealership="pagesFor" />
      <CrmBatchScanner v-model:open="showBatch" :dealership-ids="batchIds" :batch-id="batchResumeId" @done="onBatchDone" />
    </ClientOnly>

    <!-- Delete selected -->
    <Dialog v-model:open="showDelete">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <div class="flex items-start gap-3">
            <div class="size-10 shrink-0 rounded-xl bg-rose-500/10 flex items-center justify-center"><Trash2 class="size-5 text-rose-600" /></div>
            <div class="min-w-0">
              <DialogTitle>Delete {{ deletableCount }} dealership{{ deletableCount === 1 ? '' : 's' }}?</DialogTitle>
              <DialogDescription class="text-xs mt-1">They move to <b class="text-foreground">Trash</b> with everything linked to them — contacts, activity, emails, audits, stage history. Restore any time in the next 30 days; after that they are gone.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <ul class="max-h-48 overflow-y-auto rounded-lg border divide-y text-sm">
          <li v-for="d in toDelete.slice(0, 50)" :key="d.id" class="flex items-center gap-2 px-3 py-1.5" :class="d.dealerId && 'opacity-60'">
            <span class="font-mono text-[10px] text-muted-foreground w-16 shrink-0">{{ d.dealershipId }}</span>
            <span class="truncate flex-1">{{ d.name }}</span>
            <span class="text-[11px] text-muted-foreground shrink-0">{{ d.city }}</span>
            <span v-if="d.dealerId" class="shrink-0 rounded bg-emerald-500/10 px-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">Won — kept</span>
          </li>
          <li v-if="toDelete.length > 50" class="px-3 py-1.5 text-xs text-muted-foreground">…and {{ toDelete.length - 50 }} more</li>
        </ul>
        <p v-if="toDeleteWon.length" class="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"><AlertTriangle class="size-4 shrink-0 mt-px" /> {{ toDeleteWon.length }} won account{{ toDeleteWon.length === 1 ? ' lives' : 's live' }} in Dealers and will be skipped.</p>
        <p v-if="deletableCount >= 10" class="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck class="size-4 text-emerald-600" /> A full CRM backup is saved automatically before a delete this size.</p>
        <label v-if="needsTyping" class="block space-y-1">
          <span class="text-xs">Type <b class="font-mono">DELETE</b> to confirm</span>
          <Input v-model="deleteConfirm" class="h-9 font-mono" placeholder="DELETE" autocomplete="off" @keydown.enter="confirmDelete" />
        </label>
        <DialogFooter class="gap-2">
          <Button variant="ghost" :disabled="deleting" @click="showDelete = false">Cancel</Button>
          <Button variant="destructive" class="gap-1.5 min-w-32" :disabled="deleting || !deletableCount || (needsTyping && deleteConfirm.trim().toUpperCase() !== 'DELETE')" @click="confirmDelete"><Loader2 v-if="deleting" class="size-4 animate-spin" /><Trash2 v-else class="size-4" /> Move {{ deletableCount }} to Trash</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Trash -->
    <Dialog v-model:open="showTrash">
      <DialogContent class="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2"><Trash2 class="size-4 text-muted-foreground" /> Trash</DialogTitle>
          <DialogDescription class="text-xs">Dealerships deleted in the last 30 days. Restoring brings back the dealership with its contacts, activity, emails and audits — exactly as they were.</DialogDescription>
        </DialogHeader>
        <div class="flex items-center gap-2">
          <div class="relative flex-1"><Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" /><Input v-model="trashQ" class="h-8 pl-8 text-sm" placeholder="Search deleted dealerships…" /></div>
          <Button size="sm" class="h-8 gap-1.5" :disabled="restoring || !trashPick.size" @click="restorePicked()"><Loader2 v-if="restoring" class="size-4 animate-spin" /><ArchiveRestore v-else class="size-4" /> Restore {{ trashPick.size || '' }}</Button>
        </div>
        <div class="max-h-[55vh] overflow-y-auto rounded-lg border divide-y">
          <div v-if="trashLoading && !trash.length" class="p-6 text-center text-sm text-muted-foreground"><Loader2 class="size-4 animate-spin inline" /> Loading…</div>
          <div v-else-if="!trashShown.length" class="p-8 text-center text-sm text-muted-foreground">Trash is empty.</div>
          <label v-for="t in trashShown" :key="t.id" class="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent/40 cursor-pointer">
            <Checkbox :model-value="trashPick.has(t.id)" :disabled="!t.restorable" @update:model-value="toggleTrash(t.id)" />
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ t.name }} <span class="font-mono text-[10px] text-muted-foreground">{{ t.code }}</span></p>
              <p class="text-[11px] text-muted-foreground">{{ [t.city, t.state].filter(Boolean).join(', ') }} · deleted {{ formatDistanceToNow(new Date(t.deletedAt), { addSuffix: true }) }}{{ t.deletedBy?.name ? ` by ${t.deletedBy.name}` : '' }}{{ linkedCount(t.counts) ? ` · ${linkedCount(t.counts)} linked records` : '' }}</p>
            </div>
            <Button v-if="t.restorable" variant="ghost" size="sm" class="h-7 text-xs gap-1" :disabled="restoring" @click.prevent="restorePicked([t.id])"><ArchiveRestore class="size-3.5" /> Restore</Button>
            <span v-else class="text-[10px] text-muted-foreground" title="Deleted one at a time before Trash existed — only the dealership and contacts were kept">Partial</span>
          </label>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="showBulkLost">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mark {{ selected.size }} dealership{{ selected.size === 1 ? '' : 's' }} as Lost</DialogTitle>
          <DialogDescription>The same reason is recorded for each one. Use the dealership page if they were lost for different reasons.</DialogDescription>
        </DialogHeader>
        <CrmLostReasonFields v-model="lostForm" :error="lostError" />
        <DialogFooter>
          <Button variant="ghost" @click="showBulkLost = false">Cancel</Button>
          <Button variant="destructive" :disabled="bulkBusy" @click="confirmBulkLost">Mark as Lost</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
.slide-enter-active, .slide-leave-active { transition: opacity .18s ease, transform .18s ease; }
.slide-enter-from, .slide-leave-to { opacity: 0; transform: translateY(-4px); }

/* Table: the surrounding .crm-grid-box gives the 2px theme border; 1px theme column lines; dark header.
   The scroller has no padding, so the sticky header sits flush at the top and nothing shows above it. */
.crm-grid {
  --grid-line: color-mix(in oklab, var(--primary) 30%, transparent);
}
.crm-grid th, .crm-grid td {
  border-right: 1px solid var(--grid-line);
  border-bottom: 1px solid var(--grid-line);
}
.crm-grid th:last-child, .crm-grid td:last-child { border-right: 0; }
.crm-grid thead th {
  background: #18181b;
  color: #d4d4d8;
  border-right-color: rgb(255 255 255 / .14);
  border-bottom: 0;
}
:global(.dark) .crm-grid thead th { background: #09090b; }
</style>
