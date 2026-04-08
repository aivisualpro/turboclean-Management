import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

/**
 * POST /api/invoices/sync-work-order
 * Called automatically after any work order is created or updated.
 * Rebuilds the daily invoice that contains that work order,
 * and fully rebuilds any parent weekly invoice covering the same date range.
 */

function toDateStr(d: any): string {
  if (!d) return ''
  if (typeof d === 'string') return d.split('T')[0] as string
  if (d instanceof Date) return d.toISOString().split('T')[0] as string
  return String(d).split('T')[0] as string
}

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const body = await readBody(event) || {}
    const { workOrderId } = body

    if (!workOrderId) return { success: false, message: 'workOrderId required' }

    // Load the work order
    let woQuery: any = { _id: workOrderId }
    try { woQuery = { _id: new ObjectId(workOrderId) } } catch {}
    const wo = await db.collection('turboCleanWorkOrders').findOne(woQuery)
    if (!wo) return { success: false, message: 'Work order not found' }

    const dealerId = wo.dealer?.toString() || ''
    const dateStr = toDateStr(wo.date)
    if (!dealerId || !dateStr) return { success: false, message: 'Work order missing dealer or date' }

    // Load all work orders for this dealer on this date
    const possibleDealerIds: any[] = [dealerId]
    try { possibleDealerIds.push(new ObjectId(dealerId)) } catch {}

    const siblingWOs = await db.collection('turboCleanWorkOrders').aggregate([
      { $match: { dealer: { $in: possibleDealerIds } } },
      { $addFields: { dateStr: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: 'UTC' } } } },
      { $match: { dateStr } }
    ]).toArray()

    // Load dealer and services
    const dealer = await db.collection('turboCleanDealers').findOne({ _id: possibleDealerIds[1] || possibleDealerIds[0] })
    const allServices = await db.collection('turboCleanServices').find({}).toArray()
    const serviceNameMap = new Map<string, string>()
    for (const svc of allServices) serviceNameMap.set(svc._id.toString(), svc.service || '')

    function buildLineItem(w: any) {
      const rawServiceId = w.dealerServiceId?.toString() || ''
      let serviceName = rawServiceId
      if (rawServiceId && dealer?.services && Array.isArray(dealer.services)) {
        const found = dealer.services.find((s: any) => (s.id || s._id || '').toString() === rawServiceId)
        if (found?.service) serviceName = serviceNameMap.get(found.service.toString()) || found.service.toString()
      }
      return {
        workOrderId: w._id.toString(),
        date: toDateStr(w.date),
        stockNumber: w.stockNumber || '',
        poNumber: w.poNumber || '',
        vin: w.vin || '',
        description: `${serviceName} – Stock# ${w.stockNumber || 'N/A'} (PO#: ${w.poNumber || 'N/A'}) (VIN: ${w.vin || 'N/A'})`,
        serviceName,
        serviceId: rawServiceId,
        amount: Number(w.amount) || 0,
        tax: Number(w.tax) || 0,
        total: Number(w.total) || 0,
        notes: w.notes || '',
      }
    }

    const lineItems = siblingWOs.map(buildLineItem)
    lineItems.sort((a, b) => a.date.localeCompare(b.date))

    const subtotal = lineItems.reduce((s, li) => s + li.amount, 0)
    const taxTotal = lineItems.reduce((s, li) => s + li.tax, 0)
    const total = lineItems.reduce((s, li) => s + li.total, 0)

    // Upsert daily invoice
    const result = await db.collection('turboCleanInvoices').findOneAndUpdate(
      { type: 'Daily', dealerId, date: dateStr },
      {
        $set: {
          lineItems,
          subtotal: Math.round(subtotal * 100) / 100,
          taxTotal: Math.round(taxTotal * 100) / 100,
          total: Math.round(total * 100) / 100,
          workOrderIds: siblingWOs.map(w => w._id.toString()),
          updatedAt: new Date().toISOString(),
        }
      },
      { returnDocument: 'after' }
    )

    // ── Rebuild ALL weekly invoices that cover this date ──
    // Find weekly invoices for this dealer where dateStr falls within the range
    const weeklyInvoices = await db.collection('turboCleanInvoices').find({
      type: 'Weekly',
      dealerId,
      $or: [
        // Custom weekly invoices with explicit start/end dates
        { customStartDate: { $lte: dateStr }, customEndDate: { $gte: dateStr } },
        // Standard weekly invoices with weekStart/weekEnd
        { weekStart: { $lte: dateStr + 'T23:59:59.999Z' }, weekEnd: { $gte: dateStr + 'T00:00:00.000Z' } },
        // Also match by workOrderId (existing line items)
        { 'lineItems.workOrderId': workOrderId },
      ]
    }).toArray()

    for (const weeklyInv of weeklyInvoices) {
      // Determine the date range for this weekly invoice
      const rangeStart = weeklyInv.customStartDate || (weeklyInv.weekStart ? toDateStr(weeklyInv.weekStart) : null)
      const rangeEnd = weeklyInv.customEndDate || (weeklyInv.weekEnd ? toDateStr(weeklyInv.weekEnd) : null)

      if (!rangeStart || !rangeEnd) continue

      // Re-query ALL work orders in this weekly invoice's date range
      const allWOsInRange = await db.collection('turboCleanWorkOrders').aggregate([
        { $match: { dealer: { $in: possibleDealerIds } } },
        { $addFields: { dateStr: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: 'UTC' } } } },
        { $match: { dateStr: { $gte: rangeStart, $lte: rangeEnd } } }
      ]).toArray()

      // Rebuild line items from scratch
      const weeklyLineItems = allWOsInRange.map(buildLineItem)
      weeklyLineItems.sort((a: any, b: any) => a.date.localeCompare(b.date))

      const wSubtotal = weeklyLineItems.reduce((s: number, li: any) => s + li.amount, 0)
      const wTaxTotal = weeklyLineItems.reduce((s: number, li: any) => s + li.tax, 0)
      const wTotal = weeklyLineItems.reduce((s: number, li: any) => s + li.total, 0)

      await db.collection('turboCleanInvoices').updateOne(
        { _id: weeklyInv._id },
        {
          $set: {
            lineItems: weeklyLineItems,
            subtotal: Math.round(wSubtotal * 100) / 100,
            taxTotal: Math.round(wTaxTotal * 100) / 100,
            total: Math.round(wTotal * 100) / 100,
            workOrderIds: allWOsInRange.map(w => w._id.toString()),
            updatedAt: new Date().toISOString(),
          }
        }
      )
    }

    return {
      success: true,
      message: `Invoice synced for dealer ${dealerId} on ${dateStr}`,
      weeklyUpdated: weeklyInvoices.length,
    }
  } catch (error: any) {
    console.error('[Invoice Sync Error]', error)
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to sync invoice' })
  }
})

