/**
 * CRM domain helpers — Dealerships, Contacts, Activity.
 *
 * Design principles
 *  - A dealership is a permanent record. It is archived, never hard-deleted.
 *  - Contacts live in their own collection so a person's history survives
 *    staff changes. A contact is marked inactive and (optionally) linked to a
 *    successor; it is never deleted or overwritten.
 *  - Every mutation writes an immutable activity entry (who / what / when).
 */
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import { normalizePhone } from './crm-normalize'
import { connectToDatabase } from './mongodb'

export const CRM_COLLECTIONS = {
  dealerships: 'turboCleanCrmDealerships',
  contacts: 'turboCleanCrmContacts',
  activity: 'turboCleanCrmActivity',
  counters: 'turboCleanCounters',
  stageHistory: 'turboCleanCrmStageHistory',
} as const

export const LEAD_SOURCES = [
  'Manual research',
  'Cold email',
  'Cold call',
  'Walk-in',
  'Referral',
  'Existing client introduction',
  'Dealer group relationship',
  'Website/inbound',
  'Other',
] as const

export const CONTACT_ROLES = [
  'Owner',
  'Dealer Principal',
  'General Manager',
  'General Sales Manager',
  'Used Car Manager',
  'Fixed Operations Director',
  'Service Manager',
  'Internet/BDC Manager',
  'Controller/CFO',
  'Other',
] as const

export const DEALERSHIP_STAGES = [
  'Research Needed', 'Researched', 'Ready to Contact', 'Outreach Active', 'Replied', 'Conversation',
  'Meeting Scheduled', 'Meeting Completed', 'Opportunity', 'Proposal Sent', 'Negotiating',
  'Won', 'Lost', 'Nurture / Follow Up Later',
] as const
/** Open-funnel stages in order (everything before Won). */
export const OPEN_STAGE_ORDER: readonly string[] = DEALERSHIP_STAGES.slice(0, DEALERSHIP_STAGES.indexOf('Won'))
export const DEFAULT_STAGE = 'Research Needed'
/** Winning the account promotes it to an operational Dealer. */
export const WON_STAGE = 'Won'
/** Pre-pipeline stage names → their place in the 14-stage pipeline. */
export const LEGACY_STAGE_MAP: Record<string, string> = {
  Prospect: 'Research Needed',
  Engaged: 'Conversation',
  Customer: 'Won',
  Dormant: 'Nurture / Follow Up Later',
}
export function normalizeStage(v: unknown): string {
  const s = String(v ?? '')
  return LEGACY_STAGE_MAP[s] || s
}
export const CONTACT_METHODS = ['email', 'phone', 'mobile', 'text', 'in-person'] as const

export type LeadSource = typeof LEAD_SOURCES[number]
export type ContactRole = typeof CONTACT_ROLES[number]
export type DealershipStage = typeof DEALERSHIP_STAGES[number]

export interface SessionActor { id: string, name: string, email: string }

let _indexesEnsured = false
export async function getCrmDb(): Promise<Db> {
  const { db } = await connectToDatabase()
  if (!_indexesEnsured) {
    _indexesEnsured = true
    try {
      await Promise.all([
        db.collection(CRM_COLLECTIONS.dealerships).createIndex({ dealershipId: 1 }, { unique: true }),
        db.collection(CRM_COLLECTIONS.dealerships).createIndex({ name: 1 }),
        db.collection(CRM_COLLECTIONS.dealerships).createIndex({ archivedAt: 1, updatedAt: -1 }),
        db.collection(CRM_COLLECTIONS.contacts).createIndex({ dealershipId: 1, isActive: 1 }),
        db.collection(CRM_COLLECTIONS.contacts).createIndex({ email: 1 }),
        db.collection(CRM_COLLECTIONS.activity).createIndex({ dealershipId: 1, at: -1 }),
        db.collection('turboCleanCrmAudits').createIndex({ dealershipId: 1, auditedAt: -1 }),
        db.collection(CRM_COLLECTIONS.stageHistory).createIndex({ dealershipId: 1, changedAt: 1 }),
        db.collection(CRM_COLLECTIONS.stageHistory).createIndex({ toStage: 1, changedAt: -1 }),
      ])
    } catch (e) {
      console.warn('[CRM] index creation skipped:', (e as Error).message)
    }
    try {
      const { migrateToPipeline } = await import('./crm-stage')
      await migrateToPipeline(db)
    } catch (e) {
      console.error('[CRM] pipeline migration failed:', (e as Error).message)
    }
    try {
      const { migrateLegacyNotes } = await import('./crm-interactions')
      await migrateLegacyNotes(db)
    } catch (e) {
      console.error('[CRM] legacy note migration failed:', (e as Error).message)
    }
  }
  return db
}

