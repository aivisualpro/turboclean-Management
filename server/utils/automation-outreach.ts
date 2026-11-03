/**
 * Automations 7–10: drafts → approval queue → sending → follow-ups.
 *
 * Draft lifecycle (turboCleanAutomationDrafts):
 *   pending ──approve──▶ approved (waiting for the sending window / daily limit) ──▶ sent
 *      │                    └──────────────────────────────────────────────────▶ failed (error kept, can retry)
 *      ├──skip──▶ rejected (reason kept — a skipped follow-up ends that sequence)
 *      └──auto──▶ cancelled (they replied, contact opted out / bounced, dealership moved on…)
 *
 * Sending goes through the normal CRM send (sendCrmEmail), so every automated email is tracked
 * exactly like a hand-written one: template/version/subject credit, Resend events, replies,
 * relationship history, stage move to Outreach Active, outcome attribution.
 * A draft that was sent unchanged keeps the template credit; an edited or AI-written body is
 * recorded as "Personalized" — so Analytics can answer "template vs personalized" on its own.
 */
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import { CRM_COLLECTIONS, OPEN_STAGE_ORDER, str } from './crm'
import type { SessionActor } from './crm'
import { emailDb, htmlToText, mergeContext, pickVariants, previewCrmEmail, renderMerge, sendCrmEmail } from './crm-email'
import { AUTOMATION_ACTOR, addDaysYmd, automationDb, getSettings, inSendWindow, logAutomation, nextWindowLabel, zonedNow } from './automation'
import type { AutomationSettings, JobResult } from './automation'
import { aiConfigured, askClaudeJson } from './automation-ai'
import { pickEmailContact } from './automation-research'

const DAY = 86_400_000
const FIRST_TOUCH_STAGES = ['Researched', 'Ready to Contact']
/** Stages where an unanswered sequence keeps getting follow-ups. */
const FOLLOW_UP_STAGES = ['Ready to Contact', 'Outreach Active']
const SIGNATURE = '\n\n{{senderName}}\n{{senderTitle|}}\n{{senderCompany}}\n{{senderPhone|}}'

