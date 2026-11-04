/**
 * Batch scanning — "scrape these N dealerships, then email them".
 *
 * A batch is a stored to-do list (turboCleanScannerBatches): one item per dealership with the pages
 * to scan (the dealership's saved scan pages, or its website). The browser that opened the console
 * drives it: it claims items one at a time (`claimNext`, atomic), runs each as a normal streaming
 * scan (`/api/scanner/run` with batchId + autoSave) and the scan reports back here when it ends.
 * Because every item is claimed through the database, the console can be closed and resumed — from
 * any browser — and two tabs never scan the same dealership twice.
 *
 * Email step: after the scans, one template for everyone (or a different one per dealership) is
 * sent through the normal CRM send (full tracking, template credit) — right now, or queued for the
 * next sending window via the approval queue (already approved).
 */
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import type { SessionActor } from './crm'
import { CRM_COLLECTIONS, str } from './crm'
import { safeUrl } from './scanner-session'

export const BATCHES_COLLECTION = 'turboCleanScannerBatches'
export type ItemStatus = 'queued' | 'running' | 'done' | 'stopped' | 'failed' | 'skipped' | 'cancelled'

export interface BatchItem {
  dealershipId: string
  name: string
  website: string
  urls: string[]
  status: ItemStatus
  scanId: string | null
  auditId: string | null
  summary: { total: number, withoutReal: number, withoutRealPct: number | null, by?: Record<string, number> } | null
  error: string | null
  claimedAt: string | null
  finishedAt: string | null
  email: { mode: 'now' | 'queue', status: 'sent' | 'queued' | 'failed' | 'skipped', emailId?: string | null, draftId?: string | null, to?: string, subject?: string, templateName?: string, error?: string | null, at: string } | null
  /** Set when a stopped scan is queued again: the new scan continues from this one (keeps its vehicles). */
  resumeFrom?: string | null
  /** How many times this dealership has been claimed (auto-retries stop at 3). */
  attempts?: number
}

