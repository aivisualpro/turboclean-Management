/**
 * CRM relationship history — interactions.
 *
 * An interaction is one touch between us and a dealership: an email, a call,
 * a walk-in, a meeting, a proposal, a note… Each one records
 *   when (occurredAt) · which dealership · which contact · type · who (user)
 *   notes · result/outcome · next action · next-action date
 *
 * Interactions live in `turboCleanCrmInteractions`. They are never hard-deleted:
 * a mistaken entry is *voided* (kept, hidden by default, reason recorded) and
 * every edit is written to the activity log with a field-level diff.
 *
 * The dealership page merges interactions with the system activity log
 * (stage changes, contacts, audits, conversion…) into one chronological feed.
 */
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import { CRM_COLLECTIONS, logActivity, str } from './crm'
import type { SessionActor } from './crm'

export const INTERACTIONS_COLLECTION = 'turboCleanCrmInteractions'

/** Keys are stored; labels are what people see. Order = the order in the picker. */
export const INTERACTION_TYPES = [
  { key: 'research_completed', label: 'Research completed' },
  { key: 'email_sent', label: 'Email sent' },
  { key: 'email_reply', label: 'Email reply' },
  { key: 'positive_reply', label: 'Positive reply' },
  { key: 'negative_reply', label: 'Negative reply' },
  { key: 'phone_call', label: 'Phone call' },
  { key: 'connected_call', label: 'Connected phone call' },
  { key: 'voicemail', label: 'Voicemail' },
  { key: 'text_message', label: 'Text message' },
  { key: 'walk_in', label: 'Walk-in visit' },
  { key: 'conversation', label: 'Conversation' },
  { key: 'meeting_scheduled', label: 'Meeting scheduled' },
  { key: 'meeting_completed', label: 'Meeting completed' },
  { key: 'proposal_sent', label: 'Proposal sent' },
  { key: 'follow_up', label: 'Follow-up' },
  { key: 'referral', label: 'Referral/introduction' },
  { key: 'contract_won', label: 'Contract won' },
  { key: 'contract_lost', label: 'Contract lost' },
  { key: 'note', label: 'Note' },
] as const
export type InteractionType = typeof INTERACTION_TYPES[number]['key']
const TYPE_KEYS = INTERACTION_TYPES.map(t => t.key) as string[]
export const interactionLabel = (k: string) => INTERACTION_TYPES.find(t => t.key === k)?.label || k

export type InteractionSource = 'manual' | 'audit' | 'conversion' | 'legacy-note' | 'api' | 'email' | 'automation'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EDITABLE = ['type', 'occurredAt', 'contactId', 'user', 'notes', 'outcome', 'nextAction', 'nextActionDate', 'nextActionType', 'nextActionTime'] as const
/** What kind of next step it is — drives the Today board (calls due, meetings today…). */
export const NEXT_ACTION_TYPES = ['follow_up', 'call', 'email', 'meeting', 'visit', 'proposal', 'research', 'other'] as const
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
/** Sensible default when the rep doesn't pick one. */
export function inferNextActionType(interactionType: string, text: string) {
  const t = text.toLowerCase().trim()
  // The leading verb wins: "Call Priya about the demo" is a call, not a meeting.
  if (/^(call|phone|ring|dial)\b/.test(t)) return 'call'
  if (/^(email|e-mail|send|reply)\b/.test(t)) return 'email'
  if (/^(visit|stop by|drop by|walk[- ]?in)\b/.test(t)) return 'visit'
  if (interactionType === 'meeting_scheduled' || /\b(meeting|demo|walkthrough|review call)\b/.test(t)) return 'meeting'
  if (/\b(call|phone|ring|dial)\b/.test(t)) return 'call'
  if (/\b(email|send|reply)\b/.test(t)) return 'email'
  if (/\b(visit|stop by|drop by|walk-?in)\b/.test(t)) return 'visit'
  if (/\bproposal|quote|pricing\b/.test(t)) return 'proposal'
  if (/\bresearch|audit\b/.test(t)) return 'research'
  return 'follow_up'
}
function parseNextActionType(v: unknown, interactionType: string, text: string) {
  const s = str(v, 20)
  return (NEXT_ACTION_TYPES as readonly string[]).includes(s) ? s : inferNextActionType(interactionType, text)
}
function parseTime(v: unknown) {
  const s = str(v, 5)
  if (!s) return null
  if (!TIME_RE.test(s)) throw createError({ statusCode: 400, statusMessage: 'Time must be HH:mm' })
  return s
}

let _indexed = false
async function col(db: Db) {
  const c = db.collection(INTERACTIONS_COLLECTION)
  if (!_indexed) {
    _indexed = true
    await Promise.all([
      c.createIndex({ dealershipId: 1, occurredAt: -1 }),
      c.createIndex({ nextActionDate: 1, nextActionDone: 1, voidedAt: 1 }),
      c.createIndex({ 'user.id': 1, occurredAt: -1 }),
    ]).catch(e => console.warn('[CRM] interaction indexes skipped:', e?.message))
  }
  return c
}

