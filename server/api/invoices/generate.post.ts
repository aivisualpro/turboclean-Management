import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

// Get ISO week number from date
function getISOWeek(date: Date): { year: number; week: number; weekStart: Date; weekEnd: Date } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)

  // Calculate week start (Monday) and end (Sunday)
  const dayOfWeek = date.getUTCDay() || 7 // 1=Mon, 7=Sun
  const weekStart = new Date(date)
  weekStart.setDate(date.getDate() - dayOfWeek + 1)
  weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  weekEnd.setHours(23, 59, 59, 999)

  return { year: d.getUTCFullYear(), week: weekNo, weekStart, weekEnd }
}

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()

    // Fetch all data
    const [allWorkOrders, allDealers, allServices] = await Promise.all([
      db.collection('turboCleanWorkOrders').find({}).toArray(),
      db.collection('turboCleanDealers').find({}).toArray(),
      db.collection('turboCleanServices').find({}).toArray(),
    ])

    // Build lookup maps
    const dealerMap = new Map<string, any>()
    for (const d of allDealers) {
      dealerMap.set(d._id.toString(), d)
    }
    const serviceNameMap = new Map<string, string>()
    for (const svc of allServices) {
      serviceNameMap.set(svc._id.toString(), svc.service || '')
    }

    // Group work orders by dealer + week
    const groups = new Map<string, {
      dealerId: string
      dealer: any
      year: number
      week: number
      weekStart: Date
      weekEnd: Date
      workOrders: any[]
    }>()

    for (const wo of allWorkOrders) {
      const d = wo.date ? new Date(wo.date) : null
      if (!d || isNaN(d.getTime())) continue

      const dealerId = wo.dealer?.toString() || 'unknown'
      const { year, week, weekStart, weekEnd } = getISOWeek(d)
      const key = `${dealerId}__${year}_W${week}`

      if (!groups.has(key)) {
        const dealer = dealerMap.get(dealerId)
        groups.set(key, {
          dealerId,
          dealer,
          year,
          week,
          weekStart,
          weekEnd,
          workOrders: [],
        })
      }

      groups.get(key)!.workOrders.push(wo)
    }

    // Generate invoices
    const invoicesCollection = db.collection('turboCleanInvoices')

    // Check existing invoices to avoid duplicates (by weekKey)
    const existingInvoices = await invoicesCollection.find({}).project({ weekKey: 1 }).toArray()
    const existingKeys = new Set(existingInvoices.map((inv: any) => inv.weekKey))

    const newInvoices: any[] = []
    let invoiceCounter = await invoicesCollection.countDocuments()

    for (const [key, group] of groups) {
      if (existingKeys.has(key)) continue // Skip already generated

      invoiceCounter++
      const invNumber = `INV-${group.year}-${String(invoiceCounter).padStart(5, '0')}`

      // Build line items from work orders
      const lineItems = group.workOrders.map((wo: any) => {
        const rawServiceId = wo.dealerServiceId?.toString() || ''
        let serviceName = rawServiceId

        if (rawServiceId && group.dealer?.services && Array.isArray(group.dealer.services)) {
          const found = group.dealer.services.find((s: any) => {
            const sId = (s.id || s._id || '').toString()
            return sId === rawServiceId
          })
          if (found?.service) {
            serviceName = serviceNameMap.get(found.service.toString()) || found.service.toString()
          }
        }

        return {
          workOrderId: wo._id.toString(),
          date: wo.date ? new Date(wo.date).toISOString() : '',
          stockNumber: wo.stockNumber || '',
          vin: wo.vin || '',
          description: `${serviceName} – Stock# ${wo.stockNumber || 'N/A'} (VIN: ${wo.vin || 'N/A'})`,
          serviceName,
          serviceId: rawServiceId,
          amount: Number(wo.amount) || 0,
          tax: Number(wo.tax) || 0,
          total: Number(wo.total) || 0,
          notes: wo.notes || '',
        }
      })

      // Sort line items by date
      lineItems.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())

      const subtotal = lineItems.reduce((s: number, li: any) => s + li.amount, 0)
      const taxTotal = lineItems.reduce((s: number, li: any) => s + li.tax, 0)
      const total = lineItems.reduce((s: number, li: any) => s + li.total, 0)

      // Get the last work order date in this week
      const lastWoDate = lineItems.reduce((latest: string, li: any) => {
        if (!latest || new Date(li.date) > new Date(latest)) return li.date
        return latest
      }, '')
      const invoiceDate = lastWoDate ? new Date(lastWoDate).toISOString().split('T')[0] : group.weekEnd.toISOString().split('T')[0]
      const invoiceDateObj = new Date(lastWoDate || group.weekEnd)

      // Get dealer contact info
      const dealerName = group.dealer?.dealer || group.dealerId
      const dealerEmail = group.dealer?.email || ''
      const dealerPhone = group.dealer?.phone || ''
      const dealerAddress = group.dealer?.address || ''

      const roundedTotal = Math.round(total * 100) / 100

      const invoice = {
        number: invNumber,
        weekKey: key,
        dealerId: group.dealerId,
        dealerName,
        dealerEmail,
        dealerPhone,
        dealerAddress,
        status: 'Paid',
        weekNumber: group.week,
        weekYear: group.year,
        weekStart: group.weekStart.toISOString(),
        weekEnd: group.weekEnd.toISOString(),
        date: invoiceDate,
        dueDate: new Date(invoiceDateObj.getTime() + 30 * 86400000).toISOString().split('T')[0], // Net 30
        lineItems,
        subtotal: Math.round(subtotal * 100) / 100,
        taxTotal: Math.round(taxTotal * 100) / 100,
        total: roundedTotal,
        paidAmount: roundedTotal,
        paymentMethod: '',
        notes: `Weekly invoice for ${dealerName} – Week ${group.week}, ${group.year} (${group.weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${group.weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})`,
        createdAt: new Date().toISOString(),
      }

      newInvoices.push(invoice)
    }

    // Insert all new invoices
    let insertedCount = 0
    if (newInvoices.length > 0) {
      const result = await invoicesCollection.insertMany(newInvoices)
      insertedCount = result.insertedCount

      // Mark work orders as invoiced
      const allWoIds = newInvoices.flatMap(inv =>
        inv.lineItems.map((li: any) => {
          try { return new ObjectId(li.workOrderId) } catch { return li.workOrderId }
        })
      )
      if (allWoIds.length > 0) {
        await db.collection('turboCleanWorkOrders').updateMany(
          { _id: { $in: allWoIds } },
          { $set: { isInvoiced: true } }
        )
      }
    }

    const totalInvoices = await invoicesCollection.countDocuments()

    return {
      success: true,
      generated: insertedCount,
      skipped: groups.size - insertedCount,
      totalInvoices,
    }
  } catch (error: any) {
    console.error('Error generating invoices:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to generate invoices',
    })
  }
})