const oid = (id: string) => {
  if (!ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  return new ObjectId(id)
}
const who = (a: SessionActor | null) => a ? { id: a.id, name: a.name, email: a.email } : { id: 'automation', name: 'Automation', email: '' }
const fullName = (c: any) => c ? `${c.firstName || ''} ${c.lastName || ''}`.trim() : ''
/** Preview "sender" — the dealership owner; the real sender is whoever approves (merged again at send time). */
const previewActor = (d: any): SessionActor => d.assignedUserId ? { id: String(d.assignedUserId), name: d.assignedUserName || 'Owner', email: '' } : { id: 'preview', name: 'Your name', email: '' }

export function serializeDraft(d: any) {
  if (!d) return null
  const { _id, ...rest } = d
  return { id: _id.toString(), ...rest }
}

/** Auto-cancel pending/approved drafts (they replied, opted out, moved on…). */
export async function cancelDrafts(db: Db, filter: { dealershipId?: string, followUpOf?: string, contactId?: string }, reason: string) {
  const { drafts } = await automationDb(db)
  const q: any = { status: { $in: ['pending', 'approved'] } }
  if (filter.dealershipId) q.dealershipId = filter.dealershipId
  if (filter.followUpOf) q.followUpOf = filter.followUpOf
  if (filter.contactId) q.contactId = filter.contactId
  const res = await drafts.updateMany(q, { $set: { status: 'cancelled', cancelledReason: reason, cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString() } })
  return res.modifiedCount
}

// ───────────────────────── Content ─────────────────────────
async function firstTouchTemplate(db: Db, s: AutomationSettings) {
  const { templates } = await emailDb(db)
  if (s.firstTouchTemplateId && ObjectId.isValid(s.firstTouchTemplateId)) {
    const t = await templates.findOne({ _id: new ObjectId(s.firstTouchTemplateId), archivedAt: null })
    if (t) return t
  }
  return (await templates.find({ archivedAt: null, category: 'First touch' }).sort({ createdAt: 1 }).limit(1).next())
    || (await templates.find({ archivedAt: null }).sort({ createdAt: 1 }).limit(1).next())
}
async function followUpTemplate(db: Db) {
  const { templates } = await emailDb(db)
  return templates.find({ archivedAt: null, category: 'Follow-up' }).sort({ createdAt: 1 }).limit(1).next()
}

const DEFAULT_FOLLOW_UPS = [
  'Hi {{firstName|there}},\n\nQuick follow-up on my note about {{dealership}}. When we checked {{website}} on {{auditDate}}, {{totalMissingPhotos}} vehicles were showing without photos. Happy to send you the list so your team can knock it out — want me to?',
  'Hi {{firstName|there}},\n\nI know things move fast on the lot. If photos and front-line readiness are handled in-house and working, no worries. If not, a 10-minute look at the vehicles still missing photos on {{website}} might be worth it. Would this week work?',
  'Hi {{firstName|there}},\n\nI’ll stop here so I don’t clutter your inbox. If getting cars online faster becomes a priority at {{dealership}}, just reply to this email and I’ll pick it up.',
]

interface DraftContent { subjectTemplate: string, body: string, format: 'html' | 'text', templateId: string | null, templateName: string, templateVersion: number | null, templateVersionLabel: string, subjectVariant: string | null, writtenBy: 'template' | 'ai', aiModel: string | null }

async function aiFirstTouch(d: any, contact: any, baseText: string, subject: string) {
  const s = d.researchSummary
  const res = await askClaudeJson<{ body: string }>({
    purpose: 'draft.first_touch',
    brain: 'writing',
    system: 'You write short, plain, human cold emails from a vehicle reconditioning / merchandising company to car dealership managers. No hype, no emojis, no exclamation marks. Never invent numbers, names, prices or facts — use only what you are given. Do not add a greeting name you were not given. Do not add a signature (it is added for you).',
    prompt: `Rewrite this email so it reads as written personally for this dealership. Keep every number exactly as given and keep the same call to action. Max 120 words.\n\nRecipient: ${contact.firstName || ''} ${contact.lastName || ''}, ${contact.jobTitle || contact.role || ''}\nDealership: ${d.name}${d.city ? `, ${d.city}` : ''}${d.state ? ` ${d.state}` : ''}\nResearch: ${s?.facts || ''}\n${s?.angle ? `Angle: ${s.angle}\n` : ''}Subject: ${subject}\n\nOriginal email:\n${baseText}\n\nReturn {"body": "..."}.`,
    maxTokens: 700,
  })
  const body = str(res?.data?.body, 5000)
  return body ? { body, model: res!.model } : null
}

async function aiFollowUp(d: any, contact: any, previous: any, n: number) {
  const res = await askClaudeJson<{ body: string }>({
    purpose: 'draft.follow_up',
    brain: 'writing',
    system: 'You write very short, polite follow-up emails (2–4 sentences) from a vehicle reconditioning / merchandising company to a car dealership manager who has not replied. No guilt-tripping, no emojis. Never invent facts. No signature (it is added for you).',
    prompt: `This is follow-up #${n} to ${contact.firstName || 'the manager'} (${contact.jobTitle || contact.role || ''}) at ${d.name}. ${n >= 3 ? 'This is the last one — close the loop politely.' : 'Add one new, useful reason to reply.'}\nResearch: ${d.researchSummary?.facts || ''}\n\nPrevious email (subject “${previous.subject}”):\n${String(previous.bodyText || '').slice(0, 1500)}\n\nReturn {"body": "..."}.`,
    maxTokens: 400,
  })
  const body = str(res?.data?.body, 3000)
  return body ? { body, model: res!.model } : null
}

async function buildFirstTouch(db: Db, d: any, contact: any, s: AutomationSettings, useAiThisOne: boolean): Promise<DraftContent | null> {
  const t = await firstTouchTemplate(db, s)
  if (!t) return null
  const picked = await pickVariants(db, t._id.toString())
  const v = picked.version, sl = picked.subject
  if (!v || !sl) return null
  const base: DraftContent = {
    subjectTemplate: sl.text, body: v.format === 'html' ? '' : (v.body || ''), format: v.format === 'html' ? 'html' : 'text',
    templateId: t._id.toString(), templateName: t.name, templateVersion: v.version, templateVersionLabel: v.label || `V${v.version}`, subjectVariant: sl.key, writtenBy: 'template', aiModel: null,
  }
  if (!useAiThisOne) return base
  // AI personalizes the template's message (its text version) — sent as a personal text email.
  const { vars } = await mergeContext(db, d, contact, previewActor(d), { subject: sl.text })
  const baseText = renderMerge(v.format === 'html' ? (v.body || htmlToText(v.html || '')) : (v.body || ''), vars).text.replace(/__AUDIT_SCREENSHOT__/g, '').trim()
  const ai = await aiFirstTouch(d, contact, baseText, renderMerge(sl.text, vars).text)
  if (!ai) return base
  return { ...base, body: `${ai.body}${SIGNATURE}`, format: 'text', writtenBy: 'ai', aiModel: ai.model }
}

async function renderPreview(db: Db, d: any, contactId: string | null, c: { subjectTemplate: string, body: string, templateId: string | null, templateVersion: number | null }) {
  const p = await previewCrmEmail(db, d, { contactId, subject: c.subjectTemplate, body: c.body, templateId: c.templateId, templateVersion: c.templateVersion }, previewActor(d))
  return { subject: p.subject, previewHtml: p.html, missingFields: p.missing || [] }
}

// ───────────────────────── 7. Drafts for first emails ─────────────────────────
export async function draftEmailsJob(db: Db, ctx: { settings: AutomationSettings }): Promise<JobResult> {
  const s = ctx.settings
  const { drafts } = await automationDb(db)
  const { emails } = await emailDb(db)
  const ds = await db.collection(CRM_COLLECTIONS.dealerships).find({ archivedAt: null, mergedInto: null, dealerId: null, stage: { $in: FIRST_TOUCH_STAGES } }).sort({ 'automation.priority.score': -1, createdAt: 1 }).limit(500).toArray()
  if (!ds.length) return { summary: 'No dealerships are waiting for a first email', stats: { created: 0 } }
  const ids = ds.map(d => d._id.toString())
  const [sentRows, draftRows, contacts, audited] = await Promise.all([
    emails.find({ dealershipId: { $in: ids }, direction: 'outbound', status: { $ne: 'failed' } }, { projection: { dealershipId: 1 } }).toArray(),
    drafts.find({ dealershipId: { $in: ids }, $or: [{ status: { $in: ['pending', 'approved', 'failed'] } }, { status: 'rejected', kind: 'first_touch', rejectedAt: { $gte: new Date(Date.now() - 30 * DAY).toISOString() } }] }, { projection: { dealershipId: 1 } }).toArray(),
    db.collection(CRM_COLLECTIONS.contacts).find({ dealershipId: { $in: ids }, isActive: { $ne: false } }).toArray(),
    db.collection('turboCleanCrmAudits').aggregate([{ $match: { dealershipId: { $in: ids } } }, { $group: { _id: '$dealershipId' } }]).toArray(),
  ])
  const emailed = new Set(sentRows.map(r => r.dealershipId))
  const queued = new Set(draftRows.map(r => r.dealershipId))
  const hasAudit = new Set(audited.map(r => String(r._id)))
  const contactsBy = new Map<string, any[]>()
  for (const c of contacts) contactsBy.set(c.dealershipId, [...(contactsBy.get(c.dealershipId) || []), c])

  const useAi = s.useAi && aiConfigured() && s.firstTouchStyle !== 'template'
  const skipped = { noAudit: 0, noContact: 0 }
  let created = 0, aiCount = 0
  const items: any[] = []
  for (const d of ds) {
    if (created >= s.maxDraftsPerRun) break
    const id = d._id.toString()
    if (emailed.has(id) || queued.has(id)) continue
    if (!hasAudit.has(id)) { skipped.noAudit++; continue }
    const contact = pickEmailContact(contactsBy.get(id) || [])
    if (!contact) { skipped.noContact++; continue }
    // 'split' alternates template / AI so the two can be compared fairly.
    const aiThisOne = useAi && (s.firstTouchStyle === 'ai' || (s.firstTouchStyle === 'split' && created % 2 === 1))
    const content = await buildFirstTouch(db, d, contact, s, aiThisOne)
    if (!content) return { summary: 'No email template available — create one in CRM → Email → Templates', stats: { created } }
    const preview = await renderPreview(db, d, contact._id.toString(), content)
    const now = new Date().toISOString()
    const p = d.automation?.priority
    const why = [
      ...(p?.score != null ? [`Priority ${p.score} (${p.tier})`] : []),
      ...(p?.reasons || []).slice(0, 3),
      d.researchSummary?.angle,
    ].filter(Boolean)
    await drafts.insertOne({
      kind: 'first_touch', status: 'pending',
      dealershipId: id, dealershipCode: d.dealershipId || '', dealershipName: d.name, stage: d.stage, ownerId: d.assignedUserId || '', ownerName: d.assignedUserName || '',
      contactId: contact._id.toString(), contactName: fullName(contact), contactRole: contact.jobTitle || contact.role || '', toEmail: contact.email,
      ...content, ...preview,
      followUpOf: null, followUpNumber: 0,
      why, priorityScore: p?.score ?? null,
      edited: false, createdAt: now, createdBy: who(null), updatedAt: now,
    })
    created++
    if (content.writtenBy === 'ai') aiCount++
    items.push({ dealershipId: id, name: d.name, to: contact.email })
  }
  const notes = [skipped.noAudit && `${skipped.noAudit} need an inventory audit`, skipped.noContact && `${skipped.noContact} need a contact with an email`].filter(Boolean).join(', ')
  return {
    summary: `${created} first-email draft${created === 1 ? '' : 's'} added to the approval queue${aiCount ? ` (${aiCount} AI-personalized)` : ''}${notes ? ` · ${notes}` : ''}`,
    stats: { created, ai: aiCount, ...skipped },
    items,
  }
}

// ───────────────────────── 10. Follow-ups ─────────────────────────
export async function followUpsJob(db: Db, ctx: { settings: AutomationSettings }): Promise<JobResult> {
  const s = ctx.settings
  if (!s.followUpGaps.length) return { summary: 'Automatic follow-ups are off (no follow-up days set)', stats: { created: 0 } }
  const { drafts } = await automationDb(db)
  const { emails } = await emailDb(db)
  const since = new Date(Date.now() - 120 * DAY).toISOString()
  const roots = await emails.find({ direction: 'outbound', followUpNumber: 0, status: { $nin: ['failed', 'bounced', 'complained'] }, sentAt: { $gte: since } }, { projection: { bodyHtml: 0, events: 0 } }).toArray()
  if (!roots.length) return { summary: 'No open email sequences', stats: { created: 0 } }
  const threadIds = roots.map(r => r.threadId || r._id.toString())
  const dealershipIds = [...new Set(roots.map(r => r.dealershipId))]
  const [threadRows, ds, contacts, draftRows] = await Promise.all([
    emails.find({ threadId: { $in: threadIds }, direction: 'outbound', status: { $ne: 'failed' } }, { projection: { bodyHtml: 0, events: 0 } }).toArray(),
    db.collection(CRM_COLLECTIONS.dealerships).find({ _id: { $in: dealershipIds.filter(ObjectId.isValid).map(i => new ObjectId(i)) } }).toArray(),
    db.collection(CRM_COLLECTIONS.contacts).find({ dealershipId: { $in: dealershipIds } }).toArray(),
    drafts.find({ followUpOf: { $in: threadIds }, status: { $in: ['pending', 'approved', 'rejected', 'failed'] } }, { projection: { followUpOf: 1, status: 1 } }).toArray(),
  ])
  const threadBy = new Map<string, any[]>()
  for (const e of threadRows) threadBy.set(e.threadId, [...(threadBy.get(e.threadId) || []), e])
  const dBy = new Map(ds.map(d => [d._id.toString(), d]))
  const cBy = new Map(contacts.map(c => [c._id.toString(), c]))
  const blocked = new Set(draftRows.map(r => r.followUpOf)) // pending already, or a person skipped/failed one → sequence ends
  const fuTemplate = await followUpTemplate(db)
  const useAi = s.useAi && aiConfigured()
  const today = zonedNow().day
  let created = 0, finished = 0, nextActions = 0
  const items: any[] = []

  for (const root of roots) {
    if (created >= s.maxDraftsPerRun) break
    const tid = root.threadId || root._id.toString()
    if (blocked.has(tid)) continue
    const d = dBy.get(root.dealershipId)
    if (!d || d.archivedAt || d.dealerId || !FOLLOW_UP_STAGES.includes(d.stage)) continue
    const thread = (threadBy.get(tid) || [root]).sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)))
    if (thread.some(e => e.repliedAt || e.replyCount > 0 || e.status === 'bounced' || e.status === 'complained')) continue
    const contact = root.contactId ? cBy.get(root.contactId) : null
    if (contact && (contact.doNotEmail || contact.emailBouncedAt || contact.isActive === false)) continue
    const last = thread[thread.length - 1]!
    const n = thread.length // next follow-up number
    if (n > s.followUpGaps.length) {
      // Sequence finished with no reply: make sure a person decides what happens next.
      if (!d.automation?.sequenceDone?.[tid]) {
        await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: d._id }, { $set: { [`automation.sequenceDone.${tid}`]: new Date().toISOString() } })
        await setNextAction(db, d, last.interactionId, `No reply after ${thread.length} emails — call ${fullName(contact) || 'them'} or move to Nurture`, 'call', today)
        await logAutomation(db, d._id.toString(), `Email sequence finished without a reply (${thread.length} emails) — next action set to call`)
        finished++
      }
      continue
    }
    const dueDay = addDaysYmd(String(last.sentAt).slice(0, 10), s.followUpGaps[n - 1]!)
    if (dueDay > today) continue

    // Content: the team's Follow-up template if there is one, else AI, else a built-in nudge.
    let content: DraftContent
    const subjectTemplate = /^re:/i.test(root.subject) ? root.subject : `Re: ${root.subject}`
    if (fuTemplate) {
      const picked = await pickVariants(db, fuTemplate._id.toString())
      content = { subjectTemplate, body: picked.version?.format === 'html' ? '' : (picked.version?.body || ''), format: picked.version?.format === 'html' ? 'html' : 'text',
        templateId: fuTemplate._id.toString(), templateName: fuTemplate.name, templateVersion: picked.version?.version ?? null, templateVersionLabel: picked.version ? (picked.version.label || `V${picked.version.version}`) : '', subjectVariant: null, writtenBy: 'template', aiModel: null }
    }
    else {
      const ai = useAi && contact ? await aiFollowUp(d, contact, last, n) : null
      content = { subjectTemplate, body: `${ai?.body || DEFAULT_FOLLOW_UPS[Math.min(n - 1, DEFAULT_FOLLOW_UPS.length - 1)]}${SIGNATURE}`, format: 'text',
        templateId: null, templateName: '', templateVersion: null, templateVersionLabel: '', subjectVariant: null, writtenBy: ai ? 'ai' : 'template', aiModel: ai?.model || null }
    }
    const preview = await renderPreview(db, d, root.contactId || null, content)
    const now = new Date().toISOString()
    await drafts.insertOne({
      kind: 'follow_up', status: 'pending',
      dealershipId: d._id.toString(), dealershipCode: d.dealershipId || '', dealershipName: d.name, stage: d.stage, ownerId: d.assignedUserId || '', ownerName: d.assignedUserName || '',
      contactId: root.contactId || null, contactName: root.contactName || fullName(contact), contactRole: contact?.jobTitle || contact?.role || '', toEmail: root.toEmail,
      ...content, ...preview,
      followUpOf: tid, followUpNumber: n, threadSubject: root.subject,
      why: [`No reply to “${root.subject}” after ${Math.floor((Date.now() - new Date(last.sentAt).getTime()) / DAY)} days`, `Follow-up ${n} of ${s.followUpGaps.length}`],
      priorityScore: d.automation?.priority?.score ?? null,
      edited: false, createdAt: now, createdBy: who(null), updatedAt: now,
    })
    created++
    items.push({ dealershipId: d._id.toString(), name: d.name, followUp: n })
  }
  // Every sent email should carry a dated "follow up if no reply" — fix any that don't (sent by hand, older sends…).
  nextActions = await ensureFollowUpDates(db, s, roots, threadBy, dBy)
  return {
    summary: `${created} follow-up draft${created === 1 ? '' : 's'} queued${finished ? ` · ${finished} sequence${finished === 1 ? '' : 's'} finished without a reply (call suggested)` : ''}${nextActions ? ` · ${nextActions} follow-up date${nextActions === 1 ? '' : 's'} set` : ''}`,
    stats: { created, finished, nextActionsSet: nextActions },
    items,
  }
}

