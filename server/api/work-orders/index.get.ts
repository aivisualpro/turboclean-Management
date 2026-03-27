import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanWorkOrders')

    const queryInfo = getQuery(event)
    const isExport = queryInfo.export === 'true'
    const limit = isExport ? 0 : (Number(queryInfo.limit) || 50)
    const skip = isExport ? 0 : (Number(queryInfo.skip) || 0)
    const search = ((queryInfo.search as string) || '').trim()
    const sortBy = (queryInfo.sortBy as string) || 'date'
    const sortDir = Number(queryInfo.sortDir) || -1

    // Fetch dealers and services first so we can resolve searches and names
    const [dealers, services] = await Promise.all([
      db.collection('turboCleanDealers').find({}).toArray(),
      db.collection('turboCleanServices').find({}).toArray(),
    ])

    const dealerMap = new Map<string, any>()
    for (const d of dealers) {
      dealerMap.set(d._id.toString(), d)
    }

    const serviceNameMap = new Map<string, string>()
    for (const svc of services) {
      serviceNameMap.set(svc._id.toString(), svc.service || '')
    }

    // 1. Build optimized search query
    let matchQuery: any = {}
    
    // Filter by specific dealer if provided
    const dealerIdFilter = (queryInfo.dealerId as string) || ''
    if (dealerIdFilter) {
      try {
        matchQuery.dealer = new ObjectId(dealerIdFilter)
      } catch {
        matchQuery.dealer = dealerIdFilter
      }
    }
    
    if (search) {
      const q = search.toLowerCase()
      
      const matchedDealerIds: any[] = []
      for (const d of dealers) {
        if ((d.dealer || '').toLowerCase().includes(q)) {
           matchedDealerIds.push(d._id)
           matchedDealerIds.push(d._id.toString())
        }
      }

      const matchedLocalServiceIds: any[] = []
      for (const d of dealers) {
        if (Array.isArray(d.services)) {
           for (const s of d.services) {
              const svcName = serviceNameMap.get(s.service?.toString()) || s.service?.toString() || ''
              if (svcName.toLowerCase().includes(q)) {
                 if (s.id) {
                   matchedLocalServiceIds.push(s.id.toString())
                   if (s.id.toString().length === 24) {
                     matchedLocalServiceIds.push(new ObjectId(s.id.toString()))
                   }
                 }
              }
           }
        }
      }

      matchQuery.$or = [
        { stockNumber: { $regex: search, $options: 'i' } },
        { vin: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } }
      ]
      
      if (!isNaN(Number(search))) {
        matchQuery.$or.push(
          { amount: Number(search) },
          { tax: Number(search) },
          { total: Number(search) }
        )
      }
      
      if ('yes'.includes(q) || 'true'.includes(q)) {
        matchQuery.$or.push({ isInvoiced: true }, { isInvoiced: 'true' }, { isInvoiced: 'yes' })
      } 
      if ('no'.includes(q) || 'false'.includes(q)) {
        matchQuery.$or.push({ isInvoiced: false }, { isInvoiced: null }, { isInvoiced: { $exists: false } })
      }

      if (matchedDealerIds.length > 0) {
        matchQuery.$or.push({ dealer: { $in: matchedDealerIds } })
      }

      if (matchedLocalServiceIds.length > 0) {
        matchQuery.$or.push({ dealerServiceId: { $in: matchedLocalServiceIds } })
      }
    }

    // 2. Fetch data (Optimized: DB sorts native fields, JS only sorts joined fields)
    const needsJsSort = sortBy === 'dealerName' || sortBy === 'dealerServiceId'
    
    let rawWorkOrders: any[] = []
    let totalCount = 0

    if (needsJsSort) {
      // Must fetch all matching to sort by resolved joined fields
      rawWorkOrders = await collection.find(matchQuery).toArray()
      totalCount = rawWorkOrders.length
    } else {
      // Extremely fast native MongoDB sorting + pagination (avoids fetching 17k rows)
      const sortFieldMap: Record<string, string> = {
        date: 'date',
        stockNumber: 'stockNumber',
        vin: 'vin',
        amount: 'amount',
        tax: 'tax',
        total: 'total',
        notes: 'notes',
        isInvoiced: 'isInvoiced'
      }
      const mongoSortField = sortFieldMap[sortBy] || 'date'

      rawWorkOrders = await collection
        .find(matchQuery)
        .sort({ [mongoSortField]: sortDir } as any)
        .skip(skip)
        .limit(limit)
        .toArray()
      totalCount = await collection.countDocuments(matchQuery)
    }

    // 3. Map to final shape
    const mappedWorkOrders = rawWorkOrders.map((wo: any) => {
      const dealerId = wo.dealer?.toString() || ''
      const dealer = dealerMap.get(dealerId)
      const dealerName = dealer?.dealer || dealerId

      const rawServiceId = wo.dealerServiceId?.toString() || ''
      let serviceName = rawServiceId
      if (rawServiceId && dealer?.services && Array.isArray(dealer.services)) {
        const found = dealer.services.find((s: any) => {
          const sId = (s.id || s._id || '').toString()
          return sId === rawServiceId
        })
        if (found?.service) {
          const resolvedName = serviceNameMap.get(found.service.toString())
          serviceName = resolvedName || found.service.toString()
        }
      }

      return {
        id: wo._id.toString(),
        dealerId,
        rawServiceId,
        date: wo.date ? new Date(wo.date).toISOString() : new Date().toISOString(),
        stockNumber: wo.stockNumber || '',
        vin: wo.vin || '',
        dealerName,
        dealerServiceId: serviceName,
        amount: Number(wo.amount) || 0,
        tax: Number(wo.tax) || 0,
        total: Number(wo.total) || 0,
        notes: wo.notes || '',
        upload: wo.upload || '',
        isInvoiced: wo.isInvoiced === true || wo.isInvoiced === 'true' || wo.isInvoiced === 'yes'
      }
    })

    // 4. JS Sort & Paginate (if required)
    let paged = mappedWorkOrders
    if (needsJsSort) {
      paged.sort((a: any, b: any) => {
        const aVal = String(a[sortBy] || '').toLowerCase()
        const bVal = String(b[sortBy] || '').toLowerCase()
        return sortDir * aVal.localeCompare(bVal)
      })
      if (!isExport) {
         paged = paged.slice(skip, skip + limit)
      }
    }

    return {
      workOrders: paged,
      totalCount,
      hasMore: (skip + limit) < totalCount
    }

  } catch (error: any) {
    console.error('Error fetching work orders:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to fetch work orders'
    })
  }
})
