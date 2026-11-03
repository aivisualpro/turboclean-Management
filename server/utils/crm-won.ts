/**
 * Won deal tracking — "measure the actual financial return from prospecting".
 *
 * One record per win in `turboCleanCrmWonDeals`:
 *  - entered at win: date won, services sold (price × monthly volume), contract structure/term,
 *    revenue (calculated, overridable), cost → profit, acquisition source;
 *  - calculated from history: first touch, touches/emails before close, days from first contact
 *    to close, and the campaign/template responsible (overridable).
 * If the win is undone (dealer deleted / stage moved off Won) the record is kept with `revertedAt`.
 */
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import { CRM_COLLECTIONS, str } from './crm'
import type { SessionActor } from './crm'

export const WON_COLLECTION = 'turboCleanCrmWonDeals'
const INTERACTIONS = 'turboCleanCrmInteractions'
const EMAILS = 'turboCleanCrmEmails'

export const CONTRACT_STRUCTURES = ['Per vehicle', 'Per vehicle + monthly minimum', 'Monthly flat fee', 'Retainer + per vehicle', 'Trial / pilot', 'Other'] as const
export const CONTRACT_TERMS = ['Month-to-month', '3 months', '6 months', '12 months', '24 months', 'Other'] as const

/** Activity type → channel, for "first touch" and touch counts. */
const CHANNEL: Record<string, string> = {
  email_sent: 'Email', email_reply: 'Email', positive_reply: 'Email', negative_reply: 'Email',
  phone_call: 'Phone', connected_call: 'Phone', voicemail: 'Phone', text_message: 'Text',
  walk_in: 'Walk-in', conversation: 'In person', meeting_scheduled: 'Meeting', meeting_completed: 'Meeting',
  proposal_sent: 'Proposal', follow_up: 'Follow-up', referral: 'Referral',
}
/** Outreach we did (counts as a touch). Replies, notes, research and won/lost markers are not touches. */
const TOUCH_TYPES = ['email_sent', 'phone_call', 'connected_call', 'voicemail', 'text_message', 'walk_in', 'conversation', 'meeting_scheduled', 'meeting_completed', 'proposal_sent', 'follow_up']
/** What counts as first contact (two-way or outbound). */
const CONTACT_TYPES = [...TOUCH_TYPES, 'email_reply', 'positive_reply', 'negative_reply', 'referral']
const TYPE_LABEL: Record<string, string> = {
  email_sent: 'Email sent', email_reply: 'Email reply', positive_reply: 'Positive reply', negative_reply: 'Negative reply', phone_call: 'Phone call',
  connected_call: 'Connected call', voicemail: 'Voicemail', text_message: 'Text message', walk_in: 'Walk-in visit', conversation: 'Conversation',
  meeting_scheduled: 'Meeting scheduled', meeting_completed: 'Meeting completed', proposal_sent: 'Proposal sent', follow_up: 'Follow-up', referral: 'Referral/introduction',
}

const money = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null }
const round2 = (n: number) => Math.round(n * 100) / 100
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const daysBetween = (a: string | null, b: string | null) => (a && b) ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)) : null

export interface WonService { serviceId: string, name: string, price: number, monthlyVolume: number, monthlyRevenue: number }

