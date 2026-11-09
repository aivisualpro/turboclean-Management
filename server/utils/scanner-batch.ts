/**
 * Batch scanning — "scrape these N dealerships, then email them".
 *
 * AUTOPILOT (2026-11-04): the batch runs on the server, not in the browser. Every dealership is
 * scanned in its own server invocation (`/api/scanner/batches/:id/run-item`, kept alive with
 * waitUntil), and when one finishes it starts the next (`advanceBatch`). A cron tick every minute
 * restarts anything that stalled, resuming from the scan's checkpoints (finished pages are skipped,
 * the exact result page is re-opened, checked photos are kept). Closing the laptop, losing the
 * internet or a dead battery changes nothing — open Mission Control again and it shows where it is.
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
import { createHmac } from 'node:crypto'
import { safeUrl } from './scanner-session'
import { isServerless } from './scanner-cdp'
import { sanitizeScanPages, scopeOf } from './scanner-scope'

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
  summary: { total: number, withoutReal: number, withoutRealPct: number | null, by?: Record<string, number>, advertised?: number | null } | null
  error: string | null
  claimedAt: string | null
  finishedAt: string | null
  email: { mode: 'now' | 'queue', status: 'sent' | 'queued' | 'failed' | 'skipped', emailId?: string | null, draftId?: string | null, to?: string, subject?: string, templateName?: string, error?: string | null, at: string } | null
  /** Set when a stopped scan is queued again: the new scan continues from this one (keeps its vehicles). */
  resumeFrom?: string | null
  /** How many times this dealership has been claimed (auto-retries stop at 3). */
  attempts?: number
  /** Live mirror of the running scan (progress line), refreshed by the live endpoint. */
  progressText?: string
  /** The scan pages this crawl covered and how each went (done / blocked / redirected / empty …). */
  scope?: { url: string, label: string, status: string, vehicles: number, resultPages: number, advertised: number | null, note: string }[]
}

