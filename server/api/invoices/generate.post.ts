import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { appSheetEdit } from '../../utils/appsheet'
import { WorkOrdersMapper } from '../../utils/sync-mapper'

function getISOWeek(date: Date): { year: number; week: number; weekStart: Date; weekEnd: Date } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)

  const dayOfWeek = date.getUTCDay() || 7
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
    const body = await readBody(event) || {}
    const generateType = body.type || 'daily' // 'daily' or 'weekly'

    const allDealers = await db.collection('turboCleanDealers').find({}).toArray()
    const allServices = await db.collection('turboCleanServices').find({}).toArray()

    const dealerMap = new Map<string, any>()
    for (const d of allDealers) dealerMap.set(d._id.toString(), d)
    
    const serviceNameMap = new Map<string, string>()
    for (const svc of allServices) serviceNameMap.set(svc._id.toString(), svc.service || '')

    const invoicesCollection = db.collection('turboCleanInvoices')
    const newInvoices: any[] = []
    let invoiceCounter = await invoicesCollection.countDocuments()

    if (generateType === 'daily') {
      // ─── GENERATE DAILY INVOICES FROM WORK ORDERS ───
      const uninvoicedWOs = await db.collection('turboCleanWorkOrders').find({
        $or: [{ isInvoiced: false }, { isInvoiced: null }, { isInvoiced: { $exists: false } }, { isInvoiced: 'no' }]
      }).toArray()

      if (uninvoicedWOs.length === 0) return { success: true, generated: 0, message: 'No uninvoiced work orders found.' }

      const groups = new Map<string, { dealerId: string, dealer: any, dateStr: string, workOrders: any[] }>()

      for (const wo of uninvoicedWOs) {
        if (!wo.date) continue
        const dateStr = new Date(wo.date).toISOString().split('T')[0] as string
        const dealerId = wo.dealer?.toString() || wo.dealerId || 'unknown'
        const key = `${dealerId}__${dateStr}`
        
        if (!groups.has(key)) {
          groups.set(key, { dealerId, dealer: dealerMap.get(dealerId), dateStr, workOrders: [] })
        }
        groups.get(key)!.workOrders.push(wo)
      }

      for (const [key, group] of groups) {
        invoiceCounter++
        // Generate Invoice Number
        const invNumber = `D-INV-${group.dateStr.replace(/-/g, '')}-${String(invoiceCounter).padStart(4, '0')}`

        const lineItems = group.workOrders.map((wo: any) => {
          const rawServiceId = wo.dealerServiceId?.toString() || ''
          let serviceName = rawServiceId
          if (rawServiceId && group.dealer?.services && Array.isArray(group.dealer.services)) {
            const found = group.dealer.services.find((s: any) => (s.id || s._id || '').toString() === rawServiceId)
            if (found?.service) serviceName = serviceNameMap.get(found.service.toString()) || found.service.toString()
          }

          return {
            workOrderId: wo._id.toString(),
            date: wo.date ? new Date(wo.date).toISOString() : '',
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
        })

        const subtotal = lineItems.reduce((s, li) => s + li.amount, 0)
        const taxTotal = lineItems.reduce((s, li) => s + li.tax, 0)
        const total = lineItems.reduce((s, li) => s + li.total, 0)

        const dealerName = group.dealer?.dealer || group.dealerId
        const { year, week, weekStart, weekEnd } = getISOWeek(new Date(group.dateStr))

        newInvoices.push({
          number: invNumber,
          type: 'Daily',
          dealerId: group.dealerId,
          dealerName,
          dealerEmail: group.dealer?.email || '',
          dealerPhone: group.dealer?.phone || '',
          dealerAddress: group.dealer?.address || '',
          status: 'Draft',
          date: group.dateStr,
          dueDate: new Date(new Date(group.dateStr).getTime() + 15 * 86400000).toISOString().split('T')[0], // Net 15
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
          notes: `Daily Invoice for ${dealerName} on ${group.dateStr}`,
          isWeeklyBilled: false, // Flag for weekly rollup
          createdAt: new Date().toISOString(),
        })
      }

      // Insert Daily Invoices and update WOs
      if (newInvoices.length > 0) {
        await invoicesCollection.insertMany(newInvoices)
        const updatedWoIds = uninvoicedWOs.map((w: any) => w._id)
        await db.collection('turboCleanWorkOrders').updateMany(
          { _id: { $in: updatedWoIds } },
          { $set: { isInvoiced: true } }
        )

        // Sync updated WorkOrders back to AppSheet
        try {
          const rowsToSync = uninvoicedWOs.map((wo: any) => {
            wo.isInvoiced = true
            return WorkOrdersMapper.toAppSheet(wo)
          })
          
          for (let i = 0; i < rowsToSync.length; i += 100) {
            await appSheetEdit('WorkOrders', rowsToSync.slice(i, i + 100))
          }
        } catch (err) {
          console.error('[AppSheet Sync Error] Failed to sync WorkOrders:', err)
        }
      }

      return { success: true, generated: newInvoices.length, message: `Generated ${newInvoices.length} daily invoices.` }

    } else if (generateType === 'weekly') {
      // ─── GENERATE WEEKLY INVOICES FROM DAILY INVOICES ───
      const uninvoicedDaily = await invoicesCollection.find({ type: 'Daily', isWeeklyBilled: { $ne: true } }).toArray()

      if (uninvoicedDaily.length === 0) return { success: true, generated: 0, message: 'No unbilled daily invoices found.' }

      const groups = new Map<string, { dealerId: string, dealer: any, year: number, week: number, weekStart: Date, weekEnd: Date, dailyInvoices: any[] }>()

      for (const inv of uninvoicedDaily) {
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

      for (const [key, group] of groups) {
        invoiceCounter++
        const invNumber = `W-INV-${group.year}-${String(invoiceCounter).padStart(5, '0')}`

        const lineItems = group.dailyInvoices.flatMap((dInv: any) => {
          return (dInv.lineItems || []).map((li: any) => ({
            ...li,
            invoiceId: dInv._id.toString(),
            dailyInvoiceTag: dInv.number
          }))
        })

        // Sort linearly by date
        lineItems.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

        const subtotal = lineItems.reduce((s, li) => s + li.amount, 0)
        const taxTotal = lineItems.reduce((s, li) => s + li.tax, 0)
        const total = lineItems.reduce((s, li) => s + li.total, 0)

        const dealerName = group.dealer?.dealer || group.dealerId
        const invoiceDate = group.weekEnd.toISOString().split('T')[0]

        newInvoices.push({
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
          dueDate: new Date(group.weekEnd.getTime() + 30 * 86400000).toISOString().split('T')[0], // Net 30
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
        })
      }

      if (newInvoices.length > 0) {
        await invoicesCollection.insertMany(newInvoices)
        const updatedInvIds = uninvoicedDaily.map((i: any) => i._id)
        await invoicesCollection.updateMany(
          { _id: { $in: updatedInvIds } },
          { $set: { isWeeklyBilled: true } }
        )
      }

      return { success: true, generated: newInvoices.length, message: `Generated ${newInvoices.length} weekly invoices.` }
    } else if (generateType === 'custom_weekly') {
      const { dealerId, startDate, endDate } = body
      if (!dealerId || !startDate || !endDate) return { success: false, message: 'Missing required fields' }
      
      const sDate = new Date(startDate)
      const eDate = new Date(endDate)
      
      if (eDate.getTime() - sDate.getTime() > 7 * 86400000) {
         return { success: false, message: 'Date range cannot exceed 7 days' }
      }
      
      const possibleDealerIds: any[] = [dealerId]
      try { possibleDealerIds.push(new ObjectId(dealerId)) } catch {}
      
      const uninvoicedWOs = await db.collection('turboCleanWorkOrders').find({
         dealer: { $in: possibleDealerIds },
         date: { $gte: sDate, $lte: eDate },
         $or: [{ isInvoiced: false }, { isInvoiced: null }, { isInvoiced: { $exists: false } }, { isInvoiced: 'no' }]
      }).toArray()
      
      if (uninvoicedWOs.length === 0) return { success: true, generated: 0, message: 'No uninvoiced work orders found for selection.' }
      
      invoiceCounter++
      const invNumber = `W-INV-${(sDate.toISOString().split('T')[0] as string).replace(/-/g, '')}-${String(invoiceCounter).padStart(4, '0')}`
      const dealer = dealerMap.get(dealerId) || { dealer: dealerId }
      
      const lineItems = uninvoicedWOs.map((wo: any) => {
          const rawServiceId = wo.dealerServiceId?.toString() || ''
          let serviceName = rawServiceId
          if (rawServiceId && dealer?.services && Array.isArray(dealer.services)) {
            const found = dealer.services.find((s: any) => (s.id || s._id || '').toString() === rawServiceId)
            if (found?.service) serviceName = serviceNameMap.get(found.service.toString()) || found.service.toString()
          }

          return {
            workOrderId: wo._id.toString(),
            date: wo.date ? new Date(wo.date).toISOString() : '',
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
      })
      
      // Sort linearly by date
      lineItems.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      
      const subtotal = lineItems.reduce((s, li) => s + li.amount, 0)
      const taxTotal = lineItems.reduce((s, li) => s + li.tax, 0)
      const total = lineItems.reduce((s, li) => s + li.total, 0)
      const { year, week, weekStart, weekEnd } = getISOWeek(sDate)
      
      const invoice = {
          number: invNumber,
          type: 'Weekly',
          weekKey: `${dealerId}__${year}_W${week}`,
          dealerId,
          dealerName: dealer.dealer || dealerId,
          dealerEmail: dealer.email || '',
          dealerPhone: dealer.phone || '',
          dealerAddress: dealer.address || '',
          status: 'Draft',
          date: new Date().toISOString().split('T')[0],
          dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
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
          notes: `Custom Weekly Invoice for ${dealer.dealer || dealerId} (${startDate} to ${endDate})`,
          isWeeklyBilled: true,
          createdAt: new Date().toISOString(),
      }
      
      await invoicesCollection.insertOne(invoice)
      
      const updatedWoIds = uninvoicedWOs.map((w: any) => w._id)
      await db.collection('turboCleanWorkOrders').updateMany(
         { _id: { $in: updatedWoIds } },
         { $set: { isInvoiced: true } }
      )
      
      try {
        const rowsToSync = uninvoicedWOs.map((wo: any) => {
          wo.isInvoiced = true
          return WorkOrdersMapper.toAppSheet(wo)
        })
        for (let i = 0; i < rowsToSync.length; i += 100) await appSheetEdit('WorkOrders', rowsToSync.slice(i, i + 100))
      } catch (err) { }
      
      return { success: true, generated: 1, message: `Custom weekly invoice generated successfully with ${uninvoicedWOs.length} work orders.` }
    }

    return { success: false, message: 'Invalid generation type' }
  } catch (error: any) {
    console.error('Error generating invoices:', error)
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to generate invoices' })
  }
})