/** Put a dated next action on an interaction (and close older open ones for that dealership). */
export async function setNextAction(db: Db, d: any, interactionId: string | null | undefined, text: string, type: string, date: string) {
  const ix = db.collection('turboCleanCrmInteractions')
  const now = new Date().toISOString()
  const dealershipId = d._id.toString()
  let targetId: ObjectId | null = interactionId && ObjectId.isValid(interactionId) ? new ObjectId(interactionId) : null
  if (!targetId) {
    const { createInteraction } = await import('./crm-interactions')
    const created = await createInteraction(db, d, { type: 'note', notes: `Automation: ${text}` }, AUTOMATION_ACTOR, 'automation')
    targetId = new ObjectId(created.id)
  }
  await ix.updateMany({ dealershipId, _id: { $ne: targetId }, nextAction: { $nin: ['', null] }, nextActionDone: false, voidedAt: null },
    { $set: { nextActionDone: true, nextActionDoneAt: now, nextActionDoneBy: who(null), nextActionDoneVia: targetId.toString(), updatedAt: now } })
  await ix.updateOne({ _id: targetId }, { $set: { nextAction: text, nextActionDate: date, nextActionType: type, nextActionTime: null, nextActionDone: false, nextActionDoneAt: null, nextActionSetBy: 'automation', updatedAt: now } })
}