const who = (a: SessionActor | null | undefined) => a ? { id: a.id, name: a.name } : null
const oid = (id: string) => { if (!ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' }); return new ObjectId(id) }

export function serializeBatch(b: any) {
  if (!b) return null
  const { _id, advanceLockUntil, origin, ...rest } = b
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
    // A paused batch with half-scanned dealerships is not finished; neither is one with crashed items autopilot will retry.
    finished: rest.mode === 'server' ? !needsWork(items) && !(rest.paused && items.some(i => i.status === 'stopped' && !i.auditId)) : items.every(i => i.status !== 'queued' && i.status !== 'running'),
  }
}

/**
 * The pages a dealership's crawl covers: its saved scan pages that are real inventory lists.
 * The bare website (home page) is never crawled — a dealership without scan pages is skipped.
 */
export function pagesFor(d: any): string[] {
  const out: string[] = []
  for (const p of scopeOf(d).pages) { try { out.push(safeUrl(p.url)) } catch {} }
  return out
}
const noPagesReason = (d: any) => {
  const { rejected } = scopeOf(d)
  if (rejected.length) return `Its saved scan page cannot be crawled: ${rejected[0]!.message}`
  return d?.website ? 'No scan pages picked — detect or pick its inventory pages first' : 'No website on this dealership'
}
/** Save page lists typed in Mission Control as the dealership's scan pages — labels and health of pages that stay are kept, bad addresses are refused. */
async function rememberPages(db: Db, d: any, urls: any[], now: string) {
  const { pages, rejected } = sanitizeScanPages(urls, d.scanPages)
  const same = JSON.stringify((d.scanPages || []).map((p: any) => p?.url || p)) === JSON.stringify(pages.map(p => p.url))
  if (pages.length && !same) await db.collection(CRM_COLLECTIONS.dealerships).updateOne({ _id: d._id }, { $set: { scanPages: pages, updatedAt: now } })
  if (pages.length) d.scanPages = pages
  return { pages, rejected }
}

export async function createBatch(db: Db, body: any, actor: SessionActor) {
  const ids = (Array.isArray(body?.dealershipIds) ? body.dealershipIds : []).map((x: any) => String(x)).filter((x: string) => ObjectId.isValid(x)).slice(0, 200)
  if (!ids.length) throw createError({ statusCode: 400, statusMessage: 'Pick at least one dealership' })
  const overrides: Record<string, string[]> = body?.pages && typeof body.pages === 'object' ? body.pages : {}
  const docs = await db.collection(CRM_COLLECTIONS.dealerships).find({ _id: { $in: ids.map((i: string) => new ObjectId(i)) } }).toArray()
  const byId = new Map(docs.map(d => [d._id.toString(), d]))
  const now = new Date().toISOString()
  // Page lists typed in the console become the dealership's scan pages first — the crawl then reads exactly those.
  const refused = new Map<string, string>()
  for (const [id, urls] of Object.entries(overrides)) {
    const d = byId.get(id)
    if (!d || !Array.isArray(urls)) continue
    const r = await rememberPages(db, d, urls, now)
    if (!r.pages.length && r.rejected.length) refused.set(id, r.rejected[0]!.message)
  }
  const items: BatchItem[] = ids.filter((id: string) => byId.has(id)).map((id: string) => {
    const d = byId.get(id)!
    const urls = refused.has(id) ? [] : pagesFor(d).slice(0, 40)
    return {
      dealershipId: id, name: d.name || '', website: d.website || '', urls,
      status: urls.length ? 'queued' : 'skipped', scanId: null, auditId: null, summary: null,
      error: urls.length ? null : refused.has(id) ? `Not crawled: ${refused.get(id)}` : noPagesReason(d), claimedAt: null, finishedAt: null, email: null,
    } as BatchItem
  })
  const doc = {
    name: str(body?.name, 120) || `${items.length} dealership${items.length === 1 ? '' : 's'} · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    status: 'running', items, concurrency: Math.min(3, Math.max(1, Number(body?.concurrency) || 2)), autoSave: body?.autoSave !== false,
    mode: 'server', paused: false, origin: str(body?.origin, 200) || null,
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
  if (b && !needsWork(b.items as BatchItem[])) await db.collection(BATCHES_COLLECTION).updateOne({ _id: b._id }, { $set: { status: 'done', finishedAt: now } })
}

/** Re-queue one dealership (retry a failed / skipped item, optionally with new pages). */
export async function requeueItem(db: Db, batchId: string, dealershipId: string, urls?: string[], opts: { resume?: boolean } = {}) {
  // New pages given with a retry become the dealership's scan pages (the crawl only reads saved scan pages).
  let clean: string[] = []
  if (urls?.length && ObjectId.isValid(dealershipId)) {
    const d = await db.collection(CRM_COLLECTIONS.dealerships).findOne({ _id: new ObjectId(dealershipId) })
    if (d) {
      const r = await rememberPages(db, d, urls.map(u => str(u, 2000)), new Date().toISOString())
      if (!r.pages.length) throw createError({ statusCode: 400, statusMessage: 'Not an inventory page', message: r.rejected[0]?.message || 'Add at least one inventory page' })
      clean = pagesFor(d)
    }
  }
  const current = await db.collection(BATCHES_COLLECTION).findOne({ _id: oid(batchId) }, { projection: { items: 1 } })
  const item = ((current?.items || []) as BatchItem[]).find(i => i.dealershipId === dealershipId)
  // A paused / interrupted scan picks up where it left off (also a crash, when asked); a failed one starts clean.
  const resumeFrom = item && (item.status === 'stopped' || opts.resume) && item.scanId ? item.scanId : null
  const patch: Partial<BatchItem> = { status: 'queued', scanId: null, auditId: null, summary: null, error: null, claimedAt: null, finishedAt: null, email: null, resumeFrom }
  if (clean.length) patch.urls = clean
  await updateBatchItem(db, batchId, dealershipId, patch)
  await db.collection(BATCHES_COLLECTION).updateOne({ _id: oid(batchId) }, { $set: { status: 'running', paused: false } })
  const b = await db.collection(BATCHES_COLLECTION).findOne({ _id: oid(batchId) }, { projection: { mode: 1 } })
  if (b?.mode === 'server') return (await advanceBatch(db, batchId)) || getBatch(db, batchId)
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


// ───────────────────────── Autopilot (server-run) ─────────────────────────
const MAX_ATTEMPTS = 4
const CRASH_RE = /connection is closed|target closed|session closed|crashed|disconnected|cut off|did not respond|timed out/i
/** An item the server lost (crash / cut off) that autopilot should pick up again. */
/** Partly blocked by the dealer's bot protection — retried later from the blocked page (cool-down grows each attempt). */
export const isBlocked = (i: BatchItem) => i.status === 'stopped' && /blocked by the dealer/i.test(i.error || '')
const blockCooldownMs = (i: BatchItem) => [3, 8, 20, 45][Math.min(3, Math.max(0, (i.attempts || 1) - 1))]! * 60_000
const isCrashed = (i: BatchItem) => (isBlocked(i) || (i.status === 'stopped' && /cut off/i.test(i.error || '')) || (i.status === 'failed' && CRASH_RE.test(i.error || '') && !/gave up/i.test(i.error || '')))
/** Anything left for autopilot to do in this batch? */
export const needsWork = (items: BatchItem[]) => items.some(i => i.status === 'queued' || i.status === 'running' || (isCrashed(i) && (i.attempts || 0) < MAX_ATTEMPTS))
const secret = () => process.env.CRON_SECRET || process.env.SCANNER_INTERNAL_SECRET || process.env.NUXT_SESSION_PASSWORD || process.env.MONGODB_URI || 'zrz-scanner'
/** Signs internal "run this item" calls so nobody else can start scans through that route. */
export const internalToken = (batchId: string) => createHmac('sha256', secret()).update(`batch:${batchId}`).digest('hex').slice(0, 40)

/**
 * Keep a promise running after the response is sent. Vercel freezes / tears down an invocation once
 * it has answered unless the work is registered with waitUntil (Fluid compute keeps it alive up to
 * maxDuration). Locally (node server) the promise simply keeps running.
 */
export function keepAlive(p: Promise<any>, event?: any) {
  try { event?.waitUntil?.(p) } catch {}
  try { event?.context?.waitUntil?.(p) } catch {}
  try { (globalThis as any)[Symbol.for('@vercel/request-context')]?.get?.()?.waitUntil?.(p) } catch {}
  return p
}

/** Fire one dealership's scan in a fresh server invocation (own memory, own time budget). */
async function launchItem(db: Db, batchId: string, dealershipId: string, origin: string | null) {
  if (!isServerless() || !origin) {
    // Local / no public origin: run in this process (the node server stays up anyway).
    runBatchItem(db, batchId, dealershipId).catch(() => {})
    return
  }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const r = await fetch(`${origin}/api/scanner/batches/${batchId}/run-item`, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json', 'x-zrz-internal': internalToken(batchId) }, body: JSON.stringify({ dealershipId }) })
    if (!r.ok) throw new Error(`run-item answered ${r.status}`)
  }
  catch (e: any) {
    // Could not hand it off — put it back; the next tick will try again.
    await updateBatchItem(db, batchId, dealershipId, { status: 'queued', claimedAt: null, error: `Waiting to restart (${String(e?.message || e).slice(0, 80)})` })
  }
  finally { clearTimeout(t) }
}

/**
 * The heart of autopilot: tidy up stalled items, then start scans until `concurrency` are running.
 * Safe to call any time from anywhere (start, scan finished, cron tick, someone opening the batch) —
 * a short DB lease makes concurrent calls harmless.
 */
export async function advanceBatch(db: Db, id: string, origin?: string | null) {
  if (!ObjectId.isValid(id)) return null
  const col = db.collection(BATCHES_COLLECTION)
  const now = Date.now()
  const lease = await col.findOneAndUpdate(
    { _id: new ObjectId(id), mode: 'server', $or: [{ advanceLockUntil: { $exists: false } }, { advanceLockUntil: null }, { advanceLockUntil: { $lt: new Date(now).toISOString() } }] },
    { $set: { advanceLockUntil: new Date(now + 8000).toISOString(), ...(origin ? { origin } : {}) } },
    { returnDocument: 'after' },
  )
  if (!lease) return null
  try {
    let b: any = lease
    const items = b.items as BatchItem[]
    // 1. Running items whose scan went silent → the scan finalizer marks them stopped ("Cut off").
    const { getScan } = await import('./scanner-session')
    for (const i of items.filter(i => i.status === 'running')) {
      if (i.scanId) await getScan(db, i.scanId).catch(() => null)
      else if (i.claimedAt && now - new Date(i.claimedAt).getTime() > 180_000) await updateBatchItem(db, id, i.dealershipId, { status: 'queued', claimedAt: null })
    }
    b = await col.findOne({ _id: b._id })
    // 2. Cut-off / crashed items go back in the queue and continue from their checkpoint.
    if (!b.paused) {
      for (const i of b.items as BatchItem[]) {
        if (!isCrashed(i)) continue
        if (isBlocked(i) && (i.attempts || 0) < MAX_ATTEMPTS && i.finishedAt && now - new Date(i.finishedAt).getTime() < blockCooldownMs(i)) continue
        if ((i.attempts || 0) >= MAX_ATTEMPTS && isBlocked(i)) { await updateBatchItem(db, id, i.dealershipId, { error: `Partial — the dealer's site kept refusing some result pages after ${i.attempts} tries (what was reachable is saved). Retry later or run it once more.` }); continue }
        if ((i.attempts || 0) >= MAX_ATTEMPTS) { if (i.status === 'stopped') await updateBatchItem(db, id, i.dealershipId, { status: 'failed', error: `Gave up after ${i.attempts} attempts — ${i.error}` }); continue }
        await updateBatchItem(db, id, i.dealershipId, { status: 'queued', claimedAt: null, resumeFrom: i.scanId || i.resumeFrom || null, scanId: null, error: null })
      }
      b = await col.findOne({ _id: b._id })
    }
    if (b.paused) return serializeBatch(b)
    // 3. Fill the free slots.
    const running = (b.items as BatchItem[]).filter(i => i.status === 'running').length
    const slots = Math.max(0, (b.concurrency || 2) - running)
    for (let k = 0; k < slots; k++) {
      const { item } = await claimNext(db, id)
      if (!item) break
      await launchItem(db, id, item.dealershipId, origin || b.origin || null)
    }
    const after = await col.findOne({ _id: b._id })
    const items2 = (after?.items || []) as BatchItem[]
    if (after && !needsWork(items2) && after.status !== 'done') await col.updateOne({ _id: after._id }, { $set: { status: 'done', finishedAt: new Date().toISOString() } })
    else if (after && after.status === 'done' && needsWork(items2)) await col.updateOne({ _id: after._id }, { $set: { status: 'running' } })
    return serializeBatch(await col.findOne({ _id: b._id }))
  }
  finally { await col.updateOne({ _id: new ObjectId(id) }, { $set: { advanceLockUntil: null } }).catch(() => {}) }
}

