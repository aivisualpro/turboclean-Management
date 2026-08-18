import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { generateDailyInvoices, generateWeeklyRollups, buildWorkOrderLineItem } from '../../utils/invoice-generation'

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const body = await readBody(event) || {}
    const generateType = body.type || 'daily' // 'daily' | 'weekly' | 'custom_weekly'

    // ─────────────────────────────────────────────────────────────────
    // GENERATE DAILY — shared engine (also used by automations)
    // ─────────────────────────────────────────────────────────────────
    if (generateType === 'daily') {
      const result = await generateDailyInvoices(db)
      return { success: true, generated: result.generated, message: result.message }

      // ─────────────────────────────────────────────────────────────────
      // GENERATE WEEKLY (from unbilled daily invoices) — shared engine
      // ─────────────────────────────────────────────────────────────────
    } else if (generateType === 'weekly') {
      const result = await generateWeeklyRollups(db)
      return { success: true, generated: result.generated, message: result.message }

      // ─────────────────────────────────────────────────────────────────
      // CUSTOM WEEKLY — combine ALL work orders in date range (invoiced or not)
      // ─────────────────────────────────────────────────────────────────
    } else if (generateType === 'custom_weekly') {
      const { dealerId, startDate, endDate } = body
      if (!dealerId || !startDate || !endDate) return { success: false, message: 'Missing required fields' }

      const startStr = startDate as string
      const endStr = endDate as string

      // Validate max 7-day range
      const daysDiff = (new Date(endStr).getTime() - new Date(startStr).getTime()) / 86400000
      if (daysDiff > 7) return { success: false, message: 'Date range cannot exceed 7 days' }

      const invoicesCollection = db.collection('turboCleanInvoices')
      let invoiceCounter = await invoicesCollection.countDocuments()

      const allDealers = await db.collection('turboCleanDealers').find({}).toArray()
      const allServices = await db.collection('turboCleanServices').find({}).toArray()
      const dealerMap = new Map<string, any>()
      for (const d of allDealers) dealerMap.set(d._id.toString(), d)
      const serviceNameMap = new Map<string, string>()
      for (const svc of allServices) serviceNameMap.set(svc._id.toString(), svc.service || '')

      const possibleDealerIds: any[] = [dealerId]
      try { possibleDealerIds.push(new ObjectId(dealerId)) } catch { }

      // Fetch ALL work orders in date range (invoiced or not) using string-safe date comparison
      const allWOs = await db.collection('turboCleanWorkOrders').aggregate([
        { $match: { dealer: { $in: possibleDealerIds } } },
        { $addFields: { dateStr: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: 'UTC' } } } },
        { $match: { dateStr: { $gte: startStr, $lte: endStr } } }
      ]).toArray()

      if (allWOs.length === 0) {
        return { success: false, message: `No work orders found for selected dealer between ${startStr} and ${endStr}.` }
      }

      const dealer = dealerMap.get(dealerId) || { dealer: dealerId }

      const lineItems = allWOs.map(wo => buildWorkOrderLineItem(wo, dealer, serviceNameMap))
      lineItems.sort((a, b) => a.date.localeCompare(b.date))

      const subtotal = lineItems.reduce((s, li) => s + li.amount, 0)
      const taxTotal = lineItems.reduce((s, li) => s + li.tax, 0)
      const total = lineItems.reduce((s, li) => s + li.total, 0)

      // ── Upsert: check for existing invoice for same dealer + date range ──
      const existingInvoice = await invoicesCollection.findOne({
        type: 'Weekly',
        dealerId,
        customStartDate: startStr,
        customEndDate: endStr,
      })

      // Keep the original invoice number if updating, otherwise generate new
      const invNumber = existingInvoice
        ? existingInvoice.number
        : (() => { invoiceCounter++; return `W-INV-${startStr.replace(/-/g, '')}-${String(invoiceCounter).padStart(4, '0')}` })()

      const invoiceDoc = {
        number: invNumber,
        type: 'Weekly',
        customStartDate: startStr,
        customEndDate: endStr,
        dealerId,
        dealerName: dealer.dealer || dealerId,
        dealerEmail: dealer.email || '',
        dealerPhone: dealer.phone || '',
        dealerAddress: dealer.address || '',
        status: existingInvoice?.status || 'Draft',
        date: endStr,
        dueDate: (() => {
          const d = new Date(endStr + 'T00:00:00Z')
          d.setUTCDate(d.getUTCDate() + 30)
          return d.toISOString().split('T')[0]
        })(),
        weekStart: startStr + 'T00:00:00.000Z',
        weekEnd: endStr + 'T23:59:59.999Z',
        lineItems,
        subtotal: Math.round(subtotal * 100) / 100,
        taxTotal: Math.round(taxTotal * 100) / 100,
        total: Math.round(total * 100) / 100,
        paidAmount: existingInvoice?.paidAmount || 0,
        paymentMethod: existingInvoice?.paymentMethod || '',
        notes: `Custom Weekly Invoice for ${dealer.dealer || dealerId} (${startStr} to ${endStr})`,
        isWeeklyBilled: true,
        workOrderIds: allWOs.map(wo => wo._id.toString()),
        updatedAt: new Date().toISOString(),
      }

      // Upsert: replace existing or insert new
      await invoicesCollection.updateOne(
        { type: 'Weekly', dealerId, customStartDate: startStr, customEndDate: endStr },
        { $set: invoiceDoc, $setOnInsert: { createdAt: new Date().toISOString() } },
        { upsert: true }
      )

      // Mark all included WOs as invoiced (MongoDB only — no AppSheet sync for weekly)
      await db.collection('turboCleanWorkOrders').updateMany(
        { _id: { $in: allWOs.map(w => w._id) } },
        { $set: { isInvoiced: true } }
      )

      const action = existingInvoice ? 'updated' : 'created'
      return { success: true, generated: 1, message: `Weekly invoice ${invNumber} ${action} with ${allWOs.length} work orders (${startStr} to ${endStr}).` }
    }

    return { success: false, message: 'Invalid generation type' }
  } catch (error: any) {
    console.error('Error generating invoices:', error)
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to generate invoices' })
  }
})
