/**
 * Invoice generation engine — single source of truth for turning
 * work orders into Daily invoices and Daily invoices into Weekly rollups.
 *
 * Used by:
 *  - POST /api/invoices/generate            (manual "Generate" buttons)
 *  - server/utils/invoice-automation.ts     (scheduled daily/weekly automations)
 *
 * Both paths produce identical invoice documents and numbering.
 */

import { ObjectId } from 'mongodb'
import { syncToAppSheet } from './appsheet-sync'
import { WorkOrdersMapper } from './sync-mapper'

// Returns YYYY-MM-DD string from a work order's date field (handles ISODate or string)
export function toDateStr(d: any): string {
  if (!d) return ''
  if (typeof d === 'string') return d.split('T')[0] as string
  if (d instanceof Date) return d.toISOString().split('T')[0] as string
  return String(d).split('T')[0] as string
}

export function getISOWeek(date: Date): { year: number, week: number, weekStart: Date, weekEnd: Date } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)

  const dayOfWeek = date.getUTCDay() || 7
  const weekStart = new Date(date)
  weekStart.setUTCDate(date.getUTCDate() - dayOfWeek + 1)
  weekStart.setUTCHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6)
  weekEnd.setUTCHours(23, 59, 59, 999)

  return { year: d.getUTCFullYear(), week: weekNo, weekStart, weekEnd }
}

// Build a line item from a work order + dealer service map
export function buildWorkOrderLineItem(wo: any, dealer: any, serviceNameMap: Map<string, string>) {
  const rawServiceId = wo.dealerServiceId?.toString() || ''
  let serviceName = rawServiceId
  if (rawServiceId && dealer?.services && Array.isArray(dealer.services)) {
    const found = dealer.services.find((s: any) => (s.id || s._id || '').toString() === rawServiceId)
    if (found?.service) serviceName = serviceNameMap.get(found.service.toString()) || found.service.toString()
  }
  return {
    workOrderId: wo._id.toString(),
    date: toDateStr(wo.date),
    stockNumber: wo.stockNumber || '',
    poNumber: wo.poNumber || '',
    vin: wo.vin || '',
    description: `${serviceName} – Stock# ${wo.stockNumber || 'N/A'} (PO#: ${wo.poNumber || 'N/A'}) (VIN: ${wo.vin || 'N/A'})`,
    serviceName,
    serviceId: rawServiceId,
    amount: Number(wo.amount) || 0,
    tax: Number(wo.tax) || 0,
    total: Number(wo.total) || 0,
    notes: wo.notes || '',
  }
}

/** Merge freshly-swept work-order line items into an existing open Draft daily invoice */
async function mergeIntoDraft(invoicesCollection: any, draft: any, newLineItems: any[], workOrders: any[], stamp?: Record<string, any>) {
  const newByWo = new Map(newLineItems.map(li => [li.workOrderId, li]))
  const kept = (draft.lineItems || []).filter((li: any) => !li.workOrderId || !newByWo.has(li.workOrderId))
  const merged = [...kept, ...newLineItems].sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''))

  const subtotal = merged.reduce((s: number, li: any) => s + (Number(li.amount) || 0), 0)
  const taxTotal = merged.reduce((s: number, li: any) => s + (Number(li.tax) || 0), 0)
  const total = merged.reduce((s: number, li: any) => s + (Number(li.total) || 0), 0)
  const workOrderIds = [...new Set([...(draft.workOrderIds || []), ...workOrders.map((wo: any) => wo._id.toString())])]

  await invoicesCollection.updateOne(
    { _id: draft._id },
    {
      $set: {
        lineItems: merged,
        subtotal: Math.round(subtotal * 100) / 100,
        taxTotal: Math.round(taxTotal * 100) / 100,
        total: Math.round(total * 100) / 100,
        workOrderIds,
        updatedAt: new Date().toISOString(),
        ...(stamp || {}),
      },
    },
  )
  return draft.number as string
}

/** Load dealer + service lookup maps shared by every generation pass */
async function loadLookups(db: any) {
  const [allDealers, allServices] = await Promise.all([
    db.collection('turboCleanDealers').find({}).toArray(),
    db.collection('turboCleanServices').find({}).toArray(),
  ])

  const dealerMap = new Map<string, any>()
  for (const d of allDealers) dealerMap.set(d._id.toString(), d)

  const serviceNameMap = new Map<string, string>()
  for (const svc of allServices) serviceNameMap.set(svc._id.toString(), svc.service || '')

  return { dealerMap, serviceNameMap }
}

