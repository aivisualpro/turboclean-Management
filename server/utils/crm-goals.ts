/**
 * Activity goals — goal vs actual for the CRM's day-to-day prospecting work.
 *
 * - Goals are a weekly plan: a number per activity for each day of the week (Mon … Sun), because a
 *   sales week isn't flat (more calls early in the week, no walk-ins at the weekend…).
 * - One team goal, or a goal for each salesperson (a shared default plus optional per-person plans).
 *   With per-person goals the team goal is the sum of everyone's.
 * - Every save is a new *version* that starts on the Monday of the week it was saved, so the current
 *   week uses the new goals in full and last month is still judged against last month's goals.
 * - Actuals are the same interaction counts the dashboard's Activity tiles show (work logged by the
 *   person, by day in the user's own time zone).
 *
 * Stored in `turboCleanCrmGoals`, one document `{ _id: 'activity', versions: [...] }`.
 */
import type { Db } from 'mongodb'
import { OUTREACH_TYPES } from './crm-facts'

// ─── Catalog ───
export const GOAL_METRIC_KEYS = ['contacted', 'emails', 'calls', 'walkIns', 'followUps', 'conversations', 'meetingsHeld'] as const
export type GoalMetric = typeof GOAL_METRIC_KEYS[number]
const CONTACT_TYPES = OUTREACH_TYPES.filter(t => !t.startsWith('meeting') && t !== 'proposal_sent')
export const GOAL_METRICS: Record<GoalMetric, { label: string, types: string[], distinct?: boolean, weight: number }> = {
  contacted: { label: 'Contacted', types: CONTACT_TYPES, distinct: true, weight: 2 },
  emails: { label: 'Emails sent', types: ['email_sent'], weight: 1 },
  calls: { label: 'Calls', types: ['phone_call', 'connected_call', 'voicemail', 'text_message'], weight: 1 },
  walkIns: { label: 'Walk-ins', types: ['walk_in'], weight: 2 },
  followUps: { label: 'Follow-ups', types: ['follow_up'], weight: 1 },
  conversations: { label: 'Conversations', types: ['conversation', 'connected_call'], weight: 3 },
  meetingsHeld: { label: 'Meetings held', types: ['meeting_completed'], weight: 5 },
}
const ALL_TYPES = [...new Set(GOAL_METRIC_KEYS.flatMap(k => GOAL_METRICS[k].types))]

export const GOAL_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type GoalDayKey = typeof GOAL_DAY_KEYS[number]
export type GoalDayTargets = Partial<Record<GoalMetric, number>>
export type GoalPlan = Record<GoalDayKey, GoalDayTargets>

export interface GoalConfig {
  /** team = one goal for everyone together; individual = each person in `people` has their own. */
  mode: 'team' | 'individual'
  people: string[]
  plan: GoalPlan
  /** Per-person plans (individual mode); a person without one uses `plan`. */
  overrides: Record<string, GoalPlan>
  /** How much each activity counts towards the goal score (1–5). */
  weights: Partial<Record<GoalMetric, number>>
  /** Working hours, used to work out how much of today's goal should be done by now. */
  workdayStart: number
  workdayEnd: number
}
export interface GoalVersion { effectiveFrom: string, config: GoalConfig, savedAt: string, savedBy: { id: string, name: string } | null }
export interface GoalDoc { versions: GoalVersion[], seeded?: boolean }

export const GOAL_COLLECTION = 'turboCleanCrmGoals'
const DOC_ID = 'activity'

/** The team's weekly activity sheet (week of Oct 26, 2026): emails / calls / walk-ins / meetings per day. */
export const GOAL_TEAM_SHEET_PLAN: GoalPlan = {
  mon: { emails: 15, calls: 15, walkIns: 5, meetingsHeld: 1 },
  tue: { emails: 15, calls: 15, walkIns: 5, meetingsHeld: 1 },
  wed: { emails: 15, calls: 10, walkIns: 5, meetingsHeld: 1 },
  thu: { emails: 15, calls: 10, walkIns: 5, meetingsHeld: 1 },
  fri: { emails: 10, calls: 10, walkIns: 5 },
  sat: { emails: 15 },
  sun: { emails: 15 },
}
export function defaultGoalConfig(): GoalConfig {
  return { mode: 'team', people: [], plan: structuredClone(GOAL_TEAM_SHEET_PLAN), overrides: {}, weights: {}, workdayStart: 8, workdayEnd: 18 }
}