async function ensureFollowUpDates(db: Db, s: AutomationSettings, roots: any[], threadBy: Map<string, any[]>, dBy: Map<string, any>) {
  const ix = db.collection('turboCleanCrmInteractions')
  let set = 0
  for (const root of roots) {
    const tid = root.threadId || root._id.toString()
    const d = dBy.get(root.dealershipId)
    if (!d || d.archivedAt || d.dealerId || !FOLLOW_UP_STAGES.includes(d.stage)) continue
    const thread = (threadBy.get(tid) || [root]).sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)))
    if (thread.some(e => e.repliedAt)) continue
    const last = thread[thread.length - 1]!
    if (thread.length > s.followUpGaps.length) continue
    const open = await ix.countDocuments({ dealershipId: root.dealershipId, voidedAt: null, nextActionDone: false, nextAction: { $nin: ['', null] }, nextActionDate: { $ne: null } })
    if (open) continue
    const date = addDaysYmd(String(last.sentAt).slice(0, 10), s.followUpGaps[thread.length - 1]!)
    await setNextAction(db, d, last.interactionId, `Follow up if no reply to “${root.subject}”`, 'follow_up', date)
    set++
  }
  return set
}

// ───────────────────────── 8. Approval queue ─────────────────────────
export async function listDrafts(db: Db, q: { status?: string, limit?: number, dealershipId?: string } = {}) {
  const { drafts } = await automationDb(db)
  const filter: any = {}
  const status = str(q.status, 20) || 'pending'
  if (status === 'open') filter.status = { $in: ['pending', 'approved', 'failed'] }
  else if (status !== 'all') filter.status = status
  if (q.dealershipId) filter.dealershipId = q.dealershipId
  const sort: any = status === 'pending' || status === 'open' ? { kind: -1, priorityScore: -1, createdAt: 1 } : { updatedAt: -1 }
  const rows = await drafts.find(filter).sort(sort).limit(Math.min(500, q.limit || 200)).toArray()
  const counts = await drafts.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray()
  return { drafts: rows.map(serializeDraft), counts: Object.fromEntries(counts.map(c => [c._id, c.n])) }
}