export function serializeInteraction(doc: any) {
  const { _id, ...rest } = doc
  return { id: _id.toString(), ...rest, typeLabel: interactionLabel(rest.type) }
}

/** Resolve "who did it": an explicit app user, else the signed-in user, else System. */
async function resolveUser(db: Db, body: any, actor: SessionActor | null) {
  const id = str(body?.userId, 64)
  if (id && id !== actor?.id && ObjectId.isValid(id)) {
    const u = await db.collection('turboCleanAppUsers').findOne({ _id: new ObjectId(id) }, { projection: { name: 1, email: 1 } })
    if (!u) throw createError({ statusCode: 400, statusMessage: 'Unknown user' })
    return { id, name: u.name || u.email || 'Unknown', email: u.email || '' }
  }
  return actor ? { id: actor.id, name: actor.name, email: actor.email } : { id: 'system', name: 'System', email: '' }
}

/** Contact snapshot — name/title as they were when the interaction happened. */
async function resolveContact(db: Db, dealershipId: string, contactId: unknown) {
  const id = str(contactId, 64)
  if (!id) return { contactId: null, contactName: '', contactTitle: '' }
  if (!ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid contact' })
  const c = await db.collection(CRM_COLLECTIONS.contacts).findOne({ _id: new ObjectId(id), dealershipId })
  if (!c) throw createError({ statusCode: 400, statusMessage: 'Contact does not belong to this dealership' })
  return { contactId: id, contactName: `${c.firstName || ''} ${c.lastName || ''}`.trim(), contactTitle: c.jobTitle || c.role || '' }
}

function parseOccurredAt(v: unknown) {
  if (v === undefined || v === null || v === '') return new Date().toISOString()
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) throw createError({ statusCode: 400, statusMessage: 'Invalid date/time' })
  // Allow a little clock skew; real future items belong in "next action".
  if (d.getTime() > Date.now() + 10 * 60_000) throw createError({ statusCode: 400, statusMessage: 'Date/time cannot be in the future — use Next action for planned items' })
  return d.toISOString()
}
function parseNextActionDate(v: unknown) {
  const s = str(v, 10)
  if (!s) return null
  if (!DATE_RE.test(s)) throw createError({ statusCode: 400, statusMessage: 'Next-action date must be YYYY-MM-DD' })
  return s
}

export async function createInteraction(db: Db, dealership: any, body: any, actor: SessionActor | null, source: InteractionSource = 'manual') {
  const type = str(body?.type, 40)
  if (!TYPE_KEYS.includes(type)) throw createError({ statusCode: 400, statusMessage: 'Unknown activity type' })
  const dealershipId = dealership._id.toString()
  const notes = str(body?.notes, 10_000)
  const nextAction = str(body?.nextAction, 500)
  const nextActionDate = parseNextActionDate(body?.nextActionDate)
  if (nextActionDate && !nextAction) throw createError({ statusCode: 400, statusMessage: 'Describe the next action for that date' })
  const now = new Date().toISOString()
  const doc = {
    schemaVersion: 1,
    dealershipId,
    dealershipCode: dealership.dealershipId || '',
    dealershipName: dealership.name || '',
    type,
    occurredAt: parseOccurredAt(body?.occurredAt),
    ...(await resolveContact(db, dealershipId, body?.contactId)),
    user: await resolveUser(db, body, actor),
    notes,
    outcome: str(body?.outcome, 500),
    nextAction,
    nextActionDate,
    nextActionType: nextAction ? parseNextActionType(body?.nextActionType, type, nextAction) : null,
    nextActionTime: nextAction ? parseTime(body?.nextActionTime) : null,
    nextActionDone: false,
    nextActionDoneAt: null as string | null,
    nextActionDoneBy: null as any,
    source,
    refs: body?.refs && typeof body.refs === 'object' ? body.refs : null,
    voidedAt: null as string | null,
    voidedBy: null as any,
    voidReason: '',
    createdBy: actor ? { id: actor.id, name: actor.name, email: actor.email } : { id: 'system', name: 'System', email: '' },
    createdAt: now,
    updatedAt: now,
  }
  const c = await col(db)
  const res = await c.insertOne(doc)
  const id = res.insertedId.toString()

  // Logging a new touch usually closes the follow-up that prompted it.
  if (body?.completePrevious) {
    await c.updateMany(
      { dealershipId, _id: { $ne: res.insertedId }, nextAction: { $ne: '' }, nextActionDone: false, voidedAt: null },
      { $set: { nextActionDone: true, nextActionDoneAt: now, nextActionDoneBy: doc.createdBy, nextActionDoneVia: id, updatedAt: now } },
    )
  }
  await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: dealership._id }, { $set: { updatedAt: now } })
  if (source === 'manual') {
    const { attributeOutcome } = await import('./crm-email')
    await attributeOutcome(db, dealershipId, { interactionType: type }, new Date(doc.occurredAt))
  }
  return serializeInteraction({ _id: res.insertedId, ...doc })
}

