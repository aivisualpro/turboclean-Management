import { VERIFICATION_STALE_DAYS } from '~/constants/crm'

export interface CrmActor { id: string, name: string, email: string }

export interface CrmContact {
  id: string
  dealershipId: string
  firstName: string
  lastName: string
  fullName: string
  role: string
  jobTitle: string
  email: string
  phone: string
  mobile: string
  preferredContactMethod: string
  isPrimary: boolean
  isActive: boolean
  inactiveAt: string | null
  inactiveReason: string
  succeededById: string | null
  precededById: string | null
  addedAt: string
  lastVerifiedAt: string | null
  notes: string
  createdBy: CrmActor | null
  updatedAt: string
}

export interface CrmDealership {
  id: string
  dealershipId: string
  name: string
  dealerGroup: string
  brands: string[]
  website: string
  /** Scan pages: the only pages the crawler reads for this dealership (each with the health of its last test / crawl). */
  scanPages?: { url: string, label: string, health?: { status: 'ok' | 'empty' | 'redirected' | 'blocked' | 'error', vehicles: number, advertised: number | null, at: string, note: string, landedUrl?: string | null } | null }[]
  address: string
  city: string
  state: string
  zip: string
  phone: string
  territory: string
  /** Visit route / day ("Day 1") — which trip this dealership belongs to. */
  route?: string
  assignedUserId: string
  assignedUserName: string
  leadSource: string
  leadSourceDetail: string
  stage: string
  notes: string
  tags: string[]
  createdAt: string
  createdBy: CrmActor | null
  updatedAt: string
  archivedAt: string | null
  /** Set once the account is won and promoted to an operational Dealer */
  dealerId?: string | null
  convertedAt?: string | null
  convertedBy?: CrmActor | null
  lastAuditAt?: string | null
  /** When the dealership entered its current stage, and who moved it there */
  stageChangedAt?: string | null
  stageChangedBy?: CrmActor | null
  stageBeforeConversion?: string | null
  contractValue?: number | null
  wonAt?: string | null
  estMonthlyValue?: number | string | null
  wonMonthlyRevenue?: number | null
  wonAnnualProfit?: number | null
  /** Nurture / Lost: when to look at this dealership again (YYYY-MM-DD) */
  revisitDate?: string | null
  lostReason?: string
  lostNotes?: string
  lostCompetitor?: string
  lostAt?: string | null
  lostFromStage?: string
  parkedNote?: string
  auditSummary?: CrmAuditSummary
  interactionSummary?: CrmInteractionSummary
  contactSummary?: {
    total: number
    active: number
    inactive: number
    primary: CrmContact | null
    oldestVerification: string | null
  }
}

export interface CrmAuditExample { url: string, label: string }
export interface CrmAudit {
  id: string
  dealershipId: string
  auditedAt: string
  source: 'manual' | 'automated' | 'imported'
  inventoryUrl: string
  newTotal: number
  usedTotal: number
  newMissingPhotos: number
  usedMissingPhotos: number
  totalVehicles: number
  totalMissingPhotos: number
  missingPhotoPct: number | null
  newMissingPhotoPct: number | null
  usedMissingPhotoPct: number | null
  poorPhotoSets: number | null
  poorPhotoSetsNotes: string
  merchandisingIssues: string[]
  merchandisingNotes: string
  websiteIssues: string[]
  websiteIssuesNotes: string
  notes: string
  examples: CrmAuditExample[]
  collector: { name: string, version: string, runId: string } | null
  auditedBy: CrmActor | null
  createdAt: string
}
export interface CrmAuditSnapshot { auditedAt: string, missingPhotoPct: number | null, totalVehicles: number, totalMissingPhotos: number, source: string }
export interface CrmAuditSummary { count: number, latest: CrmAuditSnapshot | null, previous: CrmAuditSnapshot | null }
export type AuditInput = Partial<Pick<CrmAudit, 'auditedAt' | 'inventoryUrl' | 'newTotal' | 'usedTotal' | 'newMissingPhotos' | 'usedMissingPhotos' | 'poorPhotoSets' | 'poorPhotoSetsNotes' | 'merchandisingIssues' | 'merchandisingNotes' | 'websiteIssues' | 'websiteIssuesNotes' | 'notes' | 'examples'>> & { screenshotFileId?: string | null }