/** Validate + compute the hand-entered part. Revenue = Σ price × volume unless overridden. */
export function parseWonInput(body: any) {
  const b = body || {}
  const wonAt = DATE_RE.test(String(b.wonAt || '')) ? String(b.wonAt) : new Date().toISOString().slice(0, 10)
  const services: WonService[] = (Array.isArray(b.services) ? b.services : []).slice(0, 40).map((s: any) => {
    const price = money(s?.price) ?? 0
    const monthlyVolume = Math.max(0, Math.round(Number(s?.monthlyVolume) || 0))
    return { serviceId: str(s?.serviceId, 64), name: str(s?.name, 120), price, monthlyVolume, monthlyRevenue: round2(price * monthlyVolume) }
  }).filter((s: WonService) => s.name || s.serviceId)
  if (!services.length) throw createError({ statusCode: 400, statusMessage: 'Add at least one service sold' })

  const calculated = round2(services.reduce((a, s) => a + s.monthlyRevenue, 0))
  const override = money(b.monthlyRevenueOverride)
  const revenueOverridden = b.monthlyRevenueOverride !== '' && b.monthlyRevenueOverride != null && override != null
  const monthlyRevenue = revenueOverridden ? override! : calculated

  const given = (v: unknown) => v !== '' && v != null
  const costMode = (b.costMode === 'pct' && given(b.costPct)) || (b.costMode === 'amount' && given(b.monthlyCost)) ? b.costMode as 'pct' | 'amount' : 'none'
  const costPct = costMode === 'pct' ? Math.min(100, money(b.costPct) ?? 0) : null
  const monthlyCost = costMode === 'amount' ? (money(b.monthlyCost) ?? 0) : costMode === 'pct' ? round2(monthlyRevenue * (costPct! / 100)) : null
  const monthlyProfit = monthlyCost == null ? null : round2(monthlyRevenue - monthlyCost)

  const structure = (CONTRACT_STRUCTURES as readonly string[]).includes(b.contractStructure) ? b.contractStructure : 'Per vehicle'
  const term = (CONTRACT_TERMS as readonly string[]).includes(b.contractTerm) ? b.contractTerm : 'Month-to-month'
  return {
    wonAt, services, calculatedMonthlyRevenue: calculated, revenueOverridden,
    monthlyRevenue, annualRevenue: round2(monthlyRevenue * 12),
    costMode, costPct, monthlyCost,
    monthlyProfit, annualProfit: monthlyProfit == null ? null : round2(monthlyProfit * 12),
    marginPct: monthlyProfit == null || !monthlyRevenue ? null : Math.round((monthlyProfit / monthlyRevenue) * 1000) / 10,
    contractStructure: structure, contractTerm: term,
    monthlyMinimum: structure === 'Per vehicle + monthly minimum' ? money(b.monthlyMinimum) : null,
    contractNotes: str(b.contractNotes, 2000),
    acquisitionSource: str(b.acquisitionSource, 80),
    attributionOverride: b.attributionTemplateId || b.attributionCampaignId
      ? { templateId: str(b.attributionTemplateId, 64) || null, campaignId: str(b.attributionCampaignId, 64) || null }
      : null,
  }
}

/**
 * Everything that can be worked out from the relationship history, as of `asOf`.
 * Template credit: the email credited with the win (outcomes.won) → else the most recent replied
 * email → else the first email sent (first touch). Read-only.
 */
export async function wonAttribution(db: Db, dealershipId: string, asOf: string = new Date().toISOString()) {
  const end = asOf.length === 10 ? `${asOf}T23:59:59.999Z` : asOf
  const ix = await db.collection(INTERACTIONS).find(
    { dealershipId, voidedAt: null, occurredAt: { $lte: end } },
    { projection: { type: 1, occurredAt: 1, source: 1 } },
  ).sort({ occurredAt: 1 }).toArray()
  const contact = ix.filter(i => CONTACT_TYPES.includes(i.type))
  const first = contact[0] || null
  const touches = ix.filter(i => TOUCH_TYPES.includes(i.type))
  const count = (types: string[]) => touches.filter(i => types.includes(i.type)).length

  const emails = db.collection(EMAILS)
  const proj = { projection: { templateId: 1, templateName: 1, templateVersion: 1, templateVersionLabel: 1, campaignId: 1, campaignName: 1, sentAt: 1, subject: 1 } }
  const base = { dealershipId, direction: 'outbound', status: { $ne: 'failed' }, sentAt: { $lte: end } }
  let model: 'credited' | 'replied' | 'first_email' | 'none' = 'credited'
  let email = await emails.find({ ...base, 'outcomes.won': { $ne: null } }, proj).sort({ sentAt: -1 }).limit(1).next()
  if (!email) { model = 'replied'; email = await emails.find({ ...base, repliedAt: { $ne: null } }, proj).sort({ sentAt: -1 }).limit(1).next() }
  if (!email) { model = 'first_email'; email = await emails.find(base, proj).sort({ sentAt: 1 }).limit(1).next() }
  if (!email) model = 'none'

  return {
    firstTouch: first ? { type: first.type, label: TYPE_LABEL[first.type] || first.type, channel: CHANNEL[first.type] || 'Other', at: first.occurredAt } : null,
    firstContactAt: first?.occurredAt || null,
    touches: {
      total: touches.length,
      emails: count(['email_sent']),
      calls: count(['phone_call', 'connected_call', 'voicemail', 'text_message']),
      visits: count(['walk_in', 'conversation']),
      meetings: count(['meeting_scheduled', 'meeting_completed']),
      other: count(['proposal_sent', 'follow_up']),
    },
    template: email && email.templateId ? { id: email.templateId, name: email.templateName || '', version: email.templateVersionLabel || '', subject: email.subject || '' } : null,
    campaign: email && email.campaignId ? { id: email.campaignId, name: email.campaignName || '' } : null,
    model: email && (email.templateId || email.campaignId) ? model : 'none' as const,
  }
}

