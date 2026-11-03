/**
 * CRM Automations — engine.
 *
 * The 15 automations from the CRM brief ("16. Future automation / AI"). Design rule (brief §17):
 * simple to use every day, extremely good data in the background. So:
 *  - Everything that can run by itself runs on the in-app scheduler (server/plugins/automation-scheduler.ts).
 *  - Nothing goes to a dealership without a person approving it (drafts wait in the Approval queue).
 *  - AI only *suggests* (drafts, reply classification); a person confirms with one click.
 *  - Every action an automation takes is written back into the CRM (activity log, relationship
 *    history, next actions, stage moves, run log) with actor "Automation".
 *
 * Collections
 *  - turboCleanAutomationSettings   one doc `_id: 'global'`: settings + per-job state (enabled, last run, lock)
 *  - turboCleanAutomationRuns       append-only run log
 *  - turboCleanAutomationDrafts     the approval queue (see automation-outreach.ts)
 *  - turboCleanCrmResearchSummaries append-only research summaries (see automation-research.ts)
 *  - turboCleanAutomationInsights   weekly "what produces contracts" snapshots (see automation-insights.ts)
 */
import type { Db } from 'mongodb'
import type { SessionActor } from './crm'
import { CRM_TIMEZONE } from './crm-stage'
import { aiConfigured, aiLabel, aiModel } from './automation-ai'

export const AUTOMATION_COLLECTIONS = {
  settings: 'turboCleanAutomationSettings',
  runs: 'turboCleanAutomationRuns',
  drafts: 'turboCleanAutomationDrafts',
  summaries: 'turboCleanCrmResearchSummaries',
  insights: 'turboCleanAutomationInsights',
} as const

/** Who the CRM says did it, when an automation acted on its own. */
export const AUTOMATION_ACTOR: SessionActor = { id: 'automation', name: 'Automation', email: '' }

export type AutomationKind = 'scheduled' | 'event' | 'always' | 'planned'
export interface AutomationDef {
  key: string
  n: number
  title: string
  group: 'find' | 'outreach' | 'respond' | 'learn'
  kind: AutomationKind
  /** Scheduled jobs: minimum minutes between runs. */
  everyMinutes?: number
  /** What it does, in one sentence. */
  does: string
}

/** The 15 automations, in the brief's order. Mirrored client-side in app/constants/automations.ts. */
export const AUTOMATIONS: AutomationDef[] = [
  { key: 'find_dealerships', n: 1, title: 'Find dealerships', group: 'find', kind: 'planned', does: 'Searches an area for car dealerships and adds new ones to the CRM (skipping duplicates).' },
  { key: 'scrape_inventory', n: 2, title: 'Scrape websites & inventory', group: 'find', kind: 'planned', does: 'Reads each dealership website’s inventory pages and sends the vehicle list to the CRM.' },
  { key: 'count_inventory', n: 3, title: 'Count inventory', group: 'find', kind: 'event', does: 'Counts new and used vehicles from every incoming inventory snapshot and saves it as an audit.' },
  { key: 'missing_photos', n: 4, title: 'Missing-photo %', group: 'find', kind: 'scheduled', everyMinutes: 24 * 60, does: 'Calculates missing-photo % on every audit and flags dealerships whose audit is missing or older than 45 days.' },
  { key: 'find_contacts', n: 5, title: 'Find managers & contacts', group: 'find', kind: 'planned', does: 'Finds the GM / used-car manager on the dealership’s staff page and adds them as contacts.' },
  { key: 'research_summaries', n: 6, title: 'Research summaries', group: 'find', kind: 'scheduled', everyMinutes: 6 * 60, does: 'Writes a short research summary for each dealership and moves researched dealerships forward in the pipeline.' },
  { key: 'draft_emails', n: 7, title: 'Personalized email drafts', group: 'outreach', kind: 'scheduled', everyMinutes: 60, does: 'Drafts the first email for every dealership that is ready to contact, using its own audit numbers.' },
  { key: 'approval_queue', n: 8, title: 'Approval queue', group: 'outreach', kind: 'always', does: 'Every draft waits for you. Approve, edit or skip — nothing is sent without your OK.' },
  { key: 'send_approved', n: 9, title: 'Send approved outreach', group: 'outreach', kind: 'scheduled', everyMinutes: 5, does: 'Sends approved emails inside your sending hours, up to your daily limit.' },
  { key: 'schedule_followups', n: 10, title: 'Schedule follow-ups', group: 'outreach', kind: 'scheduled', everyMinutes: 60, does: 'Sets a follow-up date after every send and drafts the follow-up when there is no reply.' },
  { key: 'classify_replies', n: 11, title: 'Read & classify replies', group: 'respond', kind: 'scheduled', everyMinutes: 5, does: 'Reads every reply and suggests what it is (interested, not now, out of office…). You confirm with one click.' },
  { key: 'priority', n: 12, title: 'High-priority prospects', group: 'respond', kind: 'scheduled', everyMinutes: 6 * 60, does: 'Scores every open dealership 0–100 so the best opportunities are always on top.' },
  { key: 'next_action', n: 13, title: 'Suggest the next action', group: 'respond', kind: 'scheduled', everyMinutes: 6 * 60, does: 'Works out the single most useful next step for each dealership.' },
  { key: 'strategy', n: 14, title: 'What produces contracts', group: 'learn', kind: 'scheduled', everyMinutes: 7 * 24 * 60, does: 'Every week, compares templates, channels, markets and contacts to show what actually wins dealerships.' },
  { key: 'crm_feed', n: 15, title: 'Feed results back into the CRM', group: 'learn', kind: 'always', does: 'Every email, reply, stage move, next action and score an automation produces is written to the CRM automatically.' },
  { key: 'brain', n: 16, title: 'Learn & improve (Brain)', group: 'learn', kind: 'scheduled', everyMinutes: 24 * 60, does: 'Studies every approval, edit, skip, reply correction and result, and updates the playbook every AI suggestion follows.' },
]
export const automationDef = (key: string) => AUTOMATIONS.find(a => a.key === key)

