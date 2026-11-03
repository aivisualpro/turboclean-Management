/**
 * Automations 2–6: inventory snapshots → counts → missing-photo % → research summaries.
 *
 *  - ingestInventorySnapshot(): what a website/inventory collector (automation 2) posts. The CRM
 *    counts new/used vehicles (3) and missing photos (4) itself and records an append-only audit
 *    with `source: 'automated'`, exactly like a manual audit.
 *  - auditFreshnessJob(): daily — which dealerships have no audit or a stale one.
 *  - researchSummariesJob(): writes a research summary per dealership (facts always; an outreach
 *    angle from Claude when enabled) and moves researched dealerships forward in the pipeline.
 */
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import { CRM_COLLECTIONS, OPEN_STAGE_ORDER, str } from './crm'
import { AUDIT_COLLECTION, recordAudit } from './crm-audit'
import { AUTOMATION_ACTOR, automationDb, logAutomation, logEventRun } from './automation'
import type { AutomationSettings, JobResult } from './automation'
import { aiConfigured, askClaudeJson } from './automation-ai'

const DAY = 86_400_000
const daysAgo = (iso: string | null | undefined) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : null
const domainOf = (url: string) => String(url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0] || ''

/** Contact roles worth emailing first, best first. */
export const ROLE_PRIORITY = ['General Manager', 'Used Car Manager', 'General Sales Manager', 'Dealer Principal', 'Owner', 'Internet/BDC Manager', 'Fixed Operations Director', 'Service Manager', 'Controller/CFO', 'Other']
/** The person automations should write to: active, has a working email, not opted out. */
export function pickEmailContact(contacts: any[]) {
  const ok = contacts.filter(c => c.isActive !== false && c.email && !c.emailBouncedAt && !c.doNotEmail)
  return ok.sort((a, b) => (Number(!!b.isPrimary) - Number(!!a.isPrimary)) || (ROLE_PRIORITY.indexOf(a.role || 'Other') - ROLE_PRIORITY.indexOf(b.role || 'Other')))[0] || null
}

// ───────────────────────── 2–4. Inventory snapshot ingest ─────────────────────────
export interface InventoryVehicle { condition?: string, photoCount?: number | null, isPlaceholder?: boolean, url?: string, vin?: string, stockNumber?: string, year?: number | string, make?: string, model?: string }

/** Count new/used vehicles and missing photos from a raw vehicle list. */
export function countInventory(vehicles: InventoryVehicle[]) {
  const c = { newTotal: 0, usedTotal: 0, newMissingPhotos: 0, usedMissingPhotos: 0 }
  const missing: InventoryVehicle[] = []
  const seen = new Set<string>()
  for (const v of vehicles) {
    const id = String(v.vin || v.stockNumber || v.url || '').toLowerCase()
    if (id) { if (seen.has(id)) continue; seen.add(id) }
    const isNew = /^\s*new\b/i.test(String(v.condition || ''))
    const noPhoto = v.isPlaceholder === true || (v.photoCount !== undefined && v.photoCount !== null && Number(v.photoCount) <= 0)
    if (isNew) { c.newTotal++; if (noPhoto) c.newMissingPhotos++ }
    else { c.usedTotal++; if (noPhoto) c.usedMissingPhotos++ }
    if (noPhoto) missing.push(v)
  }
  return { counts: c, missing, unique: seen.size || vehicles.length }
}

