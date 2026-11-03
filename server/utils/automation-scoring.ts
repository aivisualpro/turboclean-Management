/**
 * Automations 12 & 13: priority score + suggested next action, for every open dealership.
 *
 * Score 0–100 = opportunity (missing photos × inventory size) + engagement (replies, meetings,
 * proposals) + momentum (recent activity) + reachability + what has worked before (a bonus when
 * dealerships like this one have historically booked meetings more often than average).
 * Every point comes with a plain-English reason, so the ranking can always be explained.
 *
 * Results are stamped on the dealership (`automation.priority`, `automation.nextBest`) — that is
 * how they flow back into the CRM, the draft queue order and the Priorities page.
 */
import type { Db } from 'mongodb'
import { CRM_COLLECTIONS, OPEN_STAGE_ORDER } from './crm'
import { buildFacts, missingPhotoBand } from './crm-facts'
import type { DealershipFacts } from './crm-facts'
import { emailDb } from './crm-email'
import { automationDb, zonedNow } from './automation'
import type { AutomationSettings, JobResult } from './automation'
import { pickEmailContact } from './automation-research'

const DAY = 86_400_000
const NURTURE = 'Nurture / Follow Up Later'
const daysSince = (iso: string | null | undefined) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : null
const LATE = ['Meeting Completed', 'Opportunity', 'Proposal Sent', 'Negotiating']

export type Tier = 'Hot' | 'Warm' | 'Cool'
export interface Priority { score: number, tier: Tier, reasons: string[], scoredAt: string }
export interface NextBest { action: string, type: 'research' | 'contact' | 'approve' | 'email' | 'call' | 'meeting' | 'proposal' | 'review' | 'plan' | 'revisit' | 'none', why: string, due: 'now' | 'today' | 'soon' | 'later', link: string, at: string }

interface Ctx {
  facts: Map<string, DealershipFacts>
  contacts: Map<string, any[]>
  openActions: Map<string, any[]>
  pendingDrafts: Map<string, any[]>
  unclassified: Map<string, number>
  bandBonus: Map<string, { bonus: number, rate: number, avg: number }>
  today: string
}

async function loadContext(db: Db): Promise<Ctx> {
  const { drafts } = await automationDb(db)
  const { emails } = await emailDb(db)
  const [facts, contacts, open, pending, unclassified] = await Promise.all([
    buildFacts(db),
    db.collection(CRM_COLLECTIONS.contacts).find({ isActive: { $ne: false } }, { projection: { dealershipId: 1, email: 1, role: 1, isPrimary: 1, isActive: 1, emailBouncedAt: 1, doNotEmail: 1, firstName: 1, lastName: 1, jobTitle: 1, phone: 1, mobile: 1 } }).toArray(),
    db.collection('turboCleanCrmInteractions').find({ voidedAt: null, nextActionDone: false, nextAction: { $nin: ['', null] } }, { projection: { dealershipId: 1, nextAction: 1, nextActionDate: 1, nextActionType: 1 } }).toArray(),
    drafts.find({ status: { $in: ['pending', 'approved', 'failed'] } }, { projection: { dealershipId: 1, kind: 1, status: 1, followUpNumber: 1 } }).toArray(),
    emails.aggregate([{ $match: { direction: 'inbound', sentiment: null, dealershipId: { $ne: null } } }, { $group: { _id: '$dealershipId', n: { $sum: 1 } } }]).toArray(),
  ])
  const group = (rows: any[]) => { const m = new Map<string, any[]>(); for (const r of rows) { const k = String(r.dealershipId); m.set(k, [...(m.get(k) || []), r]) } return m }
  // Learning: meeting rate by missing-photo band among contacted dealerships (needs ≥ 10 per band).
  const contacted = facts.filter(f => f.steps.contacted)
  const avg = contacted.length ? contacted.filter(f => f.steps.meeting).length / contacted.length : 0
  const bandBonus = new Map<string, { bonus: number, rate: number, avg: number }>()
  const bands = new Map<string, DealershipFacts[]>()
  for (const f of contacted) { const b = missingPhotoBand(f.missingPhotoPct); bands.set(b, [...(bands.get(b) || []), f]) }
  for (const [b, list] of bands) {
    if (list.length < 10 || !avg) continue
    const rate = list.filter(f => f.steps.meeting).length / list.length
    const lift = rate / avg
    bandBonus.set(b, { bonus: lift >= 1.5 ? 10 : lift >= 1.15 ? 5 : lift <= 0.6 ? -5 : 0, rate, avg })
  }
  return {
    facts: new Map(facts.map(f => [f.id, f])), contacts: group(contacts), openActions: group(open), pendingDrafts: group(pending),
    unclassified: new Map(unclassified.map(u => [String(u._id), u.n])), bandBonus, today: zonedNow().day,
  }
}