// ─── Sanitizing ───
const num = (v: unknown, max = 10_000) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0 }
function cleanPlan(raw: any): GoalPlan {
  const out = {} as GoalPlan
  for (const d of GOAL_DAY_KEYS) {
    const day: GoalDayTargets = {}
    for (const m of GOAL_METRIC_KEYS) { const n = num(raw?.[d]?.[m]); if (n) day[m] = n }
    out[d] = day
  }
  return out
}
const ID_RE = /^[\w-]{1,64}$/
export function sanitizeGoalConfig(raw: any): GoalConfig {
  if (!raw || typeof raw !== 'object') throw createError({ statusCode: 400, statusMessage: 'Those goals could not be read' })
  const people = Array.isArray(raw.people) ? [...new Set(raw.people.map(String).filter((s: string) => ID_RE.test(s)))].slice(0, 100) as string[] : []
  const overrides: Record<string, GoalPlan> = {}
  if (raw.overrides && typeof raw.overrides === 'object') for (const [id, p] of Object.entries(raw.overrides)) if (people.includes(id)) overrides[id] = cleanPlan(p)
  const weights: Partial<Record<GoalMetric, number>> = {}
  for (const m of GOAL_METRIC_KEYS) { const w = num(raw.weights?.[m], 5); if (w && w !== GOAL_METRICS[m].weight) weights[m] = w }
  let start = Math.min(23, Math.max(0, Math.round(Number(raw.workdayStart ?? 8)) || 0))
  let end = Math.min(24, Math.max(1, Math.round(Number(raw.workdayEnd ?? 18)) || 18))
  if (end <= start) { start = 8; end = 18 }
  return { mode: raw.mode === 'individual' ? 'individual' : 'team', people, plan: cleanPlan(raw.plan), overrides, weights, workdayStart: start, workdayEnd: end }
}