async function findDealership(db: Db, body: any) {
  const col = db.collection(CRM_COLLECTIONS.dealerships)
  const ref = str(body?.dealershipId, 64)
  if (ref && ObjectId.isValid(ref)) return col.findOne({ _id: new ObjectId(ref) })
  if (ref) return col.findOne({ dealershipId: ref.toUpperCase() })
  const dom = domainOf(str(body?.website, 300) || str(body?.inventoryUrl, 1000))
  if (!dom) return null
  const rows = await col.find({ archivedAt: null, website: { $regex: dom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }).limit(5).toArray()
  return rows.find(r => domainOf(r.website) === dom) || null
}

export async function ingestInventorySnapshot(db: Db, body: any, actor = AUTOMATION_ACTOR) {
  const dealership = await findDealership(db, body)
  if (!dealership) throw createError({ statusCode: 404, statusMessage: 'No CRM dealership matches that id or website' })
  let counts: any
  let missing: InventoryVehicle[] = []
  if (Array.isArray(body?.vehicles)) {
    if (body.vehicles.length > 20_000) throw createError({ statusCode: 413, statusMessage: 'Too many vehicles in one snapshot' })
    const r = countInventory(body.vehicles)
    counts = r.counts
    missing = r.missing
  }
  else if (body?.counts && typeof body.counts === 'object') counts = body.counts
  else throw createError({ statusCode: 400, statusMessage: 'Send `vehicles` (a list) or `counts`' })

  const examples = missing.filter(v => v.url).slice(0, 20).map(v => ({ url: str(v.url, 1000), label: [v.year, v.make, v.model, v.stockNumber && `#${v.stockNumber}`].filter(Boolean).join(' ') || 'Vehicle without photos' }))
  const audit = await recordAudit(db, dealership, {
    ...counts,
    source: 'automated',
    inventoryUrl: str(body?.inventoryUrl, 1000),
    examples,
    screenshotFileId: body?.screenshotFileId,
    notes: str(body?.notes, 4000),
    collector: { name: str(body?.collector?.name, 120) || 'collector', version: str(body?.collector?.version, 40), runId: str(body?.collector?.runId, 120) },
  }, actor)
  const summary = `${dealership.name}: ${audit!.totalVehicles} vehicles (${audit!.newTotal} new / ${audit!.usedTotal} used), ${audit!.missingPhotoPct ?? 0}% missing photos`
  await logEventRun(db, 'count_inventory', summary, { vehicles: audit!.totalVehicles, missing: audit!.totalMissingPhotos }, [{ dealershipId: dealership._id.toString(), name: dealership.name }])
  return { dealershipId: dealership._id.toString(), dealershipCode: dealership.dealershipId, audit }
}

// ───────────────────────── 4. Audit freshness ─────────────────────────
export async function auditFreshnessJob(db: Db, ctx: { settings: AutomationSettings }): Promise<JobResult> {
  const live = await db.collection(CRM_COLLECTIONS.dealerships).find({ archivedAt: null, mergedInto: null, dealerId: null, stage: { $in: [...OPEN_STAGE_ORDER, 'Nurture / Follow Up Later'] } }, { projection: { name: 1, lastAuditAt: 1, stage: 1 } }).toArray()
  const never = live.filter(d => !d.lastAuditAt)
  const stale = live.filter(d => d.lastAuditAt && (daysAgo(d.lastAuditAt) ?? 0) > ctx.settings.auditStaleDays)
  const ids = live.map(d => d._id.toString())
  const recent = ids.length ? await db.collection(AUDIT_COLLECTION).aggregate([
    { $match: { dealershipId: { $in: ids }, auditedAt: { $gte: new Date(Date.now() - 30 * DAY).toISOString() } } },
    { $group: { _id: null, n: { $sum: 1 }, avgPct: { $avg: '$missingPhotoPct' } } },
  ]).toArray() : []
  const r = recent[0]
  return {
    summary: `${never.length} open dealerships never audited, ${stale.length} with an audit older than ${ctx.settings.auditStaleDays} days${r ? ` · ${r.n} audits in the last 30 days (avg ${Math.round((r.avgPct || 0) * 10) / 10}% missing)` : ''}`,
    stats: { open: live.length, neverAudited: never.length, stale: stale.length, auditsLast30: r?.n || 0, avgMissingPct: r ? Math.round((r.avgPct || 0) * 10) / 10 : null },
    items: [...never, ...stale].slice(0, 50).map(d => ({ dealershipId: d._id.toString(), name: d.name, lastAuditAt: d.lastAuditAt || null })),
  }
}

// ───────────────────────── 6. Research summaries ─────────────────────────
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** Plain facts, no guessing — the part of the summary that is always true. */
export function factsSummary(d: any, audits: any[], contacts: any[], ix: any[], emails: any[]) {
  const lines: string[] = []
  const where = [d.city, d.state].filter(Boolean).join(', ')
  const brand = (d.brands || []).join('/') || 'Independent'
  lines.push(`${brand} dealership${where ? ` in ${where}` : ''}${d.dealerGroup ? ` (${d.dealerGroup})` : ''}. Stage: ${d.stage}.`)
  const a = audits[0], prev = audits[1]
  if (a) {
    let trend = ''
    if (prev && a.missingPhotoPct != null && prev.missingPhotoPct != null) {
      const delta = Math.round((a.missingPhotoPct - prev.missingPhotoPct) * 10) / 10
      trend = delta === 0 ? ', unchanged since the previous audit' : `, ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)} pts since ${fmtDay(prev.auditedAt)}`
    }
    lines.push(`Inventory ${fmtDay(a.auditedAt)}: ${a.totalVehicles} vehicles (${a.usedTotal} used / ${a.newTotal} new); ${a.totalMissingPhotos} missing photos = ${a.missingPhotoPct ?? 0}%${a.usedMissingPhotoPct != null ? ` (used ${a.usedMissingPhotoPct}%)` : ''}${trend}.`)
    const issues = [...(a.merchandisingIssues || []), ...(a.websiteIssues || [])]
    if (issues.length) lines.push(`Issues seen: ${issues.slice(0, 6).join(', ')}.`)
  }
  else lines.push('Not audited yet — inventory and missing-photo % unknown.')
  const active = contacts.filter(c => c.isActive !== false)
  const best = pickEmailContact(active)
  if (best) lines.push(`Best contact: ${`${best.firstName || ''} ${best.lastName || ''}`.trim()}, ${best.jobTitle || best.role}${best.lastVerifiedAt ? ` (verified ${daysAgo(best.lastVerifiedAt)}d ago)` : ''}.`)
  else if (active.length) lines.push(`${active.length} contact${active.length === 1 ? '' : 's'} on file but none with a usable email.`)
  else lines.push('No contacts yet.')
  const touches = ix.filter(i => !i.voidedAt && i.type !== 'note' && i.type !== 'research_completed')
  const sent = emails.filter(e => e.direction === 'outbound' && e.status !== 'failed')
  const replies = emails.filter(e => e.direction === 'inbound')
  if (touches.length || sent.length) {
    const last = touches[0]
    lines.push(`History: ${touches.length} touch${touches.length === 1 ? '' : 'es'}, ${sent.length} email${sent.length === 1 ? '' : 's'} sent, ${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}${last ? `; last touch ${fmtDay(last.occurredAt)} (${String(last.type).replace(/_/g, ' ')})` : ''}.`)
  }
  else lines.push('Never contacted.')
  return lines.join(' ')
}

async function aiAngle(d: any, facts: string, audits: any[]) {
  const a = audits[0]
  const res = await askClaudeJson<{ angle: string, talkingPoints: string[] }>({
    system: 'You help a reconditioning / vehicle merchandising company (car photos, detailing) prepare outreach to car dealerships. Be concrete and brief. Only use facts you are given — never invent numbers, names or events.',
    prompt: `Dealership: ${d.name}\nFacts: ${facts}\n${a?.notes ? `Audit notes: ${String(a.notes).slice(0, 800)}\n` : ''}\nReturn {"angle": one sentence on the strongest reason this dealership should talk to us, "talkingPoints": up to 3 short bullet strings}.`,
    maxTokens: 400,
  })
  if (!res) return null
  return { angle: str(res.data?.angle, 400), talkingPoints: (Array.isArray(res.data?.talkingPoints) ? res.data.talkingPoints : []).map((t: any) => str(t, 200)).filter(Boolean).slice(0, 3), model: res.model }
}

export async function researchSummariesJob(db: Db, ctx: { settings: AutomationSettings }): Promise<JobResult> {
  const { summaries } = await automationDb(db)
  const col = db.collection(CRM_COLLECTIONS.dealerships)
  const ds = await col.find({ archivedAt: null, mergedInto: null, dealerId: null, stage: { $in: [...OPEN_STAGE_ORDER, 'Nurture / Follow Up Later'] } }).toArray()
  // Due: no summary, a newer audit than the summary, or a summary older than 30 days.
  const due = ds.filter((d) => {
    const s = d.researchSummary
    if (!s?.generatedAt) return true
    if (d.lastAuditAt && d.lastAuditAt > s.generatedAt) return true
    return (daysAgo(s.generatedAt) ?? 0) > 30
  }).slice(0, 40)
  const useAi = ctx.settings.useAi && aiConfigured()
  let written = 0, aiWritten = 0, advanced = 0
  const items: any[] = []
  const { moveStage } = await import('./crm-stage')
  for (const d of due) {
    const id = d._id.toString()
    const [audits, contacts, ix, emails] = await Promise.all([
      db.collection(AUDIT_COLLECTION).find({ dealershipId: id }).sort({ auditedAt: -1 }).limit(2).toArray(),
      db.collection(CRM_COLLECTIONS.contacts).find({ dealershipId: id }).toArray(),
      db.collection('turboCleanCrmInteractions').find({ dealershipId: id, voidedAt: null }, { projection: { type: 1, occurredAt: 1, voidedAt: 1 } }).sort({ occurredAt: -1 }).limit(200).toArray(),
      db.collection('turboCleanCrmEmails').find({ dealershipId: id }, { projection: { direction: 1, status: 1, sentAt: 1 } }).toArray(),
    ])
    const facts = factsSummary(d, audits, contacts, ix, emails)
    const angle = useAi && audits.length ? await aiAngle(d, facts, audits) : null
    const now = new Date().toISOString()
    const doc = { dealershipId: id, dealershipName: d.name, facts, angle: angle?.angle || '', talkingPoints: angle?.talkingPoints || [], by: angle ? 'ai' : 'rules', model: angle?.model || null, auditId: audits[0]?._id?.toString() || null, generatedAt: now }
    await summaries.insertOne(doc)
    await col.updateOne({ _id: d._id }, { $set: { researchSummary: { facts: doc.facts, angle: doc.angle, talkingPoints: doc.talkingPoints, by: doc.by, generatedAt: now } } })
    written++
    if (angle) aiWritten++

    // Move forward in the pipeline when the research is actually done (forward only).
    if (ctx.settings.autoAdvanceStages) {
      const hasEmailContact = !!pickEmailContact(contacts)
      let target: string | null = null
      if (d.stage === 'Research Needed' && audits.length) target = hasEmailContact ? 'Ready to Contact' : 'Researched'
      else if (d.stage === 'Researched' && audits.length && hasEmailContact) target = 'Ready to Contact'
      if (target) {
        try {
          if (target === 'Ready to Contact' && d.stage === 'Research Needed') {
            await moveStage(db, d, 'Researched', AUTOMATION_ACTOR, 'automation', 'Automation: audit on file')
            const fresh = await col.findOne({ _id: d._id })
            if (fresh) await moveStage(db, fresh, 'Ready to Contact', AUTOMATION_ACTOR, 'automation', 'Automation: audit + emailable contact on file')
          }
          else await moveStage(db, d, target, AUTOMATION_ACTOR, 'automation', target === 'Researched' ? 'Automation: audit on file' : 'Automation: audit + emailable contact on file')
          advanced++
          items.push({ dealershipId: id, name: d.name, moved: `${d.stage} → ${target}` })
        }
        catch (e: any) { console.warn('[Automations] stage advance failed:', e?.message) }
      }
    }
    if (!items.find(i => i.dealershipId === id)) items.push({ dealershipId: id, name: d.name })
  }
  if (written) for (const it of items.filter(i => i.moved)) await logAutomation(db, it.dealershipId, `Research summary written; stage moved ${it.moved}`)
  return {
    summary: due.length ? `${written} research summar${written === 1 ? 'y' : 'ies'} written${aiWritten ? ` (${aiWritten} with an AI outreach angle)` : ''}, ${advanced} dealership${advanced === 1 ? '' : 's'} moved forward` : 'All research summaries are up to date',
    stats: { written, aiWritten, advanced, checked: ds.length },
    items,
  }
}

export async function latestSummary(db: Db, dealershipId: string) {
  const { summaries } = await automationDb(db)
  const s = await summaries.find({ dealershipId }).sort({ generatedAt: -1 }).limit(1).next()
  return s ? { id: s._id.toString(), ...s, _id: undefined } : null
}
