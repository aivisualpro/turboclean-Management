/**
 * Automation 11: read & classify replies.
 *
 * Every inbound reply gets a *suggestion* (Claude when enabled, keyword rules otherwise):
 *   category  interested · meeting_request · question · referral · out_of_office · not_interested · unsubscribe · other
 *   sentiment positive · neutral · negative   (what the CRM's existing reply tracking stores)
 * A person confirms it with one click (decision 2026-11-03: AI suggests, I confirm). Confirming
 * runs the normal sentiment update (updateEmailMessage) and then does the follow-on work: a dated
 * next action, stopping queued follow-ups, opting the contact out on "unsubscribe".
 * Suggested vs confirmed is stored, so the accuracy of the suggestions can be measured.
 */
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import { CRM_COLLECTIONS, str } from './crm'
import type { SessionActor } from './crm'
import { emailDb, stripQuoted, updateEmailMessage } from './crm-email'
import { addDaysYmd, logAutomation, zonedNow } from './automation'
import type { AutomationSettings, JobResult } from './automation'
import { aiConfigured, askClaudeJson } from './automation-ai'
import { cancelDrafts, setNextAction } from './automation-outreach'

export const REPLY_CATEGORIES = {
  interested: { label: 'Interested', sentiment: 'positive' },
  meeting_request: { label: 'Wants a meeting / call', sentiment: 'positive' },
  question: { label: 'Has a question', sentiment: 'neutral' },
  referral: { label: 'Referred to someone else', sentiment: 'neutral' },
  out_of_office: { label: 'Out of office / auto-reply', sentiment: 'neutral' },
  not_interested: { label: 'Not interested', sentiment: 'negative' },
  unsubscribe: { label: 'Unsubscribe / stop', sentiment: 'negative' },
  other: { label: 'Other', sentiment: 'neutral' },
} as const
export type ReplyCategory = keyof typeof REPLY_CATEGORIES
const CATS = Object.keys(REPLY_CATEGORIES) as ReplyCategory[]