/** Edit a pending draft. Edited text is sent as written (and recorded as personalized). */
export async function updateDraft(db: Db, id: string, body: any, actor: SessionActor | null) {
  const { drafts } = await automationDb(db)
  const d = await drafts.findOne({ _id: oid(id) })
  if (!d) throw createError({ statusCode: 404, statusMessage: 'Draft not found' })
  if (!['pending', 'failed'].includes(d.status)) throw createError({ statusCode: 409, statusMessage: `This draft is already ${d.status}` })
  const dealership = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: oid(d.dealershipId) })
  if (!dealership) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  const $set: any = { updatedAt: new Date().toISOString() }
  if (typeof body?.subject === 'string') { const v = str(body.subject, 300); if (!v) throw createError({ statusCode: 400, statusMessage: 'Subject is required' }); $set.subjectTemplate = v; $set.subjectVariant = null }
  if (typeof body?.body === 'string') { const v = str(body.body, 20_000); if (!v) throw createError({ statusCode: 400, statusMessage: 'Message is required' }); $set.body = v; $set.format = 'text' }
  if (typeof body?.contactId === 'string' && body.contactId !== d.contactId) {
    const c = await db.collection(CRM_COLLECTIONS.contacts).findOne({ _id: oid(body.contactId), dealershipId: d.dealershipId })
    if (!c || !c.email) throw createError({ statusCode: 400, statusMessage: 'That contact has no email address' })
    if (c.doNotEmail) throw createError({ statusCode: 400, statusMessage: 'That contact asked not to be emailed' })
    Object.assign($set, { contactId: c._id.toString(), contactName: fullName(c), contactRole: c.jobTitle || c.role || '', toEmail: c.email })
  }
  const merged = { ...d, ...$set }
  Object.assign($set, await renderPreview(db, dealership, merged.contactId, merged), { edited: true, editedAt: $set.updatedAt, editedBy: who(actor) })
  // Brain: what the person changed is the most valuable writing lesson there is.
  if ((typeof body?.body === 'string' && body.body.trim() !== String(d.body || '').trim()) || (typeof body?.subject === 'string' && body.subject.trim() !== String(d.subjectTemplate || '').trim())) {
    const { recordSignal } = await import('./brain')
    const before = d.body ? String(d.body) : htmlToText(String(d.previewHtml || ''))
    await recordSignal(db, 'draft.edited', 'writing', {
      beforeSubject: d.subjectTemplate, afterSubject: merged.subjectTemplate, before: before.slice(0, 3000), after: String(merged.body || '').slice(0, 3000),
      kind: d.kind, writtenBy: d.writtenBy, templateName: d.templateName || '', templateVersionLabel: d.templateVersionLabel || '',
    }, { actor, dealershipId: d.dealershipId, refId: d._id.toString() })
  }
  if (d.status === 'failed') { $set.status = 'pending'; $set.error = null }
  await drafts.updateOne({ _id: d._id }, { $set })
  return serializeDraft(await drafts.findOne({ _id: d._id }))
}

