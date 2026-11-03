/**
 * ZRZ Brain — the CRM's learning memory.
 *
 * The model itself is not re-trained; instead the app keeps a living playbook that every AI call reads
 * (see automation-ai.ts `brain:`). The playbook gets better every day from what actually happens:
 *
 *  1. Signals (append-only, turboCleanBrainSignals) — recorded automatically whenever a person
 *     approves a draft as-is, edits it (before → after), skips it (with the reason), confirms or
 *     corrects a reply classification, or refines a design in Template Studio.
 *  2. Lessons (turboCleanBrainLessons) — short rules the AI follows.
 *       taught  = written by a person on the Brain page (never changed by the AI)
 *       learned = distilled from signals + results by the daily reflection (automation 16)
 *  3. Results — reply / positive / meeting / won rates per template, version, subject line and
 *     writing style (crm-email experiments + automation stats) go into every reflection, so lessons
 *     are grounded in what produces dealerships, not just in what people prefer.
 *  4. Every reflection is saved as a playbook version (turboCleanBrainPlaybooks) — full history.
 *
 * Without an API key the reflection still runs with rules (rejection reasons, classifier accuracy,
 * winning templates), so the brain keeps learning either way.
 */
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import type { SessionActor } from './crm'
import { str } from './crm'

export type BrainArea = 'writing' | 'design' | 'replies' | 'research' | 'strategy'
export const BRAIN_AREAS: { key: BrainArea, label: string, does: string }[] = [
  { key: 'writing', label: 'Email writing', does: 'First emails, follow-ups and AI personalization' },
  { key: 'design', label: 'Email design', does: 'HTML templates made in Template Studio' },
  { key: 'replies', label: 'Reading replies', does: 'How replies are classified and what to do next' },
  { key: 'research', label: 'Research', does: 'Dealership summaries and talking points' },
  { key: 'strategy', label: 'Strategy', does: 'What to do more and less of' },
]
const AREA_KEYS = BRAIN_AREAS.map(a => a.key)

export const BRAIN_COLLECTIONS = {
  signals: 'turboCleanBrainSignals',
  lessons: 'turboCleanBrainLessons',
  playbooks: 'turboCleanBrainPlaybooks',
  state: 'turboCleanBrainState',
} as const

export type SignalKind =
  | 'draft.approved' | 'draft.edited' | 'draft.rejected'
  | 'reply.confirmed' | 'reply.corrected'
  | 'design.instruction' | 'design.saved'
  | 'lesson.taught' | 'lesson.removed'

const who = (a: SessionActor | null | undefined) => a ? { id: a.id, name: a.name } : null
const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+\n/g, '\n').trim().slice(0, n)

/** Record a learning signal. Never throws — learning must never break the action it watches. */
export async function recordSignal(db: Db, kind: SignalKind, area: BrainArea, data: Record<string, any>, opts: { actor?: SessionActor | null, dealershipId?: string | null, refId?: string | null } = {}) {
  try {
    await db.collection(BRAIN_COLLECTIONS.signals).insertOne({
      kind, area, data, at: new Date().toISOString(), actor: who(opts.actor), dealershipId: opts.dealershipId || null, refId: opts.refId || null, reflected: false,
    })
    invalidate()
  } catch (e: any) { console.warn('[Brain] signal not recorded:', e?.message) }
}

// ───────────────────────── Context for AI calls ─────────────────────────
const cache = new Map<BrainArea, { at: number, text: string }>()
function invalidate() { cache.clear() }

/** The playbook block added to AI prompts for one area. Cached for a minute. */
export async function brainContext(area: BrainArea): Promise<string> {
  const hit = cache.get(area)
  if (hit && Date.now() - hit.at < 60_000) return hit.text
  const { getCrmDb } = await import('./crm')
  const db = await getCrmDb()
  const text = await buildContext(db, area)
  cache.set(area, { at: Date.now(), text })
  return text
}

