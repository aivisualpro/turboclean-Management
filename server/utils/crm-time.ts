/**
 * Time / effort tracking — "where is my time going?"
 *
 * Entries in `turboCleanCrmTimeEntries`, one per block of work:
 *   timer   — started/stopped from the top bar (one running timer per user)
 *   manual  — "add 30 min of driving" after the fact
 *   activity— minutes entered when logging a call / meeting / visit
 * Report: hours by category & week, and the return on that time:
 *   hours → meetings → dealerships won → revenue.
 */
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import { CRM_COLLECTIONS, str } from './crm'
import type { SessionActor } from './crm'

export const TIME_COLLECTION = 'turboCleanCrmTimeEntries'
export const TIME_CATEGORIES = [
  { key: 'research', label: 'Dealer research' },
  { key: 'audit', label: 'Website/inventory audits' },
  { key: 'email', label: 'Email prospecting' },
  { key: 'phone', label: 'Phone prospecting' },
  { key: 'field', label: 'Field/walk-in prospecting' },
  { key: 'driving', label: 'Driving' },
  { key: 'meeting', label: 'Meetings' },
  { key: 'follow_up', label: 'Follow-ups' },
  { key: 'admin', label: 'Proposals/admin' },
] as const
const CATEGORY_KEYS: string[] = TIME_CATEGORIES.map(c => c.key)

/** Activity type → default time category (minutes entered on "Log activity"). */
export const INTERACTION_TIME_CATEGORY: Record<string, string> = {
  research_completed: 'research',
  email_sent: 'email', email_reply: 'email', positive_reply: 'email', negative_reply: 'email',
  phone_call: 'phone', connected_call: 'phone', voicemail: 'phone', text_message: 'phone',
  walk_in: 'field', conversation: 'field', referral: 'field',
  meeting_scheduled: 'meeting', meeting_completed: 'meeting',
  proposal_sent: 'admin', contract_won: 'admin', contract_lost: 'admin', note: 'admin',
  follow_up: 'follow_up',
}

const MAX_MINUTES = 12 * 60
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const today = () => new Date().toISOString().slice(0, 10)

let _indexed = false
async function col(db: Db) {
  const c = db.collection(TIME_COLLECTION)
  if (!_indexed) {
    _indexed = true
    await Promise.all([
      c.createIndex({ userId: 1, endedAt: 1 }), c.createIndex({ date: -1 }), c.createIndex({ interactionId: 1 }, { sparse: true }), c.createIndex({ dealershipId: 1 }),
    ]).catch(e => console.warn('[CRM time] index creation skipped:', e?.message))
  }
  return c
}

export function serializeEntry(e: any) {
  if (!e) return null
  const { _id, ...rest } = e
  return { id: _id.toString(), ...rest }
}

function category(v: unknown) {
  const k = str(v, 40)
  if (!CATEGORY_KEYS.includes(k)) throw createError({ statusCode: 400, statusMessage: 'Pick what the time was spent on' })
  return k
}

async function dealershipRef(db: Db, id: unknown) {
  const s = str(id, 64)
  if (!s || !ObjectId.isValid(s)) return { dealershipId: null, dealershipName: '', dealershipCode: '' }
  const d = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: new ObjectId(s) }, { projection: { name: 1, dealershipId: 1 } })
  return d ? { dealershipId: s, dealershipName: d.name || '', dealershipCode: d.dealershipId || '' } : { dealershipId: null, dealershipName: '', dealershipCode: '' }
}

function minutesOf(v: unknown) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n) || n < 1) throw createError({ statusCode: 400, statusMessage: 'Enter the minutes spent' })
  if (n > MAX_MINUTES) throw createError({ statusCode: 400, statusMessage: 'One entry can be at most 12 hours — split longer days' })
  return n
}

const owns = (e: any, session: any) => !!session && (e.userId === session.id || String(session.role || '').toLowerCase() === 'admin')

export async function runningTimer(db: Db, userId: string) {
  return serializeEntry(await (await col(db)).findOne({ userId, endedAt: null }))
}

async function stopEntry(db: Db, e: any, at = new Date()) {
  const raw = Math.round((at.getTime() - new Date(e.startedAt).getTime()) / 60_000)
  const minutes = Math.min(MAX_MINUTES, Math.max(1, raw))
  await (await col(db)).updateOne({ _id: e._id }, { $set: { endedAt: at.toISOString(), minutes, capped: raw > MAX_MINUTES, updatedAt: at.toISOString() } })
  return { ...e, endedAt: at.toISOString(), minutes, capped: raw > MAX_MINUTES }
}

