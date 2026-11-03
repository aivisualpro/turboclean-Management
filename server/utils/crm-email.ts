/**
 * CRM email tracking — acquisition emails sent from the CRM through Resend.
 *
 * Collections
 *  - turboCleanCrmEmails           one doc per message. `direction: 'outbound'` for what we send,
 *                                  `'inbound'` for replies. Outbound docs carry delivery/engagement
 *                                  status AND the funnel outcomes credited to them.
 *  - turboCleanCrmEmailTemplates   template library; every edit appends an immutable version.
 *  - turboCleanCrmEmailCampaigns   optional grouping of sends.
 *
 * Tracking sources
 *  - Sending: Resend API (`tags.crm_email_id` lets webhooks find the doc even before we store the Resend id).
 *  - Delivered / bounced / opened / clicked / complained: Resend webhooks (open/click tracking must be
 *    enabled on the sending domain in Resend; Apple Mail privacy etc. make opens unreliable — they are
 *    shown as "reported", never as a success metric).
 *  - Replies: Resend inbound (`email.received`). Matched by, in order: `reply+<emailId>@CRM_REPLY_DOMAIN`
 *    address, In-Reply-To/References headers, then the sender's address against CRM contacts.
 *
 * Success metrics (credited to the most recent *replied* outbound email of a dealership, ≤ 90 days old):
 *   replied → conversation → meeting → (opportunity) → proposal → won
 * Reaching a later stage implies the earlier ones (a meeting implies a conversation happened).
 */
import { createHash, createHmac as createHmacNode } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { auditBreakdown, auditEvidence, newInventoryNote, RAW_HTML_FIELDS, usedPhotoBar } from './crm-email-blocks'
import { reportUrl as auditReportUrl, trendVars } from './crm-reports'
import type { Db } from 'mongodb'
import { Resend } from 'resend'
import { CRM_COLLECTIONS, OPEN_STAGE_ORDER, logActivity, str } from './crm'
import { getFile } from './crm-files'
import type { SessionActor } from './crm'

export const EMAIL_COLLECTIONS = {
  emails: 'turboCleanCrmEmails',
  templates: 'turboCleanCrmEmailTemplates',
  campaigns: 'turboCleanCrmEmailCampaigns',
} as const

export const OUTCOMES = ['conversation', 'meeting', 'opportunity', 'proposal', 'won'] as const
export type Outcome = typeof OUTCOMES[number]
export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const
export const TEMPLATE_CATEGORIES = ['First touch', 'Follow-up', 'Meeting', 'Proposal', 'Re-engage', 'Other'] as const
const ATTRIBUTION_DAYS = 90
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const FROM_EMAIL = () => process.env.CRM_FROM_EMAIL || 'sales@zrzops.com'
const FROM_BRAND = () => process.env.CRM_FROM_BRAND || 'ZRZ Turbo Clean'
const REPLY_DOMAIN = () => process.env.CRM_REPLY_DOMAIN || ''

let _indexed = false
export async function emailDb(db: Db) {
  if (!_indexed) {
    _indexed = true
    const e = db.collection(EMAIL_COLLECTIONS.emails)
    await Promise.all([
      e.createIndex({ dealershipId: 1, sentAt: -1 }),
      e.createIndex({ resendId: 1 }, { sparse: true }),
      e.createIndex({ messageId: 1 }, { sparse: true }),
      e.createIndex({ threadId: 1, sentAt: 1 }),
      e.createIndex({ direction: 1, sentiment: 1, receivedAt: -1 }),
      e.createIndex({ toEmail: 1, sentAt: -1 }),
      e.createIndex({ campaignId: 1 }), e.createIndex({ templateId: 1, templateVersion: 1 }),
    ]).catch(err => console.warn('[CRM email] index creation skipped:', err?.message))
    seedDefaultTemplates(db).catch(err => console.warn('[CRM email] template seed skipped:', err?.message))
  }
  return {
    emails: db.collection(EMAIL_COLLECTIONS.emails),
    templates: db.collection(EMAIL_COLLECTIONS.templates),
    campaigns: db.collection(EMAIL_COLLECTIONS.campaigns),
  }
}