export interface CrmStageChange {
  id: string
  dealershipId: string
  dealershipCode: string
  dealershipName: string
  fromStage: string | null
  toStage: string
  changedAt: string
  /** YYYY-MM-DD / HH:mm in the CRM's business time zone */
  date: string
  time: string
  timeZone: string
  user: CrmActor
  source: 'create' | 'manual' | 'bulk' | 'convert' | 'revert' | 'backfill' | 'migration' | 'api'
  previousStageEnteredAt: string | null
  durationInPreviousStageMs: number | null
  note: string
}
export type CrmStageDurations = Record<string, { totalMs: number, stints: number, current: boolean }>

export interface PipelineStageRow {
  stage: string
  currentCount: number
  currentAvgDays: number | null
  currentMaxDays: number | null
  completedCount: number
  avgDays: number | null
  medianDays: number | null
  maxDays: number | null
}
export interface PipelineClose { id: string, dealershipId: string, name: string, assignedUserName: string, startedAt: string, closedAt: string, closedBy: string, days: number | null, stageChanges: number }
export interface PipelineCloseSummary { count: number, avgDays: number | null, medianDays: number | null, minDays: number | null, maxDays: number | null }
export interface PipelineReport {
  generatedAt: string
  totalDealerships: number
  stages: PipelineStageRow[]
  timeToClose: { won: PipelineCloseSummary, lost: PipelineCloseSummary }
  recentWins: PipelineClose[]
  recentLosses: PipelineClose[]
}

/** "3d 4h", "5h", "12m" — compact durations for stage timers. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${Math.max(0, m)}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`
  const d = Math.floor(h / 24)
  return `${d}d${h % 24 ? ` ${h % 24}h` : ''}`
}

export interface CrmInteraction {
  id: string
  dealershipId: string
  dealershipCode: string
  dealershipName: string
  type: string
  typeLabel: string
  /** When it happened (ISO) */
  occurredAt: string
  contactId: string | null
  /** Snapshot at the time of the interaction */
  contactName: string
  contactTitle: string
  /** Who did it */
  user: CrmActor
  notes: string
  outcome: string
  nextAction: string
  /** YYYY-MM-DD */
  nextActionDate: string | null
  /** follow_up | call | email | meeting | visit | proposal | research | other */
  nextActionType?: string | null
  /** HH:mm */
  nextActionTime?: string | null
  nextActionDone: boolean
  nextActionDoneAt: string | null
  nextActionDoneBy: CrmActor | null
  source: 'manual' | 'audit' | 'conversion' | 'legacy-note' | 'api' | 'email'
  refs: Record<string, string> | null
  voidedAt: string | null
  voidedBy: CrmActor | null
  voidReason: string
  createdBy: CrmActor | null
  createdAt: string
  updatedAt: string
}
export interface InteractionInput {
  type?: string
  occurredAt?: string
  contactId?: string | null
  userId?: string
  notes?: string
  outcome?: string
  nextAction?: string
  nextActionDate?: string | null
  nextActionType?: string | null
  nextActionTime?: string | null
  /** create only */
  completePrevious?: boolean
  moveStage?: string
  /** required when moveStage is 'Lost' */
  lostReason?: string
  lostNotes?: string
  lostCompetitor?: string
  /** time tracking — create only */
  minutesSpent?: number
  timeCategory?: string
  timeDate?: string
  /** patch only */
  nextActionDone?: boolean
  voided?: boolean
  voidReason?: string
}
export interface CrmInteractionSummary {
  count: number
  last: { type: string, typeLabel: string, occurredAt: string, userName: string, contactName: string, outcome: string } | null
  nextAction: { id: string, text: string, date: string | null, time?: string | null, type?: string | null, userName: string } | null
  openNextActions: number
}
/** Local calendar date YYYY-MM-DD */
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** 'overdue' | 'today' | 'soon' (≤7d) | 'later' | 'none' for a YYYY-MM-DD next-action date */
export function dueState(date: string | null | undefined): 'overdue' | 'today' | 'soon' | 'later' | 'none' {
  if (!date) return 'none'
  const today = localDay()
  if (date < today) return 'overdue'
  if (date === today) return 'today'
  const week = localDay(new Date(Date.now() + 7 * 86_400_000))
  return date <= week ? 'soon' : 'later'
}

