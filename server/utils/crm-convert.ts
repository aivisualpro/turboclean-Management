/**
 * CRM → Operations hand-off.
 *
 * When a dealership is won (stage = Won) it is promoted into a real
 * Dealer record in `turboCleanDealers` — the same shape the rest of the ERP
 * (services, work orders, invoices, AppSheet sync) already understands.
 *
 * Guarantees
 *  - Idempotent: converting twice returns the existing dealer.
 *  - Linked both ways: dealership.dealerId ↔ dealer.crmDealershipId.
 *  - Active CRM contacts are carried over into the dealer's contact list.
 *  - Mirrors `POST /api/dealers` exactly (AppSheet sync, user permissions).
 */
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import { nanoid } from 'nanoid'
import { appSheetAdd } from './appsheet'
import { CRM_COLLECTIONS, WON_STAGE, actorFromSession, logActivity, normalizeStage } from './crm'
import { recordStageChange } from './crm-stage'
import type { StageChangeSource } from './crm-stage'

export interface ConvertOptions {
  status?: 'Authorised' | 'Pending' | 'In Followup'
  isTaxApplied?: boolean
  taxPercentage?: number
  copyServicesFromDealerId?: string
  duplicateStock?: boolean
  notes?: string
  /** Price list for the new dealer (from the services sold at win) when not copying another dealer's. */
  services?: any[]
}

export interface ConvertResult {
  dealerId: string
  created: boolean
  contactsCarried: number
  servicesCopied: number
}

function phoneType(v: string): 'mobile' | 'landline' { return v ? 'landline' : 'mobile' }

/** Map CRM contacts (one doc per person) → dealer contact subdocs. */
export function mapCrmContactsToDealer(contacts: any[]) {
  const active = contacts.filter(c => c.isActive !== false)
  // Primary first so legacy `phone` / `email` fields on the dealer pick it up.
  active.sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary))
  return active.map((c) => {
    const phones: { id: string, number: string, type: 'mobile' | 'landline' | 'fax' }[] = []
    if (c.mobile) phones.push({ id: nanoid(6), number: c.mobile, type: 'mobile' })
    if (c.phone) phones.push({ id: nanoid(6), number: c.phone, type: 'landline' })
    const pref = c.preferredContactMethod
    return {
      id: nanoid(8),
      name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
      designation: c.jobTitle || c.role || '',
      phones,
      emails: c.email ? [c.email] : [],
      preferredContactMethod: pref === 'email' ? 'email' : (pref === 'phone' || pref === 'mobile' || pref === 'text') ? 'phone' : 'any',
      receiveInvoices: !!c.isPrimary,
      crmContactId: c._id?.toString?.() || c.id || null,
    }
  })
}

