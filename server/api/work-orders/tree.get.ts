import { connectToDatabase } from '../../utils/mongodb'
import { getUserSession } from '../../utils/auth'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  try {
    const session = await getUserSession(event)
    const { db } = await connectToDatabase()
    const queryInfo = getQuery(event)

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

    // 3. Filter: Global Date Range
    if (queryInfo.dateStart || queryInfo.dateEnd) {
      matchQuery.date = {}
      if (queryInfo.dateStart) matchQuery.date.$gte = new Date(queryInfo.dateStart as string)
      if (queryInfo.dateEnd) matchQuery.date.$lte = new Date(queryInfo.dateEnd as string)
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
          totalAmount: { $sum: { $toDouble: "$total" } },
          totalTax: { $sum: { $toDouble: "$tax" } },
          totalSub: { $sum: { $toDouble: "$amount" } },
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
      const year = parseInt(yearStr)
      // Convert month to name, e.g., '03' -> 'Mar'
      const dateObj = new Date(Date.UTC(year, parseInt(monthStr) - 1, parseInt(dayStr)))
      const month = dateObj.toLocaleString('default', { month: 'short', timeZone: 'UTC' })
      const day = parseInt(dayStr)

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

    return { success: true, tree: finalTree }
  } catch (error: any) {
    console.error('Error fetching work order tree:', error)
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