/** Scan one claimed dealership to the end (resuming its last scan when there is one), then move the batch on. */
export async function runBatchItem(db: Db, batchId: string, dealershipId: string) {
  const b = await db.collection(BATCHES_COLLECTION).findOne({ _id: oid(batchId) })
  if (!b) return
  const item = (b.items as BatchItem[]).find(i => i.dealershipId === dealershipId)
  if (!item || item.status !== 'running') return
  const { createScan } = await import('./scanner-session')
  const actor = { id: b.createdBy?.id || 'system', name: b.createdBy?.name || 'Batch', email: '' } as SessionActor
  try {
    // No addresses are passed: the crawl reads the dealership's scan pages as they are saved right now.
    const { doc, run } = await createScan(db, { dealershipId, allPages: true, batchId, autoSave: b.autoSave !== false, appendTo: item.resumeFrom || undefined }, actor)
    await updateBatchItem(db, batchId, dealershipId, { scanId: String(doc._id), error: null, urls: doc.urls })
    await run(() => {}, { isClosed: () => true })
  }
  catch (e: any) {
    await updateBatchItem(db, batchId, dealershipId, { status: 'failed', error: String(e?.message || e?.statusMessage || e).slice(0, 300) })
  }
  finally {
    await advanceBatch(db, batchId).catch(() => {})
  }
}