export async function buildContext(db: Db, area: BrainArea) {
  const lessons = await db.collection(BRAIN_COLLECTIONS.lessons)
    .find({ status: 'active', $or: [{ area: { $in: [area, 'strategy'] } }, { pinned: true }] })
    .sort({ pinned: -1, source: -1, confidence: -1, updatedAt: -1 }).limit(40).toArray()
  const taught = lessons.filter(l => l.source === 'taught' && (l.area === area || l.pinned))
  const learned = lessons.filter(l => l.source === 'learned' && l.area === area).slice(0, 15)
  const examples = await recentExamples(db, area)
  if (!taught.length && !learned.length && !examples.length) return ''
  const out: string[] = ['# Team playbook (ZRZ Brain)', 'This is what this team has taught you and what has been learned from real results. Follow it unless the task says otherwise.']
  if (taught.length) out.push('', '## Rules from the team (always follow)', ...taught.map(l => `- ${l.text}`))
  if (learned.length) out.push('', '## Learned from approvals, edits and results', ...learned.map(l => `- ${l.text}${l.evidence ? ` (evidence: ${l.evidence})` : ''}`))
  if (examples.length) out.push('', '## Recent corrections — learn from these', ...examples)
  return out.join('\n')
}

async function recentExamples(db: Db, area: BrainArea): Promise<string[]> {
  const sig = db.collection(BRAIN_COLLECTIONS.signals)
  if (area === 'writing') {
    const rows = await sig.find({ kind: { $in: ['draft.edited', 'draft.rejected'] } }).sort({ at: -1 }).limit(4).toArray()
    return rows.map((r) => r.kind === 'draft.edited'
      ? `- A person rewrote an AI/template draft before sending.\n  BEFORE: ${clip(r.data?.before, 500)}\n  AFTER: ${clip(r.data?.after, 500)}`
      : `- A draft was skipped: “${clip(r.data?.reason, 160)}” (subject: ${clip(r.data?.subject, 120)})`)
  }
  if (area === 'replies') {
    const rows = await sig.find({ kind: 'reply.corrected' }).sort({ at: -1 }).limit(5).toArray()
    return rows.map(r => `- Reply “${clip(r.data?.text, 260)}” was suggested as ${r.data?.suggested} but is ${r.data?.confirmed}.`)
  }
  if (area === 'design') {
    const rows = await sig.find({ kind: 'design.instruction' }).sort({ at: -1 }).limit(6).toArray()
    return rows.map(r => `- Design feedback: “${clip(r.data?.instruction, 240)}”`)
  }
  return []
}

// ───────────────────────── Lessons ─────────────────────────
export function serializeLesson(l: any) {
  if (!l) return null
  const { _id, ...rest } = l
  return { id: _id.toString(), ...rest }
}

export async function listLessons(db: Db) {
  const rows = await db.collection(BRAIN_COLLECTIONS.lessons).find({ status: { $ne: 'deleted' } }).sort({ pinned: -1, source: -1, area: 1, confidence: -1, updatedAt: -1 }).limit(500).toArray()
  return rows.map(serializeLesson)
}

/** A person teaches the brain a rule. */
export async function teachLesson(db: Db, body: any, actor: SessionActor | null) {
  const text = str(body?.text, 400)
  if (!text) throw createError({ statusCode: 400, statusMessage: 'Write the lesson first' })
  const area: BrainArea = AREA_KEYS.includes(body?.area) ? body.area : 'writing'
  const now = new Date().toISOString()
  const doc = { area, text, source: 'taught', status: 'active', pinned: !!body?.pinned, confidence: 1, evidence: '', createdAt: now, updatedAt: now, createdBy: who(actor), hits: 0 }
  const r = await db.collection(BRAIN_COLLECTIONS.lessons).insertOne(doc)
  await recordSignal(db, 'lesson.taught', area, { text }, { actor })
  return serializeLesson({ _id: r.insertedId, ...doc })
}