/** Keyword fallback — decent for the obvious cases, and free. */
export function classifyByRules(text: string): { category: ReplyCategory, reason: string } {
  const t = ` ${String(text || '').toLowerCase().replace(/\s+/g, ' ')} `
  const rules: [ReplyCategory, RegExp, string][] = [
    ['out_of_office', /out of (the )?office|\booo\b|on (vacation|leave|pto)|away (from the office )?until|limited access to (my )?email|automatic reply|auto-?reply|i will be out/, 'out-of-office wording'],
    ['unsubscribe', /unsubscribe|remove me|take me off|stop (emailing|contacting|sending)|do not (email|contact)|don'?t (email|contact) me/, 'asked to stop'],
    ['not_interested', /not interested|no thank(s| you)|we('| a)re (all )?(set|good|covered)|already (have|use|work with)|not a (good )?fit|we handle (it|that|this) in.?house|not at this time|no need/, 'declined'],
    ['meeting_request', /(set up|schedule|book|hop on|jump on) (a )?(call|meeting|time|demo)|let'?s (talk|chat|meet|connect)|when are you (free|available)|what time works|calendar invite|give me a call|call me (at|on|tomorrow|today)|stop by|come by|swing by/, 'asked to meet or talk'],
    ['referral', /(reach out|talk|speak) to|you('| wi)ll want|not the right person|wrong person|(he|she|they) handles?|i('| a)m cc'?ing|copying (my|our)|forwarding (this|you) to/, 'pointed to someone else'],
    ['interested', /interested|sounds (good|great|interesting)|tell me more|send (me |over )?(the |that )?(list|info|details|more|pricing)|what (does it|would it) cost|how much|please send|happy to (look|chat|talk)|yes,? please|go ahead/, 'positive wording'],
  ]
  for (const [cat, re, why] of rules) if (re.test(t)) return { category: cat, reason: why }
  if (t.includes('?')) return { category: 'question', reason: 'contains a question' }
  return { category: 'other', reason: 'no clear signal' }
}

async function classifyWithAi(reply: any, parent: any) {
  const res = await askClaudeJson<{ category: string, summary: string, nextAction: string, returnDate: string | null, referralName: string | null, referralEmail: string | null, confidence: number }>({
    system: 'You triage replies to cold sales emails sent by a vehicle reconditioning / merchandising company to car dealerships. Classify precisely and summarize in one short sentence. Never invent names or emails that are not in the text.',
    prompt: `Our email (subject “${parent?.subject || reply.subject}”):\n${String(parent?.bodyText || '').slice(0, 1200)}\n\nTheir reply from ${reply.fromName || ''} <${reply.fromEmail}>:\n${String(reply.snippet || stripQuoted(reply.bodyText || '')).slice(0, 2500)}\n\nCategories: ${CATS.join(', ')}.\nReturn {"category": one category, "summary": "...", "nextAction": "what we should do next, imperative, max 12 words", "returnDate": "YYYY-MM-DD" if out of office and a return date is given else null, "referralName": name if they referred us else null, "referralEmail": email if given else null, "confidence": 0-1}.`,
    maxTokens: 400,
  })
  if (!res) return null
  const category = (CATS.includes(res.data?.category as any) ? res.data.category : 'other') as ReplyCategory
  return {
    category, summary: str(res.data?.summary, 300), nextAction: str(res.data?.nextAction, 160),
    returnDate: /^\d{4}-\d{2}-\d{2}$/.test(String(res.data?.returnDate || '')) ? String(res.data.returnDate) : null,
    referralName: str(res.data?.referralName, 120) || null, referralEmail: str(res.data?.referralEmail, 254) || null,
    confidence: Math.max(0, Math.min(1, Number(res.data?.confidence) || 0)), model: res.model,
  }
}

const DEFAULT_NEXT: Record<ReplyCategory, string> = {
  interested: 'Reply today and offer a 10-minute review',
  meeting_request: 'Book the meeting they asked for',
  question: 'Answer their question',
  referral: 'Reach out to the person they referred you to',
  out_of_office: 'Follow up after they are back',
  not_interested: 'Decide: Nurture (revisit later) or Lost',
  unsubscribe: 'Stop emailing — move to Lost or Nurture',
  other: 'Read the reply and decide the next step',
}

export async function classifyRepliesJob(db: Db, ctx: { settings: AutomationSettings }): Promise<JobResult> {
  const { emails } = await emailDb(db)
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString()
  const todo = await emails.find({ direction: 'inbound', sentiment: null, aiSuggestion: null, receivedAt: { $gte: since } }, { projection: { bodyHtml: 0 } }).sort({ receivedAt: 1 }).limit(25).toArray()
  const useAi = ctx.settings.useAi && aiConfigured()
  let ai = 0, rules = 0, stopped = 0
  const items: any[] = []
  for (const r of todo) {
    const parent = r.inReplyToEmailId && ObjectId.isValid(r.inReplyToEmailId) ? await emails.findOne({ _id: new ObjectId(r.inReplyToEmailId) }, { projection: { subject: 1, bodyText: 1 } }) : null
    const viaAi = useAi ? await classifyWithAi(r, parent) : null
    const rb = classifyByRules(`${r.subject || ''}\n${r.snippet || stripQuoted(r.bodyText || '')}`)
    const category = viaAi?.category || rb.category
    const suggestion = {
      category, label: REPLY_CATEGORIES[category].label, sentiment: REPLY_CATEGORIES[category].sentiment,
      summary: viaAi?.summary || '', reason: viaAi ? '' : rb.reason, nextAction: viaAi?.nextAction || DEFAULT_NEXT[category],
      returnDate: viaAi?.returnDate || null, referralName: viaAi?.referralName || null, referralEmail: viaAi?.referralEmail || null,
      confidence: viaAi?.confidence ?? null, by: viaAi ? 'ai' : 'rules', model: viaAi?.model || null, at: new Date().toISOString(),
    }
    await emails.updateOne({ _id: r._id }, { $set: { aiSuggestion: suggestion } })
    viaAi ? ai++ : rules++
    // Any reply stops the automatic sequence for that dealership right away (no waiting for confirmation).
    if (r.dealershipId) stopped += await cancelDrafts(db, { dealershipId: r.dealershipId }, 'They replied')
    items.push({ emailId: r._id.toString(), dealershipId: r.dealershipId, name: r.dealershipName, from: r.fromEmail, category })
  }
  return {
    summary: todo.length ? `${todo.length} repl${todo.length === 1 ? 'y' : 'ies'} read and classified (${ai} by AI, ${rules} by rules) — waiting for your confirmation${stopped ? ` · ${stopped} queued email${stopped === 1 ? '' : 's'} stopped` : ''}` : 'No new replies',
    stats: { classified: todo.length, ai, rules, draftsStopped: stopped },
    items,
  }
}

/** Replies waiting for a person: unclassified inbound mail, newest first. */
export async function repliesToConfirm(db: Db, q: { limit?: number } = {}) {
  const { emails } = await emailDb(db)
  const rows = await emails.find({ direction: 'inbound', sentiment: null }, { projection: { bodyHtml: 0 } }).sort({ receivedAt: -1 }).limit(Math.min(200, q.limit || 100)).toArray()
  return rows.map(({ _id, bodyText, ...r }) => ({ id: _id.toString(), ...r, bodyText: String(bodyText || '').slice(0, 4000) }))
}

/**
 * Confirm (or correct) a classification. Runs the CRM's normal sentiment update, then the follow-on work.
 * Body: { category, note? }
 */
export async function confirmReply(db: Db, id: string, body: any, actor: SessionActor | null) {
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const { emails } = await emailDb(db)
  if (!ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  const msg = await emails.findOne({ _id: new ObjectId(id), direction: 'inbound' })
  if (!msg) throw createError({ statusCode: 404, statusMessage: 'Reply not found' })
  const category = (CATS.includes(body?.category) ? body.category : msg.aiSuggestion?.category) as ReplyCategory | undefined
  if (!category) throw createError({ statusCode: 400, statusMessage: 'Pick what kind of reply this is' })
  const sentiment = REPLY_CATEGORIES[category].sentiment
  await updateEmailMessage(db, id, { sentiment }, actor)
  const now = new Date().toISOString()
  await emails.updateOne({ _id: msg._id }, { $set: { classification: {
    category, label: REPLY_CATEGORIES[category].label, sentiment, confirmedAt: now, confirmedBy: { id: actor.id, name: actor.name },
    suggested: msg.aiSuggestion?.category || null, suggestedBy: msg.aiSuggestion?.by || null, agreed: msg.aiSuggestion ? msg.aiSuggestion.category === category : null,
  } } })

  const effects: string[] = []
  if (msg.dealershipId && ObjectId.isValid(msg.dealershipId)) {
    const d = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: new ObjectId(msg.dealershipId) })
    const today = zonedNow().day
    if (d) {
      const n = await cancelDrafts(db, { dealershipId: msg.dealershipId }, `Reply confirmed: ${REPLY_CATEGORIES[category].label}`)
      if (n) effects.push(`${n} queued email${n === 1 ? '' : 's'} stopped`)
      if (category === 'unsubscribe' && msg.contactId && ObjectId.isValid(msg.contactId)) {
        await db.collection(CRM_COLLECTIONS.contacts).updateOne({ _id: new ObjectId(msg.contactId) }, { $set: { doNotEmail: true, doNotEmailAt: now, doNotEmailReason: 'Asked to stop (reply)', updatedAt: now } })
        effects.push('contact marked “do not email”')
      }
      if (!d.dealerId) {
        const text = str(body?.nextAction, 160) || msg.aiSuggestion?.nextAction || DEFAULT_NEXT[category]
        const date = category === 'out_of_office'
          ? (msg.aiSuggestion?.returnDate && msg.aiSuggestion.returnDate > today ? addDaysYmd(msg.aiSuggestion.returnDate, 1) : addDaysYmd(today, 7))
          : category === 'not_interested' || category === 'unsubscribe' ? addDaysYmd(today, 1) : today
        const type = category === 'meeting_request' ? 'meeting' : category === 'out_of_office' ? 'follow_up' : category === 'not_interested' || category === 'unsubscribe' ? 'other' : 'email'
        await setNextAction(db, d, msg.interactionId, text, type, date)
        effects.push(`next action: “${text}” (${date})`)
      }
      await logAutomation(db, msg.dealershipId, `Reply from ${msg.fromEmail} confirmed as “${REPLY_CATEGORIES[category].label}”${msg.aiSuggestion && msg.aiSuggestion.category !== category ? ` (suggested: ${REPLY_CATEGORIES[msg.aiSuggestion.category as ReplyCategory]?.label || msg.aiSuggestion.category})` : ''}${effects.length ? ` — ${effects.join('; ')}` : ''}`, undefined, msg.contactId)
    }
  }
  return { id, category, sentiment, effects }
}

/** How often the suggestions were right (confirmed unchanged). */
export async function suggestionAccuracy(db: Db) {
  const { emails } = await emailDb(db)
  const rows = await emails.aggregate([
    { $match: { direction: 'inbound', 'classification.agreed': { $in: [true, false] } } },
    { $group: { _id: '$classification.suggestedBy', n: { $sum: 1 }, agreed: { $sum: { $cond: ['$classification.agreed', 1, 0] } } } },
  ]).toArray()
  return Object.fromEntries(rows.map(r => [r._id || 'unknown', { n: r.n, agreed: r.agreed, pct: r.n ? Math.round((r.agreed / r.n) * 100) : null }]))
}