export interface AutomationSettings {
  /** Max emails the queue sends per day (CRM time zone). */
  dailySendLimit: number
  /** Sending window in the CRM time zone. */
  sendStart: string
  sendEnd: string
  weekdaysOnly: boolean
  /** Days to wait before follow-up #1, #2, #3… (no reply). */
  followUpGaps: number[]
  /** First emails: send the template as designed, let AI personalize it, or alternate (an experiment). */
  firstTouchStyle: 'template' | 'ai' | 'split'
  /** Template for first emails ('' = best "First touch" template). */
  firstTouchTemplateId: string
  /** Max new drafts per run, so the queue never floods. */
  maxDraftsPerRun: number
  /** Move dealerships forward automatically (Research Needed → Researched → Ready to Contact). */
  autoAdvanceStages: boolean
  /** Use the AI (Gemini or Claude) when an API key is set. */
  useAi: boolean
  /** Audits older than this count as stale. */
  auditStaleDays: number
}

export const DEFAULT_SETTINGS: AutomationSettings = {
  dailySendLimit: 40,
  sendStart: '08:00',
  sendEnd: '17:00',
  weekdaysOnly: true,
  followUpGaps: [4, 7, 14],
  firstTouchStyle: 'template',
  firstTouchTemplateId: '',
  maxDraftsPerRun: 25,
  autoAdvanceStages: true,
  useAi: true,
  auditStaleDays: 45,
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export function cleanSettings(body: any, base: AutomationSettings = DEFAULT_SETTINGS): AutomationSettings {
  const out = { ...base }
  const num = (v: any, min: number, max: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null }
  if (body?.dailySendLimit !== undefined) out.dailySendLimit = num(body.dailySendLimit, 0, 500) ?? out.dailySendLimit
  if (TIME_RE.test(String(body?.sendStart || ''))) out.sendStart = body.sendStart
  if (TIME_RE.test(String(body?.sendEnd || ''))) out.sendEnd = body.sendEnd
  if (typeof body?.weekdaysOnly === 'boolean') out.weekdaysOnly = body.weekdaysOnly
  if (Array.isArray(body?.followUpGaps)) {
    const gaps = body.followUpGaps.map((g: any) => num(g, 1, 90)).filter((g: number | null): g is number => g !== null).slice(0, 5)
    out.followUpGaps = gaps
  }
  if (['template', 'ai', 'split'].includes(body?.firstTouchStyle)) out.firstTouchStyle = body.firstTouchStyle
  if (typeof body?.firstTouchTemplateId === 'string' && (/^[a-f0-9]{24}$/i.test(body.firstTouchTemplateId) || body.firstTouchTemplateId === '')) out.firstTouchTemplateId = body.firstTouchTemplateId
  if (body?.maxDraftsPerRun !== undefined) out.maxDraftsPerRun = num(body.maxDraftsPerRun, 1, 200) ?? out.maxDraftsPerRun
  if (typeof body?.autoAdvanceStages === 'boolean') out.autoAdvanceStages = body.autoAdvanceStages
  if (typeof body?.useAi === 'boolean') out.useAi = body.useAi
  if (body?.auditStaleDays !== undefined) out.auditStaleDays = num(body.auditStaleDays, 7, 365) ?? out.auditStaleDays
  return out
}

export interface JobState {
  enabled: boolean
  lastRunAt: string | null
  lastStatus: 'ok' | 'error' | null
  lastSummary: string
  runningUntil: string | null
}

let _indexed = false
export async function automationDb(db: Db) {
  const c = {
    settings: db.collection<any>(AUTOMATION_COLLECTIONS.settings),
    runs: db.collection(AUTOMATION_COLLECTIONS.runs),
    drafts: db.collection(AUTOMATION_COLLECTIONS.drafts),
    summaries: db.collection(AUTOMATION_COLLECTIONS.summaries),
    insights: db.collection(AUTOMATION_COLLECTIONS.insights),
  }
  if (!_indexed) {
    _indexed = true
    await Promise.all([
      c.runs.createIndex({ key: 1, startedAt: -1 }),
      c.runs.createIndex({ startedAt: -1 }),
      c.drafts.createIndex({ status: 1, createdAt: -1 }),
      c.drafts.createIndex({ dealershipId: 1, status: 1 }),
      c.drafts.createIndex({ followUpOf: 1, status: 1 }),
      c.drafts.createIndex({ sentDay: 1, status: 1 }),
      c.summaries.createIndex({ dealershipId: 1, generatedAt: -1 }),
      c.insights.createIndex({ generatedAt: -1 }),
    ]).catch(e => console.warn('[Automations] index creation skipped:', e?.message))
    // Make sure the settings doc exists with every job present.
    const jobs: Record<string, JobState> = {}
    for (const a of AUTOMATIONS) jobs[a.key] = { enabled: a.kind !== 'planned', lastRunAt: null, lastStatus: null, lastSummary: '', runningUntil: null }
    await c.settings.updateOne({ _id: 'global' }, { $setOnInsert: { settings: DEFAULT_SETTINGS, jobs, createdAt: new Date().toISOString() } }, { upsert: true })
      .catch(e => console.warn('[Automations] settings init skipped:', e?.message))
  }
  return c
}

export async function getAutomationState(db: Db) {
  const { settings } = await automationDb(db)
  const doc = await settings.findOne({ _id: 'global' })
  const s = cleanSettings(doc?.settings || {}, { ...DEFAULT_SETTINGS, ...(doc?.settings || {}) })
  const jobs: Record<string, JobState> = {}
  for (const a of AUTOMATIONS) {
    const j = doc?.jobs?.[a.key] || {}
    jobs[a.key] = { enabled: j.enabled ?? a.kind !== 'planned', lastRunAt: j.lastRunAt || null, lastStatus: j.lastStatus || null, lastSummary: j.lastSummary || '', runningUntil: j.runningUntil || null }
  }
  return { settings: s, jobs }
}
export async function getSettings(db: Db) { return (await getAutomationState(db)).settings }

export async function saveSettings(db: Db, body: any, actor: SessionActor | null) {
  const { settings } = await automationDb(db)
  const cur = await getSettings(db)
  const next = cleanSettings(body, cur)
  await settings.updateOne({ _id: 'global' }, { $set: { settings: next, updatedAt: new Date().toISOString(), updatedBy: actor ? { id: actor.id, name: actor.name } : null } })
  return next
}

export async function setJobEnabled(db: Db, key: string, enabled: boolean, actor: SessionActor | null) {
  const def = automationDef(key)
  if (!def) throw createError({ statusCode: 404, statusMessage: 'Unknown automation' })
  if (def.kind === 'always') throw createError({ statusCode: 400, statusMessage: `“${def.title}” is always on` })
  const { settings } = await automationDb(db)
  await settings.updateOne({ _id: 'global' }, { $set: { [`jobs.${key}.enabled`]: enabled, [`jobs.${key}.changedAt`]: new Date().toISOString(), [`jobs.${key}.changedBy`]: actor ? actor.name : 'System' } })
  return getAutomationState(db)
}

// ───────────────────────── Time helpers (CRM time zone) ─────────────────────────
export function zonedNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: CRM_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(d).map(x => [x.type, x.value]))
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: String(p.weekday) }
}
export const addDaysYmd = (ymd: string, n: number) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