export async function rejectDraft(db: Db, id: string, reason: string, actor: SessionActor | null) {
  const { drafts } = await automationDb(db)
  const d = await drafts.findOne({ _id: oid(id) })
  if (!d) throw createError({ statusCode: 404, statusMessage: 'Draft not found' })
  if (!['pending', 'approved', 'failed'].includes(d.status)) throw createError({ statusCode: 409, statusMessage: `This draft is already ${d.status}` })
  const now = new Date().toISOString()
  await drafts.updateOne({ _id: d._id }, { $set: { status: 'rejected', rejectedAt: now, rejectedBy: who(actor), rejectReason: str(reason, 300) || 'Skipped', updatedAt: now } })
  {
    const { recordSignal } = await import('./brain')
    await recordSignal(db, 'draft.rejected', 'writing', { reason: str(reason, 300) || 'Skipped', subject: d.subject || d.subjectTemplate, body: String(d.body || htmlToText(String(d.previewHtml || ''))).slice(0, 1500), kind: d.kind, writtenBy: d.writtenBy, templateName: d.templateName || '' }, { actor, dealershipId: d.dealershipId, refId: d._id.toString() })
  }
  await logAutomation(db, d.dealershipId, `${d.kind === 'follow_up' ? `Follow-up #${d.followUpNumber}` : 'First-email'} draft skipped by ${actor?.name || 'someone'}${reason ? ` — ${str(reason, 300)}` : ''}`)
  return serializeDraft(await drafts.findOne({ _id: d._id }))
}

/** Approve: send now when inside the sending window and under the daily limit, else queue for the next window. */
export async function approveDraft(db: Db, id: string, actor: SessionActor | null, opts: { sendNow?: boolean } = {}) {
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in to approve outreach' })
  const { drafts } = await automationDb(db)
  const d = await drafts.findOne({ _id: oid(id) })
  if (!d) throw createError({ statusCode: 404, statusMessage: 'Draft not found' })
  if (!['pending', 'failed', 'approved'].includes(d.status)) throw createError({ statusCode: 409, statusMessage: `This draft is already ${d.status}` })
  const s = await getSettings(db)
  const now = new Date().toISOString()
  await drafts.updateOne({ _id: d._id }, { $set: { status: 'approved', approvedAt: d.approvedAt || now, approvedBy: d.approvedBy || who(actor), error: null, updatedAt: now } })
  if (d.status === 'pending' && !d.edited) {
    const { recordSignal } = await import('./brain')
    await recordSignal(db, 'draft.approved', 'writing', { subject: d.subject || d.subjectTemplate, writtenBy: d.writtenBy, kind: d.kind, templateName: d.templateName || '', templateVersionLabel: d.templateVersionLabel || '' }, { actor, dealershipId: d.dealershipId, refId: d._id.toString() })
  }
  const sentToday = await sentTodayCount(db)
  const canSend = sentToday < s.dailySendLimit && (opts.sendNow || inSendWindow(s))
  if (!canSend) {
    const why = sentToday >= s.dailySendLimit ? `today’s limit of ${s.dailySendLimit} is reached — it goes out ${nextWindowLabel(s)}` : `it goes out ${nextWindowLabel(s)} (sending hours ${s.sendStart}–${s.sendEnd})`
    await drafts.updateOne({ _id: d._id }, { $set: { queuedNote: why } })
    return { draft: serializeDraft(await drafts.findOne({ _id: d._id })), sent: false, message: `Approved — ${why}` }
  }
  const sent = await sendDraft(db, id)
  return { draft: sent, sent: sent?.status === 'sent', message: sent?.status === 'sent' ? `Sent to ${d.toEmail}` : `Not sent: ${sent?.error}` }
}

async function sentTodayCount(db: Db) {
  const { drafts } = await automationDb(db)
  return drafts.countDocuments({ status: 'sent', sentDay: zonedNow().day })
}

/** Send one approved draft through the normal CRM send, then schedule its follow-up. */
export async function sendDraft(db: Db, id: string) {
  const { drafts } = await automationDb(db)
  // Claim it so two ticks never send the same draft.
  const d = await drafts.findOneAndUpdate({ _id: oid(id), status: 'approved' }, { $set: { status: 'sending', updatedAt: new Date().toISOString() } })
  if (!d) return serializeDraft(await drafts.findOne({ _id: oid(id) }))
  const fail = async (msg: string, status: 'failed' | 'cancelled' = 'failed') => {
    await drafts.updateOne({ _id: d._id }, { $set: { status, error: msg, ...(status === 'cancelled' ? { cancelledReason: msg, cancelledAt: new Date().toISOString() } : {}), updatedAt: new Date().toISOString() } })
    return serializeDraft(await drafts.findOne({ _id: d._id }))
  }
  const dealership = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: oid(d.dealershipId) })
  if (!dealership || dealership.archivedAt) return fail('Dealership was archived', 'cancelled')
  if (dealership.dealerId || !OPEN_STAGE_ORDER.includes(dealership.stage)) return fail(`Dealership is now “${dealership.stage}”`, 'cancelled')
  if (d.contactId) {
    const c = await db.collection(CRM_COLLECTIONS.contacts).findOne({ _id: oid(d.contactId) })
    if (c?.doNotEmail) return fail('Contact asked not to be emailed', 'cancelled')
    if (c?.emailBouncedAt) return fail('Contact’s email bounced', 'cancelled')
  }
  if (d.followUpOf) {
    const { emails } = await emailDb(db)
    const replied = await emails.findOne({ threadId: d.followUpOf, direction: 'outbound', repliedAt: { $ne: null } }, { projection: { _id: 1 } })
    if (replied) return fail('They replied — follow-up no longer needed', 'cancelled')
  }
  const sender = d.approvedBy?.id ? { id: d.approvedBy.id, name: d.approvedBy.name, email: d.approvedBy.email || '' } : AUTOMATION_ACTOR
  try {
    const email: any = await sendCrmEmail(db, dealership, {
      contactId: d.contactId, to: d.toEmail,
      subject: d.subjectTemplate, subjectVariant: d.subjectVariant || null,
      body: d.body, templateId: d.templateId, templateVersion: d.templateVersion,
      followUpOf: d.followUpOf || null,
    }, sender)
    const now = new Date().toISOString()
    await drafts.updateOne({ _id: d._id }, { $set: { status: 'sent', sentAt: now, sentDay: zonedNow().day, sentEmailId: email?.id || null, sentSubject: email?.subject || d.subject, error: null, updatedAt: now } })
    // 10. Schedule the follow-up straight away so nothing is forgotten.
    const s = await getSettings(db)
    const n = (d.followUpNumber || 0)
    const gap = s.followUpGaps[n]
    const fresh = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: dealership._id })
    if (fresh && email?.interactionId) {
      if (gap) await setNextAction(db, fresh, email.interactionId, `Follow up if no reply to “${email.subject}”`, 'follow_up', addDaysYmd(zonedNow().day, gap))
      else await setNextAction(db, fresh, email.interactionId, `Last email sent — call ${d.contactName || 'them'} if no reply`, 'call', addDaysYmd(zonedNow().day, 3))
    }
    await logAutomation(db, d.dealershipId, `${d.kind === 'follow_up' ? `Follow-up #${n}` : 'First email'} sent from the approval queue to ${d.toEmail}${d.writtenBy === 'ai' ? ' (AI-personalized)' : d.edited ? ' (edited)' : ''}${gap ? ` — follow-up planned in ${gap} days` : ''}`, undefined, d.contactId)
  }
  catch (e: any) {
    const msg = e?.statusMessage || e?.message || 'Send failed'
    // Duplicate guard / validation errors: keep it visible in the queue with the reason.
    return fail(msg)
  }
  return serializeDraft(await drafts.findOne({ _id: d._id }))
}