export async function updateLesson(db: Db, id: string, body: any, actor: SessionActor | null) {
  if (!ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid lesson' })
  const col = db.collection(BRAIN_COLLECTIONS.lessons)
  const l = await col.findOne({ _id: new ObjectId(id) })
  if (!l) throw createError({ statusCode: 404, statusMessage: 'Lesson not found' })
  const $set: any = { updatedAt: new Date().toISOString(), updatedBy: who(actor) }
  if (typeof body?.text === 'string') { const t = str(body.text, 400); if (!t) throw createError({ statusCode: 400, statusMessage: 'Lesson cannot be empty' }); $set.text = t; if (l.source === 'learned') $set.source = 'taught' }
  if (typeof body?.pinned === 'boolean') $set.pinned = body.pinned
  if (['active', 'disabled', 'deleted'].includes(body?.status)) $set.status = body.status
  if (AREA_KEYS.includes(body?.area)) $set.area = body.area
  await col.updateOne({ _id: l._id }, { $set })
  if (body?.status === 'deleted' || body?.status === 'disabled') await recordSignal(db, 'lesson.removed', l.area, { text: l.text, source: l.source, status: body.status }, { actor })
  invalidate()
  return serializeLesson(await col.findOne({ _id: l._id }))
}

// ───────────────────────── Reflection (automation 16) ─────────────────────────
async function resultsDigest(db: Db) {
  const lines: string[] = []
  try {
    const { templateExperiments } = await import('./crm-email')
    for (const level of ['version', 'subject'] as const) {
      const r: any = await templateExperiments(db, { level, model: 'sequence' })
      for (const row of (r.rows || []).slice(0, 8)) {
        if (!row.units) continue
        const name = [row.templateName, row.versionLabel || (row.version ? `V${row.version}` : ''), row.subjectVariant || ''].filter(Boolean).join(' ')
        lines.push(`${level === 'version' ? 'Body' : 'Subject'} ${name}${row.subjectText ? ` “${row.subjectText}”` : ''}: ${row.units} sent, reply ${row.replyRate ?? 0}%, positive ${row.positiveRate ?? 0}%, meetings ${row.meetings || 0}, won ${row.won || 0}${row.enoughData ? '' : ' (small sample)'}`)
      }
    }
  } catch {}
  try {
    const { automationStats } = await import('./automation-insights')
    const s: any = await automationStats(db)
    for (const g of s.byStyle || []) lines.push(`Writing style “${g.key}”: ${g.n} sent, reply ${g.replyRate ?? 0}%, positive ${g.positiveRate ?? 0}%, meetings ${g.meetings}${g.enough ? '' : ' (small sample)'}`)
    if (s.drafts) lines.push(`Drafts: approval rate ${s.drafts.approvalRate ?? '—'}%, edited before sending ${s.drafts.editRate ?? '—'}%.`)
    for (const r of (s.skipReasons || []).slice(0, 6)) lines.push(`Skip reason “${r.reason}”: ${r.n}×`)
    for (const [by, a] of Object.entries<any>(s.replySuggestions || {})) if (a?.n) lines.push(`Reply suggestions by ${by}: ${a.pct}% confirmed unchanged (n=${a.n}).`)
  } catch {}
  return lines
}

function signalLine(s: any) {
  const d = s.data || {}
  switch (s.kind) {
    case 'draft.approved': return `[writing] Approved unchanged (${d.writtenBy || 'template'}): subject “${clip(d.subject, 120)}”`
    case 'draft.edited': return `[writing] Edited before sending.\n  BEFORE: ${clip(d.before, 600)}\n  AFTER: ${clip(d.after, 600)}`
    case 'draft.rejected': return `[writing] Skipped — reason: “${clip(d.reason, 200)}” — subject “${clip(d.subject, 120)}”`
    case 'reply.confirmed': return `[replies] Suggestion “${d.suggested}” confirmed correct for: “${clip(d.text, 200)}”`
    case 'reply.corrected': return `[replies] Suggested “${d.suggested}” but it was “${d.confirmed}”: “${clip(d.text, 300)}”`
    case 'design.instruction': return `[design] Asked Template Studio: “${clip(d.instruction, 300)}”`
    case 'design.saved': return `[design] Saved an AI-designed template “${clip(d.name, 100)}” (brief: ${clip(d.brief, 200)})`
    case 'lesson.taught': return `[${s.area}] Team taught: “${clip(d.text, 300)}”`
    case 'lesson.removed': return `[${s.area}] Team ${d.status} a ${d.source} lesson: “${clip(d.text, 200)}”`
    default: return `[${s.area}] ${s.kind}`
  }
}

/** Rules-only learning (no API key): turn repeated patterns into lessons. */
async function ruleLessons(db: Db, signals: any[]) {
  const out: { area: BrainArea, text: string, evidence: string, confidence: number, key: string }[] = []
  const reasons = new Map<string, number>()
  for (const s of signals) if (s.kind === 'draft.rejected') { const r = clip(s.data?.reason, 120).toLowerCase(); if (r && r !== 'skipped') reasons.set(r, (reasons.get(r) || 0) + 1) }
  for (const [r, n] of reasons) if (n >= 2) out.push({ area: 'writing', key: `skip:${r}`, text: `Avoid drafts that get skipped for: “${r}”.`, evidence: `skipped ${n}× for this reason`, confidence: Math.min(0.9, 0.4 + n * 0.1) })
  const pairs = new Map<string, number>()
  for (const s of signals) if (s.kind === 'reply.corrected') { const k = `${s.data?.suggested}→${s.data?.confirmed}`; pairs.set(k, (pairs.get(k) || 0) + 1) }
  for (const [k, n] of pairs) if (n >= 2) { const [a, b] = k.split('→'); out.push({ area: 'replies', key: `reply:${k}`, text: `Replies that look like “${a}” are often really “${b}” — read them carefully before choosing “${a}”.`, evidence: `corrected ${n}×`, confidence: Math.min(0.9, 0.4 + n * 0.1) }) }
  try {
    const { templateExperiments } = await import('./crm-email')
    const r: any = await templateExperiments(db, { level: 'version', model: 'sequence' })
    const best = (r.rows || []).filter((x: any) => x.enoughData).sort((a: any, b: any) => (b.positiveRate || 0) - (a.positiveRate || 0))[0]
    if (best) out.push({ area: 'writing', key: `best:${best.templateId}:${best.version}`, text: `The best-performing first email so far is “${best.templateName}” ${best.versionLabel || `V${best.version}`} — keep its structure and tone when writing new ones.`, evidence: `${best.units} sent, ${best.positiveRate}% positive replies`, confidence: 0.7 })
  } catch {}
  return out
}

export async function reflect(db: Db, opts: { trigger?: string, actor?: SessionActor | null } = {}) {
  const sigCol = db.collection(BRAIN_COLLECTIONS.signals)
  const lessonCol = db.collection(BRAIN_COLLECTIONS.lessons)
  const signals = await sigCol.find({ reflected: { $ne: true } }).sort({ at: -1 }).limit(250).toArray()
  const lessons = await lessonCol.find({ status: { $in: ['active', 'disabled'] } }).toArray()
  const results = await resultsDigest(db)
  const now = new Date().toISOString()
  const { aiConfigured, askClaudeJson } = await import('./automation-ai')
  let added = 0, updated = 0, retired = 0
  let summary = ''
  let model: string | null = null

  if (aiConfigured()) {
    const learned = lessons.filter(l => l.source === 'learned' && l.status === 'active')
    const taught = lessons.filter(l => l.source === 'taught' && l.status === 'active')
    const removed = lessons.filter(l => l.status === 'disabled')
    const res = await askClaudeJson<{ summary: string, lessons: { id?: string, area: string, text: string, evidence: string, confidence: number }[], retire: string[] }>({
      purpose: 'brain.reflect',
      maxTokens: 4000,
      timeoutMs: 180_000,
      system: `You maintain the sales playbook of ZRZ OPS, a vehicle reconditioning / photo merchandising company that emails car dealerships. Your job: turn what people did (approved, edited, skipped, corrected) and real results (replies, positive replies, meetings, contracts won) into a small set of clear, specific, actionable lessons that future AI drafts, reply triage, research and email designs will follow.
Rules:
- Ground every lesson in the evidence given; cite it briefly (e.g. "edited 4 drafts to remove pricing", "V2 42% reply vs V1 18%, n=60").
- Results beat preferences: a lesson backed by won contracts or positive replies outranks style edits. Say when a sample is small and use lower confidence.
- Never contradict a team rule. Do not repeat a team rule as a learned lesson.
- Prefer updating an existing learned lesson (give its id) over adding a near-duplicate. Retire learned lessons the new evidence contradicts.
- Lessons that the team disabled must not be re-added in any wording.
- Max 25 learned lessons in total, each one sentence, imperative ("Lead with…", "Never…", "When a reply says… classify it as…").
- Areas: ${AREA_KEYS.join(', ')}.`,
      prompt: `TEAM RULES (fixed):\n${taught.map(l => `- [${l.area}] ${l.text}`).join('\n') || '(none)'}\n\nLESSONS THE TEAM DISABLED (never re-add):\n${removed.map(l => `- ${l.text}`).join('\n') || '(none)'}\n\nCURRENT LEARNED LESSONS:\n${learned.map(l => `- id=${l._id} [${l.area}] (${l.confidence}) ${l.text}${l.evidence ? ` — ${l.evidence}` : ''}`).join('\n') || '(none yet)'}\n\nRESULTS SO FAR:\n${results.join('\n') || '(no sends yet)'}\n\nNEW SIGNALS SINCE LAST REFLECTION (newest first):\n${signals.map(signalLine).join('\n') || '(none)'}\n\nReturn {"summary": "2-3 sentences: what changed in the playbook and why", "lessons": [{"id": "existing id when updating, omit when new", "area": "...", "text": "...", "evidence": "...", "confidence": 0-1}], "retire": ["ids of learned lessons to retire"]}. Include every learned lesson that should remain active (updated or unchanged).`,
    })
    if (res) {
      model = res.model
      summary = str(res.data?.summary, 800)
      const keep = new Set<string>()
      for (const l of (Array.isArray(res.data?.lessons) ? res.data.lessons : []).slice(0, 25)) {
        const text = str(l?.text, 400)
        if (!text) continue
        const area: BrainArea = AREA_KEYS.includes(l?.area as any) ? l.area as BrainArea : 'writing'
        const fields = { area, text, evidence: str(l?.evidence, 300), confidence: Math.max(0, Math.min(1, Number(l?.confidence) || 0.5)), updatedAt: now, model }
        const existing = l?.id && ObjectId.isValid(l.id) ? learned.find(x => x._id.toString() === l.id) : null
        if (existing) { await lessonCol.updateOne({ _id: existing._id }, { $set: fields }); keep.add(existing._id.toString()); updated++ }
        else { const r = await lessonCol.insertOne({ ...fields, source: 'learned', status: 'active', pinned: false, createdAt: now, hits: 0 }); keep.add(r.insertedId.toString()); added++ }
      }
      const retireIds = new Set((Array.isArray(res.data?.retire) ? res.data.retire : []).map(String))
      for (const l of learned) {
        if (retireIds.has(l._id.toString()) || (!keep.has(l._id.toString()) && res.data?.lessons?.length)) {
          await lessonCol.updateOne({ _id: l._id }, { $set: { status: 'retired', retiredAt: now } }); retired++
        }
      }
    }
  }
  if (!model) {
    // Rules-based learning.
    const found = await ruleLessons(db, await sigCol.find({}).sort({ at: -1 }).limit(500).toArray())
    for (const l of found) {
      const ex = await lessonCol.findOne({ ruleKey: l.key })
      if (ex) { if (ex.status === 'active') { await lessonCol.updateOne({ _id: ex._id }, { $set: { text: l.text, evidence: l.evidence, confidence: l.confidence, updatedAt: now } }); updated++ } }
      else { await lessonCol.insertOne({ area: l.area, text: l.text, evidence: l.evidence, confidence: l.confidence, ruleKey: l.key, source: 'learned', status: 'active', pinned: false, createdAt: now, updatedAt: now, hits: 0, model: null }); added++ }
    }
    summary = found.length ? `Rules-based review: ${added} new and ${updated} refreshed lesson${added + updated === 1 ? '' : 's'} from skip reasons, reply corrections and template results.` : 'Nothing new to learn yet — approve, edit, skip and confirm a few more and the brain will pick up the patterns.'
  }

  if (signals.length) await sigCol.updateMany({ _id: { $in: signals.map(s => s._id) } }, { $set: { reflected: true, reflectedAt: now } })
  const active = await lessonCol.find({ status: 'active' }).toArray()
  const stateCol = db.collection<any>(BRAIN_COLLECTIONS.state)
  const prev = await stateCol.findOne({ _id: 'global' })
  const version = (prev?.playbookVersion || 0) + 1
  await db.collection(BRAIN_COLLECTIONS.playbooks).insertOne({
    version, at: now, model, trigger: opts.trigger || 'schedule', by: who(opts.actor), summary, signals: signals.length, added, updated, retired,
    lessons: active.map(l => ({ id: l._id.toString(), area: l.area, source: l.source, text: l.text, evidence: l.evidence || '', confidence: l.confidence ?? null })),
  })
  await stateCol.updateOne({ _id: 'global' }, { $set: { playbookVersion: version, lastReflectAt: now, lastSummary: summary, lastModel: model } }, { upsert: true })
  invalidate()
  return { version, summary, signals: signals.length, added, updated, retired, model }
}

/** Automation 16 (daily). */
export async function reflectJob(db: Db, ctx: { trigger: string, actor: SessionActor | null }) {
  const r = await reflect(db, { trigger: ctx.trigger, actor: ctx.actor })
  return { summary: `Playbook v${r.version}: ${r.signals} new signal${r.signals === 1 ? '' : 's'} studied — ${r.added} new, ${r.updated} updated, ${r.retired} retired lesson${r.retired === 1 ? '' : 's'}${r.model ? '' : ' (rules only — no API key)'}`, stats: r }
}

// ───────────────────────── Brain page ─────────────────────────
export async function brainOverview(db: Db) {
  const [lessons, state, signals, playbooks, calls30, signalCounts] = await Promise.all([
    listLessons(db),
    db.collection<any>(BRAIN_COLLECTIONS.state).findOne({ _id: 'global' }),
    db.collection(BRAIN_COLLECTIONS.signals).find({}).sort({ at: -1 }).limit(40).toArray(),
    db.collection(BRAIN_COLLECTIONS.playbooks).find({}, { projection: { lessons: 0 } }).sort({ version: -1 }).limit(12).toArray(),
    db.collection('turboCleanAiCalls').aggregate([
      { $match: { at: { $gte: new Date(Date.now() - 30 * 86_400_000).toISOString() } } },
      { $group: { _id: '$purpose', calls: { $sum: 1 }, failed: { $sum: { $cond: ['$ok', 0, 1] } }, input: { $sum: '$inputTokens' }, output: { $sum: '$outputTokens' }, cacheRead: { $sum: '$cacheReadTokens' }, ms: { $avg: '$ms' } } },
      { $sort: { calls: -1 } },
    ]).toArray(),
    db.collection(BRAIN_COLLECTIONS.signals).aggregate([{ $group: { _id: '$kind', n: { $sum: 1 }, pending: { $sum: { $cond: ['$reflected', 0, 1] } } } }]).toArray(),
  ])
  const { aiConfigured, aiLabel, aiModel, aiProvider } = await import('./automation-ai')
  return {
    ai: { configured: aiConfigured(), model: aiModel(), provider: aiProvider(), label: aiLabel() },
    state: state ? { playbookVersion: state.playbookVersion || 0, lastReflectAt: state.lastReflectAt || null, lastSummary: state.lastSummary || '', lastModel: state.lastModel || null } : { playbookVersion: 0, lastReflectAt: null, lastSummary: '', lastModel: null },
    areas: BRAIN_AREAS,
    lessons,
    signals: signals.map(s => ({ id: s._id.toString(), kind: s.kind, area: s.area, at: s.at, actor: s.actor, line: signalLine(s), reflected: !!s.reflected, dealershipId: s.dealershipId })),
    signalCounts: Object.fromEntries(signalCounts.map(c => [c._id, { n: c.n, pending: c.pending }])),
    playbooks: playbooks.map(p => ({ version: p.version, at: p.at, model: p.model, summary: p.summary, signals: p.signals, added: p.added, updated: p.updated, retired: p.retired, trigger: p.trigger })),
    usage: calls30.map(c => ({ purpose: c._id, calls: c.calls, failed: c.failed, inputTokens: c.input, outputTokens: c.output, cacheReadTokens: c.cacheRead, avgMs: Math.round(c.ms || 0) })),
  }
}

/** Preview exactly what an AI call in this area is told. */
export async function previewContext(area: BrainArea) {
  invalidate()
  return brainContext(area)
}