const who = (a: SessionActor | null) => a ? { id: a.id, name: a.name, email: a.email } : { id: 'system', name: 'System', email: '' }
const oid = (id: string) => {
  if (!ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  return new ObjectId(id)
}
export function parseAddress(raw: unknown): string {
  const s = String(Array.isArray(raw) ? raw[0] ?? '' : raw ?? '').trim()
  const m = s.match(/<([^>]+)>/)
  return (m ? m[1]! : s).trim().toLowerCase()
}
export function serializeEmail(doc: any, opts: { withBody?: boolean } = {}) {
  if (!doc) return null
  const { _id, bodyHtml, events, ...rest } = doc
  return { id: _id.toString(), ...rest, ...(opts.withBody ? { bodyHtml, events: events || [] } : {}) }
}

// ───────────────────────── Merge fields ─────────────────────────
/**
 * Every {{field}} a template may use. Audit fields come from the dealership's most recent inventory
 * audit; sender fields from the sender's CRM profile (Email → Settings).
 */
export const MERGE_FIELDS = [
  'firstName', 'lastName', 'fullName', 'contactTitle', 'dealership', 'dealerGroup', 'city', 'state', 'website',
  'senderName', 'senderFirstName', 'senderInitials', 'senderTitle', 'senderCompany', 'senderPhone', 'senderEmail', 'senderTagline', 'senderRegion',
  'auditDate', 'auditDateUpper', 'usedTotal', 'usedMissingPhotos', 'usedMissingPhotoPct', 'newTotal', 'newMissingPhotos', 'newMissingPhotoPct',
  'totalVehicles', 'totalMissingPhotos', 'missingPhotoPct', 'inventoryUrl', 'auditScreenshot', 'replyMailto',
  // Inventory Scanner detail + ready-made HTML blocks (see crm-email-blocks.ts)
  'usedWithPhotos', 'placeholderImages', 'noImageCount', 'stockImages',
  'auditEvidence', 'auditBreakdown', 'usedPhotoBar', 'newInventoryNote',
  // Then vs now (vs the audit closest to ~3 months earlier) + public report link
  'prevAuditDate', 'prevUsedTotal', 'prevUsedMissingPhotos', 'prevUsedMissingPhotoPct', 'prevTotalMissingPhotos', 'usedMissingChange', 'usedMissingPctChange', 'auditPeriod', 'trendWord', 'auditTrend', 'reportUrl',
] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export interface SenderProfile { displayName: string, title: string, company: string, phone: string, email: string, tagline: string, region: string }

export function mergeVars(dealership: any, contact: any, sender: Partial<SenderProfile> & { name?: string } | null, audit: any = null, extra: { replyTo?: string, subject?: string, history?: any[], reportUrl?: string } = {}) {
  const senderName = sender?.displayName || sender?.name || ''
  const d = audit?.auditedAt ? new Date(audit.auditedAt) : null
  const n = (v: any) => (v === null || v === undefined || v === '') ? '' : String(v)
  const p = (v: any) => (v === null || v === undefined) ? '' : `${v}%`
  return {
    firstName: contact?.firstName || '',
    lastName: contact?.lastName || '',
    fullName: `${contact?.firstName || ''} ${contact?.lastName || ''}`.trim(),
    contactTitle: contact?.jobTitle || contact?.role || '',
    dealership: dealership?.name || '',
    dealerGroup: dealership?.dealerGroup || '',
    city: dealership?.city || '',
    state: dealership?.state || '',
    website: (dealership?.website || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    senderName,
    senderFirstName: senderName.split(/\s+/)[0] || '',
    senderInitials: senderName.split(/\s+/).filter(Boolean).slice(0, 2).map((w: string) => w[0]!.toUpperCase()).join(''),
    senderTitle: sender?.title || '',
    senderCompany: sender?.company || FROM_BRAND(),
    senderPhone: sender?.phone || '',
    senderEmail: sender?.email || '',
    senderTagline: sender?.tagline || '',
    senderRegion: sender?.region || '',
    auditDate: d ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}` : '',
    auditDateUpper: d ? `${MONTHS[d.getUTCMonth()]!.toUpperCase()} ${String(d.getUTCDate()).padStart(2, '0')}, ${d.getUTCFullYear()}` : '',
    usedTotal: n(audit?.usedTotal), usedMissingPhotos: n(audit?.usedMissingPhotos), usedMissingPhotoPct: p(audit?.usedMissingPhotoPct),
    newTotal: n(audit?.newTotal), newMissingPhotos: n(audit?.newMissingPhotos), newMissingPhotoPct: p(audit?.newMissingPhotoPct),
    totalVehicles: n(audit?.totalVehicles), totalMissingPhotos: n(audit?.totalMissingPhotos), missingPhotoPct: p(audit?.missingPhotoPct),
    inventoryUrl: audit?.inventoryUrl || '',
    auditScreenshot: audit?.screenshotFileId ? '__AUDIT_SCREENSHOT__' : '',
    usedWithPhotos: audit?.usedTotal != null && audit?.usedMissingPhotos != null ? String(Math.max(0, audit.usedTotal - audit.usedMissingPhotos)) : '',
    placeholderImages: n(audit?.photoBreakdown?.placeholder),
    noImageCount: n(audit?.photoBreakdown?.missing),
    stockImages: n(audit?.photoBreakdown?.stock),
    auditEvidence: audit ? auditEvidence({ ...audit, auditDateUpper: d ? `${MONTHS[d.getUTCMonth()]!.toUpperCase()} ${String(d.getUTCDate()).padStart(2, '0')}, ${d.getUTCFullYear()}` : '' }, { screenshot: audit?.screenshotFileId ? '__AUDIT_SCREENSHOT__' : '' }) : '',
    auditBreakdown: audit ? auditBreakdown(audit) : '',
    usedPhotoBar: audit ? usedPhotoBar(audit) : '',
    newInventoryNote: audit ? newInventoryNote(audit) : '',
    // Then vs now (latest audit vs the one ~3 months earlier) + the dealer's own report link.
    ...trendVars(audit, extra.history || (audit ? [audit] : [])),
    reportUrl: extra.reportUrl || '',
    replyMailto: extra.replyTo ? `mailto:${extra.replyTo}?subject=${encodeURIComponent(`Re: ${extra.subject || ''}`)}` : '',
  } as Record<string, string>
}
/** Replace {{field}} (and {{field|fallback}}) placeholders. `html: true` escapes values. */
export function renderMerge(text: string, vars: Record<string, string>, opts: { html?: boolean } = {}) {
  const missing = new Set<string>()
  const out = String(text || '').replace(/\{\{\s*(\w+)\s*(?:\|\s*([^}]*))?\}\}/g, (_m, key: string, fallback?: string) => {
    const v = vars[key]
    if (v) return RAW_HTML_FIELDS.has(key) ? (opts.html ? v : htmlToText(v).trim()) : opts.html ? esc(v) : v
    if (fallback !== undefined) return opts.html ? esc(fallback.trim()) : fallback.trim()
    missing.add(key)
    return ''
  })
  return { text: out, missing: [...missing] }
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** Plain text → simple, client-safe HTML (paragraphs, line breaks, clickable links). */
export function textToHtml(text: string) {
  const paras = esc(text.trim()).split(/\n{2,}/).map(p => p.replace(/\n/g, '<br>'))
  const linked = paras.map(p => p.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>'))
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#111">${linked.map(p => `<p style="margin:0 0 14px">${p}</p>`).join('')}</div>`
}
/** HTML → readable plain-text part (for the text/plain alternative and history notes). */
export function htmlToText(html: string) {
  return String(html || '')
    .replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|tr|li|table)>/gi, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const l = label.replace(/<[^>]+>/g, '').trim()
      // tel:/mailto: links whose text already shows the number/address: keep just the text.
      if (/^(tel|mailto):/i.test(href) && href.replace(/^(tel|mailto):/i, '').split('?')[0]!.replace(/\D/g, '') === l.replace(/\D/g, '')) return l
      if (/^mailto:/i.test(href) && l.includes('@')) return l
      return `${l} (${href})`
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rarr;/g, '→').replace(/&mdash;/g, '—').replace(/&middot;/g, '·')
    .replace(/&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…').replace(/&[a-z]+;/gi, ' ')
    .replace(/&#(\d+);/g, (_m, c) => String.fromCodePoint(Number(c)))
    .replace(/[\u2007\uFEFF\u034F\u200C]+/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ───────────────────────── Sender profiles ─────────────────────────
export const SENDER_COLLECTION = 'turboCleanCrmSenderProfiles'
export async function getSenderProfile(db: Db, actor: SessionActor | null): Promise<SenderProfile> {
  const p = actor ? await db.collection(SENDER_COLLECTION).findOne({ userId: actor.id }) : null
  let phone = p?.phone || ''
  if (!p && actor && ObjectId.isValid(actor.id)) {
    const u = await db.collection('turboCleanAppUsers').findOne({ _id: new ObjectId(actor.id) }, { projection: { phone: 1 } })
    phone = u?.phone || ''
  }
  return {
    displayName: p?.displayName || actor?.name || '', title: p?.title || '', company: p?.company || FROM_BRAND(),
    phone, email: p?.email || actor?.email || '', tagline: p?.tagline || '', region: p?.region || '',
  }
}
export async function saveSenderProfile(db: Db, actor: SessionActor | null, body: any) {
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const fields: any = {}
  for (const [k, max] of [['displayName', 120], ['title', 120], ['company', 120], ['phone', 40], ['email', 254], ['tagline', 200], ['region', 120]] as const)
    if (k in (body || {})) fields[k] = str(body[k], max)
  if (fields.email && !EMAIL_RE.test(fields.email)) throw createError({ statusCode: 400, statusMessage: 'Invalid email' })
  await db.collection(SENDER_COLLECTION).updateOne({ userId: actor.id }, { $set: { ...fields, userId: actor.id, updatedAt: new Date().toISOString() } }, { upsert: true })
  return getSenderProfile(db, actor)
}

// ───────────────────────── Templates (body versions × subject lines) ─────────────────────────
/**
 * A template is one message idea ("Missing Photos"). It has
 *  - body versions V1, V2, … (text or HTML). Content never changes once created; edits add a version.
 *  - subject lines S1, S2, … tracked separately, so subject and body can be tested independently.
 * Any number of versions / subject lines can be ACTIVE at once — the composer rotates between active
 * ones (fewest sends first) so experiments get balanced samples.
 */
export function normalizeTemplate(t: any) {
  if (!t) return t
  const versions = (t.versions || []).map((v: any) => ({
    format: 'text', html: '', label: '', ...v,
    status: v.status || (v.version === t.currentVersion ? 'active' : 'retired'),
  }))
  let subjects = Array.isArray(t.subjects) && t.subjects.length ? t.subjects : null
  if (!subjects) {
    // Templates created before subject lines were tracked: one line per distinct version subject.
    const seen: string[] = []
    for (const v of versions) if (v.subject && !seen.includes(v.subject)) seen.push(v.subject)
    const current = versions.find((v: any) => v.version === t.currentVersion)?.subject
    subjects = seen.map((text, i) => ({ key: `S${i + 1}`, text, status: text === current ? 'active' : 'retired', createdAt: t.createdAt }))
  }
  return { ...t, versions, subjects }
}
const serializeTemplate = (t: any, usage?: any) => { const n = normalizeTemplate(t); const { _id, ...rest } = n; return { id: _id.toString(), ...rest, usage: usage || { versions: {}, subjects: {} } } }

async function templateUsage(db: Db, templateIds: string[]) {
  const { emails } = await emailDb(db)
  const rows = await emails.aggregate([
    { $match: { direction: 'outbound', status: { $ne: 'failed' }, templateId: { $in: templateIds } } },
    { $group: { _id: { t: '$templateId', v: '$templateVersion', s: '$subjectVariant' }, n: { $sum: 1 } } },
  ]).toArray()
  const out: Record<string, { versions: Record<string, number>, subjects: Record<string, number> }> = {}
  for (const r of rows) {
    const u = (out[r._id.t] ||= { versions: {}, subjects: {} })
    if (r._id.v != null) u.versions[r._id.v] = (u.versions[r._id.v] || 0) + r.n
    if (r._id.s) u.subjects[r._id.s] = (u.subjects[r._id.s] || 0) + r.n
  }
  return out
}

export async function listTemplates(db: Db, includeArchived = false) {
  const { templates } = await emailDb(db)
  const rows = await templates.find(includeArchived ? {} : { archivedAt: null }).sort({ category: 1, name: 1 }).toArray()
  const usage = await templateUsage(db, rows.map(r => r._id.toString()))
  return rows.map(t => serializeTemplate(t, usage[t._id.toString()]))
}

function versionFromBody(body: any, version: number, actor: SessionActor | null) {
  const format = body?.format === 'html' ? 'html' : 'text'
  const html = format === 'html' ? String(body?.html ?? '').slice(0, 200_000) : ''
  const text = format === 'html' ? (str(body?.body, 20_000) || htmlToText(html)) : str(body?.body, 20_000)
  if (format === 'html' ? !html.trim() : !text) throw createError({ statusCode: 400, statusMessage: 'The message body is required' })
  return { version, format, body: text, html, subject: str(body?.subject, 300), label: str(body?.label, 60), note: str(body?.note, 300), status: 'active', createdAt: new Date().toISOString(), createdBy: who(actor) }
}

export async function createTemplate(db: Db, body: any, actor: SessionActor | null) {
  const { templates } = await emailDb(db)
  const name = str(body?.name, 120)
  const subject = str(body?.subject, 300)
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Template name is required' })
  if (!subject) throw createError({ statusCode: 400, statusMessage: 'A subject line is required' })
  const now = new Date().toISOString()
  const doc = {
    name, category: TEMPLATE_CATEGORIES.includes(body?.category) ? body.category : 'Other', description: str(body?.description, 500),
    currentVersion: 1,
    versions: [{ ...versionFromBody(body, 1, actor), note: str(body?.note, 300) || 'Initial version' }],
    subjects: [{ key: 'S1', text: subject, status: 'active', createdAt: now, createdBy: who(actor) }],
    archivedAt: null as string | null, createdAt: now, createdBy: who(actor), updatedAt: now,
  }
  const res = await templates.insertOne(doc)
  return serializeTemplate({ _id: res.insertedId, ...doc })
}

/**
 * PATCH a template. Supported (combinable):
 *  name / category / description / archived
 *  newVersion: { format, body, html, label, note, retireOthers (default true) }
 *  addSubject: { text, retireOthers (default false) }
 *  versionStatus: { version, status: 'active'|'retired' }
 *  subjectStatus: { key, status: 'active'|'retired' }
 *  (legacy) subject / body → new subject line / new text version
 */
export async function updateTemplate(db: Db, id: string, body: any, actor: SessionActor | null) {
  const { templates } = await emailDb(db)
  const raw = await templates.findOne({ _id: oid(id) })
  if (!raw) throw createError({ statusCode: 404, statusMessage: 'Template not found' })
  const t = normalizeTemplate(raw)
  const now = new Date().toISOString()
  const $set: any = { updatedAt: now }
  let versions = t.versions.map((v: any) => ({ ...v }))
  let subjects = t.subjects.map((s: any) => ({ ...s }))

  if ('name' in body) { const n = str(body.name, 120); if (!n) throw createError({ statusCode: 400, statusMessage: 'Name cannot be empty' }); $set.name = n }
  if ('category' in body && TEMPLATE_CATEGORIES.includes(body.category)) $set.category = body.category
  if ('description' in body) $set.description = str(body.description, 500)
  if (typeof body.archived === 'boolean') $set.archivedAt = body.archived ? now : null

  // Legacy single-field edits
  if (typeof body.subject === 'string' && !body.addSubject && !subjects.some((s: any) => s.text === body.subject.trim())) body.addSubject = { text: body.subject, retireOthers: true }
  if (typeof body.body === 'string' && !body.newVersion) {
    const cur = versions.find((v: any) => v.version === t.currentVersion)
    if (!cur || cur.body !== body.body.trim()) body.newVersion = { format: 'text', body: body.body, note: body.note, retireOthers: true }
  }

  if (body.newVersion) {
    const next = Math.max(0, ...versions.map((v: any) => v.version)) + 1
    const v = versionFromBody(body.newVersion, next, actor)
    if (body.newVersion.retireOthers !== false) versions = versions.map((x: any) => ({ ...x, status: 'retired' }))
    versions.push(v)
    $set.currentVersion = next
  }
  if (body.addSubject) {
    const text = str(body.addSubject.text, 300)
    if (!text) throw createError({ statusCode: 400, statusMessage: 'Subject line cannot be empty' })
    const existing = subjects.find((s: any) => s.text === text)
    if (body.addSubject.retireOthers) subjects = subjects.map((s: any) => ({ ...s, status: 'retired' }))
    if (existing) existing.status = 'active'
    else subjects.push({ key: `S${Math.max(0, ...subjects.map((s: any) => Number(String(s.key).slice(1)) || 0)) + 1}`, text, status: 'active', createdAt: now, createdBy: who(actor) })
    if (existing && body.addSubject.retireOthers) subjects = subjects.map((s: any) => s.key === existing.key ? { ...s, status: 'active' } : s)
  }
  if (body.versionStatus) {
    const v = versions.find((x: any) => x.version === Number(body.versionStatus.version))
    if (!v) throw createError({ statusCode: 400, statusMessage: 'Version not found' })
    v.status = body.versionStatus.status === 'retired' ? 'retired' : 'active'
  }
  if (body.subjectStatus) {
    const s = subjects.find((x: any) => x.key === body.subjectStatus.key)
    if (!s) throw createError({ statusCode: 400, statusMessage: 'Subject line not found' })
    s.status = body.subjectStatus.status === 'retired' ? 'retired' : 'active'
  }
  if (!versions.some((v: any) => v.status === 'active')) throw createError({ statusCode: 400, statusMessage: 'At least one body version must stay active' })
  if (!subjects.some((s: any) => s.status === 'active')) throw createError({ statusCode: 400, statusMessage: 'At least one subject line must stay active' })
  // "Current" = newest active version (what new sends default to).
  $set.currentVersion = Math.max(...versions.filter((v: any) => v.status === 'active').map((v: any) => v.version))
  $set.versions = versions
  $set.subjects = subjects
  await templates.updateOne({ _id: raw._id }, { $set })
  const usage = await templateUsage(db, [id])
  return serializeTemplate(await templates.findOne({ _id: raw._id }), usage[id])
}

/** Balanced rotation: among active versions/subject lines, the one with the fewest sends. */
export async function pickVariants(db: Db, templateId: string) {
  const { templates } = await emailDb(db)
  const raw = await templates.findOne({ _id: oid(templateId) })
  if (!raw) throw createError({ statusCode: 400, statusMessage: 'Template not found' })
  const t = normalizeTemplate(raw)
  const usage = (await templateUsage(db, [templateId]))[templateId] || { versions: {}, subjects: {} }
  const v = [...t.versions.filter((x: any) => x.status === 'active')].sort((a: any, b: any) => (usage.versions[a.version] || 0) - (usage.versions[b.version] || 0) || b.version - a.version)[0]
  const s = [...t.subjects.filter((x: any) => x.status === 'active')].sort((a: any, b: any) => (usage.subjects[a.key] || 0) - (usage.subjects[b.key] || 0))[0]
  return { template: t, version: v, subject: s, usage }
}

export async function listCampaigns(db: Db) {
  const { campaigns } = await emailDb(db)
  const rows = await campaigns.find({}).sort({ archivedAt: 1, createdAt: -1 }).toArray()
  return rows.map(c => ({ id: c._id.toString(), ...c, _id: undefined }))
}
export async function saveCampaign(db: Db, id: string | null, body: any, actor: SessionActor | null) {
  const { campaigns } = await emailDb(db)
  const now = new Date().toISOString()
  const fields: any = {}
  if (!id || 'name' in body) { const n = str(body?.name, 120); if (!n) throw createError({ statusCode: 400, statusMessage: 'Campaign name is required' }); fields.name = n }
  if ('description' in (body || {})) fields.description = str(body.description, 1000)
  if ('status' in (body || {}) && ['planned', 'active', 'paused', 'completed'].includes(body.status)) fields.status = body.status
  if ('startDate' in (body || {})) fields.startDate = str(body.startDate, 10) || null
  if ('endDate' in (body || {})) fields.endDate = str(body.endDate, 10) || null
  if (typeof body?.archived === 'boolean') fields.archivedAt = body.archived ? now : null
  if (!id) {
    const doc = { status: 'active', description: '', startDate: null, endDate: null, archivedAt: null, ...fields, createdAt: now, createdBy: who(actor), updatedAt: now }
    const res = await campaigns.insertOne(doc)
    return { id: res.insertedId.toString(), ...doc }
  }
  await campaigns.updateOne({ _id: oid(id) }, { $set: { ...fields, updatedAt: now } })
  const after = await campaigns.findOne({ _id: oid(id) })
  if (!after) throw createError({ statusCode: 404, statusMessage: 'Campaign not found' })
  return { id: after._id.toString(), ...after, _id: undefined }
}

// ───────────────────────── Threads / follow-up numbering ─────────────────────────
/**
 * The sequence an email belongs to. A "thread" = first email + its follow-ups to the same person.
 * followUpNumber 0 = first email, 1 = first follow-up, …
 */
export async function nextInThread(db: Db, threadId: string | null) {
  const { emails } = await emailDb(db)
  if (!threadId) return { threadId: null, followUpNumber: 0, root: null as any, previous: null as any }
  const root = await emails.findOne({ _id: oid(threadId), direction: 'outbound' })
  if (!root) throw createError({ statusCode: 400, statusMessage: 'The email you are following up on was not found' })
  const rootId = root.threadId || root._id.toString()
  const thread = await emails.find({ threadId: rootId, direction: 'outbound', status: { $ne: 'failed' } }).sort({ sentAt: -1 }).toArray()
  return { threadId: rootId, followUpNumber: thread.length, root, previous: thread[0] || root }
}

// ───────────────────────── Send ─────────────────────────
export interface SendInput {
  contactId?: string | null
  to?: string
  /** Subject as typed (may contain {{fields}}). Omit with a template to use the rotated subject line. */
  subject?: string
  /** Text body. For an HTML template version leave empty to send the version's HTML unchanged. */
  body?: string
  templateId?: string | null
  /** Omit to let the CRM pick (balanced rotation among active versions). */
  templateVersion?: number | null
  /** Subject line key (S1, S2…). Omit to rotate; ignored when `subject` differs from every line (→ 'custom'). */
  subjectVariant?: string | null
  campaignId?: string | null
  /** Reply in an existing sequence (any email id from that thread) */
  followUpOf?: string | null
  /** Send even though the same message went to this address recently (data-quality guard). */
  allowDuplicate?: boolean
}

/** Days within which the same template / subject to the same address counts as a duplicate send. */
export const DUPLICATE_EMAIL_DAYS = 7

/** Everything the merge needs for one recipient. */
export async function mergeContext(db: Db, dealership: any, contact: any, actor: SessionActor | null, extra: { replyTo?: string, subject?: string } = {}) {
  const [sender, recent] = await Promise.all([
    getSenderProfile(db, actor),
    db.collection('turboCleanCrmAudits').find({ dealershipId: dealership._id.toString() }).sort({ auditedAt: -1, createdAt: -1 }).limit(24).toArray(),
  ])
  const audit = recent[0] || null
  const history = [...recent].reverse()
  return { vars: mergeVars(dealership, contact, sender, audit, { ...extra, history, reportUrl: audit ? auditReportUrl(audit._id.toString()) : '' }), sender, audit }
}

export async function sendCrmEmail(db: Db, dealership: any, input: SendInput, actor: SessionActor | null) {
  if (!process.env.RESEND_API_KEY) throw createError({ statusCode: 500, statusMessage: 'RESEND_API_KEY is not configured' })
  const { emails, campaigns } = await emailDb(db)
  const dealershipId = dealership._id.toString()

  // Recipient
  let contact: any = null
  if (input.contactId) {
    contact = await db.collection(CRM_COLLECTIONS.contacts).findOne({ _id: oid(input.contactId), dealershipId })
    if (!contact) throw createError({ statusCode: 400, statusMessage: 'Contact does not belong to this dealership' })
  }
  const toEmail = (str(input.to, 254) || contact?.email || '').toLowerCase()
  if (!EMAIL_RE.test(toEmail)) throw createError({ statusCode: 400, statusMessage: 'A valid recipient email is required' })
  if (!contact) contact = await db.collection(CRM_COLLECTIONS.contacts).findOne({ dealershipId, email: toEmail })

  // Template version + subject line (rotated when not chosen explicitly)
  let template: any = null, version: any = null, subjectLine: any = null
  if (input.templateId) {
    const picked = await pickVariants(db, input.templateId)
    template = picked.template
    version = input.templateVersion ? template.versions.find((v: any) => v.version === Number(input.templateVersion)) : picked.version
    if (!version) throw createError({ statusCode: 400, statusMessage: 'Template version not found' })
    subjectLine = input.subjectVariant ? template.subjects.find((s: any) => s.key === input.subjectVariant) : null
    if (!subjectLine && !input.subject) subjectLine = picked.subject
  }
  let campaign: any = null
  if (input.campaignId) {
    campaign = await campaigns.findOne({ _id: oid(input.campaignId) })
    if (!campaign) throw createError({ statusCode: 400, statusMessage: 'Campaign not found' })
  }

  // Duplicate guard: the same template (or the same subject) to the same address in the last few days.
  if (!input.allowDuplicate && !input.followUpOf) {
    const since = new Date(Date.now() - DUPLICATE_EMAIL_DAYS * 86_400_000).toISOString()
    const typedSubject = str(input.subject, 300)
    const or: any[] = []
    if (template) or.push({ templateId: template._id.toString() })
    if (typedSubject) or.push({ subjectTemplate: typedSubject })
    const dup = or.length ? await emails.find({ toEmail, direction: 'outbound', status: { $ne: 'failed' }, sentAt: { $gte: since }, $or: or }, { projection: { sentAt: 1, subject: 1 } }).sort({ sentAt: -1 }).limit(1).next() : null
    if (dup) throw createError({ statusCode: 409, statusMessage: `Already sent to ${toEmail} on ${String(dup.sentAt).slice(0, 10)} (“${dup.subject}”). Send again anyway?`, data: { duplicateEmail: true, emailId: dup._id.toString() } })
  }

  const thread = await nextInThread(db, input.followUpOf || null)
  const _id = new ObjectId()
  const id = _id.toString()
  const now = new Date().toISOString()
  const fromEmail = FROM_EMAIL()
  const replyTo = REPLY_DOMAIN() ? `reply+${id}@${REPLY_DOMAIN()}` : (process.env.CRM_REPLY_TO || actor?.email || fromEmail)

  // Subject: the typed one wins; if it is exactly a tracked line, credit that line, else 'custom'.
  const rawSubject = str(input.subject, 300) || subjectLine?.text || ''
  if (template && !subjectLine) subjectLine = template.subjects.find((s: any) => s.text === rawSubject) || null
  const subjectVariant = template ? (subjectLine && subjectLine.text === rawSubject ? subjectLine.key : 'custom') : null

  // Content — merged on the server so what is stored is exactly what was sent.
  const { vars, sender, audit } = await mergeContext(db, dealership, contact, actor, { replyTo, subject: rawSubject })
  const subject = renderMerge(rawSubject, vars).text.trim()
  const typedBody = str(input.body, 20_000)
  const useHtml = version?.format === 'html' && (!typedBody || typedBody === version.body)
  const bodyEdited = !!version && !useHtml && typedBody !== (version.body || '')
  let bodyHtml: string, bodyText: string
  const attachments: any[] = []
  const inlineFiles: { cid: string, fileId: string }[] = []
  if (useHtml) {
    const shot = audit?.screenshotFileId ? await getFile(db, audit.screenshotFileId) : null
    if (shot) inlineFiles.push({ cid: 'audit-shot', fileId: String(audit!.screenshotFileId) })
    const merged = renderMerge(version.html, vars, { html: true }).text
    bodyHtml = merged.replace(/__AUDIT_SCREENSHOT__/g, shot ? `<img src="cid:audit-shot" alt="Inventory page screenshot" width="100%" style="display:block;width:100%;max-width:600px;height:auto;border:0" />` : '')
    if (shot && bodyHtml.includes('cid:audit-shot')) attachments.push({ content: shot.data.toString('base64'), filename: shot.filename, contentType: shot.contentType, contentId: 'audit-shot' })
    bodyText = renderMerge(version.body || htmlToText(version.html), vars).text.replace(/__AUDIT_SCREENSHOT__/g, '').trim()
  } else {
    bodyText = renderMerge(typedBody || version?.body || '', vars).text.replace(/__AUDIT_SCREENSHOT__/g, '').trim()
    bodyHtml = textToHtml(bodyText)
  }
  if (!subject || !bodyText) throw createError({ statusCode: 400, statusMessage: 'Subject and message are required' })

  const fromName = sender.displayName ? `${sender.displayName} | ${sender.company || FROM_BRAND()}` : FROM_BRAND()
  const refs = thread.previous?.messageId ? [thread.root?.messageId, thread.previous.messageId].filter((v, i, a) => v && a.indexOf(v) === i) : []

  const doc: any = {
    schemaVersion: 2,
    _id,
    direction: 'outbound',
    dealershipId,
    dealershipCode: dealership.dealershipId || '',
    dealershipName: dealership.name || '',
    contactId: contact?._id?.toString() || null,
    contactName: contact ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim() : '',
    toEmail,
    fromEmail,
    fromName,
    replyTo,
    subject,
    subjectTemplate: rawSubject,
    bodyText,
    bodyHtml,
    bodyFormat: useHtml ? 'html' : 'text',
    // Exact copy of what was sent, kept forever: content fingerprint + envelope + inline images.
    contentSha256: createHash('sha256').update(`${subject}\n${bodyHtml}\n${bodyText}`).digest('hex'),
    inlineFiles,
    envelope: { from: `${fromName} <${fromEmail}>`, to: toEmail, replyTo, subject, date: now },
    templateId: template?._id?.toString() || null,
    templateName: template?.name || '',
    templateVersion: version?.version ?? null,
    templateVersionLabel: version ? (version.label || `V${version.version}`) : '',
    templateEdited: bodyEdited,
    subjectVariant,
    auditId: audit?._id?.toString() || null,
    campaignId: campaign?._id?.toString() || null,
    campaignName: campaign?.name || '',
    threadId: thread.threadId || id,
    // First-touch attribution: the template/subject that opened this sequence.
    rootTemplateId: thread.root ? (thread.root.templateId || null) : (template?._id?.toString() || null),
    rootTemplateVersion: thread.root ? (thread.root.templateVersion ?? null) : (version?.version ?? null),
    rootSubjectVariant: thread.root ? (thread.root.subjectVariant || null) : subjectVariant,
    isFollowUp: thread.followUpNumber > 0,
    followUpNumber: thread.followUpNumber,
    // Resend assigns the Message-ID; it arrives on the `email.sent` webhook and is used for threading.
    messageId: null as string | null,
    resendId: null as string | null,
    status: 'queued',
    sentAt: now,
    sentBy: who(actor),
    deliveredAt: null, bouncedAt: null, bounceType: '', bounceReason: '', complainedAt: null, delayedAt: null,
    openedAt: null, lastOpenedAt: null, openCount: 0,
    clickedAt: null, lastClickedAt: null, clickCount: 0, clickedLinks: [] as string[],
    repliedAt: null, lastRepliedAt: null, replyCount: 0, replySentiment: null as string | null,
    outcomes: { conversation: null, meeting: null, opportunity: null, proposal: null, won: null } as Record<Outcome, any>,
    events: [{ type: 'queued', at: now }],
    interactionId: null as string | null,
    createdAt: now, updatedAt: now,
  }
  await emails.insertOne(doc)

  const resend = new Resend(process.env.RESEND_API_KEY)
  const payload: any = {
    from: `${fromName} <${fromEmail}>`,
    to: [toEmail],
    subject,
    text: bodyText,
    html: bodyHtml,
    replyTo,
    ...(attachments.length ? { attachments } : {}),
    // Deliverability: one-click unsubscribe (RFC 8058, required by Gmail/Yahoo for bulk senders) + threading.
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl(id)}>, <mailto:${replyTo}?subject=unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      ...(refs.length ? { 'In-Reply-To': refs.at(-1)!, 'References': refs.join(' ') } : {}),
    },
    tags: [{ name: 'crm_email_id', value: id }, { name: 'source', value: 'crm' }],
  }
  const result: any = await resend.emails.send(payload).catch((e: any) => ({ error: { message: e?.message || String(e) } }))
  if (result?.error) {
    const msg = result.error.message || result.error.name || 'Send failed'
    await emails.updateOne({ _id }, { $set: { status: 'failed', failedReason: msg, updatedAt: new Date().toISOString() }, $push: { events: { type: 'failed', at: new Date().toISOString(), detail: msg } } as any })
    throw createError({ statusCode: 502, statusMessage: `Email not sent: ${msg}` })
  }
  await emails.updateOne({ _id }, { $set: { status: 'sent', resendId: result?.data?.id || null, updatedAt: new Date().toISOString() }, $push: { events: { type: 'sent', at: new Date().toISOString() } } as any })

  // Relationship history + pipeline (forward only).
  try {
    const { createInteraction } = await import('./crm-interactions')
    const tLabel = template ? `\nTemplate: ${template.name} ${doc.templateVersionLabel}${bodyEdited ? ' (edited)' : ''} · subject ${subjectVariant}` : ''
    const ix = await createInteraction(db, dealership, {
      type: 'email_sent', contactId: contact?._id?.toString() || null,
      notes: `Subject: ${subject}\nTo: ${toEmail}${tLabel}${campaign ? `\nCampaign: ${campaign.name}` : ''}${thread.followUpNumber ? `\nFollow-up #${thread.followUpNumber}` : '\nFirst email'}`,
      outcome: 'Sent', refs: { emailId: id },
    }, actor, 'email')
    await emails.updateOne({ _id }, { $set: { interactionId: ix.id } })
    await advanceStage(db, dealership, 'Outreach Active', actor, `Email sent: ${subject}`)
  } catch (e) { console.error('[CRM email] history/stage update failed:', (e as Error).message) }

  return serializeEmail(await emails.findOne({ _id }), { withBody: true })
}

/** Render what a send would produce, without sending (composer preview). */
export async function previewCrmEmail(db: Db, dealership: any, input: SendInput, actor: SessionActor | null) {
  let contact: any = null
  const dealershipId = dealership._id.toString()
  if (input.contactId && ObjectId.isValid(input.contactId)) contact = await db.collection(CRM_COLLECTIONS.contacts).findOne({ _id: new ObjectId(input.contactId), dealershipId })
  let version: any = null, template: any = null
  if (input.templateId) {
    const picked = await pickVariants(db, input.templateId)
    template = picked.template
    version = input.templateVersion ? template.versions.find((v: any) => v.version === Number(input.templateVersion)) : picked.version
  }
  const replyTo = REPLY_DOMAIN() ? `reply+preview@${REPLY_DOMAIN()}` : (process.env.CRM_REPLY_TO || actor?.email || FROM_EMAIL())
  const rawSubject = str(input.subject, 300)
  const { vars, audit } = await mergeContext(db, dealership, contact, actor, { replyTo, subject: rawSubject })
  const subj = renderMerge(rawSubject, vars)
  const typedBody = str(input.body, 20_000)
  const useHtml = version?.format === 'html' && (!typedBody || typedBody === version.body)
  if (useHtml) {
    const merged = renderMerge(version.html, vars, { html: true })
    const html = merged.text.replace(/__AUDIT_SCREENSHOT__/g, audit?.screenshotFileId ? `<img src="/api/crm/files/${audit.screenshotFileId}" alt="Inventory page screenshot" style="display:block;width:100%;max-width:600px;height:auto;border:0" />` : '')
    return { subject: subj.text, html, format: 'html', missing: [...new Set([...subj.missing, ...merged.missing])], auditDate: audit?.auditedAt || null }
  }
  const b = renderMerge(typedBody || version?.body || '', vars)
  return { subject: subj.text, html: textToHtml(b.text.replace(/__AUDIT_SCREENSHOT__/g, '')), format: 'text', missing: [...new Set([...subj.missing, ...b.missing])], auditDate: audit?.auditedAt || null }
}

/**
 * Everything a template preview needs to render exactly like a real send, in the browser:
 * the merge values (incl. the ready-made HTML blocks) for a real dealership — its latest audit and
 * best contact — or for a realistic sample dealership. The sender is always the signed-in user's
 * profile (sample values fill any blanks). The client fills {{fields}} itself, so previews update
 * instantly while typing or while Template Studio is writing.
 */
export async function templatePreviewContext(db: Db, input: any, actor: SessionActor | null) {
  const { SAMPLE_AUDIT, SAMPLE_CONTACT, SAMPLE_DEALERSHIP, SAMPLE_HISTORY, SAMPLE_SENDER } = await import('./crm-email-blocks')
  const replyTo = REPLY_DOMAIN() ? `reply+preview@${REPLY_DOMAIN()}` : (process.env.CRM_REPLY_TO || actor?.email || FROM_EMAIL())
  const subject = str(input?.subject, 300)
  let vars: Record<string, string>, audit: any, sender: SenderProfile
  let source: 'sample' | 'dealership' = 'sample'
  let to = { name: `${SAMPLE_CONTACT.firstName} ${SAMPLE_CONTACT.lastName}`, email: SAMPLE_CONTACT.email }
  let dealershipName = SAMPLE_DEALERSHIP.name
  if (input?.dealershipId && ObjectId.isValid(String(input.dealershipId))) {
    const dealership = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: new ObjectId(String(input.dealershipId)) })
    if (!dealership) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
    const contacts = await db.collection(CRM_COLLECTIONS.contacts).find({ dealershipId: dealership._id.toString() }).toArray()
    const { pickEmailContact } = await import('./automation-research')
    const contact = pickEmailContact(contacts) || contacts[0] || null
    const ctx = await mergeContext(db, dealership, contact, actor, { replyTo, subject })
    vars = ctx.vars; audit = ctx.audit; sender = ctx.sender; source = 'dealership'
    to = { name: contact ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim() : '', email: contact?.email || '' }
    dealershipName = dealership.name || ''
  }
  else {
    const mine = await getSenderProfile(db, actor)
    sender = { ...SAMPLE_SENDER, ...Object.fromEntries(Object.entries(mine).filter(([, v]) => v)) } as SenderProfile
    audit = SAMPLE_AUDIT
    vars = mergeVars(SAMPLE_DEALERSHIP, SAMPLE_CONTACT, sender, SAMPLE_AUDIT, { replyTo, subject, history: SAMPLE_HISTORY, reportUrl: '#sample-report' })
  }
  return {
    source, dealershipName, vars, rawFields: [...RAW_HTML_FIELDS],
    screenshotHtml: audit?.screenshotFileId ? `<img src="/api/crm/files/${audit.screenshotFileId}" alt="Inventory page screenshot" style="display:block;width:100%;max-width:600px;height:auto;border:0" />` : '',
    hasAudit: !!audit, auditDate: audit?.auditedAt || null,
    from: { name: sender.displayName ? `${sender.displayName} | ${sender.company || FROM_BRAND()}` : FROM_BRAND(), email: FROM_EMAIL() },
    to,
  }
}