const who = (a: SessionActor | null | undefined) => a ? { id: a.id, name: a.name } : null
const oid = (id: string) => { if (!ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' }); return new ObjectId(id) }

export function serializeBatch(b: any) {
  if (!b) return null
  const { _id, ...rest } = b
  const items: BatchItem[] = rest.items || []
  const n = (st: ItemStatus) => items.filter(i => i.status === st).length
  const done = items.filter(i => i.status === 'done' || i.status === 'stopped')
  return {
    id: _id.toString(), ...rest,
    counts: { total: items.length, queued: n('queued'), running: n('running'), done: n('done'), stopped: n('stopped'), failed: n('failed'), skipped: n('skipped'), cancelled: n('cancelled') },
    totals: {
      vehicles: done.reduce((a, i) => a + (i.summary?.total || 0), 0),
      withoutReal: done.reduce((a, i) => a + (i.summary?.withoutReal || 0), 0),
      emailed: items.filter(i => i.email?.status === 'sent' || i.email?.status === 'queued').length,
    },
    finished: items.every(i => i.status !== 'queued' && i.status !== 'running'),
  }
}

/** The pages a dealership's scan should cover: its saved scan pages, else its website. */
/** Only pages someone picked (or discovery verified) — a bare website is not scanned any more. */
export function pagesFor(d: any): string[] {
  return (Array.isArray(d?.scanPages) ? d.scanPages : []).map((p: any) => typeof p === 'string' ? p : p?.url).filter(Boolean)
}

export async function createBatch(db: Db, body: any, actor: SessionActor) {
  const ids = (Array.isArray(body?.dealershipIds) ? body.dealershipIds : []).map((x: any) => String(x)).filter((x: string) => ObjectId.isValid(x)).slice(0, 200)
  if (!ids.length) throw createError({ statusCode: 400, statusMessage: 'Pick at least one dealership' })
  const overrides: Record<string, string[]> = body?.pages && typeof body.pages === 'object' ? body.pages : {}
  const docs = await db.collection(CRM_COLLECTIONS.dealerships).find({ _id: { $in: ids.map((i: string) => new ObjectId(i)) } }).toArray()
  const byId = new Map(docs.map(d => [d._id.toString(), d]))
  const now = new Date().toISOString()
  const items: BatchItem[] = ids.filter((id: string) => byId.has(id)).map((id: string) => {
    const d = byId.get(id)!
    const raw = (Array.isArray(overrides[id]) ? overrides[id]! : pagesFor(d)).map(u => str(u, 2000)).filter(Boolean).slice(0, 30)
    const urls: string[] = []
    for (const u of raw) { try { urls.push(safeUrl(u)) } catch {} }
    return {
      dealershipId: id, name: d.name || '', website: d.website || '', urls,
      status: urls.length ? 'queued' : 'skipped', scanId: null, auditId: null, summary: null,
      error: urls.length ? null : (d?.website ? 'No scan pages picked — detect or pick its inventory pages first' : 'No website on this dealership'), claimedAt: null, finishedAt: null, email: null,
    } as BatchItem
  })
  // Remember page lists typed in the console as the dealership's scan pages for next time.
  for (const [id, urls] of Object.entries(overrides)) {
    if (!byId.has(id) || !Array.isArray(urls)) continue
    const clean = urls.map(u => { try { return safeUrl(str(u, 2000)) } catch { return '' } }).filter(Boolean).slice(0, 30)
    if (clean.length) await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: new ObjectId(id) }, { $set: { scanPages: clean.map(url => ({ url, label: '' })), updatedAt: now } })
  }
  const doc = {
    name: str(body?.name, 120) || `${items.length} dealership${items.length === 1 ? '' : 's'} · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    status: 'running', items, concurrency: Math.min(3, Math.max(1, Number(body?.concurrency) || 2)), autoSave: body?.autoSave !== false,
    createdAt: now, createdBy: who(actor), updatedAt: now,
  }
  const r = await db.collection(BATCHES_COLLECTION).insertOne(doc)
  return serializeBatch({ _id: r.insertedId, ...doc })
}

export async function getBatch(db: Db, id: string) {
  const b = await db.collection(BATCHES_COLLECTION).findOne({ _id: oid(id) })
  if (!b) throw createError({ statusCode: 404, statusMessage: 'Batch not found' })
  // Items whose scan died silently (server cut off) → let the scan finalizer sort them out.
  const stale = (b.items as BatchItem[]).filter(i => i.status === 'running' && i.scanId && i.claimedAt && Date.now() - new Date(i.claimedAt).getTime() > 150_000)
  if (stale.length) {
    const { getScan } = await import('./scanner-session')
    for (const i of stale) await getScan(db, i.scanId!).catch(() => null)
    return serializeBatch(await db.collection(BATCHES_COLLECTION).findOne({ _id: b._id }))
  }
  return serializeBatch(b)
}

export async function listBatches(db: Db, limit = 12) {
  const rows = await db.collection(BATCHES_COLLECTION).find({}).sort({ createdAt: -1 }).limit(limit).toArray()
  return rows.map(serializeBatch)
}

/** Atomically take the next queued dealership (so two consoles never scan the same one). */
export async function claimNext(db: Db, id: string) {
  const now = new Date().toISOString()
  const r = await db.collection(BATCHES_COLLECTION).findOneAndUpdate(
    { _id: oid(id), 'items.status': 'queued' },
    { $set: { 'items.$.status': 'running', 'items.$.claimedAt': now, updatedAt: now }, $inc: { 'items.$.attempts': 1 } },
    { returnDocument: 'after' },
  )
  if (!r) return { item: null, batch: await getBatch(db, id) }
  const item = (r.items as BatchItem[]).find(i => i.status === 'running' && i.claimedAt === now) || null
  return { item, batch: serializeBatch(r) }
}

export async function updateBatchItem(db: Db, batchId: string, dealershipId: string, patch: Partial<BatchItem>) {
  if (!ObjectId.isValid(batchId)) return
  const now = new Date().toISOString()
  const $set: Record<string, any> = { updatedAt: now }
  for (const [k, v] of Object.entries(patch)) $set[`items.$.${k}`] = v
  if (patch.status && ['done', 'stopped', 'failed', 'cancelled'].includes(patch.status)) $set['items.$.finishedAt'] = now
  await db.collection(BATCHES_COLLECTION).updateOne({ _id: new ObjectId(batchId), 'items.dealershipId': dealershipId }, { $set })
  const b = await db.collection(BATCHES_COLLECTION).findOne({ _id: new ObjectId(batchId) }, { projection: { items: 1 } })
  if (b && (b.items as BatchItem[]).every(i => i.status !== 'queued' && i.status !== 'running')) await db.collection(BATCHES_COLLECTION).updateOne({ _id: b._id }, { $set: { status: 'done', finishedAt: now } })
}

/** Re-queue one dealership (retry a failed / skipped item, optionally with new pages). */
export async function requeueItem(db: Db, batchId: string, dealershipId: string, urls?: string[], opts: { resume?: boolean } = {}) {
  const clean = (urls || []).map(u => { try { return safeUrl(str(u, 2000)) } catch { return '' } }).filter(Boolean).slice(0, 30)
  const current = await db.collection(BATCHES_COLLECTION).findOne({ _id: oid(batchId) }, { projection: { items: 1 } })
  const item = ((current?.items || []) as BatchItem[]).find(i => i.dealershipId === dealershipId)
  // A paused / interrupted scan picks up where it left off (also a crash, when asked); a failed one starts clean.
  const resumeFrom = item && (item.status === 'stopped' || opts.resume) && item.scanId ? item.scanId : null
  const patch: Partial<BatchItem> = { status: 'queued', scanId: null, auditId: null, summary: null, error: null, claimedAt: null, finishedAt: null, email: null, resumeFrom }
  if (clean.length) patch.urls = clean
  await updateBatchItem(db, batchId, dealershipId, patch)
  await db.collection(BATCHES_COLLECTION).updateOne({ _id: oid(batchId) }, { $set: { status: 'running' } })
  return getBatch(db, batchId)
}

/** Stop: queued items are cancelled; running scans are asked to stop (they keep what they found). */
export async function cancelBatch(db: Db, id: string) {
  const b = await db.collection(BATCHES_COLLECTION).findOne({ _id: oid(id) })
  if (!b) throw createError({ statusCode: 404, statusMessage: 'Batch not found' })
  const now = new Date().toISOString()
  const items = (b.items as BatchItem[]).map(i => i.status === 'queued' ? { ...i, status: 'cancelled' as ItemStatus, finishedAt: now } : i)
  await db.collection(BATCHES_COLLECTION).updateOne({ _id: b._id }, { $set: { items, status: items.some(i => i.status === 'running') ? 'running' : 'done', updatedAt: now } })
  const { requestStop } = await import('./scanner-session')
  for (const i of items) if (i.status === 'running' && i.scanId) await requestStop(db, i.scanId).catch(() => {})
  return getBatch(db, id)
}

// ───────────────────────── Email step ─────────────────────────
/** Everything the email step needs: contacts, last email, latest audit numbers per dealership. */
export async function batchEmailContext(db: Db, id: string) {
  const b = await getBatch(db, id)
  const ids = b!.items.map((i: BatchItem) => i.dealershipId)
  const oids = ids.map((x: string) => new ObjectId(x))
  const [contacts, lastEmails, dealers] = await Promise.all([
    db.collection(CRM_COLLECTIONS.contacts).find({ dealershipId: { $in: ids }, isActive: { $ne: false } }).toArray(),
    db.collection('turboCleanCrmEmails').aggregate([
      { $match: { dealershipId: { $in: ids }, direction: 'outbound', status: { $ne: 'failed' } } },
      { $sort: { sentAt: -1 } },
      { $group: { _id: '$dealershipId', subject: { $first: '$subject' }, sentAt: { $first: '$sentAt' }, toEmail: { $first: '$toEmail' }, templateName: { $first: '$templateName' }, repliedAt: { $first: '$repliedAt' } } },
    ]).toArray(),
    db.collection(CRM_COLLECTIONS.dealerships).find({ _id: { $in: oids } }, { projection: { name: 1, stage: 1, city: 1, state: 1, lastAuditAt: 1 } }).toArray(),
  ])
  const { pickEmailContact } = await import('./automation-research')
  const byDealer = new Map<string, any[]>()
  for (const c of contacts) byDealer.set(c.dealershipId, [...(byDealer.get(c.dealershipId) || []), c])
  const last = new Map(lastEmails.map(e => [e._id, e]))
  const dmap = new Map(dealers.map(d => [d._id.toString(), d]))
  return {
    batch: b,
    dealers: ids.map((id: string) => {
      const cs = byDealer.get(id) || []
      const best = pickEmailContact(cs)
      const d = dmap.get(id)
      const le = last.get(id)
      return {
        dealershipId: id, stage: d?.stage || '', city: d?.city || '', state: d?.state || '',
        contacts: cs.filter(c => c.email).map(c => ({ id: c._id.toString(), name: `${c.firstName || ''} ${c.lastName || ''}`.trim(), email: c.email, title: c.jobTitle || c.role || '', doNotEmail: !!c.doNotEmail, bounced: !!c.emailBouncedAt, isPrimary: !!c.isPrimary })),
        bestContactId: best ? best._id.toString() : null,
        lastEmail: le ? { subject: le.subject, sentAt: le.sentAt, to: le.toEmail, templateName: le.templateName, replied: !!le.repliedAt } : null,
      }
    }),
  }
}

export interface SendAssignment { dealershipId: string, templateId: string, contactId?: string | null, mode?: 'now' | 'queue', allowDuplicate?: boolean }

/** Send (or queue) one email per dealership with the chosen template. Never throws for one dealer's failure. */
export async function sendBatchEmails(db: Db, id: string, assignments: SendAssignment[], actor: SessionActor) {
  const b = await db.collection(BATCHES_COLLECTION).findOne({ _id: oid(id) })
  if (!b) throw createError({ statusCode: 404, statusMessage: 'Batch not found' })
  const { sendCrmEmail, pickVariants, previewCrmEmail } = await import('./crm-email')
  const { pickEmailContact } = await import('./automation-research')
  const { automationDb } = await import('./automation')
  const results: any[] = []
  for (const a of (assignments || []).slice(0, 200)) {
    const item = (b.items as BatchItem[]).find(i => i.dealershipId === a.dealershipId)
    if (!item || !ObjectId.isValid(a.dealershipId) || !ObjectId.isValid(String(a.templateId || ''))) continue
    const at = new Date().toISOString()
    const fail = async (error: string) => {
      const email = { mode: a.mode === 'queue' ? 'queue' as const : 'now' as const, status: 'failed' as const, error, at }
      await updateBatchItem(db, id, a.dealershipId, { email })
      results.push({ dealershipId: a.dealershipId, name: item.name, ...email })
    }
    try {
      const d = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: new ObjectId(a.dealershipId) })
      if (!d) { await fail('Dealership not found'); continue }
      const contacts = await db.collection(CRM_COLLECTIONS.contacts).find({ dealershipId: a.dealershipId, isActive: { $ne: false } }).toArray()
      const contact = a.contactId && ObjectId.isValid(a.contactId) ? contacts.find(c => c._id.toString() === a.contactId) : pickEmailContact(contacts)
      if (!contact?.email) { await fail('No contact with an email address') ; continue }
      if (contact.doNotEmail) { await fail(`${contact.email} asked not to be emailed`); continue }
      const picked = await pickVariants(db, String(a.templateId))
      if (!picked.version || !picked.subject) { await fail('Template has no active version / subject line'); continue }
      if (a.mode === 'queue') {
        // Approved draft → the sender job sends it inside sending hours, under the daily limit.
        const { drafts } = await automationDb(db)
        const p = await previewCrmEmail(db, d, { contactId: contact._id.toString(), subject: picked.subject.text, body: '', templateId: picked.template._id.toString(), templateVersion: picked.version.version }, actor)
        const r = await drafts.insertOne({
          kind: 'first_touch', status: 'approved', source: 'batch', batchId: id,
          dealershipId: a.dealershipId, dealershipCode: d.dealershipId || '', dealershipName: d.name, stage: d.stage, ownerId: d.assignedUserId || '', ownerName: d.assignedUserName || '',
          contactId: contact._id.toString(), contactName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(), contactRole: contact.jobTitle || contact.role || '', toEmail: contact.email,
          subjectTemplate: picked.subject.text, body: picked.version.format === 'html' ? '' : (picked.version.body || ''), format: picked.version.format === 'html' ? 'html' : 'text',
          templateId: picked.template._id.toString(), templateName: picked.template.name, templateVersion: picked.version.version, templateVersionLabel: picked.version.label || `V${picked.version.version}`, subjectVariant: picked.subject.key,
          writtenBy: 'template', aiModel: null, subject: p.subject, previewHtml: p.html, missingFields: p.missing || [],
          followUpOf: null, followUpNumber: 0, why: ['Sent from a batch scan'], priorityScore: null,
          edited: false, createdAt: at, createdBy: who(actor), updatedAt: at, approvedAt: at, approvedBy: { ...who(actor), email: actor.email },
        })
        const email = { mode: 'queue' as const, status: 'queued' as const, draftId: r.insertedId.toString(), to: contact.email, subject: p.subject, templateName: picked.template.name, error: null, at }
        await updateBatchItem(db, id, a.dealershipId, { email })
        results.push({ dealershipId: a.dealershipId, name: item.name, ...email })
      }
      else {
        const sent: any = await sendCrmEmail(db, d, { contactId: contact._id.toString(), to: contact.email, subject: picked.subject.text, subjectVariant: picked.subject.key, templateId: picked.template._id.toString(), templateVersion: picked.version.version, allowDuplicate: !!a.allowDuplicate } as any, actor)
        const email = { mode: 'now' as const, status: 'sent' as const, emailId: sent?.id || null, to: contact.email, subject: sent?.subject || '', templateName: picked.template.name, error: null, at }
        await updateBatchItem(db, id, a.dealershipId, { email })
        results.push({ dealershipId: a.dealershipId, name: item.name, ...email })
      }
    }
    catch (e: any) {
      await fail(e?.data?.duplicateEmail ? `${e.statusMessage || e.message}` : (e?.statusMessage || e?.message || 'Send failed'))
      if (e?.data?.duplicateEmail) results[results.length - 1]!.duplicate = true
    }
  }
  return { results, batch: await getBatch(db, id) }
}