/** Start the timer (stops any running one first — one timer per person). */
export async function startTimer(db: Db, actor: SessionActor, body: any) {
  const c = await col(db)
  const running = await c.findOne({ userId: actor.id, endedAt: null })
  const stopped = running ? serializeEntry(await stopEntry(db, running)) : null
  const now = new Date().toISOString()
  const doc = {
    userId: actor.id, userName: actor.name, category: category(body?.category), ...(await dealershipRef(db, body?.dealershipId)),
    date: DATE_RE.test(String(body?.date || '')) ? String(body.date) : today(),
    startedAt: now, endedAt: null as string | null, minutes: 0, note: str(body?.note, 500), source: 'timer',
    interactionId: null as string | null, createdAt: now, updatedAt: now,
  }
  const res = await c.insertOne(doc)
  return { entry: serializeEntry({ _id: res.insertedId, ...doc }), stopped }
}

/** A finished block of time (manual entry, or minutes on a logged activity). */
export async function addEntry(db: Db, actor: SessionActor, body: any, source: 'manual' | 'activity' = 'manual') {
  const now = new Date().toISOString()
  const doc = {
    userId: actor.id, userName: actor.name, category: category(body?.category), ...(await dealershipRef(db, body?.dealershipId)),
    date: DATE_RE.test(String(body?.date || '')) ? String(body.date) : today(),
    startedAt: null as string | null, endedAt: now, minutes: minutesOf(body?.minutes), note: str(body?.note, 500), source,
    interactionId: str(body?.interactionId, 64) || null, createdAt: now, updatedAt: now,
  }
  const res = await (await col(db)).insertOne(doc)
  return serializeEntry({ _id: res.insertedId, ...doc })
}

export async function updateEntry(db: Db, id: string, body: any, session: any) {
  if (!ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  const c = await col(db)
  const e = await c.findOne({ _id: new ObjectId(id) })
  if (!e) throw createError({ statusCode: 404, statusMessage: 'Time entry not found' })
  if (!owns(e, session)) throw createError({ statusCode: 403, statusMessage: 'You can only change your own time' })
  if (body?.stop) {
    if (e.endedAt) return serializeEntry(e)
    return serializeEntry(await stopEntry(db, e))
  }
  const $set: any = { updatedAt: new Date().toISOString() }
  if ('category' in body) $set.category = category(body.category)
  if ('note' in body) $set.note = str(body.note, 500)
  if ('date' in body && DATE_RE.test(String(body.date))) $set.date = String(body.date)
  if ('dealershipId' in body) Object.assign($set, await dealershipRef(db, body.dealershipId))
  if ('minutes' in body && e.endedAt) { $set.minutes = minutesOf(body.minutes); $set.capped = false }
  await c.updateOne({ _id: e._id }, { $set })
  return serializeEntry({ ...e, ...$set })
}

export async function deleteEntry(db: Db, id: string, session: any) {
  if (!ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  const c = await col(db)
  const e = await c.findOne({ _id: new ObjectId(id) })
  if (!e) return { ok: true }
  if (!owns(e, session)) throw createError({ statusCode: 403, statusMessage: 'You can only delete your own time' })
  await c.deleteOne({ _id: e._id })
  return { ok: true }
}

/** Voiding an activity removes the time logged with it; restoring brings it back. */
export async function setActivityTimeVoided(db: Db, interactionId: string, voided: boolean) {
  await (await col(db)).updateMany({ interactionId }, { $set: { voidedAt: voided ? new Date().toISOString() : null } })
}

export async function listEntries(db: Db, q: { from?: string, to?: string, userId?: string, limit?: number }) {
  const match: any = { voidedAt: null }
  if (q.from || q.to) match.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) }
  if (q.userId) match.userId = q.userId
  const rows = await (await col(db)).find(match).sort({ date: -1, createdAt: -1 }).limit(Math.min(q.limit || 500, 2000)).toArray()
  return rows.map(serializeEntry)
}

