/**
 * Follow-up system — "no active prospect disappears because someone forgot".
 *
 * Coverage rule: every live dealership must be in exactly one of these states
 *   1. an open next action WITH a date            (interactions.nextAction / nextActionDate)
 *   2. Won                                         (lives in Dealers)
 *   3. Lost                                        (optionally with a revisit date)
 *   4. Nurture / Follow Up Later WITH a revisit date (dealership.revisitDate)
 *   – or it is queued for research / first contact (Research Needed, Researched, Ready to Contact),
 *     which the board lists as "Dealers to research" / "Dealers to contact".
 * Anything else is flagged "No next step".
 *
 * The board is computed for the viewer's local date (`today`, YYYY-MM-DD) so "due today" matches their day.
 */
import type { Db } from 'mongodb'
import { CRM_COLLECTIONS, OPEN_STAGE_ORDER, str } from './crm'
import { parseLostInput } from './crm-lost'

export const NURTURE_STAGE = 'Nurture / Follow Up Later'
export const LOST_STAGE = 'Lost'
export const RESEARCH_STAGES = ['Research Needed']
export const CONTACT_STAGES = ['Researched', 'Ready to Contact']
export const LATE_STAGES = ['Meeting Completed', 'Opportunity', 'Proposal Sent', 'Negotiating']
/** Active prospects with no logged activity for this long show as "no recent activity". */
export const NO_ACTIVITY_DAYS = 14
/** Late-stage deals untouched this long — or sitting in their stage this long — are "stale". */
export const STALE_OPP_TOUCH_DAYS = 10
export const STALE_OPP_STAGE_DAYS = 30
export const DEFAULT_NURTURE_DAYS = 90

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY = 86_400_000
const addDays = (ymd: string, n: number) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10)
const todayUtc = () => new Date().toISOString().slice(0, 10)

/**
 * Stage-dependent "parking" fields, applied to a dealership $set:
 *  - entering Nurture → revisitDate required (defaults to +90 days so it can never be missing)
 *  - entering Lost → optional lostReason / revisitDate ("try again in a year")
 *  - leaving Nurture/Lost → revisitDate cleared
 */
export function applyParkingFields($set: Record<string, any>, body: any, before: any) {
  const stage = $set.stage ?? before.stage
  const leaving = $set.stage !== undefined && $set.stage !== before.stage
  if ('revisitDate' in (body || {})) {
    const v = str(body.revisitDate, 10)
    if (v && !DATE_RE.test(v)) throw createError({ statusCode: 400, statusMessage: 'Revisit date must be YYYY-MM-DD' })
    $set.revisitDate = v || null
  }
  if ('parkedNote' in (body || {})) $set.parkedNote = str(body.parkedNote, 500)
  // Lost always needs a standard reason (notes required for "Other"); edits while already Lost are allowed too.
  const enteringLost = stage === LOST_STAGE && (leaving || before.stage !== LOST_STAGE)
  if (enteringLost || (stage === LOST_STAGE && 'lostReason' in (body || {}))) {
    const lost = parseLostInput(body, { required: true })
    $set.lostReason = lost.reason
    $set.lostNotes = lost.notes
    $set.lostCompetitor = lost.competitor
    if (enteringLost) { $set.lostAt = new Date().toISOString(); $set.lostFromStage = before.stage || '' }
  }
  if (stage === NURTURE_STAGE) {
    const rd = $set.revisitDate !== undefined ? $set.revisitDate : before.revisitDate
    if (!rd) $set.revisitDate = addDays(todayUtc(), DEFAULT_NURTURE_DAYS)
  }
  else if (stage !== LOST_STAGE && leaving && (before.revisitDate || before.lostReason)) {
    $set.revisitDate = null
    $set.lostReason = ''
    $set.lostNotes = ''
    $set.lostCompetitor = ''
  }
  if (leaving) $set.parkedAt = (stage === NURTURE_STAGE || stage === LOST_STAGE) ? new Date().toISOString() : null
}

export interface BoardItem {
  dealershipId: string
  dealershipCode: string
  name: string
  stage: string
  city: string
  state: string
  ownerId: string
  ownerName: string
  daysInStage: number | null
  lastTouchAt: string | null
  lastTouchType: string | null
  daysSinceTouch: number | null
  contact: { name: string, title: string, phone: string, email: string } | null
  nextAction: { interactionId: string, text: string, type: string, date: string | null, time: string | null, userId: string, userName: string, daysOverdue: number } | null
  revisitDate: string | null
  reason: string
}

/**
 * Build the follow-up board.
 * scope: 'all' | 'mine' | <userId> — mine = I own the dealership OR the next action is mine.
 */