/** Builds a Mongo filter matching dealer ids stored as strings OR ObjectIds */
function dealerInFilter(dealerIds: string[]): any[] {
  const variants: any[] = []
  for (const id of dealerIds) {
    variants.push(id)
    try { variants.push(new ObjectId(id)) } catch {}
  }
  return variants
}

export interface DailyGenerationResult {
  generated: number
  invoiceNumbers: string[]
  workOrdersInvoiced: number
  message: string
}

/**
 * Sweep uninvoiced work orders into Daily invoices (one per dealer per date).
 * Upserts by (type, dealerId, date) so re-runs are idempotent, marks the work
 * orders invoiced, and syncs the flag back to AppSheet through the outbox.
 *
 * opts.dealerIds — restrict to these dealers (automation scope)
 * opts.stamp     — extra fields stamped on each invoice (automation linkage)
 */
export async function generateDailyInvoices(
  db: any,
  opts: { dealerIds?: string[], stamp?: Record<string, any> } = {},
): Promise<DailyGenerationResult> {
  const { dealerMap, serviceNameMap } = await loadLookups(db)
  const invoicesCollection = db.collection('turboCleanInvoices')
  let invoiceCounter = await invoicesCollection.countDocuments()

  const woQuery: any = {
    $or: [{ isInvoiced: false }, { isInvoiced: null }, { isInvoiced: { $exists: false } }, { isInvoiced: 'no' }],
  }
  if (opts.dealerIds && opts.dealerIds.length > 0) {
    woQuery.dealer = { $in: dealerInFilter(opts.dealerIds) }
  }

  const uninvoicedWOs = await db.collection('turboCleanWorkOrders').find(woQuery).toArray()
  if (uninvoicedWOs.length === 0) {
    return { generated: 0, invoiceNumbers: [], workOrdersInvoiced: 0, message: 'No uninvoiced work orders found.' }
  }

  // Group by dealer + date string (no timezone shifts)
  const groups = new Map<string, { dealerId: string, dateStr: string, workOrders: any[] }>()
  for (const wo of uninvoicedWOs) {
    if (!wo.date) continue
    const dateStr = toDateStr(wo.date)
    const dealerId = wo.dealer?.toString() || 'unknown'
    const key = `${dealerId}__${dateStr}`
    if (!groups.has(key)) groups.set(key, { dealerId, dateStr, workOrders: [] })
    groups.get(key)!.workOrders.push(wo)
  }

  const invoiceNumbers: string[] = []

  for (const [, group] of groups) {
    const dealer = dealerMap.get(group.dealerId)

    const newLineItems = group.workOrders.map(wo => buildWorkOrderLineItem(wo, dealer, serviceNameMap))
    const dealerName = dealer?.dealer || group.dealerId
    const { year, week, weekStart, weekEnd } = getISOWeek(new Date(`${group.dateStr}T00:00:00Z`))

    // ── 1. An open Draft for this dealer+date? MERGE the new work orders in.
    //    (Never replace: earlier same-day sweeps must keep their line items.)
    const draft = await invoicesCollection.findOne({
      type: 'Daily',
      dealerId: group.dealerId,
      date: group.dateStr,
      status: 'Draft',
      isWeeklyBilled: { $ne: true },
    })

    if (draft) {
      const number = await mergeIntoDraft(invoicesCollection, draft, newLineItems, group.workOrders, opts.stamp)
      invoiceNumbers.push(number)
      continue
    }

    // ── 2. No open Draft. Build a fresh invoice for these work orders. ──
    newLineItems.sort((a, b) => a.date.localeCompare(b.date))
    const subtotal = newLineItems.reduce((s, li) => s + li.amount, 0)
    const taxTotal = newLineItems.reduce((s, li) => s + li.tax, 0)
    const total = newLineItems.reduce((s, li) => s + li.total, 0)

    invoiceCounter++
    const invNumber = `D-INV-${group.dateStr.replace(/-/g, '')}-${String(invoiceCounter).padStart(4, '0')}`

    // If a finalized invoice (Emailed/Approved/Paid or already weekly-billed)
    // exists for this dealer+date, NEVER touch it — the late work orders go on
    // a separate supplemental invoice instead.
    const finalized = await invoicesCollection.findOne(
      { type: 'Daily', dealerId: group.dealerId, date: group.dateStr },
      { projection: { number: 1 } },
    )

    const invoiceDoc: Record<string, any> = {
      number: invNumber,
      type: 'Daily',
      dealerId: group.dealerId,
      dealerName,
      dealerEmail: dealer?.email || '',
      dealerPhone: dealer?.phone || '',
      dealerAddress: dealer?.address || '',
      status: 'Draft',
      date: group.dateStr,
      dueDate: (() => {
        const d = new Date(`${group.dateStr}T00:00:00Z`)
        d.setUTCDate(d.getUTCDate() + 15)
        return d.toISOString().split('T')[0]
      })(),
      weekNumber: week,
      weekYear: year,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      lineItems: newLineItems,
      subtotal: Math.round(subtotal * 100) / 100,
      taxTotal: Math.round(taxTotal * 100) / 100,
      total: Math.round(total * 100) / 100,
      paidAmount: 0,
      paymentMethod: '',
      notes: finalized
        ? `Supplemental Daily Invoice for ${dealerName} on ${group.dateStr} (late work orders — original: ${finalized.number})`
        : `Daily Invoice for ${dealerName} on ${group.dateStr}`,
      isWeeklyBilled: false,
      workOrderIds: group.workOrders.map(wo => wo._id.toString()),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(finalized ? { supplementOf: finalized.number } : {}),
      ...(opts.stamp || {}),
    }

    try {
      await invoicesCollection.insertOne(invoiceDoc as any)
      invoiceNumbers.push(invoiceDoc.number)
    }
    catch (e: any) {
      // Unique-index race: a concurrent run created the Draft first — merge into it
      if (e?.code === 11000) {
        const raceDraft = await invoicesCollection.findOne({
          type: 'Daily',
          dealerId: group.dealerId,
          date: group.dateStr,
          status: 'Draft',
          isWeeklyBilled: { $ne: true },
        })
        if (raceDraft) {
          const number = await mergeIntoDraft(invoicesCollection, raceDraft, newLineItems, group.workOrders, opts.stamp)
          invoiceNumbers.push(number)
          continue
        }
      }
      throw e
    }
  }

  // Mark WOs as invoiced
  const updatedWoIds = uninvoicedWOs.map((w: any) => w._id)
  await db.collection('turboCleanWorkOrders').updateMany(
    { _id: { $in: updatedWoIds } },
    { $set: { isInvoiced: true } },
  )

  // Sync the isInvoiced flag to AppSheet in batches (outbox-backed, retried automatically)
  try {
    const rows = uninvoicedWOs.map((wo: any) => {
      wo.isInvoiced = true
      return WorkOrdersMapper.toAppSheet(wo)
    })
    for (let i = 0; i < rows.length; i += 100) {
      await syncToAppSheet(db, 'WorkOrders', 'Edit', rows.slice(i, i + 100))
    }
  }
  catch (err) {
    console.error('[Invoice Generation] AppSheet work-order sync error:', err)
  }

  return {
    generated: invoiceNumbers.length,
    invoiceNumbers,
    workOrdersInvoiced: uninvoicedWOs.length,
    message: `Generated/updated ${invoiceNumbers.length} daily invoices.`,
  }
}

