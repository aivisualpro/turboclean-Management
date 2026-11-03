/**
 * One row of facts per dealership, worked out from everything the CRM has recorded
 * (activities, stage history, emails, audits, contacts, won/lost logs, time).
 * Shared by the dashboard, performance analytics and advanced search — nothing here is typed by hand.
 */
import type { Db } from 'mongodb'
import { CRM_COLLECTIONS, DEALERSHIP_STAGES } from './crm'
import { CRM_TIMEZONE } from './crm-stage'

export const FUNNEL_STEPS = ['researched', 'contacted', 'replied', 'conversation', 'meeting', 'proposal', 'won'] as const
export type FunnelStep = typeof FUNNEL_STEPS[number]
export const FUNNEL_LABELS: Record<FunnelStep, string> = {
  researched: 'Researched', contacted: 'Contacted', replied: 'Replied', conversation: 'Conversation', meeting: 'Meeting', proposal: 'Proposal', won: 'Won',
}
/** Reaching this pipeline stage (or later) means the step was reached. */
const STEP_STAGE: Record<FunnelStep, string> = {
  researched: 'Researched', contacted: 'Outreach Active', replied: 'Replied', conversation: 'Conversation',
  meeting: 'Meeting Scheduled', proposal: 'Proposal Sent', won: 'Won',
}
const STAGE_INDEX = (s: string) => { const i = DEALERSHIP_STAGES.indexOf(s as any); return i > DEALERSHIP_STAGES.indexOf('Won') ? -1 : i }

export const OUTREACH_TYPES = ['email_sent', 'phone_call', 'connected_call', 'voicemail', 'text_message', 'walk_in', 'follow_up', 'proposal_sent', 'meeting_scheduled', 'meeting_completed', 'conversation']
const TYPE_STEP: Record<string, FunnelStep> = {
  research_completed: 'researched',
  email_sent: 'contacted', phone_call: 'contacted', voicemail: 'contacted', text_message: 'contacted', walk_in: 'contacted', follow_up: 'contacted',
  email_reply: 'replied', positive_reply: 'replied', negative_reply: 'replied',
  conversation: 'conversation', connected_call: 'conversation',
  meeting_scheduled: 'meeting', meeting_completed: 'meeting',
  proposal_sent: 'proposal', contract_won: 'won',
}
export const CHANNEL_OF: Record<string, 'email' | 'call' | 'visit' | undefined> = {
  email_sent: 'email', phone_call: 'call', connected_call: 'call', voicemail: 'call', text_message: 'call', walk_in: 'visit', conversation: 'visit',
}
export const CHANNEL_LABEL = { email: 'Email', call: 'Call', visit: 'Walk-in' } as const

export function missingPhotoBand(pct: number | null | undefined) {
  if (pct == null) return 'Not audited'
  if (pct < 5) return 'Under 5%'
  if (pct < 10) return '5–10%'
  if (pct < 15) return '10–15%'
  if (pct < 25) return '15–25%'
  return '25%+'
}
export const MISSING_BANDS = ['Under 5%', '5–10%', '10–15%', '15–25%', '25%+', 'Not audited']
export function sizeBand(total: number | null | undefined) {
  if (total == null) return 'Not audited'
  if (total < 75) return 'Small (<75 cars)'
  if (total < 200) return 'Medium (75–199)'
  if (total < 400) return 'Large (200–399)'
  return 'Very large (400+)'
}
export const SIZE_BANDS = ['Small (<75 cars)', 'Medium (75–199)', 'Large (200–399)', 'Very large (400+)', 'Not audited']
export function touchesBand(n: number) { return n <= 1 ? '1' : n === 2 ? '2' : n === 3 ? '3' : n <= 5 ? '4–5' : n <= 9 ? '6–9' : '10+' }
export const TOUCH_BANDS = ['1', '2', '3', '4–5', '6–9', '10+']

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** Day of week + hour in the CRM time zone. */
export function zoned(iso: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: CRM_TIMEZONE, weekday: 'long', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(x => [x.type, x.value]))
  return { dow: String(p.weekday), dowIndex: DOW.indexOf(String(p.weekday)), hour: Number(p.hour) }
}