export async function followUpBoard(db: Db, q: { today?: string, scope?: string, userId?: string | null }) {
  const today = q.today && DATE_RE.test(q.today) ? q.today : todayUtc()
  const daysSince = (iso: string | null | undefined) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY)) : null
  const daysBetween = (a: string, b: string) => Math.round((new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / DAY)

  const dealerships = await db.collection(CRM_COLLECTIONS.dealerships).find({ archivedAt: null }, {
    projection: { dealershipId: 1, name: 1, stage: 1, city: 1, state: 1, assignedUserId: 1, assignedUserName: 1, stageChangedAt: 1, createdAt: 1, dealerId: 1, revisitDate: 1, lostReason: 1 },
  }).toArray()
  const ids = dealerships.map(d => d._id.toString())
  const ix = db.collection('turboCleanCrmInteractions')
  const [open, last, contacts] = await Promise.all([
    ix.find({ dealershipId: { $in: ids }, voidedAt: null, nextActionDone: false, nextAction: { $nin: ['', null] } },
      { projection: { dealershipId: 1, nextAction: 1, nextActionDate: 1, nextActionTime: 1, nextActionType: 1, user: 1, type: 1, contactId: 1 } }).toArray(),
    ix.aggregate([
      { $match: { dealershipId: { $in: ids }, voidedAt: null } },
      { $sort: { occurredAt: -1 } },
      { $group: { _id: '$dealershipId', at: { $first: '$occurredAt' }, type: { $first: '$type' } } },
    ]).toArray(),
    db.collection(CRM_COLLECTIONS.contacts).find({ dealershipId: { $in: ids }, isActive: true }, { projection: { dealershipId: 1, firstName: 1, lastName: 1, jobTitle: 1, role: 1, phone: 1, mobile: 1, email: 1, isPrimary: 1 } }).toArray(),
  ])
  const lastBy = new Map(last.map(l => [l._id as string, l]))
  const contactBy = new Map<string, any>()
  const contactById = new Map<string, any>()
  for (const c of contacts) {
    contactById.set(c._id.toString(), c)
    const cur = contactBy.get(c.dealershipId)
    if (!cur || (c.isPrimary && !cur.isPrimary)) contactBy.set(c.dealershipId, c)
  }
  const openBy = new Map<string, any[]>()
  for (const o of open) openBy.set(o.dealershipId, [...(openBy.get(o.dealershipId) || []), o])

  const mineId = q.scope === 'mine' ? q.userId : (q.scope && q.scope !== 'all' ? q.scope : null)
  const contactOf = (c: any) => c ? { name: `${c.firstName || ''} ${c.lastName || ''}`.trim(), title: c.jobTitle || c.role || '', phone: c.mobile || c.phone || '', email: c.email || '' } : null

  const base = (d: any): Omit<BoardItem, 'nextAction' | 'reason'> => {
    const id = d._id.toString()
    const l = lastBy.get(id)
    return {
      dealershipId: id, dealershipCode: d.dealershipId || '', name: d.name, stage: d.stage, city: d.city || '', state: d.state || '',
      ownerId: d.assignedUserId || '', ownerName: d.assignedUserName || '',
      daysInStage: daysSince(d.stageChangedAt || d.createdAt), lastTouchAt: l?.at || null, lastTouchType: l?.type || null, daysSinceTouch: daysSince(l?.at),
      contact: contactOf(contactBy.get(id)), revisitDate: d.revisitDate || null,
    }
  }
  const actionItem = (d: any, o: any, reason: string): BoardItem => ({
    ...base(d), reason,
    contact: contactOf(contactById.get(o.contactId)) || contactOf(contactBy.get(d._id.toString())),
    nextAction: { interactionId: o._id.toString(), text: o.nextAction, type: o.nextActionType || 'follow_up', date: o.nextActionDate || null, time: o.nextActionTime || null,
      userId: o.user?.id || '', userName: o.user?.name || '', daysOverdue: o.nextActionDate ? Math.max(0, daysBetween(today, o.nextActionDate)) : 0 },
  })
  const inScope = (d: any, o?: any) => !mineId || d.assignedUserId === mineId || (o && o.user?.id === mineId)

  const board = {
    today, rules: { NO_ACTIVITY_DAYS, STALE_OPP_TOUCH_DAYS, STALE_OPP_STAGE_DAYS, DEFAULT_NURTURE_DAYS },
    followUpsToday: [] as BoardItem[], meetingsToday: [] as BoardItem[], callsDue: [] as BoardItem[], revisitsDue: [] as BoardItem[],
    toResearch: [] as BoardItem[], toContact: [] as BoardItem[],
    overdueFollowUps: [] as BoardItem[], noRecentActivity: [] as BoardItem[], staleOpportunities: [] as BoardItem[], noNextStep: [] as BoardItem[],
    upcoming: [] as BoardItem[],
    coverage: { active: 0, covered: 0, queued: 0, parked: 0, uncovered: 0 },
  }
  const weekAhead = addDays(today, 7)

  for (const d of dealerships) {
    const id = d._id.toString()
    const isOpenStage = OPEN_STAGE_ORDER.includes(d.stage)
    const converted = !!d.dealerId || d.stage === 'Won'
    if (converted) continue
    const actions = (openBy.get(id) || []).sort((a, b) => (a.nextActionDate || '9999').localeCompare(b.nextActionDate || '9999'))
    const dated = actions.filter(a => a.nextActionDate)

    // Next actions → today / calls / meetings / overdue / upcoming
    for (const o of dated) {
      if (!inScope(d, o)) continue
      const type = o.nextActionType || 'follow_up'
      if (o.nextActionDate < today) {
        if (type === 'call') board.callsDue.push(actionItem(d, o, 'Call overdue'))
        else board.overdueFollowUps.push(actionItem(d, o, type === 'meeting' ? 'Meeting date passed — log the outcome' : 'Overdue'))
      }
      else if (o.nextActionDate === today) {
        if (type === 'meeting') board.meetingsToday.push(actionItem(d, o, 'Meeting today'))
        else if (type === 'call') board.callsDue.push(actionItem(d, o, 'Call today'))
        else board.followUpsToday.push(actionItem(d, o, 'Due today'))
      }
      else if (o.nextActionDate <= weekAhead) board.upcoming.push(actionItem(d, o, 'This week'))
    }
    if (!inScope(d)) continue

    // Parked: Nurture / Lost with a revisit date due
    if ((d.stage === NURTURE_STAGE || d.stage === LOST_STAGE) && d.revisitDate && d.revisitDate <= today)
      board.revisitsDue.push({ ...base(d), nextAction: null, reason: d.stage === LOST_STAGE ? `Lost${d.lostReason ? ` (${d.lostReason})` : ''} — revisit date reached` : 'Nurture revisit date reached' })

    if (!isOpenStage && d.stage !== NURTURE_STAGE) continue // Lost: done unless a revisit date is due
    board.coverage.active++

    if (d.stage === NURTURE_STAGE) { board.coverage.parked++; continue }
    if (RESEARCH_STAGES.includes(d.stage)) { board.coverage.queued++; if (!dated.length) board.toResearch.push({ ...base(d), nextAction: null, reason: 'Needs research' }); else board.coverage.covered++; continue }
    if (CONTACT_STAGES.includes(d.stage)) { board.coverage.queued++; if (!dated.length) board.toContact.push({ ...base(d), nextAction: null, reason: d.stage === 'Researched' ? 'Researched — not contacted yet' : 'Ready to contact' }); else board.coverage.covered++; continue }

    const b = base(d)
    if (!dated.length) {
      board.coverage.uncovered++
      board.noNextStep.push({ ...b, nextAction: actions[0] ? { interactionId: actions[0]._id.toString(), text: actions[0].nextAction, type: actions[0].nextActionType || 'follow_up', date: null, time: null, userId: actions[0].user?.id || '', userName: actions[0].user?.name || '', daysOverdue: 0 } : null,
        reason: actions.length ? 'Next action has no date' : 'No next action planned' })
    }
    else board.coverage.covered++

    const late = LATE_STAGES.includes(d.stage)
    const touch = b.daysSinceTouch ?? b.daysInStage ?? 0
    if (late && (touch >= STALE_OPP_TOUCH_DAYS || (b.daysInStage ?? 0) >= STALE_OPP_STAGE_DAYS))
      board.staleOpportunities.push({ ...b, nextAction: dated[0] ? actionItem(d, dated[0], '').nextAction : null,
        reason: touch >= STALE_OPP_TOUCH_DAYS ? `No activity for ${touch} days` : `${b.daysInStage} days in ${d.stage}` })
    else if (!late && touch >= NO_ACTIVITY_DAYS)
      board.noRecentActivity.push({ ...b, nextAction: dated[0] ? actionItem(d, dated[0], '').nextAction : null,
        reason: b.lastTouchAt ? `Last activity ${touch} days ago` : `Never contacted — ${touch} days in pipeline` })
  }

  const byDate = (a: BoardItem, b: BoardItem) => (a.nextAction?.date || '').localeCompare(b.nextAction?.date || '') || (a.nextAction?.time || '99').localeCompare(b.nextAction?.time || '99')
  board.followUpsToday.sort(byDate); board.meetingsToday.sort(byDate); board.callsDue.sort(byDate); board.upcoming.sort(byDate)
  board.overdueFollowUps.sort((a, b) => (b.nextAction?.daysOverdue || 0) - (a.nextAction?.daysOverdue || 0))
  const oldest = (a: BoardItem, b: BoardItem) => (b.daysSinceTouch ?? b.daysInStage ?? 0) - (a.daysSinceTouch ?? a.daysInStage ?? 0)
  board.noRecentActivity.sort(oldest); board.staleOpportunities.sort(oldest); board.noNextStep.sort(oldest)
  board.toResearch.sort((a, b) => (b.daysInStage ?? 0) - (a.daysInStage ?? 0)); board.toContact.sort((a, b) => (b.daysInStage ?? 0) - (a.daysInStage ?? 0))
  board.revisitsDue.sort((a, b) => (a.revisitDate || '').localeCompare(b.revisitDate || ''))
  return board
}