export function scoreDealership(d: any, f: DealershipFacts | undefined, ctx: Ctx): Priority {
  const reasons: string[] = []
  let score = 0
  const add = (pts: number, why: string) => { if (pts) { score += pts; reasons.push(`${pts > 0 ? '+' : ''}${pts} ${why}`) } }
  const pct = f?.missingPhotoPct ?? null
  const cars = f?.totalVehicles ?? null
  // Opportunity
  if (pct == null) add(5, 'not audited yet')
  else if (pct >= 25) add(25, `${pct}% missing photos`)
  else if (pct >= 15) add(18, `${pct}% missing photos`)
  else if (pct >= 10) add(12, `${pct}% missing photos`)
  else if (pct >= 5) add(6, `${pct}% missing photos`)
  if (cars != null) add(cars >= 400 ? 15 : cars >= 200 ? 12 : cars >= 75 ? 8 : 4, `${cars} vehicles`)
  // Engagement
  if (f) {
    if (f.counts.positiveReplies) add(25, 'positive reply')
    else if (f.steps.replied) add(15, 'replied')
    if (f.steps.proposal) add(15, 'proposal stage')
    else if (f.steps.meeting) add(12, 'had a meeting')
    else if (f.steps.conversation) add(8, 'had a conversation')
    if (f.counts.negativeReplies && !f.counts.positiveReplies) add(-15, 'negative reply')
    const quiet = daysSince(f.lastActivityAt)
    if (quiet != null && quiet <= 7) add(10, 'active this week')
    else if (quiet != null && quiet <= 14) add(5, 'active in the last 2 weeks')
    if (f.estMonthlyValue && f.estMonthlyValue > 0) add(5, `est. $${Math.round(f.estMonthlyValue).toLocaleString()}/mo`)
  }
  // Reachability
  const contact = pickEmailContact(ctx.contacts.get(d._id.toString()) || [])
  if (contact) add(5, `email contact (${contact.role || 'contact'})`)
  else add(-10, 'no emailable contact')
  // What has worked before
  const band = ctx.bandBonus.get(missingPhotoBand(pct))
  if (band?.bonus) add(band.bonus, `${missingPhotoBand(pct)} dealerships book meetings ${Math.round(band.rate * 100)}% vs ${Math.round(band.avg * 100)}% avg`)
  // Needs attention
  if (LATE.includes(d.stage) && (daysSince(f?.lastActivityAt) ?? 99) >= 10) add(10, 'late-stage deal going quiet')
  score = Math.max(0, Math.min(100, score))
  return { score, tier: score >= 70 ? 'Hot' : score >= 45 ? 'Warm' : 'Cool', reasons, scoredAt: new Date().toISOString() }
}

