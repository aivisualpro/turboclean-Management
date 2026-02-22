import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const fromParam = query.from as string | undefined
    const toParam = query.to as string | undefined

    const { db } = await connectToDatabase()

    const [rawWorkOrders, allDealers, allServices] = await Promise.all([
      db.collection('turboCleanWorkOrders').find({}).toArray(),
      db.collection('turboCleanDealers').find({}).toArray(),
      db.collection('turboCleanServices').find({}).toArray(),
    ])

    // Filter work orders by date range if provided
    let allWorkOrders = rawWorkOrders
    if (fromParam || toParam) {
      const fromDate = fromParam ? new Date(fromParam) : null
      const toDate = toParam ? new Date(toParam) : null
      // Set toDate to end of day
      if (toDate) toDate.setHours(23, 59, 59, 999)

      allWorkOrders = rawWorkOrders.filter(wo => {
        const d = wo.date ? new Date(wo.date) : null
        if (!d || isNaN(d.getTime())) return false
        if (fromDate && d < fromDate) return false
        if (toDate && d > toDate) return false
        return true
      })
    }

    // Build lookup maps
    const dealerMap = new Map<string, any>()
    for (const d of allDealers) {
      dealerMap.set(d._id.toString(), d)
    }
    const serviceNameMap = new Map<string, string>()
    for (const svc of allServices) {
      serviceNameMap.set(svc._id.toString(), svc.service || '')
    }

    // ── KPIs ────────────────────────────────────────
    const totalRevenue = allWorkOrders.reduce((s, wo) => s + (Number(wo.total) || 0), 0)
    const totalAmount = allWorkOrders.reduce((s, wo) => s + (Number(wo.amount) || 0), 0)
    const totalTax = allWorkOrders.reduce((s, wo) => s + (Number(wo.tax) || 0), 0)
    const totalOrders = allWorkOrders.length
    const avgOrderSize = totalOrders > 0 ? totalRevenue / totalOrders : 0
    const invoicedCount = allWorkOrders.filter(wo => wo.isInvoiced).length
    const invoicedPct = totalOrders > 0 ? Math.round((invoicedCount / totalOrders) * 1000) / 10 : 0
    const uninvoicedRevenue = allWorkOrders.filter(wo => !wo.isInvoiced).reduce((s, wo) => s + (Number(wo.total) || 0), 0)

    // ── Monthly Revenue Trend ─────────────────────
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const monthlyMap = new Map<string, { revenue: number; orders: number; invoiced: number; uninvoiced: number }>()

    for (const wo of allWorkOrders) {
      const d = wo.date ? new Date(wo.date) : null
      if (!d || isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
      const entry = monthlyMap.get(key) || { revenue: 0, orders: 0, invoiced: 0, uninvoiced: 0 }
      entry.revenue += Number(wo.total) || 0
      entry.orders += 1
      if (wo.isInvoiced) entry.invoiced += 1
      else entry.uninvoiced += 1
      monthlyMap.set(key, entry)
    }

    // Get sorted months
    const sortedMonthKeys = [...monthlyMap.keys()].sort()
    const monthlyTrend = sortedMonthKeys.map(key => {
      const [yr, mo] = key.split('-')
      const entry = monthlyMap.get(key)!
      return {
        month: `${monthNames[Number(mo)]} ${yr}`,
        shortMonth: monthNames[Number(mo)]!,
        year: Number(yr),
        revenue: Math.round(entry.revenue * 100) / 100,
        orders: entry.orders,
        invoiced: entry.invoiced,
        uninvoiced: entry.uninvoiced,
      }
    })

    // ── Revenue by Dealer (top 10) ────────────────
    const dealerRevMap = new Map<string, { name: string; revenue: number; orders: number; invoiced: number }>()
    for (const wo of allWorkOrders) {
      const dId = wo.dealer?.toString() || 'unknown'
      const d = dealerMap.get(dId)
      const name = d?.dealer || dId
      const entry = dealerRevMap.get(dId) || { name, revenue: 0, orders: 0, invoiced: 0 }
      entry.revenue += Number(wo.total) || 0
      entry.orders += 1
      if (wo.isInvoiced) entry.invoiced += 1
      dealerRevMap.set(dId, entry)
    }
    const topDealers = [...dealerRevMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .map(d => ({ ...d, revenue: Math.round(d.revenue * 100) / 100 }))

    // ── Revenue by Service (top 10) ────────────────
    const serviceRevMap = new Map<string, { name: string; revenue: number; orders: number }>()
    for (const wo of allWorkOrders) {
      const rawSvcId = wo.dealerServiceId?.toString() || 'unknown'
      const dealerId = wo.dealer?.toString() || ''
      const dealer = dealerMap.get(dealerId)

      let svcName = rawSvcId
      if (rawSvcId && dealer?.services && Array.isArray(dealer.services)) {
        const found = dealer.services.find((s: any) => {
          const sId = (s.id || s._id || '').toString()
          return sId === rawSvcId
        })
        if (found?.service) {
          svcName = serviceNameMap.get(found.service.toString()) || found.service.toString()
        }
      }

      const entry = serviceRevMap.get(svcName) || { name: svcName, revenue: 0, orders: 0 }
      entry.revenue += Number(wo.total) || 0
      entry.orders += 1
      serviceRevMap.set(svcName, entry)
    }
    const topServices = [...serviceRevMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .map(s => ({ ...s, revenue: Math.round(s.revenue * 100) / 100 }))

    // ── Dealer Status Breakdown ───────────────────
    const statusMap = new Map<string, number>()
    for (const d of allDealers) {
      const st = d.status || 'Pending'
      statusMap.set(st, (statusMap.get(st) || 0) + 1)
    }
    const dealerStatuses = [...statusMap.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)

    return {
      kpis: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalAmount: Math.round(totalAmount * 100) / 100,
        totalTax: Math.round(totalTax * 100) / 100,
        totalOrders,
        avgOrderSize: Math.round(avgOrderSize * 100) / 100,
        invoicedCount,
        invoicedPct,
        uninvoicedRevenue: Math.round(uninvoicedRevenue * 100) / 100,
        totalDealers: allDealers.length,
        totalServices: allServices.length,
      },
      monthlyTrend,
      topDealers,
      topServices,
      dealerStatuses,
    }
  } catch (error: any) {
    console.error('Error generating sales stats:', error)
    throw createError({ statusCode: 500, statusMessage: 'Failed to generate stats' })
  }
})
