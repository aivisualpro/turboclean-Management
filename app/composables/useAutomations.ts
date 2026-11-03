/**
 * Client side of the Automations menu (server: server/utils/automation*.ts, /api/automations/*).
 */
export interface AutomationJob {
  key: string
  n: number
  title: string
  group: 'find' | 'outreach' | 'respond' | 'learn'
  kind: 'scheduled' | 'event' | 'always' | 'planned'
  everyMinutes?: number
  does: string
  enabled: boolean
  lastRunAt: string | null
  lastStatus: 'ok' | 'error' | null
  lastSummary: string
  runningUntil: string | null
}
export interface AutomationSettings {
  dailySendLimit: number
  sendStart: string
  sendEnd: string
  weekdaysOnly: boolean
  followUpGaps: number[]
  firstTouchStyle: 'template' | 'ai' | 'split'
  firstTouchTemplateId: string
  maxDraftsPerRun: number
  autoAdvanceStages: boolean
  useAi: boolean
  auditStaleDays: number
}
export interface AutomationOverview {
  automations: AutomationJob[]
  settings: AutomationSettings
  env: { ai: boolean, aiModel: string, resend: boolean, places: boolean, collectorToken: boolean, replyDomain: boolean, timeZone: string, schedulerDisabled: boolean }
  sending: { inWindow: boolean, nextWindow: string, sentToday: number, limit: number }
  needsYou: { draftsPending: number, draftsApproved: number, draftsFailed: number, repliesToConfirm: number, hot: number, needToday: number }
}
export interface AutomationRun { id: string, key: string, n: number, title: string, trigger: string, by: { id: string, name: string } | null, startedAt: string, finishedAt: string, ms: number, status: 'ok' | 'error', summary: string, stats: Record<string, any> | null, items: any[], error: string | null }
export interface OutreachDraft {
  id: string
  kind: 'first_touch' | 'follow_up'
  status: 'pending' | 'approved' | 'sending' | 'sent' | 'rejected' | 'cancelled' | 'failed'
  dealershipId: string
  dealershipCode: string
  dealershipName: string
  stage: string
  ownerName: string
  contactId: string | null
  contactName: string
  contactRole: string
  toEmail: string
  subject: string
  subjectTemplate: string
  body: string
  format: 'html' | 'text'
  previewHtml: string
  missingFields: string[]
  templateName: string
  templateVersionLabel: string
  subjectVariant: string | null
  writtenBy: 'template' | 'ai'
  followUpNumber: number
  threadSubject?: string
  why: string[]
  priorityScore: number | null
  edited: boolean
  queuedNote?: string
  error?: string | null
  cancelledReason?: string
  rejectReason?: string
  approvedBy?: { name: string }
  sentAt?: string
  createdAt: string
  updatedAt: string
}
export interface ReplySuggestion { category: string, label: string, sentiment: string, summary: string, reason: string, nextAction: string, returnDate: string | null, referralName: string | null, referralEmail: string | null, confidence: number | null, by: 'ai' | 'rules', model: string | null }
export interface ReplyToConfirm { id: string, dealershipId: string | null, dealershipName: string, contactName: string, fromEmail: string, fromName: string, subject: string, snippet: string, bodyText: string, receivedAt: string, aiSuggestion?: ReplySuggestion | null }
export interface PriorityRow {
  id: string
  code: string
  name: string
  stage: string
  city: string
  state: string
  ownerName: string
  score: number
  tier: 'Hot' | 'Warm' | 'Cool'
  reasons: string[]
  next: { action: string, type: string, why: string, due: 'now' | 'today' | 'soon' | 'later', link: string }
  missingPhotoPct: number | null
  totalVehicles: number | null
  lastActivityAt: string | null
  contact: { name: string, title: string, email: string, phone: string } | null
}