/**
 * Edit / complete / void an interaction. Every change is diffed into the activity log,
 * so corrections are visible and nothing silently disappears.
 */
export async function updateInteraction(db: Db, dealershipId: string, interactionId: string, body: any, actor: SessionActor | null) {
  if (!ObjectId.isValid(interactionId)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  const c = await col(db)
  const before = await c.findOne({ _id: new ObjectId(interactionId), dealershipId })
  if (!before) throw createError({ statusCode: 404, statusMessage: 'Activity not found' })
  const now = new Date().toISOString()
  const who = actor ? { id: actor.id, name: actor.name, email: actor.email } : { id: 'system', name: 'System', email: '' }
  const $set: Record<string, any> = {}

  for (const k of EDITABLE) {
    if (k === 'user' ? !('userId' in (body || {})) : !(k in (body || {}))) continue
    switch (k) {
      case 'type': {
        const t = str(body.type, 40)
        if (!TYPE_KEYS.includes(t)) throw createError({ statusCode: 400, statusMessage: 'Unknown activity type' })
        $set.type = t; break
      }
      case 'occurredAt': $set.occurredAt = parseOccurredAt(body.occurredAt); break
      case 'contactId': Object.assign($set, await resolveContact(db, dealershipId, body.contactId)); break
      case 'user': $set.user = await resolveUser(db, body, actor); break
      case 'notes': $set.notes = str(body.notes, 10_000); break
      case 'outcome': $set.outcome = str(body.outcome, 500); break
      case 'nextAction': $set.nextAction = str(body.nextAction, 500); break
      case 'nextActionDate': $set.nextActionDate = parseNextActionDate(body.nextActionDate); break
      case 'nextActionType': $set.nextActionType = parseNextActionType(body.nextActionType, before.type, String(body.nextAction ?? before.nextAction ?? '')); break
      case 'nextActionTime': $set.nextActionTime = parseTime(body.nextActionTime); break
    }
  }
  if (typeof body?.nextActionDone === 'boolean') {
    $set.nextActionDone = body.nextActionDone
    $set.nextActionDoneAt = body.nextActionDone ? now : null
    $set.nextActionDoneBy = body.nextActionDone ? who : null
  }
  let voidChange: 'void' | 'restore' | null = null
  if (typeof body?.voided === 'boolean' && body.voided !== !!before.voidedAt) {
    voidChange = body.voided ? 'void' : 'restore'
    $set.voidedAt = body.voided ? now : null
    $set.voidedBy = body.voided ? who : null
    $set.voidReason = body.voided ? str(body.voidReason, 500) : ''
  }
  const finalNextAction = $set.nextAction ?? before.nextAction
  const finalNextDate = 'nextActionDate' in $set ? $set.nextActionDate : before.nextActionDate
  if (finalNextDate && !finalNextAction) throw createError({ statusCode: 400, statusMessage: 'Describe the next action for that date' })

  $set.updatedAt = now
  await c.updateOne({ _id: before._id }, { $set })
  const after = await c.findOne({ _id: before._id })

  const label = interactionLabel(after!.type)
  if (voidChange) {
    const { setActivityTimeVoided } = await import('./crm-time')
    await setActivityTimeVoided(db, interactionId, voidChange === 'void')
    await logActivity(db, { dealershipId, type: voidChange === 'void' ? 'interaction.voided' : 'interaction.restored', actor,
      message: voidChange === 'void' ? `Voided "${label}" from ${before.occurredAt.slice(0, 10)}${$set.voidReason ? ` — ${$set.voidReason}` : ''}` : `Restored "${label}" from ${before.occurredAt.slice(0, 10)}` })
  } else if (typeof body?.nextActionDone === 'boolean' && Object.keys($set).length <= 4) {
    await logActivity(db, { dealershipId, type: 'interaction.updated', actor,
      message: body.nextActionDone ? `Next action done: ${after!.nextAction}` : `Next action reopened: ${after!.nextAction}` })
  } else {
    const keys = ['type', 'occurredAt', 'contactName', 'notes', 'outcome', 'nextAction', 'nextActionDate', 'nextActionType', 'nextActionTime']
    const changes: Record<string, { from: any, to: any }> = {}
    for (const k of keys) if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after![k] ?? null)) changes[k] = { from: k === 'type' ? interactionLabel(before[k]) : before[k] ?? null, to: k === 'type' ? interactionLabel(after![k]) : after![k] ?? null }
    if (before.user?.id !== after!.user?.id) changes.user = { from: before.user?.name, to: after!.user?.name }
    if (Object.keys(changes).length)
      await logActivity(db, { dealershipId, type: 'interaction.updated', actor, message: `Edited "${label}" from ${after!.occurredAt.slice(0, 10)}`, changes })
  }
  return serializeInteraction(after)
}