/** Is `d` inside the sending window? */
export function inSendWindow(s: AutomationSettings, d = new Date()) {
  const z = zonedNow(d)
  if (s.weekdaysOnly && (z.weekday === 'Sat' || z.weekday === 'Sun')) return false
  return z.time >= s.sendStart && z.time < s.sendEnd
}
/** Human description of when the next sending window opens. */
export function nextWindowLabel(s: AutomationSettings) {
  const z = zonedNow()
  const weekend = s.weekdaysOnly && (z.weekday === 'Sat' || z.weekday === 'Sun')
  if (!weekend && z.time < s.sendStart) return `today at ${s.sendStart}`
  return `the next ${s.weekdaysOnly ? 'weekday' : 'day'} at ${s.sendStart}`
}

// ───────────────────────── Running jobs ─────────────────────────
export interface JobResult { summary: string, stats?: Record<string, any>, items?: any[] }
type JobFn = (db: Db, ctx: { settings: AutomationSettings, trigger: 'schedule' | 'manual' | 'event', actor: SessionActor | null }) => Promise<JobResult>

async function loadJob(key: string): Promise<JobFn | null> {
  switch (key) {
    case 'missing_photos': return (await import('./automation-research')).auditFreshnessJob
    case 'research_summaries': return (await import('./automation-research')).researchSummariesJob
    case 'draft_emails': return (await import('./automation-outreach')).draftEmailsJob
    case 'send_approved': return (await import('./automation-outreach')).sendApprovedJob
    case 'schedule_followups': return (await import('./automation-outreach')).followUpsJob
    case 'classify_replies': return (await import('./automation-replies')).classifyRepliesJob
    case 'priority': return (await import('./automation-scoring')).priorityJob
    case 'next_action': return (await import('./automation-scoring')).nextActionJob
    case 'strategy': return (await import('./automation-insights')).strategyJob
    case 'brain': return (await import('./brain')).reflectJob as any
    default: return null
  }
}