export function useAutomations() {
  const overview = useState<AutomationOverview | null>('automations-overview', () => null)
  const loading = ref(false)
  async function loadOverview() {
    loading.value = true
    try { overview.value = await $fetch<AutomationOverview>('/api/automations') }
    finally { loading.value = false }
    return overview.value
  }
  const setEnabled = (key: string, enabled: boolean) => $fetch(`/api/automations/jobs/${key}`, { method: 'PATCH', body: { enabled } })
  const runNow = (key: string) => $fetch<any>(`/api/automations/jobs/${key}/run`, { method: 'POST' })
  const saveSettings = (body: Partial<AutomationSettings>) => $fetch<{ settings: AutomationSettings }>('/api/automations/settings', { method: 'PUT', body })
  const loadRuns = (key?: string, limit = 50) => $fetch<{ runs: AutomationRun[] }>('/api/automations/runs', { query: { key, limit } })
  const loadDrafts = (status = 'pending') => $fetch<{ drafts: OutreachDraft[], counts: Record<string, number> }>('/api/automations/drafts', { query: { status } })
  const updateDraft = (id: string, body: { subject?: string, body?: string, contactId?: string }) => $fetch<{ draft: OutreachDraft }>(`/api/automations/drafts/${id}`, { method: 'PATCH', body })
  const approveDraft = (id: string, sendNow = false) => $fetch<{ draft: OutreachDraft, sent: boolean, message: string }>(`/api/automations/drafts/${id}/approve`, { method: 'POST', body: { sendNow } })
  const rejectDraft = (id: string, reason: string) => $fetch<{ draft: OutreachDraft }>(`/api/automations/drafts/${id}/reject`, { method: 'POST', body: { reason } })
  const bulkDrafts = (ids: string[], action: 'approve' | 'reject', reason = '') => $fetch<{ sent: number, queued: number, failed: number, results: any[] }>('/api/automations/drafts/bulk', { method: 'POST', body: { ids, action, reason } })
  const loadReplies = () => $fetch<{ replies: ReplyToConfirm[], categories: Record<string, { label: string, sentiment: string }>, accuracy: Record<string, { n: number, agreed: number, pct: number | null }> }>('/api/automations/replies')
  const confirmReply = (id: string, category: string) => $fetch<{ effects: string[] }>(`/api/automations/replies/${id}/confirm`, { method: 'POST', body: { category } })
  const loadPriorities = (tier = 'all', owner = '') => $fetch<{ rows: PriorityRow[], totals: Record<string, number>, learning: any[] }>('/api/automations/priorities', { query: { tier, owner: owner || undefined } })
  const loadInsights = (refresh = false) => $fetch<{ report: any, liveAutomation: any }>('/api/automations/insights', { query: refresh ? { refresh: 1 } : {} })
  return { overview, loading, loadOverview, setEnabled, runNow, saveSettings, loadRuns, loadDrafts, updateDraft, approveDraft, rejectDraft, bulkDrafts, loadReplies, confirmReply, loadPriorities, loadInsights }
}

export const AUTOMATION_GROUPS = [
  { key: 'find', title: 'Find & research', hint: 'Dealerships, inventory, missing photos, contacts, research' },
  { key: 'outreach', title: 'Outreach', hint: 'Drafts, your approval, sending, follow-ups' },
  { key: 'respond', title: 'Respond & prioritize', hint: 'Replies, hottest prospects, next step' },
  { key: 'learn', title: 'Learn', hint: 'What actually produces contracts' },
] as const

export const REPLY_CATEGORY_STYLE: Record<string, string> = {
  interested: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  meeting_request: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  question: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  referral: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  out_of_office: 'bg-muted text-muted-foreground',
  other: 'bg-muted text-muted-foreground',
  not_interested: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  unsubscribe: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
}
export const TIER_STYLE: Record<string, string> = {
  Hot: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/30',
  Warm: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30',
  Cool: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20',
}

/** "3 min ago", "2 h ago", "Oct 4" */
export function ago(iso: string | null | undefined) {
  if (!iso) return 'never'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
export function everyLabel(min?: number) {
  if (!min) return ''
  if (min < 60) return `every ${min} min`
  if (min < 1440) return `every ${min / 60} h`
  if (min === 1440) return 'daily'
  if (min === 10080) return 'weekly'
  return `every ${Math.round(min / 1440)} days`
}