export async function startBatch(db: Db, id: string, origin: string | null) {
  await db.collection(BATCHES_COLLECTION).updateOne({ _id: oid(id) }, { $set: { mode: 'server', paused: false, status: 'running', ...(origin ? { origin } : {}) } })
  // Paused dealerships continue where they stopped.
  const b = await db.collection(BATCHES_COLLECTION).findOne({ _id: oid(id) })
  for (const i of (b?.items || []) as BatchItem[]) if (i.status === 'stopped' && !i.auditId) await updateBatchItem(db, id, i.dealershipId, { status: 'queued', claimedAt: null, resumeFrom: i.scanId, scanId: null, error: null })
  return advanceBatch(db, id, origin)
}

export async function pauseBatch(db: Db, id: string) {
  await db.collection(BATCHES_COLLECTION).updateOne({ _id: oid(id) }, { $set: { paused: true } })
  const b = await db.collection(BATCHES_COLLECTION).findOne({ _id: oid(id) })
  const { requestStop } = await import('./scanner-session')
  for (const i of (b?.items || []) as BatchItem[]) if (i.status === 'running' && i.scanId) await requestStop(db, i.scanId, 'pause').catch(() => {})
  return getBatch(db, id)
}

/** Batch + what each running scan is doing right now (progress, last log lines, latest frame). */
export async function batchLive(db: Db, id: string, origin: string | null, withFrames = true) {
  const b = await db.collection(BATCHES_COLLECTION).findOne({ _id: oid(id) })
  if (!b) throw createError({ statusCode: 404, statusMessage: 'Batch not found' })
  // Viewing a server batch nudges it (stalled items restart even without the cron).
  if (b.mode === 'server' && !b.paused && needsWork(b.items as BatchItem[])) await advanceBatch(db, id, origin).catch(() => null)
  const fresh = await db.collection(BATCHES_COLLECTION).findOne({ _id: b._id })
  const running = ((fresh?.items || []) as BatchItem[]).filter(i => i.status === 'running' && i.scanId)
  const { SCANS_COLLECTION } = await import('./scanner-session')
  const scans = running.length
    ? await db.collection(SCANS_COLLECTION).find({ _id: { $in: running.map(i => new ObjectId(i.scanId!)) } }, { projection: { progress: 1, log: { $slice: -14 }, dealershipId: 1, heartbeatAt: 1, createdAt: 1, ...(withFrames ? { frame: 1 } : {}) } }).toArray()
    : []
  const live: Record<string, any> = {}
  for (const sc of scans) live[sc.dealershipId] = { scanId: String(sc._id), progress: sc.progress, log: sc.log || [], frame: withFrames && sc.frame?.data ? `data:image/jpeg;base64,${sc.frame.data}` : null, heartbeatAt: sc.heartbeatAt, startedAt: sc.progress?.startedAt || sc.createdAt }
  return { batch: serializeBatch(fresh), live }
}

/** Cron: keep every unfinished server batch moving. */
export async function tickBatches(db: Db) {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const recent = await db.collection(BATCHES_COLLECTION).find({ mode: 'server', createdAt: { $gte: since } }, { projection: { _id: 1, origin: 1, paused: 1, items: 1 } }).sort({ createdAt: -1 }).limit(30).toArray()
  const rows = recent.filter(r => !r.paused && needsWork(r.items || []))
  const out: any[] = []
  for (const r of rows) out.push({ id: String(r._id), batch: await advanceBatch(db, String(r._id), r.origin).catch((e: any) => ({ error: e?.message })) })
  return out
}
