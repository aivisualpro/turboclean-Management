import { connectToDatabase } from '../../utils/mongodb'
import { getUserSession } from '../../utils/auth'
import { ObjectId } from 'mongodb'
const cache = new Map<string, { timestamp: number; data: any }>()
const CACHE_TTL = 15000 // 15s cache buffer

export default defineEventHandler(async (event) => {
  try {
    const session = await getUserSession(event)
    const queryInfo = getQuery(event)

    const cacheKey = JSON.stringify({ ...queryInfo, r: session?.role, e: session?.email })
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
       return { success: true, tree: cached.data }
    }

    const { db } = await connectToDatabase()

    // Build Match query based on filters
    const matchQuery: any = {}

    // Session-based dealer filtering
    if (session && session.registerDealers && session.registerDealers.length > 0) {
      const stringDealers = session.registerDealers || []
      const objDealers = stringDealers.reduce((acc: any[], id: string) => {
        try { acc.push(new ObjectId(id)); return acc } catch { return acc }
      }, [])
      const allowedDealers = [...stringDealers, ...objDealers]
      
      if (allowedDealers.length === 0) return { success: true, tree: [] }
      matchQuery.dealer = { $in: allowedDealers }
    } else if (session && session.role !== 'Admin' && (!session.registerDealers || session.registerDealers.length === 0)) {
      // Non-admins with no dealers shouldn't see anything
      return { success: true, tree: [] }
    }

    // 1. Filter: Invoiced vs Not Invoiced (if provided, e.g. 'true' or 'false')
    if (queryInfo.isInvoiced !== undefined && queryInfo.isInvoiced !== '') {
      const isInv = queryInfo.isInvoiced === 'true'
      if (isInv) {
        matchQuery.$or = [{ isInvoiced: true }, { isInvoiced: 'true' }, { isInvoiced: 'yes' }]
      } else {
        matchQuery.$or = [{ isInvoiced: false }, { isInvoiced: null }, { isInvoiced: { $exists: false } }]
      }
    }

    if (queryInfo.dealerId) {
      try {
        matchQuery.dealer = new ObjectId(queryInfo.dealerId as string)
      } catch {
        matchQuery.dealer = queryInfo.dealerId as string
      }
    }

    // 2. Filter: lastUpdatedBy
    if (queryInfo.lastUpdatedBy) {
      matchQuery.lastUpdatedBy = { $regex: queryInfo.lastUpdatedBy, $options: 'i' }
    }

    // 3. Filter: Global Date Range — use UTC date-string comparison to avoid timezone shifts
    if (queryInfo.dateStart || queryInfo.dateEnd) {
      const dateConditions: any[] = []
      if (queryInfo.dateStart) {
        dateConditions.push({ $gte: [{ $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: 'UTC' } }, queryInfo.dateStart as string] })
      }
      if (queryInfo.dateEnd) {
        dateConditions.push({ $lte: [{ $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: 'UTC' } }, queryInfo.dateEnd as string] })
      }
      if (!matchQuery.$expr) matchQuery.$expr = { $and: dateConditions }
      else matchQuery.$expr = { $and: [...(matchQuery.$expr.$and || [matchQuery.$expr]), ...dateConditions] }
    }

    // Pipeline to aggregate totals grouping by Dealer -> Date (Year/Month/Day)
    const pipeline = [
      { $match: matchQuery },
      {
        $group: {
          _id: {
            dealer: "$dealer",
            date: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: "UTC" } }
          },
          totalAmount: { $sum: { $convert: { input: "$total", to: "double", onError: 0, onNull: 0 } } },
          totalTax: { $sum: { $convert: { input: "$tax", to: "double", onError: 0, onNull: 0 } } },
          totalSub: { $sum: { $convert: { input: "$amount", to: "double", onError: 0, onNull: 0 } } },
          count: { $sum: 1 }
        }
      }
    ]

    const aggregated = await db.collection('turboCleanWorkOrders').aggregate(pipeline).toArray()

    // We need to resolve Dealer Names
    const dealers = await db.collection('turboCleanDealers').find({}).project({ _id: 1, dealer: 1 }).toArray()
    const dealerMap = new Map(dealers.map(d => [d._id.toString(), d.dealer || 'Unknown Dealer']))

    // Construct the structured tree: Dealer -> Year -> Month -> Date (YYYY-MM-DD)
    // using a nested dictionary
    const tree: any = {}

    for (const row of aggregated) {
      const dealerId = row._id.dealer?.toString() || 'unassigned'
      const dealerName = dealerMap.get(dealerId) || 'Unassigned Dealer'
      const dateStr = row._id.date // "2026-03-27"
      if (!dateStr) continue

      const [yearStr, monthStr, dayStr] = dateStr.split('-')
      const year = parseInt(yearStr, 10)
      
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      const mIdx = parseInt(monthStr, 10) - 1
      const month = monthNames[mIdx] || 'Unknown'
      
      const day = parseInt(dayStr, 10)

      // Initialize deeper levels
      if (!tree[dealerId]) {
        tree[dealerId] = {
          dealerId,
          dealerName,
          totalAmount: 0,
          totalTax: 0,
          totalSub: 0,
          count: 0,
          years: {}
        }
      }
      const dlrNode = tree[dealerId]
      
      if (!dlrNode.years[year]) {
        dlrNode.years[year] = {
          year,
          totalAmount: 0,
          totalTax: 0,
          totalSub: 0,
          count: 0,
          months: {}
        }
      }
      const yrNode = dlrNode.years[year]

      if (!yrNode.months[month]) {
        yrNode.months[month] = {
          month,
          monthNumber: parseInt(monthStr),
          totalAmount: 0,
          totalTax: 0,
          totalSub: 0,
          count: 0,
          dates: {}
        }
      }
      const moNode = yrNode.months[month]

      if (!moNode.dates[dateStr]) {
        moNode.dates[dateStr] = {
          date: dateStr,
          day,
          totalAmount: 0,
          totalTax: 0,
          totalSub: 0,
          count: 0
        }
      }
      const dtNode = moNode.dates[dateStr]

      // Add to leaves
      dtNode.totalAmount += row.totalAmount || 0
      dtNode.totalTax += row.totalTax || 0
      dtNode.totalSub += row.totalSub || 0
      dtNode.count += row.count || 0

      // Rollup to Month
      moNode.totalAmount += row.totalAmount || 0
      moNode.totalTax += row.totalTax || 0
      moNode.totalSub += row.totalSub || 0
      moNode.count += row.count || 0

      // Rollup to Year
      yrNode.totalAmount += row.totalAmount || 0
      yrNode.totalTax += row.totalTax || 0
      yrNode.totalSub += row.totalSub || 0
      yrNode.count += row.count || 0

      // Rollup to Dealer
      dlrNode.totalAmount += row.totalAmount || 0
      dlrNode.totalTax += row.totalTax || 0
      dlrNode.totalSub += row.totalSub || 0
      dlrNode.count += row.count || 0
    }

    // Convert the dictionaries into sorted arrays for the frontend
    const finalTree = Object.values(tree).map((dlr: any) => {
      dlr.years = Object.values(dlr.years).sort((a: any, b: any) => b.year - a.year) // descending year
      for (const yr of dlr.years) {
        yr.months = Object.values(yr.months).sort((a: any, b: any) => b.monthNumber - a.monthNumber) // descending month
        for (const mo of yr.months) {
           mo.dates = Object.values(mo.dates).sort((a: any, b: any) => b.day - a.day) // descending date
        }
      }
      return dlr
    }).sort((a: any, b: any) => a.dealerName.localeCompare(b.dealerName)) // alphabetical dealers

    cache.set(cacheKey, { timestamp: Date.now(), data: finalTree })
    return { success: true, tree: finalTree }
  } catch (error: any) {
    console.error('Error fetching work order tree:', error)
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