export interface DealershipFacts {
  id: string
  code: string
  name: string
  stage: string
  ownerId: string
  ownerName: string
  leadSource: string
  brands: string[]
  dealerGroup: string
  state: string
  city: string
  createdAt: string | null
  archived: boolean
  won: boolean
  lostReason: string
  revisitDate: string | null
  estMonthlyValue: number | null
  /** first date each funnel step was reached (implied backwards: a meeting implies contacted) */
  steps: Partial<Record<FunnelStep, string>>
  furthest: FunnelStep | null
  counts: { emails: number, calls: number, visits: number, followUps: number, conversations: number, meetings: number, proposals: number, replies: number, positiveReplies: number, negativeReplies: number, touches: number }
  channels: ('email' | 'call' | 'visit')[]
  channelMix: string
  firstContactAt: string | null
  lastActivityAt: string | null
  lastEmailAt: string | null
  firstMeetingAt: string | null
  touchesBeforeMeeting: number | null
  /** channel of the last outreach touch before the first meeting (what "got" the meeting) */
  meetingChannel: string | null
  firstTouchChannel: string | null
  positiveReplyRoles: string[]
  replyRoles: string[]
  primaryRole: string
  emailsNoReply: number
  outreachMode: 'Template (unedited)' | 'Personalized' | 'No CRM email'
  missingPhotoPct: number | null
  totalVehicles: number | null
  lastAuditAt: string | null
  wonAt: string | null
  annualRevenue: number
  monthlyRevenue: number
  lostAt: string | null
  minutes: number
}

