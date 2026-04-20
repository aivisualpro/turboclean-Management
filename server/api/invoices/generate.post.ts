import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { appSheetEdit } from '../../utils/appsheet'
import { WorkOrdersMapper } from '../../utils/sync-mapper'

// Returns YYYY-MM-DD string from a work order's date field (handles ISODate or string)
function toDateStr(d: any): string {
  if (!d) return ''
  if (typeof d === 'string') return d.split('T')[0] as string
  if (d instanceof Date) return d.toISOString().split('T')[0] as string
  return String(d).split('T')[0] as string
}

function getISOWeek(date: Date): { year: number; week: number; weekStart: Date; weekEnd: Date } {
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
function buildLineItem(wo: any, dealer: any, serviceNameMap: Map<string, string>) {
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

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const body = await readBody(event) || {}
    const generateType = body.type || 'daily' // 'daily' | 'weekly' | 'custom_weekly'

    const allDealers = await db.collection('turboCleanDealers').find({}).toArray()
    const allServices = await db.collection('turboCleanServices').find({}).toArray()

    const dealerMap = new Map<string, any>()
    for (const d of allDealers) dealerMap.set(d._id.toString(), d)

    const serviceNameMap = new Map<string, string>()
    for (const svc of allServices) serviceNameMap.set(svc._id.toString(), svc.service || '')

    const invoicesCollection = db.collection('turboCleanInvoices')
    let invoiceCounter = await invoicesCollection.countDocuments()

    // ─────────────────────────────────────────────────────────────────
    // SHARED HELPER: rebuild/upsert a daily invoice for a dealer+date
    // ─────────────────────────────────────────────────────────────────
    async function upsertDailyInvoice(dealerId: string, dateStr: string, workOrders: any[]) {
      const dealer = dealerMap.get(dealerId)
      invoiceCounter++
      const invNumber = `D-INV-${dateStr.replace(/-/g, '')}-${String(invoiceCounter).padStart(4, '0')}`

      const lineItems = workOrders.map(wo => buildLineItem(wo, dealer, serviceNameMap))
      lineItems.sort((a, b) => a.date.localeCompare(b.date))

      const subtotal = lineItems.reduce((s, li) => s + li.amount, 0)
      const taxTotal = lineItems.reduce((s, li) => s + li.tax, 0)
      const total = lineItems.reduce((s, li) => s + li.total, 0)

      const dealerName = dealer?.dealer || dealerId
      const { year, week, weekStart, weekEnd } = getISOWeek(new Date(dateStr + 'T00:00:00Z'))

      const invoiceDoc = {
        number: invNumber,
        type: 'Daily',
        dealerId,
        dealerName,
        dealerEmail: dealer?.email || '',
        dealerPhone: dealer?.phone || '',
        dealerAddress: dealer?.address || '',
        status: 'Draft',
        date: dateStr,
        dueDate: (() => {
          const d = new Date(dateStr + 'T00:00:00Z')
          d.setUTCDate(d.getUTCDate() + 15)
          return d.toISOString().split('T')[0]
        })(),
        weekNumber: week,
        weekYear: year,
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        lineItems,
        subtotal: Math.round(subtotal * 100) / 100,
        taxTotal: Math.round(taxTotal * 100) / 100,
        total: Math.round(total * 100) / 100,
        paidAmount: 0,
        paymentMethod: '',
        notes: `Daily Invoice for ${dealerName} on ${dateStr}`,
        isWeeklyBilled: false,
        workOrderIds: workOrders.map(wo => wo._id.toString()),
        updatedAt: new Date().toISOString(),
      }

      // Upsert: replace existing daily invoice for same dealer+date if exists
      await invoicesCollection.updateOne(
        { type: 'Daily', dealerId, date: dateStr },
        { $set: invoiceDoc, $setOnInsert: { createdAt: new Date().toISOString() } },
        { upsert: true }
      )

      return invoiceDoc
    }

    // ─────────────────────────────────────────────────────────────────
    // GENERATE DAILY
    // ─────────────────────────────────────────────────────────────────
    if (generateType === 'daily') {
      const uninvoicedWOs = await db.collection('turboCleanWorkOrders').find({
        $or: [{ isInvoiced: false }, { isInvoiced: null }, { isInvoiced: { $exists: false } }, { isInvoiced: 'no' }]
      }).toArray()

      if (uninvoicedWOs.length === 0) return { success: true, generated: 0, message: 'No uninvoiced work orders found.' }

      // Group by dealer + date string (no timezone shifts)
      const groups = new Map<string, { dealerId: string; dateStr: string; workOrders: any[] }>()
      for (const wo of uninvoicedWOs) {
        if (!wo.date) continue
        const dateStr = toDateStr(wo.date)
        const dealerId = wo.dealer?.toString() || 'unknown'
        const key = `${dealerId}__${dateStr}`
        if (!groups.has(key)) groups.set(key, { dealerId, dateStr, workOrders: [] })
        groups.get(key)!.workOrders.push(wo)
      }

      let generated = 0
      for (const [, group] of groups) {
        await upsertDailyInvoice(group.dealerId, group.dateStr, group.workOrders)
        generated++
      }

      // Mark WOs as invoiced
      const updatedWoIds = uninvoicedWOs.map((w: any) => w._id)
      await db.collection('turboCleanWorkOrders').updateMany(
        { _id: { $in: updatedWoIds } },
        { $set: { isInvoiced: true } }
      )

      // Sync to AppSheet
      try {
        const rows = uninvoicedWOs.map(wo => { wo.isInvoiced = true; return WorkOrdersMapper.toAppSheet(wo) })
        for (let i = 0; i < rows.length; i += 100) await appSheetEdit('WorkOrders', rows.slice(i, i + 100))
      } catch (err) { console.error('[AppSheet Sync Error]', err) }

      return { success: true, generated, message: `Generated/updated ${generated} daily invoices.` }

    // ─────────────────────────────────────────────────────────────────
    // GENERATE WEEKLY (from unbilled daily invoices)
    // ─────────────────────────────────────────────────────────────────
    } else if (generateType === 'weekly') {
      const unbilledDaily = await invoicesCollection.find({ type: 'Daily', isWeeklyBilled: { $ne: true } }).toArray()
      if (unbilledDaily.length === 0) return { success: true, generated: 0, message: 'No unbilled daily invoices found.' }

      const groups = new Map<string, { dealerId: string; dealer: any; year: number; week: number; weekStart: Date; weekEnd: Date; dailyInvoices: any[] }>()
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
            dailyInvoices: []
          })
        }
        groups.get(key)!.dailyInvoices.push(inv)
      }

      const newInvoices: any[] = []
      for (const [key, group] of groups) {
        invoiceCounter++
        const invNumber = `W-INV-${group.year}-${String(invoiceCounter).padStart(5, '0')}`

        const lineItems = group.dailyInvoices.flatMap((dInv: any) =>
          (dInv.lineItems || []).map((li: any) => ({ ...li, invoiceId: dInv._id.toString(), dailyInvoiceTag: dInv.number }))
        )
        lineItems.sort((a, b) => a.date.localeCompare(b.date))

        const subtotal = lineItems.reduce((s, li) => s + li.amount, 0)
        const taxTotal = lineItems.reduce((s, li) => s + li.tax, 0)
        const total = lineItems.reduce((s, li) => s + li.total, 0)

        const dealerName = group.dealer?.dealer || group.dealerId
        const invoiceDate = group.weekEnd.toISOString().split('T')[0]

        newInvoices.push({
          number: invNumber, type: 'Weekly', weekKey: key,
          dealerId: group.dealerId, dealerName,
          dealerEmail: group.dealer?.email || '', dealerPhone: group.dealer?.phone || '', dealerAddress: group.dealer?.address || '',
          status: 'Draft', date: invoiceDate,
          dueDate: new Date(group.weekEnd.getTime() + 30 * 86400000).toISOString().split('T')[0],
          weekNumber: group.week, weekYear: group.year,
          weekStart: group.weekStart.toISOString(), weekEnd: group.weekEnd.toISOString(),
          lineItems,
          subtotal: Math.round(subtotal * 100) / 100,
          taxTotal: Math.round(taxTotal * 100) / 100,
          total: Math.round(total * 100) / 100,
          paidAmount: 0, paymentMethod: '',
          notes: `Weekly Rollup for ${dealerName} – Week ${group.week}, ${group.year}`,
          createdAt: new Date().toISOString(),
        })
      }

      if (newInvoices.length > 0) {
        await invoicesCollection.insertMany(newInvoices)
        const updatedInvIds = unbilledDaily.map((i: any) => i._id)
        await invoicesCollection.updateMany({ _id: { $in: updatedInvIds } }, { $set: { isWeeklyBilled: true } })
      }

      return { success: true, generated: newInvoices.length, message: `Generated ${newInvoices.length} weekly invoices.` }

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

      const possibleDealerIds: any[] = [dealerId]
      try { possibleDealerIds.push(new ObjectId(dealerId)) } catch {}

      // Fetch ALL work orders for this dealer and filter in memory to avoid MongoDB type errors with mixed date types
      const rawWOs = await db.collection('turboCleanWorkOrders').find({
        dealer: { $in: possibleDealerIds }
      }).toArray()

      const allWOs = rawWOs.filter(wo => {
        if (!wo.date) return false
        const dStr = toDateStr(wo.date)
        return dStr >= startStr && dStr <= endStr
      })

      if (allWOs.length === 0) {
        return { success: false, message: `No work orders found for selected dealer between ${startStr} and ${endStr}.` }
      }

      const dealer = dealerMap.get(dealerId) || { dealer: dealerId }

      const lineItems = allWOs.map(wo => buildLineItem(wo, dealer, serviceNameMap))
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