export interface CrmActivity {
  id: string
  dealershipId: string
  contactId: string | null
  type: string
  message: string
  changes: Record<string, { from: any, to: any }> | null
  actor: CrmActor
  at: string
}

export type DealershipInput = Partial<Omit<CrmDealership, 'id' | 'dealershipId' | 'createdAt' | 'createdBy' | 'updatedAt' | 'archivedAt' | 'contactSummary' | 'dealerId' | 'convertedAt' | 'convertedBy' | 'lastAuditAt' | 'auditSummary' | 'interactionSummary' | 'stageChangedAt' | 'stageChangedBy' | 'stageBeforeConversion'>> & { source?: 'bulk' | 'manual', stageNote?: string, allowDuplicate?: boolean }

export interface ConvertInput {
  status?: 'Authorised' | 'Pending' | 'In Followup'
  isTaxApplied?: boolean
  taxPercentage?: number
  copyServicesFromDealerId?: string
  duplicateStock?: boolean
  notes?: string
  /** Estimated annual contract value ($) — used for revenue in template experiments */
  contractValue?: number | string | null
  /** Won-deal details (services sold, contract, revenue, profit, attribution) */
  won?: import('~/composables/useCrmWon').WonInput
}
export interface ConvertResult { dealerId: string, created: boolean, contactsCarried: number, servicesCopied: number, dealership: CrmDealership }
export type ContactInput = Partial<Omit<CrmContact, 'id' | 'dealershipId' | 'fullName' | 'addedAt' | 'updatedAt' | 'createdBy'>> & { markVerified?: boolean }

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}
export function verificationState(iso: string | null | undefined): 'fresh' | 'aging' | 'stale' | 'never' {
  const d = daysSince(iso)
  if (d === null) return 'never'
  if (d > VERIFICATION_STALE_DAYS) return 'stale'
  if (d > VERIFICATION_STALE_DAYS / 2) return 'aging'
  return 'fresh'
}