// ───────────────────────── 9. Sender (scheduled) ─────────────────────────
export async function sendApprovedJob(db: Db, ctx: { settings: AutomationSettings }): Promise<JobResult> {
  const s = ctx.settings
  const { drafts } = await automationDb(db)
  // Reset stuck "sending" claims (crash mid-send) after 15 minutes.
  await drafts.updateMany({ status: 'sending', updatedAt: { $lt: new Date(Date.now() - 15 * 60_000).toISOString() } }, { $set: { status: 'failed', error: 'Send was interrupted — check Sent before retrying' } })
  const waiting = await drafts.countDocuments({ status: 'approved' })
  if (!waiting) return { summary: 'Nothing approved is waiting to send', stats: { sent: 0, waiting: 0 } }
  if (!inSendWindow(s)) return { summary: `${waiting} approved email${waiting === 1 ? '' : 's'} waiting for sending hours (${s.sendStart}–${s.sendEnd}${s.weekdaysOnly ? ', weekdays' : ''})`, stats: { sent: 0, waiting } }
  const room = s.dailySendLimit - await sentTodayCount(db)
  if (room <= 0) return { summary: `Daily limit of ${s.dailySendLimit} reached — ${waiting} waiting for tomorrow`, stats: { sent: 0, waiting } }
  const batch = await drafts.find({ status: 'approved' }).sort({ approvedAt: 1 }).limit(Math.min(room, 20)).toArray()
  let sent = 0, failed = 0
  const items: any[] = []
  for (const d of batch) {
    const r = await sendDraft(db, d._id.toString())
    if (r?.status === 'sent') sent++
    else failed++
    items.push({ dealershipId: d.dealershipId, name: d.dealershipName, status: r?.status, error: r?.error || null })
  }
  return { summary: `${sent} approved email${sent === 1 ? '' : 's'} sent${failed ? `, ${failed} not sent (see the queue)` : ''}`, stats: { sent, failed, waiting: waiting - sent }, items }
}