/** Move a live, unconverted dealership forward to `target` (never backwards, never out of Lost/Won). */
async function advanceStage(db: Db, dealership: any, target: string, actor: SessionActor | null, note: string) {
  const fresh = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: dealership._id })
  if (!fresh || fresh.dealerId || fresh.archivedAt) return
  const cur = OPEN_STAGE_ORDER.indexOf(fresh.stage), to = OPEN_STAGE_ORDER.indexOf(target)
  if (cur === -1 || to === -1 || to <= cur) return
  const { moveStage } = await import('./crm-stage')
  await moveStage(db, fresh, target, actor, 'email' as any, note)
}

// ───────────────────────── As-sent archive (HTML / PDF) ─────────────────────────
/**
 * The email exactly as it was sent, as one standalone document: an envelope header (from, to, date,
 * subject, template, fingerprint) above the original HTML. Inline images (cid:) are embedded, so
 * the archive opens anywhere and prints to PDF identically. Content is never re-rendered.
 */
export async function emailArchiveHtml(db: Db, id: string) {
  const { emails } = await emailDb(db)
  const e = await emails.findOne({ _id: oid(id) })
  if (!e) throw createError({ statusCode: 404, statusMessage: 'Email not found' })
  let body = String(e.bodyHtml || '') || textToHtml(String(e.bodyText || ''))
  for (const f of (e.inlineFiles || []) as { cid: string, fileId: string }[]) {
    const file = await getFile(db, f.fileId).catch(() => null)
    if (file) body = body.split(`cid:${f.cid}`).join(`data:${file.contentType};base64,${file.data.toString('base64')}`)
  }
  // Old sends (before inlineFiles was recorded): embed the audit screenshot if one was referenced.
  if (body.includes('cid:audit-shot') && e.auditId && ObjectId.isValid(e.auditId)) {
    const a = await db.collection('turboCleanCrmAudits').findOne({ _id: new ObjectId(e.auditId) })
    const file = a?.screenshotFileId ? await getFile(db, a.screenshotFileId).catch(() => null) : null
    if (file) body = body.split('cid:audit-shot').join(`data:${file.contentType};base64,${file.data.toString('base64')}`)
  }
  const head = body.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || ''
  const styles = (head.match(/<style[\s\S]*?<\/style>/gi) || []).join('\n')
  const inner = body.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? body
  const bodyAttr = body.match(/<body([^>]*)>/i)?.[1] || ''
  const bg = bodyAttr.match(/background(?:-color)?:\s*([^;"]+)/i)?.[1] || '#ffffff'
  const outbound = e.direction !== 'inbound'
  const when = new Date(e.sentAt || e.receivedAt || e.createdAt)
  const row = (k: string, v: string) => v ? `<tr><td style="padding:3px 14px 3px 0;color:#667085;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:3px 0;color:#101828">${v}</td></tr>` : ''
  const envelope = `<div class="zrz-envelope" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:17px;background:#ffffff;border-bottom:1px solid #eaecf0;padding:18px 24px">
  <div style="font-size:10px;font-weight:700;letter-spacing:1.6px;color:#15803d;margin-bottom:8px">${outbound ? 'EMAIL AS SENT' : 'EMAIL AS RECEIVED'} &middot; ZRZ OPS CRM ARCHIVE</div>
  <div style="font-size:17px;font-weight:700;color:#101828;margin-bottom:10px">${esc(String(e.subject || ''))}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
    ${row('From', esc(e.envelope?.from || (e.fromName ? `${e.fromName} <${e.fromEmail}>` : e.fromEmail || '')))}
    ${row('To', esc(e.envelope?.to || e.toEmail || ''))}
    ${row('Date', esc(when.toUTCString()))}
    ${row('Dealership', esc(e.dealershipName || ''))}
    ${outbound ? row('Template', esc([e.templateName, e.templateVersionLabel, e.subjectVariant ? `subject ${e.subjectVariant}` : '', e.templateEdited ? 'edited' : ''].filter(Boolean).join(' · '))) : ''}
    ${row('Status', esc([e.status, e.deliveredAt ? `delivered ${String(e.deliveredAt).slice(0, 16).replace('T', ' ')}` : '', e.repliedAt ? 'replied' : ''].filter(Boolean).join(' · ')))}
    ${row('Fingerprint', e.contentSha256 ? `<span style="font-family:ui-monospace,Menlo,monospace;color:#667085">sha256 ${esc(String(e.contentSha256).slice(0, 24))}…</span>` : '')}
  </table>
</div>`
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(String(e.subject || 'Email'))} — ${esc(e.dealershipName || '')}</title>
<style>@page{size:Letter;margin:0.3in}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;background:${esc(bg)}}</style>${styles}</head>
<body>${envelope}<div class="zrz-archived-body">${inner}</div></body></html>`
  return { html, email: e }
}

// ───────────────────────── Unsubscribe (deliverability) ─────────────────────────
const createHmacSync = (key: string, data: string) => createHmacNode('sha256', key).update(data).digest('hex')
const PUBLIC_URL = () => (process.env.CRM_PUBLIC_URL || process.env.NUXT_PUBLIC_SITE_URL || 'https://zrzops.com').replace(/\/$/, '')
function unsubscribeSecret() {
  return process.env.CRM_UNSUBSCRIBE_SECRET || process.env.RESEND_WEBHOOK_SECRET || process.env.RESEND_API_KEY || 'zrz-unsubscribe'
}
export function unsubscribeToken(emailId: string) {
  return createHmacSync(unsubscribeSecret(), `unsub:${emailId}`).slice(0, 32)
}
export function unsubscribeUrl(emailId: string) {
  return `${PUBLIC_URL()}/api/crm/email/unsubscribe/${emailId}?t=${unsubscribeToken(emailId)}`
}
/** Mark the recipient of an email as "do not email" (one-click unsubscribe link / button). */
export async function unsubscribeByEmail(db: Db, emailId: string, token: string) {
  if (!ObjectId.isValid(emailId) || token !== unsubscribeToken(emailId)) throw createError({ statusCode: 400, statusMessage: 'This unsubscribe link is not valid' })
  const { emails } = await emailDb(db)
  const e = await emails.findOne({ _id: new ObjectId(emailId) })
  if (!e) throw createError({ statusCode: 404, statusMessage: 'Email not found' })
  const now = new Date().toISOString()
  const contacts = db.collection(CRM_COLLECTIONS.contacts)
  const filter: any = e.contactId && ObjectId.isValid(e.contactId) ? { _id: new ObjectId(e.contactId) } : { email: e.toEmail }
  const r = await contacts.updateMany({ ...filter, doNotEmail: { $ne: true } }, { $set: { doNotEmail: true, doNotEmailAt: now, doNotEmailReason: 'Unsubscribed (email link)', updatedAt: now } })
  await emails.updateOne({ _id: e._id }, { $set: { unsubscribedAt: now }, $push: { events: { type: 'unsubscribed', at: now } } as any })
  if (r.modifiedCount && e.dealershipId) {
    try {
      const { cancelDrafts } = await import('./automation-outreach')
      await cancelDrafts(db, { dealershipId: e.dealershipId }, 'Recipient unsubscribed')
      await logActivity(db, { dealershipId: e.dealershipId, contactId: e.contactId || null, type: 'contact.updated', message: `${e.toEmail} unsubscribed from emails (one-click link) — marked “do not email”`, actor: { id: 'system', name: 'Email', email: '' } } as any)
    } catch {}
  }
  return { email: e.toEmail, changed: r.modifiedCount > 0 }
}

// ───────────────────────── Deliverability check ─────────────────────────
/**
 * Inbox-placement health of the sending setup: SPF, DKIM, DMARC and bounce (return-path) records of
 * the From domain, the reply domain, one-click unsubscribe, sending volume. Each item says how to fix it.
 */
export async function deliverabilityReport(db: Db) {
  const dns = await import('node:dns/promises')
  const from = FROM_EMAIL()
  const domain = from.split('@')[1] || ''
  const txt = async (host: string) => { try { return (await dns.resolveTxt(host)).map(r => r.join('')) } catch { return [] as string[] } }
  const mx = async (host: string) => { try { return (await dns.resolveMx(host)).map(r => r.exchange) } catch { return [] as string[] } }
  const [rootTxt, sendTxt, dkim, dmarc, sendMx] = await Promise.all([txt(domain), txt(`send.${domain}`), txt(`resend._domainkey.${domain}`), txt(`_dmarc.${domain}`), mx(`send.${domain}`)])
  const items: { key: string, label: string, status: 'ok' | 'warn' | 'fail', detail: string, fix?: string }[] = []
  const spf = [...sendTxt, ...rootTxt].find(t => /^v=spf1/i.test(t))
  items.push(spf
    ? { key: 'spf', label: 'SPF', status: /amazonses|resend/i.test(spf) || sendTxt.length ? 'ok' : 'warn', detail: spf }
    : { key: 'spf', label: 'SPF', status: 'fail', detail: `No SPF record on ${domain} or send.${domain}`, fix: 'In Resend → Domains, copy the SPF (TXT) record for the "send" subdomain into your DNS.' })
  items.push(dkim.some(t => /p=/.test(t))
    ? { key: 'dkim', label: 'DKIM signature', status: 'ok', detail: `resend._domainkey.${domain} found` }
    : { key: 'dkim', label: 'DKIM signature', status: 'fail', detail: `No DKIM key at resend._domainkey.${domain}`, fix: 'In Resend → Domains, add the DKIM (TXT) record and press Verify.' })
  const dm = dmarc.find(t => /^v=DMARC1/i.test(t))
  const policy = dm?.match(/;\s*p=(\w+)/i)?.[1]?.toLowerCase()
  items.push(!dm
    ? { key: 'dmarc', label: 'DMARC', status: 'fail', detail: `No DMARC record at _dmarc.${domain}`, fix: 'Add TXT _dmarc → "v=DMARC1; p=none; rua=mailto:dmarc@' + domain + '". Gmail and Yahoo require DMARC for senders.' }
    : { key: 'dmarc', label: 'DMARC', status: 'ok', detail: `Policy p=${policy || 'none'}${policy === 'none' ? ' (fine to start; move to quarantine once reports look clean)' : ''}` })
  items.push(sendMx.length
    ? { key: 'returnpath', label: 'Bounce handling (return-path)', status: 'ok', detail: `MX on send.${domain}` }
    : { key: 'returnpath', label: 'Bounce handling (return-path)', status: 'warn', detail: `No MX record on send.${domain}`, fix: 'Add the MX record Resend shows for the "send" subdomain so bounces are handled and SPF aligns.' })
  const rd = REPLY_DOMAIN()
  if (rd) {
    const rmx = await mx(rd)
    items.push(rmx.length ? { key: 'reply', label: 'Reply tracking domain', status: 'ok', detail: `${rd} receives mail (${rmx[0]})` } : { key: 'reply', label: 'Reply tracking domain', status: 'fail', detail: `${rd} has no MX record`, fix: 'Point the reply domain MX at Resend inbound, or replies will bounce.' })
  }
  items.push({ key: 'unsubscribe', label: 'One-click unsubscribe', status: 'ok', detail: 'List-Unsubscribe + List-Unsubscribe-Post headers on every email; an opt-out line in the template footer.' })
  items.push({ key: 'text', label: 'Plain-text version', status: 'ok', detail: 'Every HTML email also carries a readable text/plain part.' })
  try {
    const { getSettings } = await import('./automation')
    const st = await getSettings(db)
    items.push(st.dailySendLimit > 60
      ? { key: 'volume', label: 'Sending volume', status: 'warn', detail: `Daily limit is ${st.dailySendLimit}`, fix: 'For a new domain, start around 20–40 cold emails a day and raise it slowly over 3–4 weeks.' }
      : { key: 'volume', label: 'Sending volume', status: 'ok', detail: `Daily limit ${st.dailySendLimit} — a safe pace for cold outreach` })
  } catch {}
  const { emails } = await emailDb(db)
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const [sent, bounced, complained] = await Promise.all([
    emails.countDocuments({ direction: 'outbound', sentAt: { $gte: since }, status: { $ne: 'failed' } }),
    emails.countDocuments({ direction: 'outbound', sentAt: { $gte: since }, bouncedAt: { $ne: null } }),
    emails.countDocuments({ direction: 'outbound', sentAt: { $gte: since }, complainedAt: { $ne: null } }),
  ])
  if (sent) {
    const br = Math.round((bounced / sent) * 1000) / 10, cr = Math.round((complained / sent) * 1000) / 10
    items.push({ key: 'bounces', label: 'Bounce rate (30 days)', status: br > 5 ? 'fail' : br > 2 ? 'warn' : 'ok', detail: `${br}% of ${sent}`, ...(br > 2 ? { fix: 'Verify addresses before sending; remove contacts that bounced.' } : {}) })
    items.push({ key: 'complaints', label: 'Spam complaints (30 days)', status: cr >= 0.3 ? 'fail' : cr >= 0.1 ? 'warn' : 'ok', detail: `${cr}%`, ...(cr >= 0.1 ? { fix: 'Keep complaints under 0.1% (Gmail’s limit is 0.3%): tighter targeting, fewer follow-ups, clearer opt-out.' } : {}) })
  }
  const score = Math.round(100 * items.reduce((a, i) => a + (i.status === 'ok' ? 1 : i.status === 'warn' ? 0.5 : 0), 0) / items.length)
  return { domain, from, score, items, checkedAt: new Date().toISOString() }
}

// ───────────────────────── Resend webhooks ─────────────────────────
const EVENT_STATUS: Record<string, { status?: string, field?: string }> = {
  'email.sent': { field: 'sentConfirmedAt' },
  'email.delivered': { status: 'delivered', field: 'deliveredAt' },
  'email.delivery_delayed': { field: 'delayedAt' },
  'email.bounced': { status: 'bounced', field: 'bouncedAt' },
  'email.complained': { status: 'complained', field: 'complainedAt' },
  'email.opened': {},
  'email.clicked': {},
  'email.failed': { status: 'failed', field: 'failedAt' },
}
function tagValue(tags: any, name: string): string | null {
  if (!tags) return null
  if (Array.isArray(tags)) return tags.find((t: any) => t?.name === name)?.value ?? null
  if (typeof tags === 'object') return tags[name] ?? null
  return null
}

/** Applies a delivery/engagement event to the matching outbound email. Returns true if it was a CRM email. */
export async function applyEmailEvent(db: Db, payload: any) {
  const map = EVENT_STATUS[payload?.type]
  if (!map) return false
  const { emails } = await emailDb(db)
  const data = payload.data || {}
  const crmId = tagValue(data.tags, 'crm_email_id')
  const email = (crmId && ObjectId.isValid(crmId) ? await emails.findOne({ _id: new ObjectId(crmId) }) : null)
    || (data.email_id ? await emails.findOne({ resendId: data.email_id }) : null)
  if (!email) return false
  const at = new Date(payload.created_at || data.created_at || Date.now()).toISOString()
  const $set: any = { updatedAt: new Date().toISOString() }
  const $inc: any = {}
  const $addToSet: any = {}
  if (!email.resendId && data.email_id) $set.resendId = data.email_id
  if (!email.messageId && data.message_id) $set.messageId = String(data.message_id)
  // Status only moves "forward" — a late `delivered` must not undo a bounce.
  const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, bounced: 3, complained: 3, failed: 3 }
  if (map.status && (RANK[map.status] ?? 0) >= (RANK[email.status] ?? 0)) $set.status = map.status
  if (map.field && !email[map.field]) $set[map.field] = at
  if (payload.type === 'email.bounced') {
    $set.bounceType = str(data.bounce?.type || data.bounce?.subType, 60)
    $set.bounceReason = str(data.bounce?.message || data.bounce?.diagnosticCode, 500)
  }
  if (payload.type === 'email.opened') {
    $inc.openCount = 1; $set.lastOpenedAt = at
    if (!email.openedAt) $set.openedAt = at
  }
  if (payload.type === 'email.clicked') {
    $inc.clickCount = 1; $set.lastClickedAt = at
    if (!email.clickedAt) $set.clickedAt = at
    const link = str(data.click?.link, 500)
    if (link) $addToSet.clickedLinks = link
  }
  const update: any = { $set, $push: { events: { $each: [{ type: payload.type.replace('email.', ''), at, detail: str(data.bounce?.message || data.click?.link || '', 300) }], $slice: -100 } } }
  if (Object.keys($inc).length) update.$inc = $inc
  if (Object.keys($addToSet).length) update.$addToSet = $addToSet
  await emails.updateOne({ _id: email._id }, update)

  if (payload.type === 'email.bounced' || payload.type === 'email.complained') {
    const bounced = payload.type === 'email.bounced'
    if (email.contactId && ObjectId.isValid(email.contactId)) {
      await db.collection(CRM_COLLECTIONS.contacts).updateOne({ _id: new ObjectId(email.contactId) }, { $set: bounced ? { emailBouncedAt: at, emailBounceReason: $set.bounceReason || '' } : { emailComplainedAt: at } })
    }
    await logActivity(db, { dealershipId: email.dealershipId, contactId: email.contactId, type: bounced ? 'email.bounced' : 'email.complained', actor: null,
      message: bounced ? `Email bounced: "${email.subject}" to ${email.toEmail}${$set.bounceReason ? ` — ${$set.bounceReason}` : ''}` : `Marked as spam by ${email.toEmail}: "${email.subject}"` })
    if (email.interactionId && ObjectId.isValid(email.interactionId)) {
      await db.collection('turboCleanCrmInteractions').updateOne({ _id: new ObjectId(email.interactionId) }, { $set: { outcome: bounced ? 'Bounced' : 'Marked as spam', updatedAt: new Date().toISOString() } })
    }
  }
  else if (payload.type === 'email.delivered' && email.interactionId && ObjectId.isValid(email.interactionId)) {
    await db.collection('turboCleanCrmInteractions').updateOne({ _id: new ObjectId(email.interactionId), outcome: 'Sent' }, { $set: { outcome: 'Delivered', updatedAt: new Date().toISOString() } })
  }
  return true
}

/**
 * Inbound mail (Resend `email.received`). Returns the stored reply, or null when it is not CRM mail
 * (so the caller can keep its existing invoice-mailbox handling).
 */
export async function ingestInboundEmail(db: Db, payload: any, full: { html?: string, text?: string, headers?: any } = {}) {
  const { emails } = await emailDb(db)
  const data = payload.data || {}
  const toList: string[] = (Array.isArray(data.to) ? data.to : [data.to]).filter(Boolean).map(parseAddress)
  const fromEmail = parseAddress(data.from)
  const headers = lowerKeys(full.headers || data.headers || {})

  // 1) reply+<id>@ address
  let parent: any = null
  let matchedBy = ''
  for (const t of [...toList, ...(Array.isArray(data.cc) ? data.cc.map(parseAddress) : [])]) {
    const m = t.match(/^reply\+([a-f0-9]{24})@/i)
    if (m) { parent = await emails.findOne({ _id: new ObjectId(m[1]!), direction: 'outbound' }); if (parent) { matchedBy = 'reply-address'; break } }
  }
  // 2) In-Reply-To / References
  if (!parent) {
    const refs = `${headers['in-reply-to'] || ''} ${headers.references || ''}`.match(/<[^>]+>/g) || []
    for (const r of refs.reverse()) {
      parent = await emails.findOne({ messageId: r, direction: 'outbound' })
      if (parent) { matchedBy = 'headers'; break }
    }
  }
  // 3) Sender = someone we emailed (most recent outbound to them)
  if (!parent && fromEmail) {
    parent = await emails.find({ toEmail: fromEmail, direction: 'outbound' }).sort({ sentAt: -1 }).limit(1).next()
    if (parent) matchedBy = 'sender'
  }
  // 4) Sender is a CRM contact we have not emailed from the CRM yet
  let contact: any = null
  if (!parent && fromEmail) {
    contact = await db.collection(CRM_COLLECTIONS.contacts).find({ email: fromEmail }).sort({ isActive: -1 }).limit(1).next()
    if (contact) matchedBy = 'contact'
  }
  if (!parent && !contact) {
    // Only keep unmatched mail that was clearly addressed to the CRM.
    const crmAddressed = toList.some(t => t === FROM_EMAIL().toLowerCase() || /^reply\+/.test(t) || (REPLY_DOMAIN() && t.endsWith(`@${REPLY_DOMAIN()}`)))
    if (!crmAddressed) return null
  }

  const receivedAt = new Date(payload.created_at || data.created_at || Date.now()).toISOString()
  const dealershipId = parent?.dealershipId || contact?.dealershipId || null
  const dealership = dealershipId && ObjectId.isValid(dealershipId) ? await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: new ObjectId(dealershipId) }) : null
  if (!contact && parent?.contactId && ObjectId.isValid(parent.contactId)) contact = await db.collection(CRM_COLLECTIONS.contacts).findOne({ _id: new ObjectId(parent.contactId) })
  if (!contact && dealershipId && fromEmail) contact = await db.collection(CRM_COLLECTIONS.contacts).findOne({ dealershipId, email: fromEmail })

  const text = String(full.text || data.text || '').slice(0, 50_000)
  const doc: any = {
    schemaVersion: 1,
    direction: 'inbound',
    dealershipId,
    dealershipCode: dealership?.dealershipId || '',
    dealershipName: dealership?.name || '',
    contactId: contact?._id?.toString() || null,
    contactName: contact ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim() : '',
    fromEmail,
    fromName: String(data.from || '').replace(/<[^>]+>/, '').replace(/"/g, '').trim(),
    toEmail: toList[0] || '',
    subject: str(data.subject, 300) || '(No subject)',
    bodyText: text,
    snippet: stripQuoted(text).slice(0, 280),
    bodyHtml: String(full.html || data.html || '').slice(0, 200_000),
    inReplyToEmailId: parent?._id?.toString() || null,
    threadId: parent?.threadId || null,
    campaignId: parent?.campaignId || null,
    templateId: parent?.templateId || null,
    templateVersion: parent?.templateVersion ?? null,
    matchedBy,
    resendId: data.email_id || null,
    messageId: data.message_id || headers['message-id'] || null,
    receivedAt,
    sentAt: receivedAt,
    sentiment: null as string | null,
    sentimentSetAt: null, sentimentSetBy: null,
    interactionId: null as string | null,
    createdAt: new Date().toISOString(),
  }
  if (doc.resendId && await emails.findOne({ direction: 'inbound', resendId: doc.resendId })) return null // webhook retry
  const res = await emails.insertOne(doc)
  const id = res.insertedId.toString()

  if (parent) {
    const set: any = { lastRepliedAt: receivedAt, updatedAt: new Date().toISOString() }
    if (!parent.repliedAt) set.repliedAt = receivedAt
    await emails.updateOne({ _id: parent._id }, { $set: set, $inc: { replyCount: 1 }, $push: { events: { $each: [{ type: 'replied', at: receivedAt, detail: fromEmail }], $slice: -100 } } as any })
  }
  if (dealership) {
    try {
      const { createInteraction } = await import('./crm-interactions')
      const ix = await createInteraction(db, dealership, {
        type: 'email_reply', contactId: contact?._id?.toString() || null,
        occurredAt: receivedAt > new Date().toISOString() ? undefined : receivedAt,
        notes: `Subject: ${doc.subject}\nFrom: ${fromEmail}\n\n${doc.snippet}`,
        outcome: 'Needs review', refs: { emailId: id, ...(parent ? { replyToEmailId: parent._id.toString() } : {}) },
      }, null, 'email')
      await emails.updateOne({ _id: res.insertedId }, { $set: { interactionId: ix.id } })
      await advanceStage(db, dealership, 'Replied', null, `Email reply from ${fromEmail}`)
    } catch (e) { console.error('[CRM email] reply history failed:', (e as Error).message) }
  }
  return { id, matched: !!dealership, matchedBy }
}
function lowerKeys(h: any): Record<string, string> {
  const out: Record<string, string> = {}
  if (Array.isArray(h)) for (const x of h) { if (x?.name) out[String(x.name).toLowerCase()] = String(x.value ?? '') }
  else if (h && typeof h === 'object') for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = Array.isArray(v) ? v.join(' ') : String(v ?? '')
  return out
}
/** Drop the quoted original ("On … wrote:", "> …") so previews show what they actually said. */
export function stripQuoted(text: string) {
  const lines = String(text || '').split(/\r?\n/)
  const out: string[] = []
  for (const l of lines) {
    if (/^On .+wrote:\s*$/i.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim()) || /^From:\s.+/i.test(l.trim())) break
    if (l.trim().startsWith('>')) continue
    out.push(l)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ───────────────────────── Rep actions on messages ─────────────────────────
export async function updateEmailMessage(db: Db, id: string, body: any, actor: SessionActor | null) {
  const { emails } = await emailDb(db)
  const msg = await emails.findOne({ _id: oid(id) })
  if (!msg) throw createError({ statusCode: 404, statusMessage: 'Email not found' })
  const now = new Date().toISOString()

  // Attach an unmatched reply to a dealership (and optionally the email it answers).
  if (msg.direction === 'inbound' && body?.dealershipId && !msg.dealershipId) {
    const dealership = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: oid(String(body.dealershipId)) })
    if (!dealership) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
    const parent = body.inReplyToEmailId ? await emails.findOne({ _id: oid(String(body.inReplyToEmailId)), dealershipId: dealership._id.toString(), direction: 'outbound' }) : null
    const contact = await db.collection(CRM_COLLECTIONS.contacts).findOne({ dealershipId: dealership._id.toString(), email: msg.fromEmail })
    await emails.updateOne({ _id: msg._id }, { $set: {
      dealershipId: dealership._id.toString(), dealershipCode: dealership.dealershipId, dealershipName: dealership.name,
      contactId: contact?._id?.toString() || null, contactName: contact ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim() : '',
      inReplyToEmailId: parent?._id?.toString() || null, threadId: parent?.threadId || null, campaignId: parent?.campaignId || null,
      templateId: parent?.templateId || null, templateVersion: parent?.templateVersion ?? null, matchedBy: 'manual', attachedBy: who(actor), attachedAt: now,
    } })
    if (parent) await emails.updateOne({ _id: parent._id }, { $set: { lastRepliedAt: msg.receivedAt, ...(parent.repliedAt ? {} : { repliedAt: msg.receivedAt }) }, $inc: { replyCount: 1 } })
    const { createInteraction } = await import('./crm-interactions')
    const ix = await createInteraction(db, dealership, { type: 'email_reply', contactId: contact?._id?.toString() || null, occurredAt: msg.receivedAt,
      notes: `Subject: ${msg.subject}\nFrom: ${msg.fromEmail}\n\n${msg.snippet}`, outcome: 'Needs review', refs: { emailId: id } }, actor, 'email')
    await emails.updateOne({ _id: msg._id }, { $set: { interactionId: ix.id } })
  }

  // Reply sentiment — decided by the rep.
  if (msg.direction === 'inbound' && 'sentiment' in (body || {})) {
    const s = body.sentiment === null ? null : String(body.sentiment)
    if (s !== null && !SENTIMENTS.includes(s as any)) throw createError({ statusCode: 400, statusMessage: 'Unknown sentiment' })
    await emails.updateOne({ _id: msg._id }, { $set: { sentiment: s, sentimentSetAt: s ? now : null, sentimentSetBy: s ? who(actor) : null } })
    const fresh = await emails.findOne({ _id: msg._id })
    if (fresh?.inReplyToEmailId) await refreshThreadSentiment(db, fresh.inReplyToEmailId)
    if (fresh?.interactionId && ObjectId.isValid(fresh.interactionId)) {
      const type = s === 'positive' ? 'positive_reply' : s === 'negative' ? 'negative_reply' : 'email_reply'
      const outcome = s === 'positive' ? 'Positive' : s === 'negative' ? 'Negative' : s === 'neutral' ? 'Neutral' : 'Needs review'
      await db.collection('turboCleanCrmInteractions').updateOne({ _id: new ObjectId(fresh.interactionId) }, { $set: { type, outcome, updatedAt: now } })
    }
    if (fresh?.dealershipId) await logActivity(db, { dealershipId: fresh.dealershipId, contactId: fresh.contactId, type: 'email.reply_classified', actor,
      message: s ? `Reply from ${fresh.fromEmail} marked ${s}` : `Reply classification cleared (${fresh.fromEmail})` })
  }

  // Manual outcome credit on an outbound email (e.g. meeting booked by phone after the reply).
  if (msg.direction === 'outbound' && body?.outcomes && typeof body.outcomes === 'object') {
    const $set: any = { updatedAt: now }
    for (const k of OUTCOMES) {
      if (!(k in body.outcomes)) continue
      $set[`outcomes.${k}`] = body.outcomes[k] ? (msg.outcomes?.[k] || { at: now, by: who(actor), source: 'manual' }) : null
    }
    await emails.updateOne({ _id: msg._id }, { $set })
    await logActivity(db, { dealershipId: msg.dealershipId, type: 'email.outcome_updated', actor,
      message: `Email "${msg.subject}" credited: ${OUTCOMES.filter(k => body.outcomes[k]).join(', ') || 'none'}` })
  }
  return serializeEmail(await emails.findOne({ _id: msg._id }), { withBody: true })
}
async function refreshThreadSentiment(db: Db, outboundId: string) {
  const { emails } = await emailDb(db)
  if (!ObjectId.isValid(outboundId)) return
  const latest = await emails.find({ inReplyToEmailId: outboundId, direction: 'inbound', sentiment: { $ne: null } }).sort({ receivedAt: -1 }).limit(1).next()
  await emails.updateOne({ _id: new ObjectId(outboundId) }, { $set: { replySentiment: latest?.sentiment || null } })
}

// ───────────────────────── Outcome attribution ─────────────────────────
const STAGE_OUTCOME: Record<string, Outcome> = {
  'Conversation': 'conversation',
  'Meeting Scheduled': 'meeting', 'Meeting Completed': 'meeting',
  'Opportunity': 'opportunity',
  'Proposal Sent': 'proposal', 'Negotiating': 'proposal',
  'Won': 'won',
}
const INTERACTION_OUTCOME: Record<string, Outcome> = {
  connected_call: 'conversation', conversation: 'conversation', walk_in: 'conversation',
  meeting_scheduled: 'meeting', meeting_completed: 'meeting',
  proposal_sent: 'proposal', contract_won: 'won',
}
/**
 * Credit a funnel step to the email that produced it: the most recent outbound email to this
 * dealership that got a reply, sent within ATTRIBUTION_DAYS before the event. Later steps imply
 * the earlier ones. Never throws.
 */
export async function attributeOutcome(db: Db, dealershipId: string, trigger: { stage?: string, interactionType?: string }, at = new Date()) {
  try {
    const outcome = trigger.stage ? STAGE_OUTCOME[trigger.stage] : trigger.interactionType ? INTERACTION_OUTCOME[trigger.interactionType] : undefined
    if (!outcome) return
    const { emails } = await emailDb(db)
    const since = new Date(at.getTime() - ATTRIBUTION_DAYS * 86_400_000).toISOString()
    const email = await emails.find({ dealershipId, direction: 'outbound', repliedAt: { $ne: null }, sentAt: { $gte: since, $lte: at.toISOString() } }).sort({ sentAt: -1 }).limit(1).next()
    if (!email) return
    const idx = OUTCOMES.indexOf(outcome)
    const $set: any = {}
    for (const k of OUTCOMES.slice(0, idx + 1)) {
      if (!email.outcomes?.[k]) $set[`outcomes.${k}`] = { at: at.toISOString(), source: trigger.stage ? `stage:${trigger.stage}` : `activity:${trigger.interactionType}`, implied: k !== outcome }
    }
    if (Object.keys($set).length) await emails.updateOne({ _id: email._id }, { $set: { ...$set, updatedAt: new Date().toISOString() } })
  } catch (e) { console.error('[CRM email] attribution failed:', (e as Error).message) }
}

// ───────────────────────── Reporting ─────────────────────────
/**
 * Funnel + breakdown. Primary metrics: replies → conversations → meetings → proposals → won.
 * Opens/clicks are returned separately as "reported" engagement.
 */
export async function emailStats(db: Db, q: { from?: string, to?: string, groupBy?: 'template' | 'campaign' | 'user' | 'followUp' | 'none', campaignId?: string, templateId?: string, userId?: string }) {
  const { emails } = await emailDb(db)
  const match: any = { direction: 'outbound', status: { $ne: 'failed' } }
  if (q.from || q.to) match.sentAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: `${q.to}T23:59:59.999Z` } : {}) }
  if (q.campaignId) match.campaignId = q.campaignId
  if (q.templateId) match.templateId = q.templateId
  if (q.userId) match['sentBy.id'] = q.userId
  const groupKey: any = q.groupBy === 'template' ? { id: '$templateId', name: '$templateName', version: '$templateVersion' }
    : q.groupBy === 'campaign' ? { id: '$campaignId', name: '$campaignName' }
      : q.groupBy === 'user' ? { id: '$sentBy.id', name: '$sentBy.name' }
        : q.groupBy === 'followUp' ? { id: { $cond: [{ $gte: ['$followUpNumber', 3] }, '3+', { $toString: '$followUpNumber' }] } }
          : null
  const has = (f: string) => ({ $cond: [{ $ifNull: [f, false] }, 1, 0] })
  const rows = await emails.aggregate([
    { $match: match },
    { $group: {
      _id: groupKey,
      sent: { $sum: 1 },
      firstEmails: { $sum: { $cond: [{ $eq: ['$followUpNumber', 0] }, 1, 0] } },
      followUps: { $sum: { $cond: [{ $gt: ['$followUpNumber', 0] }, 1, 0] } },
      delivered: { $sum: { $cond: [{ $or: [{ $eq: ['$status', 'delivered'] }, { $ifNull: ['$deliveredAt', false] }] }, 1, 0] } },
      bounced: { $sum: { $cond: [{ $eq: ['$status', 'bounced'] }, 1, 0] } },
      complained: { $sum: { $cond: [{ $eq: ['$status', 'complained'] }, 1, 0] } },
      opened: { $sum: has('$openedAt') },
      clicked: { $sum: has('$clickedAt') },
      replied: { $sum: has('$repliedAt') },
      positive: { $sum: { $cond: [{ $eq: ['$replySentiment', 'positive'] }, 1, 0] } },
      negative: { $sum: { $cond: [{ $eq: ['$replySentiment', 'negative'] }, 1, 0] } },
      conversation: { $sum: has('$outcomes.conversation') },
      meeting: { $sum: has('$outcomes.meeting') },
      opportunity: { $sum: has('$outcomes.opportunity') },
      proposal: { $sum: has('$outcomes.proposal') },
      won: { $sum: has('$outcomes.won') },
      dealerships: { $addToSet: '$dealershipId' },
    } },
    { $addFields: { dealershipsReached: { $size: '$dealerships' } } },
    { $project: { dealerships: 0 } },
    { $sort: { sent: -1 } },
  ]).toArray()
  const unclassified = await emails.countDocuments({ direction: 'inbound', dealershipId: { $ne: null }, sentiment: null })
  const unmatched = await emails.countDocuments({ direction: 'inbound', dealershipId: null })
  return { rows: rows.map(r => ({ key: r._id, ...r, _id: undefined })), unclassifiedReplies: unclassified, unmatchedReplies: unmatched, attributionDays: ATTRIBUTION_DAYS }
}

export async function listEmails(db: Db, q: any) {
  const { emails } = await emailDb(db)
  const filter: any = {}
  if (q.dealershipId) filter.dealershipId = String(q.dealershipId)
  if (q.direction) filter.direction = q.direction
  if (q.campaignId) filter.campaignId = String(q.campaignId)
  if (q.templateId) filter.templateId = String(q.templateId)
  if (q.status) filter.status = String(q.status)
  if (q.needsReview === '1') Object.assign(filter, { direction: 'inbound', dealershipId: { $ne: null }, sentiment: null })
  if (q.unmatched === '1') Object.assign(filter, { direction: 'inbound', dealershipId: null })
  if (q.search) {
    const rx = new RegExp(String(q.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter.$or = [{ subject: rx }, { toEmail: rx }, { fromEmail: rx }, { dealershipName: rx }, { contactName: rx }]
  }
  const limit = Math.min(Number(q.limit) || 200, 1000)
  const rows = await emails.find(filter, { projection: { bodyHtml: 0, events: 0 } }).sort({ sentAt: -1 }).limit(limit).toArray()
  return rows.map(r => serializeEmail(r))
}
export async function getEmail(db: Db, id: string) {
  const { emails } = await emailDb(db)
  const doc = await emails.findOne({ _id: oid(id) })
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'Email not found' })
  const thread = doc.threadId ? await emails.find({ $or: [{ threadId: doc.threadId }, { _id: ObjectId.isValid(doc.threadId) ? new ObjectId(doc.threadId) : doc._id }] }, { projection: { bodyHtml: 0, events: 0 } }).sort({ sentAt: 1 }).toArray() : []
  return { email: serializeEmail(doc, { withBody: true }), thread: thread.map(t => serializeEmail(t)) }
}

/** Resend webhooks are signed with Svix. Verifies when RESEND_WEBHOOK_SECRET is set. */
export async function verifyResendSignature(headers: Record<string, string | undefined>, raw: string) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) return true
  const id = headers['svix-id'], ts = headers['svix-timestamp'], sig = headers['svix-signature']
  if (!id || !ts || !sig) return false
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 5 * 60) return false
  const { createHmac, timingSafeEqual } = await import('node:crypto')
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64')
  return sig.split(' ').some((part) => {
    const v = part.split(',')[1] || ''
    try { return v.length === expected.length && timingSafeEqual(Buffer.from(v), Buffer.from(expected)) } catch { return false }
  })
}

// ───────────────────────── Template experiments ─────────────────────────
/** Wilson 95% interval for a proportion — honest about small samples. */
function wilson(k: number, n: number) {
  if (!n) return null
  const z = 1.96, p = k / n, d = 1 + z * z / n
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d
  return { low: Math.max(0, Math.round((c - h) * 1000) / 10), high: Math.min(100, Math.round((c + h) * 1000) / 10) }
}
const rate = (k: number, n: number) => n ? Math.round((k / n) * 1000) / 10 : null
export const MIN_SAMPLE = 30

/**
 * "Which message actually produces dealerships?"
 * level  : template | version | subject | combo (version × subject line)
 * model  : email    — each email is judged by its own template (who got the reply / meeting / win)
 *          sequence — each sequence is judged by the template of its FIRST email (first-touch)
 * Revenue: invoiced (pre-tax subtotal of the won dealer's invoices) + estimated contract value
 * entered at win; each won dealership counts once per row.
 */
export async function templateExperiments(db: Db, q: { from?: string, to?: string, level?: string, model?: string, templateId?: string, campaignId?: string }) {
  const { emails, templates } = await emailDb(db)
  const level = ['template', 'version', 'subject', 'combo'].includes(String(q.level)) ? String(q.level) : 'version'
  const model = q.model === 'sequence' ? 'sequence' : 'email'
  const match: any = { direction: 'outbound', status: { $ne: 'failed' } }
  if (q.from || q.to) match.sentAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: `${q.to}T23:59:59.999Z` } : {}) }
  if (q.campaignId) match.campaignId = q.campaignId
  const rows = await emails.find(match, { projection: { bodyHtml: 0, bodyText: 0, events: 0 } }).sort({ sentAt: 1 }).toArray()

  // Units: emails, or sequences keyed by their first email.
  type Unit = { key: { t: string | null, v: number | null, s: string | null }, dealershipId: string, delivered: boolean, replied: boolean, positive: boolean, negative: boolean, meeting: boolean, opportunity: boolean, proposal: boolean, won: boolean, emails: number }
  const units: Unit[] = []
  const has = (e: any, k: string) => !!e.outcomes?.[k]
  if (model === 'email') {
    for (const e of rows) units.push({ key: { t: e.templateId || null, v: e.templateVersion ?? null, s: e.subjectVariant || null }, dealershipId: e.dealershipId,
      delivered: e.status === 'delivered' || !!e.deliveredAt, replied: !!e.repliedAt, positive: e.replySentiment === 'positive', negative: e.replySentiment === 'negative',
      meeting: has(e, 'meeting'), opportunity: has(e, 'opportunity'), proposal: has(e, 'proposal'), won: has(e, 'won'), emails: 1 })
  } else {
    const byThread = new Map<string, any[]>()
    for (const e of rows) { const k = e.threadId || e._id.toString(); byThread.set(k, [...(byThread.get(k) || []), e]) }
    for (const list of byThread.values()) {
      const first = list.find(e => !e.followUpNumber) || list[0]
      const any = (f: (e: any) => boolean) => list.some(f)
      units.push({ key: { t: first.rootTemplateId ?? first.templateId ?? null, v: first.rootTemplateVersion ?? first.templateVersion ?? null, s: first.rootSubjectVariant ?? first.subjectVariant ?? null }, dealershipId: first.dealershipId,
        delivered: any(e => e.status === 'delivered' || !!e.deliveredAt), replied: any(e => !!e.repliedAt), positive: any(e => e.replySentiment === 'positive'), negative: any(e => e.replySentiment === 'negative'),
        meeting: any(e => has(e, 'meeting')), opportunity: any(e => has(e, 'opportunity')), proposal: any(e => has(e, 'proposal')), won: any(e => has(e, 'won')), emails: list.length })
    }
  }
  const filtered = q.templateId ? units.filter(u => u.key.t === q.templateId) : units

  // Revenue for won dealerships.
  const wonIds = [...new Set(filtered.filter(u => u.won).map(u => u.dealershipId))]
  const revenue = new Map<string, { invoiced: number, contract: number }>()
  if (wonIds.length) {
    const ds = await db.collection(CRM_COLLECTIONS.dealerships).find({ _id: { $in: wonIds.filter(i => ObjectId.isValid(i)).map(i => new ObjectId(i)) } }, { projection: { dealerId: 1, contractValue: 1, convertedAt: 1 } }).toArray()
    const dealerIds = ds.map(d => d.dealerId).filter(Boolean)
    const inv = dealerIds.length ? await db.collection('turboCleanInvoices').aggregate([
      { $match: { dealerId: { $in: [...dealerIds, ...dealerIds.filter((x: string) => ObjectId.isValid(x)).map((x: string) => new ObjectId(x))] } } },
      { $group: { _id: { $toString: '$dealerId' }, total: { $sum: { $ifNull: ['$subtotal', { $ifNull: ['$total', 0] }] } } } },
    ]).toArray() : []
    const invBy = new Map(inv.map(r => [r._id, Number(r.total) || 0]))
    for (const d of ds) revenue.set(d._id.toString(), { invoiced: Math.round((invBy.get(String(d.dealerId)) || 0) * 100) / 100, contract: Number(d.contractValue) || 0 })
  }

  const tdocs = await templates.find({}).toArray()
  const tmap = new Map(tdocs.map(t => [t._id.toString(), normalizeTemplate(t)]))
  const keyOf = (k: Unit['key']) => level === 'template' ? `${k.t}` : level === 'version' ? `${k.t}|${k.v}` : level === 'subject' ? `${k.t}|${k.s}` : `${k.t}|${k.v}|${k.s}`
  const groups = new Map<string, Unit[]>()
  for (const u of filtered) { const k = keyOf(u.key); groups.set(k, [...(groups.get(k) || []), u]) }

  const out = [...groups.values()].map((list) => {
    const k = list[0]!.key
    const t = k.t ? tmap.get(k.t) : null
    const v = t?.versions.find((x: any) => x.version === k.v)
    const s = t?.subjects.find((x: any) => x.key === k.s)
    const n = list.length
    const count = (f: keyof Unit) => list.filter(u => u[f]).length
    const delivered = count('delivered'), replied = count('replied'), positive = count('positive')
    const base = delivered || n
    const wonDealerships = [...new Set(list.filter(u => u.won).map(u => u.dealershipId))]
    const rev = wonDealerships.reduce((a, id) => ({ invoiced: a.invoiced + (revenue.get(id)?.invoiced || 0), contract: a.contract + (revenue.get(id)?.contract || 0) }), { invoiced: 0, contract: 0 })
    return {
      templateId: k.t, templateName: t?.name || (k.t ? 'Deleted template' : 'No template'), category: t?.category || '',
      version: level === 'template' || level === 'subject' ? null : k.v, versionLabel: v ? (v.label || `V${v.version}`) : (k.v ? `V${k.v}` : ''), versionStatus: v?.status || null, versionFormat: v?.format || null,
      subjectVariant: level === 'subject' || level === 'combo' ? k.s : null, subjectText: k.s === 'custom' ? 'Custom subject (typed by rep)' : s?.text || '', subjectStatus: s?.status || null,
      units: n, emails: list.reduce((a, u) => a + u.emails, 0), dealerships: new Set(list.map(u => u.dealershipId)).size,
      delivered, deliveryRate: rate(delivered, n),
      replied, replyRate: rate(replied, base), replyCI: wilson(replied, base),
      positive, positiveRate: rate(positive, base), positiveShareOfReplies: rate(positive, replied), negative: count('negative'),
      meetings: count('meeting'), meetingRate: rate(count('meeting'), base),
      opportunities: count('opportunity'), proposals: count('proposal'),
      won: wonDealerships.length, winRate: rate(wonDealerships.length, base), winCI: wilson(wonDealerships.length, base),
      revenueInvoiced: Math.round(rev.invoiced * 100) / 100, contractValue: Math.round(rev.contract * 100) / 100,
      revenuePerUnit: n ? Math.round((rev.invoiced / n) * 100) / 100 : 0,
      enoughData: n >= MIN_SAMPLE,
    }
  })
  out.sort((a, b) => b.won - a.won || (b.revenueInvoiced - a.revenueInvoiced) || ((b.positiveRate || 0) - (a.positiveRate || 0)) || b.units - a.units)
  return { level, model, minSample: MIN_SAMPLE, unit: model === 'email' ? 'email' : 'sequence', rows: out, totals: { units: filtered.length, won: wonIds.length } }
}

// ───────────────────────── Seed: the "Missing Photos" HTML template ─────────────────────────
export async function seedDefaultTemplates(db: Db) {
  await seedMissingPhotosV1(db)
  await seedMissingPhotosV2(db)
  await seedThenVsNow(db)
}
/** "Then vs Now" — check-in email built on the audit history (latest vs ~3 months earlier). */
async function seedThenVsNow(db: Db) {
  const counters = db.collection(CRM_COLLECTIONS.counters)
  const flag = await counters.findOne({ _id: 'crmEmailSeedThenVsNow' as any })
  if (flag?.done) return
  const claim = await counters.updateOne({ _id: 'crmEmailSeedThenVsNow' as any, startedAt: { $exists: false } }, { $set: { startedAt: new Date().toISOString() } }, { upsert: true }).catch(() => null)
  if (!claim || (!claim.upsertedCount && !claim.modifiedCount)) return
  try {
    const { templates } = await emailDb(db)
    if (!(await templates.findOne({ name: 'Then vs Now' }))) {
      const { THEN_VS_NOW_HTML } = await import('./crm-email-seed')
      await createTemplate(db, {
        name: 'Then vs Now', category: 'Re-engage',
        description: 'Check-in built on the audit history: latest review vs ~3 months earlier, today’s evidence list, button to the dealer’s full report. Needs two or more audits.',
        subject: '{{dealership}}: {{prevUsedMissingPhotos}} → {{usedMissingPhotos}} cars without real photos since {{prevAuditDate}}',
        format: 'html', html: THEN_VS_NOW_HTML, label: 'V1', note: 'Then vs now — audit history + report link',
      }, null)
    }
    await counters.updateOne({ _id: 'crmEmailSeedThenVsNow' as any }, { $set: { done: true, finishedAt: new Date().toISOString() } })
  }
  catch (e) { await counters.deleteOne({ _id: 'crmEmailSeedThenVsNow' as any }).catch(() => {}); throw e }
}
async function seedMissingPhotosV1(db: Db) {
  const counters = db.collection(CRM_COLLECTIONS.counters)
  const flag = await counters.findOne({ _id: 'crmEmailSeedV1' as any })
  if (flag?.done) return
  const claim = await counters.updateOne({ _id: 'crmEmailSeedV1' as any, startedAt: { $exists: false } }, { $set: { startedAt: new Date().toISOString() } }, { upsert: true }).catch(() => null)
  if (!claim || (!claim.upsertedCount && !claim.modifiedCount)) return
  const { templates } = await emailDb(db)
  if (!(await templates.findOne({ name: 'Missing Photos' }))) {
    const { MISSING_PHOTOS_HTML } = await import('./crm-email-seed')
    await createTemplate(db, {
      name: 'Missing Photos', category: 'First touch',
      description: 'Inventory report: used vehicles missing photos from the latest audit, screenshot evidence, recon / merchandise / monitor pitch, 10-minute review CTA.',
      subject: '{{usedMissingPhotos}} vehicles at {{dealership}} are missing photos',
      format: 'html', html: MISSING_PHOTOS_HTML, label: 'V1', note: 'From "UPDATED HTML BODY EMAIL INVENTORY REPORT TEMPLATE" (Oct 11, 2026)',
    }, null)
  }
  await counters.updateOne({ _id: 'crmEmailSeedV1' as any }, { $set: { done: true, finishedAt: new Date().toISOString() } })
}

/**
 * V2 of "Missing Photos": the premium report built for Inventory Scanner audits (clickable listing
 * evidence instead of a screenshot). Added once; it replaces V1 in rotation (V1 stays in the
 * history and can be re-activated from the Templates tab). Also adds subject line S2 as an A/B test.
 */
async function seedMissingPhotosV2(db: Db) {
  const counters = db.collection(CRM_COLLECTIONS.counters)
  const flag = await counters.findOne({ _id: 'crmEmailSeedV2' as any })
  if (flag?.done) return
  const claim = await counters.updateOne({ _id: 'crmEmailSeedV2' as any, startedAt: { $exists: false } }, { $set: { startedAt: new Date().toISOString() } }, { upsert: true }).catch(() => null)
  if (!claim || (!claim.upsertedCount && !claim.modifiedCount)) return
  try {
    const { templates } = await emailDb(db)
    const { MISSING_PHOTOS_HTML_V2 } = await import('./crm-email-seed')
    const note = 'Premium report — scanner evidence list, KPI cards, photo bar (no screenshot needed)'
    const existing = await templates.findOne({ name: 'Missing Photos' })
    if (!existing) {
      await createTemplate(db, {
        name: 'Missing Photos', category: 'First touch',
        description: 'Inventory report from the latest audit: pre-owned vehicles without real photos, clickable listing evidence, recon / merchandise / monitor pitch, 10-minute review CTA.',
        subject: '{{usedMissingPhotos}} vehicles at {{dealership}} are missing photos',
        format: 'html', html: MISSING_PHOTOS_HTML_V2, label: 'V2', note,
      }, null)
    }
    else if (!normalizeTemplate(existing).versions.some((v: any) => v.note === note)) {
      await updateTemplate(db, existing._id.toString(), {
        newVersion: { format: 'html', html: MISSING_PHOTOS_HTML_V2, label: `V${Math.max(0, ...normalizeTemplate(existing).versions.map((v: any) => Number(v.version) || 0)) + 1}`, note, retireOthers: true },
        description: 'Inventory report from the latest audit: pre-owned vehicles without real photos, clickable listing evidence, recon / merchandise / monitor pitch, 10-minute review CTA.',
        addSubject: { text: '{{dealership}}: {{usedMissingPhotos}} pre-owned listings without real photos', retireOthers: false },
      }, null)
    }
    await counters.updateOne({ _id: 'crmEmailSeedV2' as any }, { $set: { done: true, finishedAt: new Date().toISOString() } })
  }
  catch (e: any) {
    // Let it retry next time.
    await counters.deleteOne({ _id: 'crmEmailSeedV2' as any }).catch(() => {})
    throw e
  }
}
