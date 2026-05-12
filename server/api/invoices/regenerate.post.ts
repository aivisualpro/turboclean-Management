import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

/**
 * POST /api/invoices/regenerate
 * Rebuilds an existing daily invoice by re-scanning ALL work orders
 * for the same dealer + date. Any work orders that were added after
 * the original invoice was generated will be picked up and included.
 *
 * Body: { invoiceId: string }
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
    const { invoiceId } = body

    if (!invoiceId) {
      return { success: false, message: 'invoiceId is required' }
    }

    // ── Load the existing invoice ──
    const invoicesCol = db.collection('turboCleanInvoices')
    let invoiceQuery: any = { _id: invoiceId }
    try { invoiceQuery = { _id: new ObjectId(invoiceId) } } catch {}

    const invoice = await invoicesCol.findOne(invoiceQuery)
    if (!invoice) {
      return { success: false, message: 'Invoice not found' }
    }

    const dealerId = invoice.dealerId
    const dateStr = invoice.date // YYYY-MM-DD

    if (!dealerId || !dateStr) {
      return { success: false, message: 'Invoice is missing dealer or date info' }
    }

    // ── Build possible dealer ID formats for matching ──
    const possibleDealerIds: any[] = [dealerId]
    try { possibleDealerIds.push(new ObjectId(dealerId)) } catch {}

    // ── Determine date range based on invoice type ──
    let rangeStart = dateStr
    let rangeEnd = dateStr

    if (invoice.type === 'Weekly') {
      rangeStart = invoice.customStartDate || (invoice.weekStart ? toDateStr(invoice.weekStart) : dateStr)
      rangeEnd = invoice.customEndDate || (invoice.weekEnd ? toDateStr(invoice.weekEnd) : dateStr)
    }

    // ── Find ALL work orders for this dealer in the date range ──
    const allWOs = await db.collection('turboCleanWorkOrders').aggregate([
      { $match: { dealer: { $in: possibleDealerIds } } },
      { $addFields: { dateStr: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: 'UTC' } } } },
      { $match: { dateStr: { $gte: rangeStart, $lte: rangeEnd } } }
    ]).toArray()

    if (allWOs.length === 0) {
      return { success: false, message: 'No work orders found for this dealer and date range' }
    }

    // ── Load dealer + services for line item construction ──
    const dealer = await db.collection('turboCleanDealers').findOne({
      _id: possibleDealerIds[1] || possibleDealerIds[0]
    })
    const allServices = await db.collection('turboCleanServices').find({}).toArray()
    const serviceNameMap = new Map<string, string>()
    for (const svc of allServices) serviceNameMap.set(svc._id.toString(), svc.service || '')

    function buildLineItem(wo: any) {
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

    // ── Rebuild line items from ALL work orders ──
    const lineItems = allWOs.map(buildLineItem)
    lineItems.sort((a, b) => a.date.localeCompare(b.date))

    const subtotal = lineItems.reduce((s, li) => s + li.amount, 0)
    const taxTotal = lineItems.reduce((s, li) => s + li.tax, 0)
    const total = lineItems.reduce((s, li) => s + li.total, 0)

    const previousCount = (invoice.lineItems || []).length
    const newCount = lineItems.length
    const addedCount = newCount - previousCount

    // ── Update the invoice ──
    await invoicesCol.updateOne(
      { _id: invoice._id },
      {
        $set: {
          lineItems,
          subtotal: Math.round(subtotal * 100) / 100,
          taxTotal: Math.round(taxTotal * 100) / 100,
          total: Math.round(total * 100) / 100,
          workOrderIds: allWOs.map(wo => wo._id.toString()),
          updatedAt: new Date().toISOString(),
        }
      }
    )

    // ── Mark all included WOs as invoiced ──
    await db.collection('turboCleanWorkOrders').updateMany(
      { _id: { $in: allWOs.map(w => w._id) } },
      { $set: { isInvoiced: true } }
    )

    // ── Also rebuild any parent weekly invoices covering these dates ──
    const weeklyInvoices = await invoicesCol.find({
      type: 'Weekly',
      dealerId,
      $or: [
        { customStartDate: { $lte: rangeEnd }, customEndDate: { $gte: rangeStart } },
        { weekStart: { $lte: rangeEnd + 'T23:59:59.999Z' }, weekEnd: { $gte: rangeStart + 'T00:00:00.000Z' } },
      ]
    }).toArray()

    for (const weeklyInv of weeklyInvoices) {
      const wStart = weeklyInv.customStartDate || (weeklyInv.weekStart ? toDateStr(weeklyInv.weekStart) : null)
      const wEnd = weeklyInv.customEndDate || (weeklyInv.weekEnd ? toDateStr(weeklyInv.weekEnd) : null)
      if (!wStart || !wEnd) continue

      const allWOsInRange = await db.collection('turboCleanWorkOrders').aggregate([
        { $match: { dealer: { $in: possibleDealerIds } } },
        { $addFields: { dateStr: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: 'UTC' } } } },
        { $match: { dateStr: { $gte: wStart, $lte: wEnd } } }
      ]).toArray()

      const weeklyLineItems = allWOsInRange.map(buildLineItem)
      weeklyLineItems.sort((a: any, b: any) => a.date.localeCompare(b.date))

      const wSubtotal = weeklyLineItems.reduce((s: number, li: any) => s + li.amount, 0)
      const wTaxTotal = weeklyLineItems.reduce((s: number, li: any) => s + li.tax, 0)
      const wTotal = weeklyLineItems.reduce((s: number, li: any) => s + li.total, 0)

      await invoicesCol.updateOne(
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
      message: addedCount > 0
        ? `Invoice regenerated: ${addedCount} new work order${addedCount > 1 ? 's' : ''} added (${newCount} total)`
        : `Invoice regenerated: already up to date (${newCount} work orders)`,
      previousCount,
      newCount,
      addedCount,
      weeklyUpdated: weeklyInvoices.length,
    }
  } catch (error: any) {
    console.error('[Invoice Regenerate Error]', error)
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to regenerate invoice' })
  }
})