/** Monday of the week containing `date` (YYYY-MM-DD). */
function weekOf(date: string) {
  const d = new Date(`${date}T12:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

/**
 * Hours by category / week / person / dealership, and what the hours produced in the same window:
 * meetings held, proposals, dealerships won, revenue (from won-deal records).
 */
export async function timeReport(db: Db, q: { from?: string, to?: string, userId?: string }) {
  const match: any = { endedAt: { $ne: null }, voidedAt: null }
  if (q.from || q.to) match.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) }
  if (q.userId) match.userId = q.userId
  const entries = await (await col(db)).find(match, { projection: { category: 1, minutes: 1, date: 1, userId: 1, userName: 1, dealershipId: 1, dealershipName: 1 } }).toArray()

  const totalMinutes = entries.reduce((a, e) => a + (e.minutes || 0), 0)
  const hours = (m: number) => Math.round((m / 60) * 10) / 10
  const pct = (m: number) => totalMinutes ? Math.round((m / totalMinutes) * 1000) / 10 : 0
  const byCategory = TIME_CATEGORIES.map((c) => {
    const m = entries.filter(e => e.category === c.key).reduce((a, e) => a + (e.minutes || 0), 0)
    return { key: c.key, label: c.label, minutes: m, hours: hours(m), pct: pct(m) }
  })
  const weeks = new Map<string, Record<string, number>>()
  for (const e of entries) {
    const w = weekOf(e.date)
    const row = weeks.get(w) || {}
    row[e.category] = (row[e.category] || 0) + (e.minutes || 0)
    weeks.set(w, row)
  }
  const byWeek = [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, cats]) => ({ week, minutes: Object.values(cats).reduce((a, b) => a + b, 0), categories: cats }))
  const groupBy = (key: (e: any) => string, label: (e: any) => string) => {
    const m = new Map<string, { key: string, label: string, minutes: number }>()
    for (const e of entries) { const k = key(e); if (!k) continue; const r = m.get(k) || { key: k, label: label(e), minutes: 0 }; r.minutes += e.minutes || 0; m.set(k, r) }
    return [...m.values()].map(r => ({ ...r, hours: hours(r.minutes), pct: pct(r.minutes) })).sort((a, b) => b.minutes - a.minutes)
  }

  // What the time produced, same window & person.
  const occurred: any = {}
  if (q.from) occurred.$gte = `${q.from}T00:00:00.000Z`
  if (q.to) occurred.$lte = `${q.to}T23:59:59.999Z`
  const ixMatch: any = { voidedAt: null, type: { $in: ['meeting_scheduled', 'meeting_completed', 'proposal_sent'] } }
  if (q.from || q.to) ixMatch.occurredAt = occurred
  if (q.userId) ixMatch['user.id'] = q.userId
  const ix = await db.collection('turboCleanCrmInteractions').find(ixMatch, { projection: { type: 1 } }).toArray()
  const wonMatch: any = { revertedAt: null }
  if (q.from || q.to) wonMatch.wonAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) }
  if (q.userId) wonMatch.ownerId = q.userId
  const wins = await db.collection('turboCleanCrmWonDeals').find(wonMatch, { projection: { monthlyRevenue: 1, annualRevenue: 1, annualProfit: 1 } }).toArray()
  const sum = (k: string) => Math.round(wins.reduce((a, w) => a + (Number(w[k]) || 0), 0) * 100) / 100
  const h = totalMinutes / 60
  const per = (n: number) => n && h ? Math.round((h / n) * 10) / 10 : null
  const meetingsHeld = ix.filter(i => i.type === 'meeting_completed').length
  const annualRevenue = sum('annualRevenue')
  const profitWins = wins.filter(w => w.annualProfit != null)

  return {
    totalMinutes, totalHours: hours(totalMinutes), entries: entries.length,
    byCategory, byWeek, byUser: groupBy(e => e.userId, e => e.userName || 'Unknown'),
    byDealership: groupBy(e => e.dealershipId || '', e => e.dealershipName || '').slice(0, 15),
    unlinkedMinutes: entries.filter(e => !e.dealershipId).reduce((a, e) => a + (e.minutes || 0), 0),
    roi: {
      hours: hours(totalMinutes),
      meetingsScheduled: ix.filter(i => i.type === 'meeting_scheduled').length,
      meetingsHeld,
      proposals: ix.filter(i => i.type === 'proposal_sent').length,
      won: wins.length,
      monthlyRevenue: sum('monthlyRevenue'),
      annualRevenue,
      annualProfit: profitWins.length ? Math.round(profitWins.reduce((a, w) => a + (Number(w.annualProfit) || 0), 0) * 100) / 100 : null,
      hoursPerMeeting: per(meetingsHeld),
      hoursPerWin: per(wins.length),
      annualRevenuePerHour: h ? Math.round((annualRevenue / h) * 100) / 100 : null,
    },
  }
}