export function useCrmDealerships() {
  const dealerships = useState<CrmDealership[]>('crm-dealerships', () => [])
  const isLoading = useState<boolean>('crm-dealerships-loading', () => false)
  const lastFetchedAt = useState<number>('crm-dealerships-fetched', () => 0)

  /** Why the list could not be loaded ('' when it loaded) — an error must never look like "no dealerships". */
  const loadError = useState<string>('crm-dealerships-error', () => '')
  // Carries the sign-in cookie when the page is built on the server (see useApi).
  const api = useApi()

  async function fetchDealerships(opts: { archived?: boolean } = {}) {
    isLoading.value = true
    try {
      const res = await api<{ dealerships: CrmDealership[] }>('/api/crm/dealerships', { query: opts.archived ? { archived: '1' } : {} })
      dealerships.value = res.dealerships || []
      lastFetchedAt.value = Date.now()
      loadError.value = ''
    } catch (e: any) {
      const code = e?.statusCode || e?.status || e?.response?.status
      loadError.value = code === 401 ? 'Your sign-in could not be confirmed.' : (e?.data?.statusMessage || e?.statusMessage || 'The server did not answer.')
      throw e
    } finally {
      isLoading.value = false
    }
  }

  function upsertLocal(d: CrmDealership) {
    const i = dealerships.value.findIndex(x => x.id === d.id)
    if (i === -1) dealerships.value.unshift(d)
    else dealerships.value.splice(i, 1, { ...dealerships.value[i], ...d })
  }

  async function createDealership(input: DealershipInput) {
    const res = await $fetch<{ dealership: CrmDealership }>('/api/crm/dealerships', { method: 'POST', body: input })
    upsertLocal({ ...res.dealership, contactSummary: { total: 0, active: 0, inactive: 0, primary: null, oldestVerification: null } })
    return res.dealership
  }

  async function updateDealership(id: string, input: DealershipInput & { archived?: boolean }) {
    const res = await $fetch<{ dealership: CrmDealership }>(`/api/crm/dealerships/${id}`, { method: 'PATCH', body: input })
    upsertLocal(res.dealership)
    return res.dealership
  }

  /** Permanently delete (not for won accounts). */
  async function deleteDealership(id: string) {
    await $fetch(`/api/crm/dealerships/${id}`, { method: 'DELETE' })
    dealerships.value = dealerships.value.filter(d => d.id !== id)
  }

  async function fetchDealershipRecord(id: string) {
    return await api<{ dealership: CrmDealership, contacts: CrmContact[], activity: CrmActivity[], audits: CrmAudit[], stageHistory: CrmStageChange[], stageDurations: CrmStageDurations, interactions: CrmInteraction[] }>(`/api/crm/dealerships/${id}`)
  }

  async function recordAudit(dealershipId: string, input: AuditInput) {
    const res = await $fetch<{ audit: CrmAudit }>(`/api/crm/dealerships/${dealershipId}/audits`, { method: 'POST', body: input })
    return res.audit
  }

  async function addContact(dealershipId: string, input: ContactInput) {
    const res = await $fetch<{ contact: CrmContact }>(`/api/crm/dealerships/${dealershipId}/contacts`, { method: 'POST', body: input })
    return res.contact
  }

  async function updateContact(dealershipId: string, contactId: string, input: ContactInput & { verified?: boolean, inactiveReason?: string }) {
    const res = await $fetch<{ contact: CrmContact }>(`/api/crm/dealerships/${dealershipId}/contacts/${contactId}`, { method: 'PATCH', body: input })
    return res.contact
  }

  async function handoverContact(dealershipId: string, contactId: string, successor: ContactInput, reason: string) {
    return await $fetch<{ outgoing: CrmContact, successor: CrmContact }>(`/api/crm/dealerships/${dealershipId}/contacts/${contactId}/handover`, { method: 'POST', body: { successor, reason } })
  }

  async function convertDealership(id: string, input: ConvertInput = {}) {
    const res = await $fetch<ConvertResult>(`/api/crm/dealerships/${id}/convert`, { method: 'POST', body: input })
    upsertLocal(res.dealership)
    return res
  }

  async function logInteraction(dealershipId: string, input: InteractionInput) {
    const res = await $fetch<{ interaction: CrmInteraction, stageMoved: string | null, dealership: CrmDealership }>(`/api/crm/dealerships/${dealershipId}/interactions`, { method: 'POST', body: input })
    upsertLocal(res.dealership)
    return res
  }

  async function updateInteraction(dealershipId: string, interactionId: string, input: InteractionInput) {
    const res = await $fetch<{ interaction: CrmInteraction }>(`/api/crm/dealerships/${dealershipId}/interactions/${interactionId}`, { method: 'PATCH', body: input })
    return res.interaction
  }

  async function fetchPipelineReport(opts: { assignedUserId?: string } = {}) {
    return await api<PipelineReport>('/api/crm/pipeline', { query: opts.assignedUserId ? { assignedUserId: opts.assignedUserId } : {} })
  }

  async function addNote(dealershipId: string, text: string) {
    await $fetch(`/api/crm/dealerships/${dealershipId}/note`, { method: 'POST', body: { text } })
  }

  return {
    dealerships, isLoading, lastFetchedAt, loadError,
    fetchDealerships, createDealership, updateDealership, deleteDealership, fetchDealershipRecord,
    addContact, updateContact, handoverContact, addNote, convertDealership, recordAudit, fetchPipelineReport, logInteraction, updateInteraction,
  }
}