/**
 * Claim + run one job. Claim-based (a lock with expiry on the settings doc), so the 60-second
 * scheduler tick, a manual "Run now" and a second server can never run the same job twice at once.
 */
export async function runJob(db: Db, key: string, opts: { trigger: 'schedule' | 'manual' | 'event', actor?: SessionActor | null, force?: boolean } = { trigger: 'schedule' }) {
  const def = automationDef(key)
  if (!def) throw createError({ statusCode: 404, statusMessage: 'Unknown automation' })
  const fn = await loadJob(key)
  if (!fn) throw createError({ statusCode: 400, statusMessage: def.kind === 'planned' ? `“${def.title}” is planned for the next phase` : `“${def.title}” runs on its own — there is nothing to run` })
  const { settings: col, runs } = await automationDb(db)
  const now = new Date()
  const nowIso = now.toISOString()
  const filter: any = { _id: 'global', $and: [{ $or: [{ [`jobs.${key}.runningUntil`]: null }, { [`jobs.${key}.runningUntil`]: { $lt: nowIso } }] }] }
  if (!opts.force) {
    filter[`jobs.${key}.enabled`] = { $ne: false }
    const dueBefore = new Date(now.getTime() - (def.everyMinutes || 60) * 60_000).toISOString()
    filter.$and.push({ $or: [{ [`jobs.${key}.lastRunAt`]: null }, { [`jobs.${key}.lastRunAt`]: { $lt: dueBefore } }] })
  }
  const claimed = await col.findOneAndUpdate(filter, { $set: { [`jobs.${key}.runningUntil`]: new Date(now.getTime() + 10 * 60_000).toISOString() } })
  if (!claimed) {
    if (opts.force) throw createError({ statusCode: 409, statusMessage: `“${def.title}” is already running` })
    return null
  }
  const settings = await getSettings(db)
  const started = Date.now()
  let status: 'ok' | 'error' = 'ok'
  let result: JobResult = { summary: '' }
  let error = ''
  try { result = await fn(db, { settings, trigger: opts.trigger, actor: opts.actor || null }) }
  catch (e: any) { status = 'error'; error = e?.statusMessage || e?.message || String(e); result = { summary: `Failed: ${error}` } }
  const finishedAt = new Date().toISOString()
  await runs.insertOne({
    key, n: def.n, title: def.title, trigger: opts.trigger, by: opts.actor ? { id: opts.actor.id, name: opts.actor.name } : null,
    startedAt: nowIso, finishedAt, ms: Date.now() - started, status, summary: result.summary, stats: result.stats || null,
    items: (result.items || []).slice(0, 50), error: error || null,
  })
  await col.updateOne({ _id: 'global' }, { $set: {
    [`jobs.${key}.runningUntil`]: null, [`jobs.${key}.lastRunAt`]: finishedAt, [`jobs.${key}.lastStatus`]: status, [`jobs.${key}.lastSummary`]: result.summary,
  } })
  return { key, status, ...result, error: error || null, ms: Date.now() - started }
}