async function resolveOverride(db: Db, o: { templateId: string | null, campaignId: string | null }) {
  const get = async (col: string, id: string | null) => (id && ObjectId.isValid(id)) ? db.collection(col).findOne({ _id: new ObjectId(id) }, { projection: { name: 1 } }) : null
  const [t, c] = await Promise.all([get('turboCleanCrmEmailTemplates', o.templateId), get('turboCleanCrmEmailCampaigns', o.campaignId)])
  return {
    template: t ? { id: t._id.toString(), name: t.name || '', version: '', subject: '' } : null,
    campaign: c ? { id: c._id.toString(), name: c.name || '' } : null,
  }
}

/** Create or replace the win for a dealership (one live record per dealership). */
export async function saveWin(db: Db, dealershipId: string, body: any, actor: SessionActor | null) {
  if (!ObjectId.isValid(dealershipId)) throw createError({ statusCode: 400, statusMessage: 'Invalid dealership' })
  const d = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: new ObjectId(dealershipId) })
  if (!d) throw createError({ statusCode: 404, statusMessage: 'Dealership not found' })
  if (d.stage !== 'Won' && !d.dealerId) throw createError({ statusCode: 409, statusMessage: 'Mark the dealership as won first' })
  const input = parseWonInput(body)
  const auto = await wonAttribution(db, dealershipId, input.wonAt)
  const override = input.attributionOverride ? await resolveOverride(db, input.attributionOverride) : null
  const now = new Date().toISOString()
  const who = actor ? { id: actor.id, name: actor.name } : { id: 'system', name: 'System' }
  const { attributionOverride: _o, ...fields } = input
  const doc = {
    dealershipId, dealershipCode: d.dealershipId || '', dealershipName: d.name || '', dealerId: d.dealerId || null,
    ...fields,
    acquisitionSource: fields.acquisitionSource || d.leadSource || '',
    firstTouch: auto.firstTouch, firstContactAt: auto.firstContactAt, touches: auto.touches,
    daysToClose: daysBetween(auto.firstContactAt, `${input.wonAt}T12:00:00.000Z`),
    attribution: override
      ? { template: override.template, campaign: override.campaign, model: 'manual' as const, auto: { template: auto.template, campaign: auto.campaign, model: auto.model } }
      : { template: auto.template, campaign: auto.campaign, model: auto.model, auto: null },
    ownerId: d.assignedUserId || '', ownerName: d.assignedUserName || '',
    dealerGroup: d.dealerGroup || '', brands: d.brands || [], state: d.state || '', city: d.city || '', territory: d.territory || '',
    revertedAt: null as string | null,
    updatedAt: now, updatedBy: who,
  }
  const col = db.collection(WON_COLLECTION)
  const existing = await col.find({ dealershipId, revertedAt: null }).sort({ createdAt: -1 }).limit(1).next()
  if (existing) await col.updateOne({ _id: existing._id }, { $set: doc })
  else await col.insertOne({ ...doc, createdAt: now, createdBy: who })
  // Keep the dealership summary (and template experiments' "contract value") in step.
  await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: d._id }, { $set: {
    contractValue: doc.annualRevenue, wonAt: doc.wonAt, wonMonthlyRevenue: doc.monthlyRevenue, wonAnnualProfit: doc.annualProfit, updatedAt: now,
  } })
  return getWin(db, dealershipId)
}