export function nextBestAction(d: any, f: DealershipFacts | undefined, ctx: Ctx): NextBest {
  const id = d._id.toString()
  const at = new Date().toISOString()
  const base = `/crm/dealership/${id}`
  const mk = (action: string, type: NextBest['type'], why: string, due: NextBest['due'], link = `${base}?tab=history`): NextBest => ({ action, type, why, due, link, at })
  const today = ctx.today
  if (d.dealerId || d.stage === 'Won') return mk('Nothing — won and live in Dealers', 'none', 'Won', 'later', base)
  if (d.stage === 'Lost' || d.stage === NURTURE) {
    if (d.revisitDate && d.revisitDate <= today) return mk('Re-engage: the revisit date has arrived', 'revisit', d.stage === 'Lost' ? `Lost${d.lostReason ? ` (${d.lostReason})` : ''}, revisit ${d.revisitDate}` : `Nurture, revisit ${d.revisitDate}`, 'today')
    return mk(`Wait until ${d.revisitDate || 'the revisit date'}`, 'none', d.stage, 'later', base)
  }
  const unclassified = ctx.unclassified.get(id) || 0
  if (unclassified) return mk('Confirm the reply (one click)', 'review', `${unclassified} repl${unclassified === 1 ? 'y' : 'ies'} waiting to be classified`, 'now', '/automations/approvals?tab=replies')
  const drafts = ctx.pendingDrafts.get(id) || []
  const failed = drafts.find(x => x.status === 'failed')
  if (failed) return mk('Fix the email that did not send', 'approve', 'A queued email failed to send', 'now', '/automations/approvals?status=failed')
  const pending = drafts.find(x => x.status === 'pending')
  if (pending) return mk(pending.kind === 'follow_up' ? `Approve follow-up #${pending.followUpNumber}` : 'Approve the first email', 'approve', 'A draft is waiting in the approval queue', 'now', '/automations/approvals')
  const actions = (ctx.openActions.get(id) || []).filter(a => a.nextActionDate).sort((a, b) => String(a.nextActionDate).localeCompare(String(b.nextActionDate)))
  const overdue = actions.find(a => a.nextActionDate < today)
  if (overdue) return mk(overdue.nextAction, (overdue.nextActionType === 'call' ? 'call' : overdue.nextActionType === 'meeting' ? 'meeting' : 'email'), `Overdue since ${overdue.nextActionDate}`, 'now')
  if (f?.counts.positiveReplies && !f.steps.meeting) return mk('Book a 10-minute review — they replied positively', 'meeting', 'Positive reply, no meeting yet', 'today')
  if (d.stage === 'Meeting Scheduled' && f?.firstMeetingAt && (daysSince(f.firstMeetingAt) ?? 0) >= 1) return mk('Log how the meeting went', 'review', 'Meeting date has passed', 'today')
  if ((d.stage === 'Meeting Completed' || d.stage === 'Opportunity') && !f?.steps.proposal) return mk('Send the proposal', 'proposal', `${d.stage}, no proposal yet`, 'today')
  if ((d.stage === 'Proposal Sent' || d.stage === 'Negotiating') && (daysSince(f?.lastActivityAt) ?? 99) >= 5) return mk('Call to follow up on the proposal', 'call', `No activity for ${daysSince(f?.lastActivityAt)} days`, 'today')
  const due = actions.find(a => a.nextActionDate === today)
  if (due) return mk(due.nextAction, (due.nextActionType === 'call' ? 'call' : due.nextActionType === 'meeting' ? 'meeting' : 'email'), 'Due today', 'today')
  const contact = pickEmailContact(ctx.contacts.get(id) || [])
  if (d.stage === 'Research Needed' || (f?.missingPhotoPct == null && !f?.lastAuditAt)) return mk('Audit the website inventory', 'research', 'No inventory audit yet', 'soon', `${base}?tab=audits`)
  if (!contact) return mk('Find the GM or used-car manager (with email)', 'contact', 'No contact with a usable email', 'soon', `${base}?tab=contacts`)
  if (!f?.steps.contacted) return mk('First email will be drafted automatically', 'email', 'Researched, never contacted', 'soon', '/automations/approvals')
  if (f && f.emailsNoReply >= 3 && f.counts.calls === 0) return mk(`Call ${`${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'them'} — emails got no reply`, 'call', `${f.emailsNoReply} emails, no reply, never called`, 'soon')
  if (actions[0]) return mk(actions[0].nextAction, (actions[0].nextActionType === 'call' ? 'call' : 'email'), `Planned for ${actions[0].nextActionDate}`, 'later')
  return mk('Plan the next step', 'plan', 'No dated next action', 'today', `${base}?tab=history&log=follow_up`)
}

async function liveDealerships(db: Db) {
  return db.collection(CRM_COLLECTIONS.dealerships).find({ archivedAt: null, mergedInto: null, dealerId: null, stage: { $in: [...OPEN_STAGE_ORDER, NURTURE, 'Lost'] } },
    { projection: { name: 1, dealershipId: 1, stage: 1, dealerId: 1, revisitDate: 1, lostReason: 1, assignedUserId: 1, assignedUserName: 1, city: 1, state: 1 } }).toArray()
}

export async function priorityJob(db: Db): Promise<JobResult> {
  const ctx = await loadContext(db)
  const ds = (await liveDealerships(db)).filter(d => OPEN_STAGE_ORDER.includes(d.stage) || d.stage === NURTURE)
  const ops = ds.map(d => ({ updateOne: { filter: { _id: d._id }, update: { $set: { 'automation.priority': scoreDealership(d, ctx.facts.get(d._id.toString()), ctx) } } } }))
  if (ops.length) await db.collection(CRM_COLLECTIONS.dealerships).bulkWrite(ops, { ordered: false })
  const scored = ops.map(o => o.updateOne.update.$set['automation.priority'])
  const hot = scored.filter(p => p.tier === 'Hot').length, warm = scored.filter(p => p.tier === 'Warm').length
  return { summary: `${ds.length} dealerships scored — ${hot} hot, ${warm} warm`, stats: { scored: ds.length, hot, warm, learnedBands: ctx.bandBonus.size } }
}

export async function nextActionJob(db: Db): Promise<JobResult> {
  const ctx = await loadContext(db)
  const ds = await liveDealerships(db)
  const ops = ds.map(d => ({ updateOne: { filter: { _id: d._id }, update: { $set: { 'automation.nextBest': nextBestAction(d, ctx.facts.get(d._id.toString()), ctx) } } } }))
  if (ops.length) await db.collection(CRM_COLLECTIONS.dealerships).bulkWrite(ops, { ordered: false })
  const now = ops.filter(o => ['now', 'today'].includes(o.updateOne.update.$set['automation.nextBest'].due)).length
  return { summary: `Next step worked out for ${ds.length} dealerships — ${now} need something today`, stats: { dealerships: ds.length, today: now } }
}

/** Live list for the Priorities page (fresh numbers, not the stamped ones). */
export async function prioritiesReport(db: Db, q: { tier?: string, ownerId?: string, limit?: number } = {}) {
  const ctx = await loadContext(db)
  const ds = await liveDealerships(db)
  const rows = ds.map((d) => {
    const id = d._id.toString()
    const f = ctx.facts.get(id)
    const open = OPEN_STAGE_ORDER.includes(d.stage) || d.stage === NURTURE
    const p = open ? scoreDealership(d, f, ctx) : { score: 0, tier: 'Cool' as Tier, reasons: [], scoredAt: '' }
    const nb = nextBestAction(d, f, ctx)
    const contact = pickEmailContact(ctx.contacts.get(id) || []) || (ctx.contacts.get(id) || [])[0]
    return {
      id, code: d.dealershipId || '', name: d.name, stage: d.stage, city: d.city || '', state: d.state || '', ownerId: d.assignedUserId || '', ownerName: d.assignedUserName || '',
      score: p.score, tier: p.tier, reasons: p.reasons, next: nb,
      missingPhotoPct: f?.missingPhotoPct ?? null, totalVehicles: f?.totalVehicles ?? null, lastActivityAt: f?.lastActivityAt || null,
      contact: contact ? { name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(), title: contact.jobTitle || contact.role || '', email: contact.email || '', phone: contact.mobile || contact.phone || '' } : null,
    }
  }).filter(r => (r.next.type !== 'none'))
  const filtered = rows.filter(r => (!q.tier || q.tier === 'all' || r.tier === q.tier) && (!q.ownerId || r.ownerId === q.ownerId))
  const dueRank = { now: 0, today: 1, soon: 2, later: 3 } as const
  filtered.sort((a, b) => b.score - a.score || dueRank[a.next.due] - dueRank[b.next.due])
  return {
    rows: filtered.slice(0, Math.min(1000, q.limit || 300)),
    totals: { all: rows.length, Hot: rows.filter(r => r.tier === 'Hot').length, Warm: rows.filter(r => r.tier === 'Warm').length, Cool: rows.filter(r => r.tier === 'Cool').length, needToday: rows.filter(r => r.next.due === 'now' || r.next.due === 'today').length },
    learning: [...ctx.bandBonus.entries()].map(([band, v]) => ({ band, meetingRate: Math.round(v.rate * 1000) / 10, average: Math.round(v.avg * 1000) / 10, bonus: v.bonus })),
  }
}