export async function listInteractions(db: Db, dealershipId: string) {
  const rows = await (await col(db)).find({ dealershipId }).sort({ occurredAt: -1, createdAt: -1 }).toArray()
  return rows.map(serializeInteraction)
}

/** Per-dealership summary for the list grid: count, last touch, earliest open next action. */
export async function interactionSummaries(db: Db, dealershipIds: string[]) {
  const map = new Map<string, any>()
  if (!dealershipIds.length) return map
  const c = await col(db)
  const [touches, next] = await Promise.all([
    c.aggregate([
      { $match: { dealershipId: { $in: dealershipIds }, voidedAt: null } },
      { $sort: { occurredAt: -1 } },
      { $group: { _id: '$dealershipId', count: { $sum: 1 }, last: { $first: { type: '$type', occurredAt: '$occurredAt', userName: '$user.name', contactName: '$contactName', outcome: '$outcome' } } } },
    ]).toArray(),
    c.aggregate([
      { $match: { dealershipId: { $in: dealershipIds }, voidedAt: null, nextActionDone: false, nextAction: { $ne: '' } } },
      { $sort: { nextActionDate: 1, occurredAt: -1 } },
      // Dated actions first; undated ones only if nothing is dated.
      { $addFields: { _undated: { $cond: [{ $ifNull: ['$nextActionDate', false] }, 0, 1] } } },
      { $sort: { _undated: 1, nextActionDate: 1 } },
      { $group: { _id: '$dealershipId', open: { $sum: 1 }, next: { $first: { id: { $toString: '$_id' }, text: '$nextAction', date: '$nextActionDate', time: '$nextActionTime', type: '$nextActionType', userName: '$user.name' } } } },
    ]).toArray(),
  ])
  for (const t of touches) map.set(t._id, { count: t.count, last: { ...t.last, typeLabel: interactionLabel(t.last.type) }, nextAction: null, openNextActions: 0 })
  for (const n of next) {
    const s = map.get(n._id) || { count: 0, last: null, nextAction: null, openNextActions: 0 }
    s.nextAction = n.next; s.openNextActions = n.open
    map.set(n._id, s)
  }
  return map
}

/**
 * One-time: free-form notes posted to the activity log before interactions existed
 * become `Note` interactions (the original activity rows are kept, flagged migrated).
 */
export async function migrateLegacyNotes(db: Db) {
  const counters = db.collection(CRM_COLLECTIONS.counters)
  const flag = await counters.findOne({ _id: 'crmInteractionsV1' as any })
  if (flag?.done) return
  const claim = await counters.updateOne({ _id: 'crmInteractionsV1' as any, startedAt: { $exists: false } }, { $set: { startedAt: new Date().toISOString() } }, { upsert: true }).catch(() => null)
  if (!claim || (!claim.upsertedCount && !claim.modifiedCount)) return
  const activity = db.collection(CRM_COLLECTIONS.activity)
  const c = await col(db)
  let moved = 0
  for await (const a of activity.find({ type: 'note', migratedToInteraction: { $exists: false } })) {
    const d = ObjectId.isValid(a.dealershipId) ? await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: new ObjectId(a.dealershipId) }, { projection: { dealershipId: 1, name: 1 } }) : null
    const res = await c.insertOne({
      schemaVersion: 1, dealershipId: a.dealershipId, dealershipCode: d?.dealershipId || '', dealershipName: d?.name || '',
      type: 'note', occurredAt: a.at, contactId: a.contactId || null, contactName: '', contactTitle: '',
      user: a.actor || { id: 'system', name: 'System', email: '' }, notes: a.message, outcome: '', nextAction: '', nextActionDate: null,
      nextActionDone: false, nextActionDoneAt: null, nextActionDoneBy: null, source: 'legacy-note', refs: { activityId: a._id.toString() },
      voidedAt: null, voidedBy: null, voidReason: '', createdBy: a.actor || null, createdAt: a.at, updatedAt: a.at,
    })
    await activity.updateOne({ _id: a._id }, { $set: { migratedToInteraction: res.insertedId.toString() } })
    moved++
  }
  await counters.updateOne({ _id: 'crmInteractionsV1' as any }, { $set: { done: true, finishedAt: new Date().toISOString(), moved } })
  if (moved) console.log(`[CRM] moved ${moved} legacy notes into interactions`)
}