/** Facts for every live (or all, with archived) dealership. */
export async function buildFacts(db: Db, opts: { includeArchived?: boolean } = {}): Promise<DealershipFacts[]> {
  const dFilter: any = { mergedInto: null }
  if (!opts.includeArchived) dFilter.archivedAt = null
  const [ds, ix, hist, emails, audits, contacts, wins, losses, time] = await Promise.all([
    db.collection(CRM_COLLECTIONS.dealerships).find(dFilter, { projection: { name: 1, dealershipId: 1, stage: 1, assignedUserId: 1, assignedUserName: 1, leadSource: 1, brands: 1, dealerGroup: 1, state: 1, city: 1, createdAt: 1, archivedAt: 1, dealerId: 1, lostReason: 1, revisitDate: 1, estMonthlyValue: 1, convertedAt: 1 } }).toArray(),
    db.collection('turboCleanCrmInteractions').find({ voidedAt: null }, { projection: { dealershipId: 1, type: 1, occurredAt: 1, contactId: 1 } }).sort({ occurredAt: 1 }).toArray(),
    db.collection(CRM_COLLECTIONS.stageHistory).find({}, { projection: { dealershipId: 1, toStage: 1, changedAt: 1 } }).toArray(),
    db.collection('turboCleanCrmEmails').find({ direction: 'outbound', status: { $ne: 'failed' } }, { projection: { dealershipId: 1, sentAt: 1, repliedAt: 1, replySentiment: 1, templateId: 1, templateEdited: 1, contactId: 1 } }).toArray(),
    db.collection('turboCleanCrmAudits').find({}, { projection: { dealershipId: 1, auditedAt: 1, missingPhotoPct: 1, totalVehicles: 1 } }).sort({ auditedAt: 1 }).toArray(),
    db.collection(CRM_COLLECTIONS.contacts).find({}, { projection: { dealershipId: 1, role: 1, isPrimary: 1, isActive: 1 } }).toArray(),
    db.collection('turboCleanCrmWonDeals').find({ revertedAt: null }, { projection: { dealershipId: 1, wonAt: 1, annualRevenue: 1, monthlyRevenue: 1 } }).toArray(),
    db.collection('turboCleanCrmLostDeals').find({ reopenedAt: null }, { projection: { dealershipId: 1, lostAt: 1 } }).toArray(),
    db.collection('turboCleanCrmTimeEntries').aggregate([{ $match: { endedAt: { $ne: null }, voidedAt: null, dealershipId: { $ne: null } } }, { $group: { _id: '$dealershipId', minutes: { $sum: '$minutes' } } }]).toArray(),
  ])
  const group = (rows: any[]) => { const m = new Map<string, any[]>(); for (const r of rows) { const k = String(r.dealershipId); const l = m.get(k); if (l) l.push(r); else m.set(k, [r]) } return m }
  const ixBy = group(ix), histBy = group(hist), emBy = group(emails), auBy = group(audits), coBy = group(contacts)
  const roleOf = new Map(contacts.map(c => [c._id.toString(), c.role || 'Other']))
  const winBy = new Map(wins.map(w => [String(w.dealershipId), w]))
  const lostBy = new Map(losses.map(l => [String(l.dealershipId), l]))
  const minBy = new Map(time.map(t => [String(t._id), Number(t.minutes) || 0]))
  const min = (a?: string, b?: string | null) => !a ? (b || undefined) : !b ? a : (a < b ? a : b)

  return ds.map((d) => {
    const id = d._id.toString()
    const steps: Partial<Record<FunnelStep, string>> = {}
    const reach = (step: FunnelStep, at?: string | null) => { if (at) steps[step] = min(steps[step], at) }
    const list = ixBy.get(id) || []
    const counts = { emails: 0, calls: 0, visits: 0, followUps: 0, conversations: 0, meetings: 0, proposals: 0, replies: 0, positiveReplies: 0, negativeReplies: 0, touches: 0 }
    const channels = new Set<'email' | 'call' | 'visit'>()
    const replyRoles = new Set<string>(), positiveRoles = new Set<string>()
    let firstMeetingAt: string | null = null, touchesBeforeMeeting: number | null = null, meetingChannel: string | null = null
    let touchCount = 0, lastChannel: string | null = null, firstTouchChannel: string | null = null, lastActivityAt: string | null = null
    for (const i of list) {
      lastActivityAt = i.occurredAt
      const step = TYPE_STEP[i.type]
      if (step) reach(step, i.occurredAt)
      const ch = CHANNEL_OF[i.type]
      if (ch) { channels.add(ch); lastChannel = ch; if (!firstTouchChannel) firstTouchChannel = ch }
      if (OUTREACH_TYPES.includes(i.type) && !i.type.startsWith('meeting')) touchCount++
      switch (i.type) {
        case 'email_sent': counts.emails++; break
        case 'phone_call': case 'connected_call': case 'voicemail': case 'text_message': counts.calls++; break
        case 'walk_in': counts.visits++; break
        case 'follow_up': counts.followUps++; break
        case 'conversation': counts.conversations++; break
        case 'meeting_scheduled': case 'meeting_completed': counts.meetings++; break
        case 'proposal_sent': counts.proposals++; break
        case 'email_reply': case 'positive_reply': case 'negative_reply':
          counts.replies++
          if (i.type === 'positive_reply') counts.positiveReplies++
          if (i.type === 'negative_reply') counts.negativeReplies++
          if (i.contactId && roleOf.has(i.contactId)) { replyRoles.add(roleOf.get(i.contactId)!); if (i.type === 'positive_reply') positiveRoles.add(roleOf.get(i.contactId)!) }
          break
      }
      if (i.type === 'connected_call') counts.conversations++
      if ((i.type === 'meeting_scheduled' || i.type === 'meeting_completed') && !firstMeetingAt) {
        firstMeetingAt = i.occurredAt; touchesBeforeMeeting = touchCount; meetingChannel = lastChannel
      }
    }
    counts.touches = touchCount
    // Emails: replies the activity log may not have (auto-detected inbound replies), roles, outreach mode.
    const em = emBy.get(id) || []
    let templated = 0, personal = 0, noReply = 0, lastEmailAt: string | null = null
    for (const e of em) {
      reach('contacted', e.sentAt)
      if (e.repliedAt) { reach('replied', e.repliedAt); if (e.contactId && roleOf.has(e.contactId)) { replyRoles.add(roleOf.get(e.contactId)!); if (e.replySentiment === 'positive') positiveRoles.add(roleOf.get(e.contactId)!) } }
      else noReply++
      if (e.templateId && !e.templateEdited) templated++
      else personal++
      if (!lastEmailAt || e.sentAt > lastEmailAt) lastEmailAt = e.sentAt
    }
    if (em.length) channels.add('email')
    // Stage history: reaching a stage implies the steps up to it.
    for (const h of histBy.get(id) || []) {
      const si = STAGE_INDEX(h.toStage)
      if (si < 0) continue
      // A "Won" entry on an account that is not won (undone win, legacy import) says nothing about how far it got.
      if (h.toStage === 'Won' && !(d.dealerId || d.stage === 'Won' || winBy.has(id))) continue
      for (const step of FUNNEL_STEPS) if (step !== 'won' && STAGE_INDEX(STEP_STAGE[step]) <= si) reach(step, h.changedAt)
    }
    const au = auBy.get(id) || []
    if (au.length) reach('researched', au[0]!.auditedAt)
    const latest = au[au.length - 1] || null
    const win = winBy.get(id)
    // Won only counts when the account really is won (a record, a dealer, or the Won stage) — never from old history alone.
    if (win) steps.won = `${win.wonAt}T12:00:00.000Z`
    else if (d.dealerId || d.stage === 'Won') steps.won = d.convertedAt || steps.won || d.createdAt || undefined
    else delete steps.won
    // Monotonic: a later step implies the earlier ones (no later than it).
    for (let k = FUNNEL_STEPS.length - 2; k >= 0; k--) {
      const a = FUNNEL_STEPS[k]!, b = FUNNEL_STEPS[k + 1]!
      if (steps[b]) steps[a] = min(steps[a], steps[b])
    }
    const furthest = [...FUNNEL_STEPS].reverse().find(s => steps[s]) || null
    const roster = coBy.get(id) || []
    const primary = roster.find(c => c.isPrimary && c.isActive !== false) || roster.find(c => c.isActive !== false)
    const chs = (['email', 'call', 'visit'] as const).filter(c => channels.has(c))
    const lostRow = lostBy.get(id)
    return {
      id, code: d.dealershipId || '', name: d.name || '', stage: d.stage || '', ownerId: d.assignedUserId || '', ownerName: d.assignedUserName || '',
      leadSource: d.leadSource || '', brands: d.brands || [], dealerGroup: d.dealerGroup || '', state: d.state || '', city: d.city || '',
      createdAt: d.createdAt || null, archived: !!d.archivedAt, won: !!d.dealerId || !!win, lostReason: d.lostReason || '', revisitDate: d.revisitDate || null,
      estMonthlyValue: d.estMonthlyValue ?? null,
      steps, furthest, counts, channels: chs,
      channelMix: chs.length ? chs.map(c => CHANNEL_LABEL[c]).join(' + ') : 'No outreach',
      firstContactAt: steps.contacted || null, lastActivityAt: [lastActivityAt, lastEmailAt].filter(Boolean).sort().pop() || null, lastEmailAt,
      firstMeetingAt, touchesBeforeMeeting, meetingChannel, firstTouchChannel,
      positiveReplyRoles: [...positiveRoles], replyRoles: [...replyRoles], primaryRole: primary?.role || 'No contact',
      emailsNoReply: noReply,
      outreachMode: !em.length ? 'No CRM email' : personal ? 'Personalized' : 'Template (unedited)',
      missingPhotoPct: latest?.missingPhotoPct ?? null, totalVehicles: latest?.totalVehicles ?? null, lastAuditAt: latest?.auditedAt || null,
      wonAt: win?.wonAt || (d.dealerId ? String(d.convertedAt || '').slice(0, 10) || null : null),
      annualRevenue: Number(win?.annualRevenue) || 0, monthlyRevenue: Number(win?.monthlyRevenue) || 0,
      lostAt: lostRow?.lostAt || null, minutes: minBy.get(id) || 0,
    }
  })
}