/** Sequential, human-readable, immutable dealership IDs: DLR-00001 */
export async function nextDealershipId(db: Db): Promise<string> {
  const res = await db.collection(CRM_COLLECTIONS.counters).findOneAndUpdate(
    { _id: 'crmDealership' as any },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  )
  const seq = (res as any)?.seq ?? (res as any)?.value?.seq ?? 1
  return `DLR-${String(seq).padStart(5, '0')}`
}

export function toObjectId(id: string) {
  if (!ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  return new ObjectId(id)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function normalizeEmail(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase()
  if (s && !EMAIL_RE.test(s)) throw createError({ statusCode: 400, statusMessage: `Invalid email: ${s}` })
  return s
}
export function normalizeUrl(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}
export function str(v: unknown, max = 500): string {
  return String(v ?? '').trim().slice(0, max)
}
export function pick<T extends object>(obj: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {}
  for (const k of keys) if (k in obj) out[k] = obj[k]
  return out
}

export function serializeDealership(doc: any) {
  if (!doc) return null
  const { _id, ...rest } = doc
  return { id: _id.toString(), ...rest, stage: normalizeStage(rest.stage) }
}
export function serializeContact(doc: any) {
  if (!doc) return null
  const { _id, ...rest } = doc
  return { id: _id.toString(), ...rest, fullName: `${rest.firstName || ''} ${rest.lastName || ''}`.trim() }
}
export function serializeActivity(doc: any) {
  const { _id, ...rest } = doc
  return { id: _id.toString(), ...rest }
}

export type ActivityType =
  | 'dealership.created' | 'dealership.stage_changed' | 'dealership.updated' | 'dealership.archived' | 'dealership.restored'
  | 'contact.added' | 'contact.updated' | 'contact.deactivated' | 'contact.reactivated'
  | 'contact.handover' | 'contact.verified' | 'dealership.converted' | 'dealership.reverted' | 'audit.recorded' | 'note'
  | 'interaction.updated' | 'interaction.voided' | 'interaction.restored'
  | 'email.bounced' | 'email.complained' | 'email.reply_classified' | 'email.outcome_updated'
  | 'automation.action'

export async function logActivity(db: Db, entry: {
  dealershipId: string
  contactId?: string | null
  type: ActivityType
  message: string
  changes?: Record<string, { from: any, to: any }>
  actor: SessionActor | null
}) {
  await db.collection(CRM_COLLECTIONS.activity).insertOne({
    dealershipId: entry.dealershipId,
    contactId: entry.contactId ?? null,
    type: entry.type,
    message: entry.message,
    changes: entry.changes ?? null,
    actor: entry.actor ? { id: entry.actor.id, name: entry.actor.name, email: entry.actor.email } : { id: 'system', name: 'System', email: '' },
    at: new Date().toISOString(),
  })
}

/** Shallow diff of selected keys → { key: {from,to} } (only changed keys). */
export function diffFields(before: any, after: any, keys: string[]) {
  const changes: Record<string, { from: any, to: any }> = {}
  for (const k of keys) {
    const a = before?.[k], b = after?.[k]
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) changes[k] = { from: a ?? null, to: b ?? null }
  }
  return changes
}

export function actorFromSession(session: any): SessionActor | null {
  if (!session) return null
  return { id: session.id, name: session.name || session.email, email: session.email }
}

function validEmail(e: string) {
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw createError({ statusCode: 400, statusMessage: 'That email address does not look valid' })
  return e
}
/** Normalises + validates a contact payload into a fresh roster document. */
export function buildContactDoc(body: any, dealershipId: string, actor: any) {
  const firstName = str(body.firstName, 80)
  const lastName = str(body.lastName, 80)
  if (!firstName && !lastName) throw createError({ statusCode: 400, statusMessage: 'Contact name is required' })
  const role = CONTACT_ROLES.includes(body.role) ? body.role : 'Other'
  const now = new Date().toISOString()
  return {
    dealershipId,
    firstName,
    lastName,
    role,
    jobTitle: str(body.jobTitle, 120) || (role !== 'Other' ? role : ''),
    email: validEmail(normalizeEmail(body.email)),
    phone: normalizePhone(body.phone),
    mobile: normalizePhone(body.mobile),
    preferredContactMethod: CONTACT_METHODS.includes(body.preferredContactMethod) ? body.preferredContactMethod : 'email',
    isPrimary: !!body.isPrimary,
    isActive: true,
    inactiveAt: null as string | null,
    inactiveReason: '',
    succeededById: null as string | null,
    precededById: body.precededById ? String(body.precededById) : null,
    addedAt: now,
    lastVerifiedAt: body.markVerified === false ? null : now,
    notes: str(body.notes, 4000),
    createdBy: actor,
    updatedAt: now,
  }
}