export function serializeWin(w: any) {
  if (!w) return null
  const { _id, ...rest } = w
  return { id: _id.toString(), ...rest }
}

export async function getWin(db: Db, dealershipId: string) {
  return serializeWin(await db.collection(WON_COLLECTION).find({ dealershipId, revertedAt: null }).sort({ createdAt: -1 }).limit(1).next())
}

/** Win undone (dealer deleted, stage moved off Won): keep the record, mark it reverted. */
export async function markWinReverted(db: Db, dealershipId: string, at: Date) {
  await db.collection(WON_COLLECTION).updateMany({ dealershipId, revertedAt: null }, { $set: { revertedAt: at.toISOString() } })
}

/** Remove deal details recorded by mistake: the record is kept (reverted) and the dealership summary cleared. */
export async function removeWin(db: Db, dealershipId: string) {
  if (!ObjectId.isValid(dealershipId)) throw createError({ statusCode: 400, statusMessage: 'Invalid dealership' })
  await markWinReverted(db, dealershipId, new Date())
  await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: new ObjectId(dealershipId) }, { $set: { contractValue: null, wonAt: null, wonMonthlyRevenue: null, wonAnnualProfit: null, updatedAt: new Date().toISOString() } })
  return { ok: true }
}

/** Dealer service rows from the services sold (used to seed the new dealer's price list). */
export function dealerServicesFromWin(services: WonService[], tax: { isTaxApplied?: boolean, taxPercentage?: number }) {
  const pct = tax.isTaxApplied ? Number(tax.taxPercentage) || 0 : 0
  return services.filter(s => s.serviceId && ObjectId.isValid(s.serviceId)).map((s) => {
    const t = round2(s.price * pct / 100)
    return { id: new ObjectId().toString(), service: s.serviceId, amount: s.price, tax: t, total: round2(s.price + t) }
  })
}

/** Invoiced to date (pre-tax) per dealer id — the real money, next to the estimate. */
export async function invoicedByDealer(db: Db, dealerIds: string[]) {
  const ids = [...new Set(dealerIds.filter(Boolean))]
  if (!ids.length) return new Map<string, number>()
  const rows = await db.collection('turboCleanInvoices').aggregate([
    { $match: { dealerId: { $in: [...ids, ...ids.filter(x => ObjectId.isValid(x)).map(x => new ObjectId(x))] } } },
    { $group: { _id: { $toString: '$dealerId' }, total: { $sum: { $ifNull: ['$subtotal', { $ifNull: ['$total', 0] }] } } } },
  ]).toArray()
  return new Map(rows.map(r => [String(r._id), round2(Number(r.total) || 0)]))
}

