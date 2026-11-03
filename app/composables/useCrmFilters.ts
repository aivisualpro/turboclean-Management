import type { CrmDealership } from '~/composables/useCrmDealerships'
import { CONTACT_ROLES, DEALERSHIP_STAGES, LEAD_SOURCES, LOST_REASONS, US_STATES } from '~/constants/crm'

/** Per-dealership facts from /api/crm/facts (computed from the whole history). */
export interface DealershipFacts {
  id: string
  stage: string
  steps: Partial<Record<FunnelStep, string>>
  furthest: FunnelStep | null
  counts: { emails: number, calls: number, visits: number, followUps: number, conversations: number, meetings: number, proposals: number, replies: number, positiveReplies: number, negativeReplies: number, touches: number }
  channels: string[]
  channelMix: string
  firstContactAt: string | null
  lastActivityAt: string | null
  lastEmailAt: string | null
  positiveReplyRoles: string[]
  replyRoles: string[]
  primaryRole: string
  emailsNoReply: number
  missingPhotoPct: number | null
  totalVehicles: number | null
  lostReason: string
  lostAt: string | null
  revisitDate: string | null
  minutes: number
}
export const FUNNEL_STEPS = ['researched', 'contacted', 'replied', 'conversation', 'meeting', 'proposal', 'won'] as const
export type FunnelStep = typeof FUNNEL_STEPS[number]
export const FUNNEL_LABELS: Record<FunnelStep, string> = { researched: 'Researched', contacted: 'Contacted', replied: 'Replied', conversation: 'Conversation', meeting: 'Meeting', proposal: 'Proposal', won: 'Won' }

export type FilterType = 'text' | 'enum' | 'number' | 'step' | 'bool'
export interface FilterField { key: string, label: string, type: FilterType, options?: readonly string[], unit?: string, group: string }
export interface Condition { field: string, op: string, value: string }

