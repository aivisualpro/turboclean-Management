/**
 * Main CRM dashboard: activity, funnel, results, efficiency for a date range.
 * from/to are calendar days (YYYY-MM-DD, the user's local dates); fromTs/toTs are the matching instants.
 */
import type { Db } from 'mongodb'
import { buildFacts, FUNNEL_LABELS, FUNNEL_STEPS, OUTREACH_TYPES } from './crm-facts'
import type { DealershipFacts, FunnelStep } from './crm-facts'

/** Chance an open deal at this stage closes — used for the weighted pipeline. */
export const STAGE_WEIGHT: Record<string, number> = {
  'Meeting Scheduled': 0.15, 'Meeting Completed': 0.25, 'Opportunity': 0.35, 'Proposal Sent': 0.5, 'Negotiating': 0.7,
}

export interface DashboardQuery { from: string, to: string, fromTs: string, toTs: string, userId?: string }

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100
const ratio = (a: number, b: number) => b ? round1(a / b) : null
const per100 = (a: number, b: number) => b ? round1((a / b) * 100) : null

export async function dashboard(db: Db, q: DashboardQuery) {
  const inTs = (v?: string | null) => !!v && v >= q.fromTs && v <= q.toTs
  const inDay = (v?: string | null) => !!v && v.slice(0, 10) >= q.from && v.slice(0, 10) <= q.to

  const allFacts = await buildFacts(db)
  const facts = q.userId ? allFacts.filter(f => f.ownerId === q.userId) : allFacts

  // ── Activity (what was done in the period) ──
  const ixMatch: any = { voidedAt: null, occurredAt: { $gte: q.fromTs, $lte: q.toTs } }
  if (q.userId) ixMatch['user.id'] = q.userId
  const [ix, audits, researchedStages, timeRows, lostCount, wins] = await Promise.all([
    db.collection('turboCleanCrmInteractions').find(ixMatch, { projection: { dealershipId: 1, type: 1, occurredAt: 1 } }).toArray(),
    db.collection('turboCleanCrmAudits').find({ auditedAt: { $gte: q.fromTs, $lte: q.toTs }, ...(q.userId ? { 'auditedBy.id': q.userId } : {}) }, { projection: { dealershipId: 1 } }).toArray(),
    db.collection('turboCleanCrmStageHistory').find({ toStage: 'Researched', changedAt: { $gte: q.fromTs, $lte: q.toTs }, ...(q.userId ? { 'user.id': q.userId } : {}) }, { projection: { dealershipId: 1 } }).toArray(),
    db.collection('turboCleanCrmTimeEntries').find({ endedAt: { $ne: null }, voidedAt: null, date: { $gte: q.from, $lte: q.to }, ...(q.userId ? { userId: q.userId } : {}) }, { projection: { minutes: 1 } }).toArray(),
    db.collection('turboCleanCrmLostDeals').countDocuments({ lostAt: { $gte: q.fromTs, $lte: q.toTs }, reopenedAt: null, ...(q.userId ? { ownerId: q.userId } : {}) }),
    db.collection('turboCleanCrmWonDeals').find({ revertedAt: null, wonAt: { $gte: q.from, $lte: q.to }, ...(q.userId ? { ownerId: q.userId } : {}) }, { projection: { monthlyRevenue: 1, annualRevenue: 1 } }).toArray(),
  ])
  const count = (types: string[]) => ix.filter(i => types.includes(i.type)).length
  const distinct = (types: string[]) => new Set(ix.filter(i => types.includes(i.type)).map(i => i.dealershipId)).size
  const researchedIds = new Set([...ix.filter(i => i.type === 'research_completed').map(i => i.dealershipId), ...audits.map(a => a.dealershipId), ...researchedStages.map(h => h.dealershipId)])
  const contactTypes = OUTREACH_TYPES.filter(t => !t.startsWith('meeting') && t !== 'proposal_sent')
  const contactedIds = new Set(ix.filter(i => contactTypes.includes(i.type)).map(i => i.dealershipId))
  const firstContacted = facts.filter(f => inTs(f.steps.contacted)).length
  const activity = {
    researched: researchedIds.size,
    contacted: contactedIds.size,
    newlyContacted: firstContacted,
    emails: count(['email_sent']),
    calls: count(['phone_call', 'connected_call', 'voicemail', 'text_message']),
    connectedCalls: count(['connected_call']),
    walkIns: count(['walk_in']),
    followUps: count(['follow_up']),
    conversations: count(['conversation', 'connected_call']),
    meetingsHeld: count(['meeting_completed']),
    meetingsScheduled: count(['meeting_scheduled']),
    replies: count(['email_reply', 'positive_reply', 'negative_reply']),
    dealershipsTouched: distinct(contactTypes),
  }

  // Daily (or weekly for long ranges) outreach volume.
  const days = Math.round((new Date(q.toTs).getTime() - new Date(q.fromTs).getTime()) / 86_400_000) + 1
  const weekly = days > 62
  const bucketOf = (iso: string) => {
    const d = new Date(iso)
    if (!weekly) return iso.slice(0, 10)
    const m = new Date(d); m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7)); return m.toISOString().slice(0, 10)
  }
  const series = new Map<string, { emails: number, calls: number, visits: number, other: number }>()
  for (const i of ix) {
    if (!OUTREACH_TYPES.includes(i.type)) continue
    const k = bucketOf(i.occurredAt)
    const r = series.get(k) || { emails: 0, calls: 0, visits: 0, other: 0 }
    if (i.type === 'email_sent') r.emails++
    else if (['phone_call', 'connected_call', 'voicemail', 'text_message'].includes(i.type)) r.calls++
    else if (i.type === 'walk_in') r.visits++
    else r.other++
    series.set(k, r)
  }

  // ── Funnel ──
  const entered = facts.filter(f => inTs(f.steps.researched) || inTs(f.steps.contacted))
  const funnelRows = (pick: (f: DealershipFacts, s: FunnelStep) => boolean, base: DealershipFacts[]) => {
    const rows = FUNNEL_STEPS.map(s => ({ key: s, label: FUNNEL_LABELS[s], count: base.filter(f => pick(f, s)).length }))
    return rows.map((r, i) => ({ ...r, ofPrevious: i ? per100(r.count, rows[i - 1]!.count) : null, ofFirst: i ? per100(r.count, rows[0]!.count) : null }))
  }
  const funnel = {
    /** Dealerships that entered the funnel in the period — how far they have got since. */
    cohort: funnelRows((f, s) => !!f.steps[s], entered),
    /** Dealerships that reached each step for the first time during the period. */
    period: funnelRows((f, s) => inTs(f.steps[s]), facts),
  }

  // ── Results ──
  const meetingsGenerated = facts.filter(f => inTs(f.steps.meeting)).length
  const proposalsGenerated = facts.filter(f => inTs(f.steps.proposal)).length
  const monthlyWon = round2(wins.reduce((a, w) => a + (Number(w.monthlyRevenue) || 0), 0))
  const annualWon = round2(wins.reduce((a, w) => a + (Number(w.annualRevenue) || 0), 0))
  const wonWithoutDetails = facts.filter(f => f.won && f.wonAt && inDay(f.wonAt) && !f.annualRevenue).length

  // Pipeline (now): open deals from Meeting Scheduled onward.
  const allWins = allFacts.filter(f => f.annualRevenue > 0)
  const avgWonAnnual = allWins.length ? round2(allWins.reduce((a, f) => a + f.annualRevenue, 0) / allWins.length) : 0
  const open = facts.filter(f => !f.won && STAGE_WEIGHT[f.stage] != null)
  let pipelineTotal = 0, pipelineWeighted = 0, estimated = 0
  const byStage = new Map<string, { stage: string, deals: number, value: number, weighted: number }>()
  for (const f of open) {
    const annual = f.estMonthlyValue ? f.estMonthlyValue * 12 : avgWonAnnual
    if (f.estMonthlyValue) estimated++
    const w = annual * STAGE_WEIGHT[f.stage]!
    pipelineTotal += annual; pipelineWeighted += w
    const r = byStage.get(f.stage) || { stage: f.stage, deals: 0, value: 0, weighted: 0 }
    r.deals++; r.value += annual; r.weighted += w
    byStage.set(f.stage, r)
  }

  // ── Efficiency ──
  const minutes = timeRows.reduce((a, t) => a + (Number(t.minutes) || 0), 0)
  const hours = round1(minutes / 60)
  const results = {
    meetingsGenerated, proposalsGenerated, won: wins.length, wonWithoutDetails, lost: lostCount,
    monthlyRevenueWon: monthlyWon, annualRevenueWon: annualWon,
    pipeline: {
      deals: open.length, estimated, avgWonAnnual,
      annualValue: round2(pipelineTotal), weightedAnnualValue: round2(pipelineWeighted),
      byStage: Object.keys(STAGE_WEIGHT).map(s => byStage.get(s) || { stage: s, deals: 0, value: 0, weighted: 0 }).map(r => ({ ...r, value: round2(r.value), weighted: round2(r.weighted), weight: STAGE_WEIGHT[r.stage] })),
    },
  }
  const efficiency = {
    hours,
    contacted: activity.contacted,
    meetingsPer100Contacted: per100(meetingsGenerated, activity.contacted),
    wonPer100Contacted: per100(wins.length, activity.contacted),
    hoursPerMeeting: ratio(hours, meetingsGenerated),
    hoursPerAccount: ratio(hours, wins.length),
    annualRevenuePerHour: hours ? round2(annualWon / hours) : null,
  }

  return {
    range: { from: q.from, to: q.to, days, bucket: weekly ? 'week' : 'day' },
    activity,
    series: [...series.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, v]) => ({ key, ...v, total: v.emails + v.calls + v.visits + v.other })),
    funnel, results, efficiency,
  }
}