// ─── Plan maths (pure) ───
export const goalWeight = (c: GoalConfig, m: GoalMetric) => c.weights[m] ?? GOAL_METRICS[m].weight
/** Mon=mon … for a calendar day 'YYYY-MM-DD'. */
export function goalDayKey(day: string): GoalDayKey { return GOAL_DAY_KEYS[(new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7]! }
export function goalAddDays(day: string, n: number) { const d = new Date(`${day}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export function goalDaysBetween(from: string, to: string, max = 1000) {
  const out: string[] = []
  for (let d = from, i = 0; d <= to && i < max; d = goalAddDays(d, 1), i++) out.push(d)
  return out
}
/** The goals in force on a day: the last version that started on or before it (or the first one, for older days). */
export function goalVersionOn(doc: GoalDoc, day: string): GoalConfig {
  let pick = doc.versions[0]!
  for (const v of doc.versions) if (v.effectiveFrom <= day) pick = v
  return pick.config
}
/** Whose plan: the whole team (null) or one person. null result = that person has no goal of their own. */
export function goalPlanFor(c: GoalConfig, userId: string | null): GoalPlan | null {
  if (userId) return c.mode === 'individual' && c.people.includes(userId) ? (c.overrides[userId] || c.plan) : null
  if (c.mode === 'team' || !c.people.length) return c.plan
  const sum = Object.fromEntries(GOAL_DAY_KEYS.map(d => [d, {}])) as GoalPlan
  for (const id of c.people) {
    const p = c.overrides[id] || c.plan
    for (const d of GOAL_DAY_KEYS) for (const m of GOAL_METRIC_KEYS) { const n = p[d][m] || 0; if (n) sum[d][m] = (sum[d][m] || 0) + n }
  }
  return sum
}
export function goalForDay(doc: GoalDoc, userId: string | null, day: string): GoalDayTargets {
  return goalPlanFor(goalVersionOn(doc, day), userId)?.[goalDayKey(day)] || {}
}
/** Does anyone (or this person) have a goal at all, on the latest version? */
export function goalsExist(doc: GoalDoc, userId: string | null) {
  const p = goalPlanFor(doc.versions[doc.versions.length - 1]!.config, userId)
  return !!p && GOAL_DAY_KEYS.some(d => GOAL_METRIC_KEYS.some(m => (p[d][m] || 0) > 0))
}

export type GoalStatus = 'ahead' | 'on-track' | 'behind' | 'at-risk' | 'met' | 'missed' | 'upcoming' | 'no-goal'
/** ahead ≥ 100% of where you should be by now · on track ≥ 90% · behind ≥ 60% · at risk below. */
export function goalStatus(actual: number, goal: number, goalToDate: number, state: 'past' | 'live' | 'future'): GoalStatus {
  if (!goal) return 'no-goal'
  if (actual >= goal) return 'met'
  if (state === 'future') return 'upcoming'
  if (state === 'past') return 'missed'
  if (goalToDate <= 0) return 'on-track'
  const r = actual / goalToDate
  return r >= 1 ? 'ahead' : r >= 0.9 ? 'on-track' : r >= 0.6 ? 'behind' : 'at-risk'
}
const ratio = (a: number, g: number) => g > 0 ? Math.min(1, a / g) : 1
/** Weighted 0–100 of how close each activity is to where it should be (each capped at 100%). */
export function goalScore(rows: { metric: GoalMetric, actual: number, target: number, goal: number }[], c: GoalConfig): number | null {
  const counted = rows.filter(r => r.goal > 0)
  if (!counted.length) return null
  let w = 0, s = 0
  for (const r of counted) { const wt = goalWeight(c, r.metric); w += wt; s += wt * ratio(r.actual, r.target) }
  return Math.round((s / w) * 100)
}
export function goalOverallStatus(score: number | null, state: 'past' | 'live' | 'future'): GoalStatus {
  if (score == null) return 'no-goal'
  if (state === 'future') return 'upcoming'
  if (state === 'past') return score >= 100 ? 'met' : 'missed'
  return score >= 100 ? 'ahead' : score >= 90 ? 'on-track' : score >= 60 ? 'behind' : 'at-risk'
}

// ─── Storage ───
export async function loadGoalDoc(db: Db): Promise<GoalDoc> {
  const doc = await db.collection(GOAL_COLLECTION).findOne({ _id: DOC_ID as any })
  if (doc?.versions?.length) return { versions: (doc.versions as any[]).map(v => ({ ...v, config: sanitizeGoalConfig(v.config) })) }
  // Nothing saved yet: start from the team sheet (shown as "from your team sheet — review").
  return { versions: [{ effectiveFrom: '2000-01-01', config: defaultGoalConfig(), savedAt: '', savedBy: null }], seeded: true }
}
/** Monday of the week a day falls in. */
export const goalWeekStart = (day: string) => goalAddDays(day, -((new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7))
/**
 * Saves the goals as a new version starting this week's Monday (`today` = the user's calendar day), so the
 * current week is measured on the new goals in full. Saves within the same week replace each other.
 */
export async function saveGoalConfig(db: Db, raw: any, today: string, actor: { id: string, name: string } | null): Promise<GoalDoc> {
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw createError({ statusCode: 400, statusMessage: 'today (YYYY-MM-DD) is required' })
  const config = sanitizeGoalConfig(raw)
  const current = await loadGoalDoc(db)
  const from = goalWeekStart(today)
  // The very first save also covers the past, so earlier weeks are measured against something.
  const versions = current.seeded ? [] : current.versions.filter(v => v.effectiveFrom < from)
  versions.push({ effectiveFrom: versions.length ? from : '2000-01-01', config, savedAt: new Date().toISOString(), savedBy: { id: actor.id, name: actor.name } })
  const trimmed = versions.slice(-200)
  await db.collection(GOAL_COLLECTION).updateOne({ _id: DOC_ID as any }, { $set: { versions: trimmed, updatedAt: new Date().toISOString(), updatedBy: actor } }, { upsert: true })
  return { versions: trimmed }
}

// ─── Actuals by day ───
export interface GoalDailyActuals {
  /** day → metric → count (contacted = distinct dealerships that day) */
  team: Map<string, Record<GoalMetric, number>>
  byUser: Map<string, Map<string, Record<GoalMetric, number>>>
  /** distinct dealerships contacted over a span, per user and for everyone */
  contactedIn: (from: string, to: string, userId: string | null) => number
}
const zero = () => Object.fromEntries(GOAL_METRIC_KEYS.map(k => [k, 0])) as Record<GoalMetric, number>

export async function goalDailyActuals(db: Db, q: { fromTs: string, toTs: string, offsetMs: number, userId?: string | null }): Promise<GoalDailyActuals> {
  const match: any = { voidedAt: null, occurredAt: { $gte: q.fromTs, $lte: q.toTs }, type: { $in: ALL_TYPES } }
  if (q.userId) match['user.id'] = q.userId
  const [rows, live] = await Promise.all([
    db.collection('turboCleanCrmInteractions').find(match, { projection: { dealershipId: 1, type: 1, occurredAt: 1, 'user.id': 1 } }).toArray(),
    db.collection('turboCleanCrmDealerships').find({ archivedAt: null, mergedInto: null }, { projection: { _id: 1 } }).toArray(),
  ])
  const liveIds = new Set(live.map(d => String(d._id)))
  const localDay = (iso: string) => new Date(Date.parse(iso) + q.offsetMs).toISOString().slice(0, 10)
  const team = new Map<string, Record<GoalMetric, number>>()
  const byUser = new Map<string, Map<string, Record<GoalMetric, number>>>()
  const seen = new Set<string>() // `${user}|${day}|${dealership}` for distinct-per-day
  const contacts: { day: string, user: string, id: string }[] = []
  const bump = (map: Map<string, Record<GoalMetric, number>>, day: string, m: GoalMetric) => { let r = map.get(day); if (!r) map.set(day, r = zero()); r[m]++ }
  for (const r of rows) {
    const day = localDay(r.occurredAt), user = String(r.user?.id || ''), id = String(r.dealershipId)
    let um = byUser.get(user)
    if (!um) byUser.set(user, um = new Map())
    for (const m of GOAL_METRIC_KEYS) {
      if (!GOAL_METRICS[m].types.includes(r.type)) continue
      if (GOAL_METRICS[m].distinct) {
        if (!liveIds.has(id)) continue
        contacts.push({ day, user, id })
        if (!seen.has(`*|${day}|${id}`)) { seen.add(`*|${day}|${id}`); bump(team, day, m) }
        if (!seen.has(`${user}|${day}|${id}`)) { seen.add(`${user}|${day}|${id}`); bump(um, day, m) }
      } else { bump(team, day, m); bump(um, day, m) }
    }
  }
  const contactedIn = (from: string, to: string, userId: string | null) =>
    new Set(contacts.filter(c => c.day >= from && c.day <= to && (!userId || c.user === userId)).map(c => c.id)).size
  return { team, byUser, contactedIn }
}

// ─── The report shown on the dashboard ───
export interface GoalMetricRow {
  metric: GoalMetric, label: string, actual: number, goal: number, goalToDate: number, status: GoalStatus,
  pct: number | null, pacePct: number | null, needed: number, perDay: number | null, today: { goal: number, actual: number } | null
}
export async function goalReport(db: Db, q: {
  from: string, to: string, fromTs: string, toTs: string, offsetMs: number, userId?: string
  /** What the Activity tiles show for this period and scope — the "actual" compared with each goal. */
  activity: Partial<Record<GoalMetric, number>>
  now?: number
}) {
  const doc = await loadGoalDoc(db)
  const scope = q.userId || null
  const latest = doc.versions[doc.versions.length - 1]!.config
  const base = { seeded: !!doc.seeded, mode: latest.mode, people: latest.people, savedAt: doc.versions[doc.versions.length - 1]!.savedAt || null, savedBy: doc.versions[doc.versions.length - 1]!.savedBy }
  if (!goalsExist(doc, scope)) return { ...base, active: false as const, reason: scope && latest.mode === 'team' ? 'team' : scope ? 'not-included' : 'none' }

  // "Now" in the user's own time.
  const nowLocal = new Date((q.now ?? Date.now()) + q.offsetMs)
  const today = nowLocal.toISOString().slice(0, 10)
  const hour = nowLocal.getUTCHours() + nowLocal.getUTCMinutes() / 60
  const frac = Math.min(1, Math.max(0, (hour - latest.workdayStart) / Math.max(1, latest.workdayEnd - latest.workdayStart)))
  const state: 'past' | 'live' | 'future' = q.to < today ? 'past' : q.from > today ? 'future' : 'live'
  const days = goalDaysBetween(q.from, q.to)

  // Actuals by day: this period plus 90 days back (for the streak).
  const histFrom = [q.from, goalAddDays(today, -90)].sort()[0]!
  const histFromTs = new Date(Date.parse(`${histFrom}T00:00:00.000Z`) - q.offsetMs).toISOString()
  const toTs = [q.toTs, new Date(Date.parse(`${today}T23:59:59.999Z`) - q.offsetMs).toISOString()].sort().pop()!
  const daily = await goalDailyActuals(db, { fromTs: histFromTs, toTs, offsetMs: q.offsetMs, userId: scope })
  const dayActual = (userId: string | null, day: string) => (userId ? daily.byUser.get(userId)?.get(day) : daily.team.get(day)) || zero()

  const build = (userId: string | null, actualOf: (m: GoalMetric) => number) => {
    const rows: GoalMetricRow[] = GOAL_METRIC_KEYS.map((m) => {
      let goal = 0, goalToDate = 0, remainDays = 0
      for (const d of days) {
        const g = goalForDay(doc, userId, d)[m] || 0
        goal += g
        if (d < today) goalToDate += g
        else if (d === today) goalToDate += g * frac
        if (d >= today && g > 0) remainDays++
      }
      const actual = actualOf(m)
      const status = goalStatus(actual, goal, goalToDate, state)
      const needed = Math.max(0, goal - actual)
      const todayGoal = days.includes(today) ? (goalForDay(doc, userId, today)[m] || 0) : 0
      return {
        metric: m, label: GOAL_METRICS[m].label, actual, goal, goalToDate: Math.round(goalToDate * 10) / 10, status,
        pct: goal ? Math.round((actual / goal) * 100) : null,
        pacePct: goal && state === 'live' && goal > 0 ? Math.min(100, Math.round((goalToDate / goal) * 100)) : null,
        needed, perDay: state !== 'past' && needed && remainDays ? Math.ceil(needed / remainDays) : null,
        today: todayGoal ? { goal: todayGoal, actual: dayActual(userId, today)[m] } : null,
      }
    })
    const target = (r: GoalMetricRow) => state === 'past' ? r.goal : state === 'future' ? 0 : r.goalToDate
    const score = state === 'future' ? null : goalScore(rows.map(r => ({ metric: r.metric, actual: r.actual, target: target(r), goal: r.goal })), latest)
    return { rows, score, status: goalOverallStatus(score, state), onPace: rows.filter(r => ['ahead', 'on-track', 'met'].includes(r.status)).length, withGoal: rows.filter(r => r.goal > 0).length }
  }

  const mine = build(scope, m => Number(q.activity[m]) || 0)

  // Daily (or weekly) score for the period, up to today.
  const weekly = days.length > 62
  const buckets = new Map<string, { goal: Record<GoalMetric, number>, actual: Record<GoalMetric, number>, partial: boolean }>()
  for (const d of days) {
    if (d > today) continue
    const key = weekly ? goalAddDays(d, -((new Date(`${d}T00:00:00.000Z`).getUTCDay() + 6) % 7)) : d
    let b = buckets.get(key)
    if (!b) buckets.set(key, b = { goal: zero(), actual: zero(), partial: false })
    const g = goalForDay(doc, scope, d), a = dayActual(scope, d)
    for (const m of GOAL_METRIC_KEYS) { b.goal[m] += g[m] || 0; b.actual[m] += a[m] }
    if (d === today) b.partial = true
  }
  const trend = [...buckets.entries()].map(([key, b]) => ({
    key, partial: b.partial,
    score: goalScore(GOAL_METRIC_KEYS.map(m => ({ metric: m, actual: b.actual[m], target: b.goal[m], goal: b.goal[m] })), latest),
  }))

  // Streak: working days in a row with every goal hit (today counts once it's hit).
  let streak = 0
  for (let d = today, i = 0; i < 90; d = goalAddDays(d, -1), i++) {
    const g = goalForDay(doc, scope, d), a = dayActual(scope, d)
    const set = GOAL_METRIC_KEYS.filter(m => (g[m] || 0) > 0)
    if (!set.length) continue // rest day
    const met = set.every(m => a[m] >= g[m]!)
    if (d === today) { if (met) streak++; continue }
    if (!met) break
    streak++
  }

  // Leaderboard: each salesperson against their own goal.
  let leaderboard: any[] = []
  if (!scope && latest.mode === 'individual' && latest.people.length) {
    const names = new Map<string, string>()
    try {
      const { ObjectId } = await import('mongodb')
      const ids = latest.people.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id))
      const us = await db.collection('turboCleanAppUsers').find({ _id: { $in: ids } }, { projection: { name: 1, email: 1 } }).toArray()
      for (const u of us) names.set(String(u._id), u.name || u.email)
    } catch {}
    leaderboard = latest.people.map((id) => {
      const per = (m: GoalMetric) => m === 'contacted'
        ? daily.contactedIn(q.from, q.to, id)
        : days.reduce((n, d) => n + (daily.byUser.get(id)?.get(d)?.[m] || 0), 0)
      const r = build(id, per)
      return { userId: id, name: names.get(id) || 'Unknown user', score: r.score, status: r.status, onPace: r.onPace, withGoal: r.withGoal,
        metrics: Object.fromEntries(r.rows.filter(x => x.goal > 0).map(x => [x.metric, { actual: x.actual, goal: x.goal, status: x.status }])) }
    }).filter(p => p.withGoal > 0) // weeks from before someone had a goal of their own
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  }

  return {
    ...base, active: true as const, state, today, includesToday: days.includes(today), workday: { start: latest.workdayStart, end: latest.workdayEnd, doneShare: Math.round(frac * 100) },
    score: mine.score, status: mine.status, onPace: mine.onPace, withGoal: mine.withGoal,
    metrics: Object.fromEntries(mine.rows.map(r => [r.metric, r])) as Record<GoalMetric, GoalMetricRow>,
    trend, trendBucket: weekly ? 'week' : 'day', streak, leaderboard,
  }
}

/**
 * Suggested goals from what was actually done: per weekday, the average over the weeks (of the last
 * `weeks` full weeks) in which anything was logged, plus 10% stretch, rounded up. Days never worked stay 0.
 */
export async function suggestGoals(db: Db, q: { thisWeekStart: string, offsetMs: number, userId?: string | null, weeks?: number }) {
  const weeks = Math.min(26, Math.max(1, q.weeks ?? 8))
  const from = goalAddDays(q.thisWeekStart, -7 * weeks), to = goalAddDays(q.thisWeekStart, -1)
  const fromTs = new Date(Date.parse(`${from}T00:00:00.000Z`) - q.offsetMs).toISOString()
  const toTs = new Date(Date.parse(`${to}T23:59:59.999Z`) - q.offsetMs).toISOString()
  const daily = await goalDailyActuals(db, { fromTs, toTs, offsetMs: q.offsetMs, userId: q.userId || null })
  const src = q.userId ? daily.byUser.get(q.userId) || new Map() : daily.team
  const plan = Object.fromEntries(GOAL_DAY_KEYS.map(d => [d, {}])) as GoalPlan
  const sums = Object.fromEntries(GOAL_DAY_KEYS.map(d => [d, zero()])) as Record<GoalDayKey, Record<GoalMetric, number>>
  const activeWeeks = new Set<string>()
  for (const d of goalDaysBetween(from, to)) {
    const a = src.get(d)
    if (!a) continue
    for (const m of GOAL_METRIC_KEYS) sums[goalDayKey(d)][m] += a[m]
    if (GOAL_METRIC_KEYS.some(m => a[m] > 0)) activeWeeks.add(goalWeekStart(d))
  }
  const divisor = Math.max(1, activeWeeks.size)
  for (const d of GOAL_DAY_KEYS) for (const m of GOAL_METRIC_KEYS) { const avg = sums[d][m] / divisor; if (avg > 0) plan[d][m] = Math.max(1, Math.ceil(avg * 1.1)) }
  const activeDays = [...src.entries()].filter(([day, a]) => day >= from && day <= to && GOAL_METRIC_KEYS.some(m => a[m] > 0)).length
  return { plan, from, to, weeks, activeWeeks: activeWeeks.size, activeDays }
}