/** Won-deal report: return from prospecting, sliced by source, first touch, template, campaign, owner… */
export async function wonReport(db: Db, q: { from?: string, to?: string, ownerId?: string, includeReverted?: boolean }) {
  const match: any = {}
  if (q.from || q.to) match.wonAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) }
  if (q.ownerId) match.ownerId = q.ownerId
  if (!q.includeReverted) match.revertedAt = null
  const wins = (await db.collection(WON_COLLECTION).find(match).sort({ wonAt: -1 }).toArray()).map(serializeWin) as any[]

  // Won before this tracking existed: in Won with a dealer, but no record — listed so they can be completed.
  const recorded = new Set((await db.collection(WON_COLLECTION).find({ revertedAt: null }, { projection: { dealershipId: 1 } }).toArray()).map(w => String(w.dealershipId)))
  const missing = (await db.collection(CRM_COLLECTIONS.dealerships).find({ stage: 'Won', archivedAt: null }, { projection: { name: 1, dealershipId: 1, convertedAt: 1, assignedUserId: 1, assignedUserName: 1, leadSource: 1, dealerId: 1 } }).toArray())
    .filter(d => !recorded.has(d._id.toString()) && (!q.ownerId || d.assignedUserId === q.ownerId))
    .map(d => ({ dealershipId: d._id.toString(), dealershipCode: d.dealershipId || '', dealershipName: d.name || '', convertedAt: d.convertedAt || null, ownerName: d.assignedUserName || '', leadSource: d.leadSource || '', dealerId: d.dealerId || null }))

  const invoiced = await invoicedByDealer(db, wins.map(w => w.dealerId))
  for (const w of wins) w.invoicedToDate = w.dealerId ? (invoiced.get(String(w.dealerId)) || 0) : 0

  const sum = (list: any[], k: string) => round2(list.reduce((a, w) => a + (Number(w[k]) || 0), 0))
  const avg = (xs: number[]) => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null
  const withProfit = wins.filter(w => w.annualProfit != null)
  const group = (key: (w: any) => string) => {
    const m = new Map<string, any[]>()
    for (const w of wins) { const k = key(w) || '—'; m.set(k, [...(m.get(k) || []), w]) }
    return [...m.entries()].map(([k, list]) => ({
      key: k, count: list.length, monthlyRevenue: sum(list, 'monthlyRevenue'), annualRevenue: sum(list, 'annualRevenue'),
      annualProfit: list.some(w => w.annualProfit != null) ? sum(list.filter(w => w.annualProfit != null), 'annualProfit') : null,
      avgAnnualRevenue: list.length ? round2(sum(list, 'annualRevenue') / list.length) : 0,
      avgDaysToClose: avg(list.map(w => w.daysToClose).filter((x: any) => x != null)),
      avgTouches: avg(list.map(w => w.touches?.total).filter((x: any) => x != null)),
    })).sort((a, b) => b.annualRevenue - a.annualRevenue || b.count - a.count)
  }
  const serviceRows = new Map<string, { key: string, count: number, monthlyRevenue: number, volume: number }>()
  for (const w of wins) for (const s of w.services || []) {
    const r = serviceRows.get(s.name) || { key: s.name, count: 0, monthlyRevenue: 0, volume: 0 }
    r.count++; r.monthlyRevenue = round2(r.monthlyRevenue + s.monthlyRevenue); r.volume += s.monthlyVolume
    serviceRows.set(s.name, r)
  }

  return {
    total: wins.length,
    monthlyRevenue: sum(wins, 'monthlyRevenue'),
    annualRevenue: sum(wins, 'annualRevenue'),
    annualProfit: withProfit.length ? sum(withProfit, 'annualProfit') : null,
    profitKnown: withProfit.length,
    invoicedToDate: round2(wins.reduce((a, w) => a + (w.invoicedToDate || 0), 0)),
    avgDaysToClose: avg(wins.map(w => w.daysToClose).filter((x: any) => x != null)),
    avgTouches: avg(wins.map(w => w.touches?.total).filter((x: any) => x != null)),
    avgEmails: avg(wins.map(w => w.touches?.emails).filter((x: any) => x != null)),
    bySource: group(w => w.acquisitionSource),
    byFirstTouch: group(w => w.firstTouch?.channel || 'Unknown'),
    byTemplate: group(w => w.attribution?.template ? `${w.attribution.template.name}${w.attribution.template.version ? ` · ${w.attribution.template.version}` : ''}` : 'No email credited'),
    byCampaign: group(w => w.attribution?.campaign?.name || 'No campaign'),
    byOwner: group(w => w.ownerName || 'Unassigned'),
    byStructure: group(w => w.contractStructure),
    byMonth: group(w => (w.wonAt || '').slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key)),
    byService: [...serviceRows.values()].sort((a, b) => b.monthlyRevenue - a.monthlyRevenue),
    wins,
    missing,
  }
}