export async function convertDealershipToDealer(db: Db, dealership: any, opts: ConvertOptions, session: any, meta: { source?: StageChangeSource } = {}): Promise<ConvertResult> {
  const dealers = db.collection('turboCleanDealers')
  const dealershipId = dealership._id.toString()

  // Idempotency — already converted and the dealer still exists.
  if (dealership.dealerId && ObjectId.isValid(dealership.dealerId)) {
    const existing = await dealers.findOne({ _id: new ObjectId(dealership.dealerId) }, { projection: { _id: 1 } })
    if (existing) return { dealerId: dealership.dealerId, created: false, contactsCarried: 0, servicesCopied: 0 }
  }

  const crmContacts = await db.collection(CRM_COLLECTIONS.contacts).find({ dealershipId }).toArray()
  const contacts = mapCrmContactsToDealer(crmContacts)

  // Optional: clone the service catalogue of an existing dealer.
  let services: any[] = []
  if (opts.copyServicesFromDealerId && ObjectId.isValid(opts.copyServicesFromDealerId)) {
    const src = await dealers.findOne({ _id: new ObjectId(opts.copyServicesFromDealerId) }, { projection: { services: 1 } })
    services = (src?.services || []).map((s: any) => ({ ...s, id: new ObjectId().toString() }))
  }
  else if (opts.services?.length) services = opts.services

  const address = [dealership.address, [dealership.city, dealership.state].filter(Boolean).join(', '), dealership.zip].filter(Boolean).join(', ')
  const now = new Date()
  const newDealer: Record<string, any> = {
    dealer: dealership.name,
    address,
    contacts,
    status: opts.status || 'Authorised',
    isTaxApplied: !!opts.isTaxApplied,
    taxPercentage: opts.isTaxApplied ? Number(opts.taxPercentage) || 0 : 0,
    services,
    DuplicateStock: !!opts.duplicateStock,
    notes: opts.notes ?? dealership.notes ?? '',
    phone: contacts[0]?.phones?.[0]?.number || dealership.phone || '',
    email: contacts[0]?.emails?.[0] || '',
    // CRM provenance
    crmDealershipId: dealershipId,
    crmDealershipCode: dealership.dealershipId,
    leadSource: dealership.leadSource || '',
    dealerGroup: dealership.dealerGroup || '',
    brands: dealership.brands || [],
    website: dealership.website || '',
    territory: dealership.territory || '',
    assignedUserId: dealership.assignedUserId || '',
    assignedUserName: dealership.assignedUserName || '',
    convertedFromCrmAt: now,
    createdAt: now,
    updatedAt: now,
  }

  const result = await dealers.insertOne(newDealer)
  const dealerId = result.insertedId.toString()

  // Permissions: creator can see the dealer (mirrors POST /api/dealers).
  if (session?.id && ObjectId.isValid(session.id)) {
    await db.collection('turboCleanAppUsers').updateOne({ _id: new ObjectId(session.id) }, { $addToSet: { registerDealers: dealerId } }).catch(() => {})
  }

  // Link back + stamp the CRM record.
  const actor = actorFromSession(session)
  const fromStage = normalizeStage(dealership.stage)
  await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: dealership._id }, { $set: {
    stage: WON_STAGE, dealerId, convertedAt: now.toISOString(), convertedBy: actor, updatedAt: now.toISOString(),
    // Remembered so a deleted dealer can return the record to where it was.
    stageBeforeConversion: fromStage && fromStage !== WON_STAGE ? fromStage : 'Negotiating',
  } })
  if (fromStage !== WON_STAGE)
    await recordStageChange(db, { dealership, fromStage: fromStage || null, toStage: WON_STAGE, actor, source: meta.source || 'convert', at: now, note: 'Won — promoted to Dealer' })
  await logActivity(db, {
    dealershipId, type: 'dealership.converted', actor,
    message: `Won — promoted to Dealer${contacts.length ? ` with ${contacts.length} contact${contacts.length === 1 ? '' : 's'}` : ''}${services.length ? ` and ${services.length} services` : ''}`,
    changes: { stage: { from: fromStage, to: WON_STAGE }, dealer: { from: null, to: dealership.name } },
  })
  // Relationship history: winning is a "Contract won" touch — unless one was just logged by hand.
  try {
    const { INTERACTIONS_COLLECTION, createInteraction } = await import('./crm-interactions')
    const recent = await db.collection(INTERACTIONS_COLLECTION).findOne({ dealershipId, type: 'contract_won', voidedAt: null, createdAt: { $gte: new Date(now.getTime() - 30 * 60_000).toISOString() } })
    if (!recent) {
      await createInteraction(db, dealership, {
        type: 'contract_won',
        notes: `Promoted to Dealers${contacts.length ? ` with ${contacts.length} contact${contacts.length === 1 ? '' : 's'}` : ''}${services.length ? ` and ${services.length} services` : ''}.`,
        outcome: 'Won — now an operational dealer',
        refs: { dealerId },
      }, actor, 'conversion')
    }
  } catch (e) { console.error('[CRM] convert → interaction failed:', (e as Error).message) }

  // AppSheet sync — best effort, never blocks the conversion.
  const rows = [{
    _id: dealerId, dealer: newDealer.dealer, address: newDealer.address, status: newDealer.status,
    isTaxApplied: newDealer.isTaxApplied ? 'Y' : 'N', taxPercentage: newDealer.taxPercentage,
    phone: newDealer.phone, email: newDealer.email, notes: newDealer.notes, DuplicateStock: newDealer.DuplicateStock ? 'Y' : 'N',
  }]
  await appSheetAdd('Dealers', rows).catch(e => console.error('[CRM convert] AppSheet Dealers ADD failed:', e?.message))
  if (services.length) {
    const serviceRows = services.map((s: any) => ({ _id: s.id, dealer: dealerId, service: s.service || '', Amount: Number(s.amount) || 0, Tax: Number(s.tax) || 0, Total: Number(s.total) || 0 }))
    await appSheetAdd('DealerServices', serviceRows).catch(e => console.error('[CRM convert] AppSheet DealerServices ADD failed:', e?.message))
  }

  return { dealerId, created: true, contactsCarried: contacts.length, servicesCopied: services.length }
}