export interface WeeklyRollupResult {
  generated: number
  invoiceNumbers: string[]
  message: string
}

/**
 * Roll unbilled Daily invoices up into Weekly invoices (one per dealer per ISO week).
 *
 * opts.dealerIds       — restrict to these dealers (automation scope)
 * opts.completedBefore — only include dailies from weeks that ENDED before this
 *                        instant (automations use the current week's start, so a
 *                        Monday run bills the completed prior week — never the
 *                        week that's still in progress)
 * opts.stamp           — extra fields stamped on each invoice (automation linkage)
 */
export async function generateWeeklyRollups(
  db: any,
  opts: { dealerIds?: string[], completedBefore?: Date, stamp?: Record<string, any> } = {},
): Promise<WeeklyRollupResult> {
  const { dealerMap } = await loadLookups(db)
  const invoicesCollection = db.collection('turboCleanInvoices')
  let invoiceCounter = await invoicesCollection.countDocuments()

  const query: any = { type: 'Daily', isWeeklyBilled: { $ne: true } }
  if (opts.dealerIds && opts.dealerIds.length > 0) {
    query.dealerId = { $in: opts.dealerIds }
  }

  let unbilledDaily = await invoicesCollection.find(query).toArray()

  if (opts.completedBefore) {
    const boundary = opts.completedBefore.getTime()
    unbilledDaily = unbilledDaily.filter((inv: any) => {
      const end = inv.weekEnd ? new Date(inv.weekEnd).getTime() : 0
      return end > 0 && end < boundary
    })
  }

  if (unbilledDaily.length === 0) {
    return { generated: 0, invoiceNumbers: [], message: 'No unbilled daily invoices found.' }
  }

  const groups = new Map<string, { dealerId: string, dealer: any, year: number, week: number, weekStart: Date, weekEnd: Date, dailyInvoices: any[] }>()
  for (const inv of unbilledDaily) {
    const key = `${inv.dealerId}__${inv.weekYear}_W${inv.weekNumber}`
    if (!groups.has(key)) {
      groups.set(key, {
        dealerId: inv.dealerId,
        dealer: dealerMap.get(inv.dealerId),
        year: inv.weekYear,
        week: inv.weekNumber,
        weekStart: new Date(inv.weekStart),
        weekEnd: new Date(inv.weekEnd),
        dailyInvoices: [],
      })
    }
    groups.get(key)!.dailyInvoices.push(inv)
  }

  const newInvoices: any[] = []
  const invoiceNumbers: string[] = []

  for (const [key, group] of groups) {
    invoiceCounter++
    const invNumber = `W-INV-${group.year}-${String(invoiceCounter).padStart(5, '0')}`

    const lineItems = group.dailyInvoices.flatMap((dInv: any) =>
      (dInv.lineItems || []).map((li: any) => ({ ...li, invoiceId: dInv._id.toString(), dailyInvoiceTag: dInv.number })),
    )
    lineItems.sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''))

    const subtotal = lineItems.reduce((s: number, li: any) => s + (li.amount || 0), 0)
    const taxTotal = lineItems.reduce((s: number, li: any) => s + (li.tax || 0), 0)
    const total = lineItems.reduce((s: number, li: any) => s + (li.total || 0), 0)

    const dealerName = group.dealer?.dealer || group.dealerId
    const invoiceDate = group.weekEnd.toISOString().split('T')[0]

    const doc = {
      number: invNumber,
      type: 'Weekly',
      weekKey: key,
      dealerId: group.dealerId,
      dealerName,
      dealerEmail: group.dealer?.email || '',
      dealerPhone: group.dealer?.phone || '',
      dealerAddress: group.dealer?.address || '',
      status: 'Draft',
      date: invoiceDate,
      dueDate: new Date(group.weekEnd.getTime() + 30 * 86400000).toISOString().split('T')[0],
      weekNumber: group.week,
      weekYear: group.year,
      weekStart: group.weekStart.toISOString(),
      weekEnd: group.weekEnd.toISOString(),
      lineItems,
      subtotal: Math.round(subtotal * 100) / 100,
      taxTotal: Math.round(taxTotal * 100) / 100,
      total: Math.round(total * 100) / 100,
      paidAmount: 0,
      paymentMethod: '',
      notes: `Weekly Rollup for ${dealerName} – Week ${group.week}, ${group.year}`,
      createdAt: new Date().toISOString(),
      ...(opts.stamp || {}),
    }
    newInvoices.push(doc)
    invoiceNumbers.push(invNumber)
  }

  if (newInvoices.length > 0) {
    await invoicesCollection.insertMany(newInvoices)
    const updatedInvIds = unbilledDaily.map((i: any) => i._id)
    await invoicesCollection.updateMany({ _id: { $in: updatedInvIds } }, { $set: { isWeeklyBilled: true } })
  }

  return {
    generated: newInvoices.length,
    invoiceNumbers,
    message: `Generated ${newInvoices.length} weekly invoices.`,
  }
}