const daysAgo = (iso?: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null
const today = () => new Date().toISOString().slice(0, 10)

export const FILTER_FIELDS: FilterField[] = [
  { key: 'brand', label: 'Brand', type: 'text', group: 'Dealership' },
  { key: 'state', label: 'State', type: 'enum', options: US_STATES, group: 'Dealership' },
  { key: 'city', label: 'City', type: 'text', group: 'Dealership' },
  { key: 'dealerGroup', label: 'Dealer group', type: 'text', group: 'Dealership' },
  { key: 'route', label: 'Route / day', type: 'text', group: 'Dealership' },
  { key: 'territory', label: 'Territory / market', type: 'text', group: 'Dealership' },
  { key: 'stage', label: 'Stage', type: 'enum', options: DEALERSHIP_STAGES, group: 'Dealership' },
  { key: 'leadSource', label: 'Lead source', type: 'enum', options: LEAD_SOURCES, group: 'Dealership' },
  { key: 'owner', label: 'Owner', type: 'text', group: 'Dealership' },
  { key: 'missingPhotoPct', label: 'Missing photos', type: 'number', unit: '%', group: 'Inventory audit' },
  { key: 'vehicles', label: 'Vehicles in inventory', type: 'number', group: 'Inventory audit' },
  { key: 'audited', label: 'Has an audit', type: 'bool', group: 'Inventory audit' },
  { key: 'step', label: 'Has reached', type: 'step', options: FUNNEL_STEPS, group: 'Progress' },
  { key: 'emails', label: 'Emails sent', type: 'number', group: 'Activity' },
  { key: 'emailsNoReply', label: 'Emails with no reply', type: 'number', group: 'Activity' },
  { key: 'calls', label: 'Calls', type: 'number', group: 'Activity' },
  { key: 'visits', label: 'Walk-ins', type: 'number', group: 'Activity' },
  { key: 'touches', label: 'Total touches', type: 'number', group: 'Activity' },
  { key: 'meetings', label: 'Meetings', type: 'number', group: 'Activity' },
  { key: 'daysSinceActivity', label: 'Days since last activity', type: 'number', unit: 'days', group: 'Activity' },
  { key: 'positiveReplyFrom', label: 'Positive reply from', type: 'enum', options: CONTACT_ROLES, group: 'People' },
  { key: 'replyFrom', label: 'Any reply from', type: 'enum', options: CONTACT_ROLES, group: 'People' },
  { key: 'primaryRole', label: 'Primary contact role', type: 'enum', options: [...CONTACT_ROLES, 'No contact'], group: 'People' },
  { key: 'lostReason', label: 'Lost reason', type: 'enum', options: LOST_REASONS, group: 'Lost / nurture' },
  { key: 'daysSinceLost', label: 'Days since lost', type: 'number', unit: 'days', group: 'Lost / nurture' },
  { key: 'readyToRecontact', label: 'Ready to re-contact', type: 'bool', group: 'Lost / nurture' },
]
export const FIELD_MAP = Object.fromEntries(FILTER_FIELDS.map(f => [f.key, f])) as Record<string, FilterField>
export const OPS: Record<FilterType, { key: string, label: string }[]> = {
  text: [{ key: 'contains', label: 'contains' }, { key: 'is', label: 'is' }, { key: 'not', label: 'is not' }],
  enum: [{ key: 'is', label: 'is' }, { key: 'not', label: 'is not' }],
  number: [{ key: 'gt', label: 'more than' }, { key: 'gte', label: 'at least' }, { key: 'lt', label: 'less than' }, { key: 'eq', label: 'exactly' }],
  step: [{ key: 'yes', label: 'reached' }, { key: 'no', label: 'not reached' }],
  bool: [{ key: 'yes', label: 'yes' }, { key: 'no', label: 'no' }],
}

function value(field: string, d: CrmDealership, f: DealershipFacts | undefined): any {
  switch (field) {
    case 'brand': return d.brands || []
    case 'state': return d.state || ''
    case 'city': return d.city || ''
    case 'dealerGroup': return d.dealerGroup || ''
    case 'route': return d.route || ''
    case 'territory': return d.territory || ''
    case 'stage': return d.stage
    case 'leadSource': return d.leadSource
    case 'owner': return d.assignedUserName || ''
    case 'missingPhotoPct': return f?.missingPhotoPct ?? d.auditSummary?.latest?.missingPhotoPct ?? null
    case 'vehicles': return f?.totalVehicles ?? d.auditSummary?.latest?.totalVehicles ?? null
    case 'audited': return !!d.auditSummary?.latest
    case 'emails': return f?.counts.emails ?? 0
    case 'emailsNoReply': return f?.emailsNoReply ?? 0
    case 'calls': return f?.counts.calls ?? 0
    case 'visits': return f?.counts.visits ?? 0
    case 'touches': return f?.counts.touches ?? 0
    case 'meetings': return f?.counts.meetings ?? 0
    case 'daysSinceActivity': return daysAgo(f?.lastActivityAt) ?? daysAgo(d.createdAt) ?? 0
    case 'positiveReplyFrom': return f?.positiveReplyRoles || []
    case 'replyFrom': return f?.replyRoles || []
    case 'primaryRole': return f?.primaryRole || 'No contact'
    case 'lostReason': return d.stage === 'Lost' ? (d.lostReason || '') : ''
    case 'daysSinceLost': return d.stage === 'Lost' ? (daysAgo(d.lostAt || f?.lostAt) ?? null) : null
    case 'readyToRecontact': {
      if (d.stage !== 'Lost' && d.stage !== 'Nurture / Follow Up Later') return false
      if (d.revisitDate) return d.revisitDate <= today()
      return (daysAgo(d.lostAt || f?.lostAt || d.stageChangedAt) ?? 0) >= 90
    }
  }
}

export function matches(c: Condition, d: CrmDealership, f: DealershipFacts | undefined) {
  const def = FIELD_MAP[c.field]
  if (!def) return true
  if (def.type === 'step') { const reached = !!f?.steps?.[c.value as FunnelStep]; return c.op === 'no' ? !reached : reached }
  const v = value(c.field, d, f)
  if (def.type === 'bool') return c.op === 'no' ? !v : !!v
  if (def.type === 'number') {
    if (v == null) return false
    const n = Number(c.value)
    if (!Number.isFinite(n)) return true
    return c.op === 'gt' ? v > n : c.op === 'gte' ? v >= n : c.op === 'lt' ? v < n : v === n
  }
  const needle = String(c.value || '').trim().toLowerCase()
  if (!needle) return true
  const list = (Array.isArray(v) ? v : [v]).map((x: any) => String(x).toLowerCase())
  if (c.op === 'contains') return list.some(x => x.includes(needle))
  if (c.op === 'not') return !list.includes(needle)
  return list.includes(needle)
}
export const matchAll = (conds: Condition[], d: CrmDealership, f: DealershipFacts | undefined) => conds.every(c => matches(c, d, f))

export function describe(c: Condition) {
  const def = FIELD_MAP[c.field]
  if (!def) return ''
  const op = OPS[def.type].find(o => o.key === c.op)?.label || c.op
  if (def.type === 'step') return `${op === 'reached' ? 'Has' : 'Has not'} reached ${FUNNEL_LABELS[c.value as FunnelStep]?.toLowerCase() || c.value}`
  if (def.type === 'bool') return `${def.label}: ${op}`
  return `${def.label} ${op} ${c.value}${def.unit === '%' ? '%' : def.unit ? ` ${def.unit}` : ''}`
}

/** Ready-made smart views — the questions people actually ask. */
export const SMART_VIEWS: { key: string, label: string, conditions: Condition[] }[] = [
  { key: 'toyota-ct', label: 'Toyota in Connecticut — researched, not contacted', conditions: [{ field: 'brand', op: 'is', value: 'Toyota' }, { field: 'state', op: 'is', value: 'CT' }, { field: 'step', op: 'yes', value: 'researched' }, { field: 'step', op: 'no', value: 'contacted' }] },
  { key: 'photos10', label: 'More than 10% missing photos', conditions: [{ field: 'missingPhotoPct', op: 'gt', value: '10' }] },
  { key: 'emailed2', label: 'Emailed twice or more, no response', conditions: [{ field: 'emails', op: 'gte', value: '2' }, { field: 'step', op: 'no', value: 'replied' }] },
  { key: 'emailedNoVisit', label: 'Emailed but never visited', conditions: [{ field: 'emails', op: 'gte', value: '1' }, { field: 'visits', op: 'eq', value: '0' }] },
  { key: 'gmPositiveNoMeeting', label: 'GM replied positively, no meeting yet', conditions: [{ field: 'positiveReplyFrom', op: 'is', value: 'General Manager' }, { field: 'step', op: 'no', value: 'meeting' }] },
  { key: 'quiet30', label: 'Open prospects with no activity in 30+ days', conditions: [{ field: 'daysSinceActivity', op: 'gt', value: '30' }, { field: 'stage', op: 'not', value: 'Won' }, { field: 'stage', op: 'not', value: 'Lost' }] },
  { key: 'badTiming', label: "Lost for 'bad timing' — ready to re-contact", conditions: [{ field: 'lostReason', op: 'is', value: 'Bad timing' }, { field: 'readyToRecontact', op: 'yes', value: '' }] },
]