/** Record an event-driven run (e.g. an inventory snapshot arrived) in the same log. */
export async function logEventRun(db: Db, key: string, summary: string, stats: Record<string, any> = {}, items: any[] = []) {
  const def = automationDef(key)
  const { settings: col, runs } = await automationDb(db)
  const at = new Date().toISOString()
  await runs.insertOne({ key, n: def?.n, title: def?.title, trigger: 'event', by: null, startedAt: at, finishedAt: at, ms: 0, status: 'ok', summary, stats, items: items.slice(0, 50), error: null })
  await col.updateOne({ _id: 'global' }, { $set: { [`jobs.${key}.lastRunAt`]: at, [`jobs.${key}.lastStatus`]: 'ok', [`jobs.${key}.lastSummary`]: summary } })
}

/** Called by the scheduler every minute. Order matters a little: replies before follow-ups, scoring after research. */
const TICK_ORDER = ['classify_replies', 'send_approved', 'research_summaries', 'missing_photos', 'schedule_followups', 'draft_emails', 'priority', 'next_action', 'strategy', 'brain']
export async function runDueAutomations(db: Db) {
  const ran: any[] = []
  for (const key of TICK_ORDER) {
    try {
      const r = await runJob(db, key, { trigger: 'schedule' })
      if (r) ran.push(r)
    } catch (e: any) { console.error(`[Automations] ${key} failed:`, e?.message) }
  }
  return ran
}

export async function listRuns(db: Db, q: { key?: string, limit?: number } = {}) {
  const { runs } = await automationDb(db)
  const rows = await runs.find(q.key ? { key: q.key } : {}).sort({ startedAt: -1 }).limit(Math.min(200, q.limit || 50)).toArray()
  return rows.map(({ _id, ...r }) => ({ id: _id.toString(), ...r }))
}

/** Feed into the CRM: one activity-log line per automation action, always attributed to "Automation". */
export async function logAutomation(db: Db, dealershipId: string, message: string, changes?: Record<string, { from: any, to: any }>, contactId?: string | null) {
  const { logActivity } = await import('./crm')
  await logActivity(db, { dealershipId, contactId: contactId || null, type: 'automation.action', message, changes, actor: AUTOMATION_ACTOR })
}

export function envStatus() {
  return {
    ai: aiConfigured(),
    aiLabel: aiLabel(),
    aiModel: aiModel(),
    resend: !!process.env.RESEND_API_KEY,
    places: !!process.env.GOOGLE_PLACES_API_KEY,
    collectorToken: !!process.env.AUTOMATION_API_TOKEN,
    replyDomain: !!process.env.CRM_REPLY_DOMAIN,
    timeZone: CRM_TIMEZONE,
    schedulerDisabled: process.env.AUTOMATION_SCHEDULER_DISABLED === '1' || process.env.CRM_AUTOMATIONS_DISABLED === '1',
  }
}
