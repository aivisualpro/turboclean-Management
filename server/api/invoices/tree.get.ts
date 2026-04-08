import { connectToDatabase } from '../../utils/mongodb'
import { getUserSession } from '../../utils/auth'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  try {
    const session = await getUserSession(event)
    const { db } = await connectToDatabase()
    const queryInfo = getQuery(event)

    const isAdmin = session?.role === 'Admin'
    const matchQuery: any = {}

    // Session-based dealer filtering
    if (!isAdmin && session && session.registerDealers && session.registerDealers.length > 0) {
      const stringDealers = session.registerDealers
      const objDealers = stringDealers.reduce((acc: any[], id: string) => {
        try { acc.push(new ObjectId(id)); return acc } catch { return acc }
      }, [])
      matchQuery.dealerId = { $in: [...stringDealers, ...objDealers] }
    } else if (!isAdmin && session) {
      return { success: true, tree: [] }
    }

    // Filter: Status (Paid vs Unpaid)
    if (queryInfo.paymentStatus && queryInfo.paymentStatus !== 'all') {
      if (queryInfo.paymentStatus === 'paid') {
        matchQuery.status = 'Paid'
      } else if (queryInfo.paymentStatus === 'unpaid') {
        matchQuery.status = { $ne: 'Paid' } 
      }
    }

    if (queryInfo.dealerId) {
      matchQuery.dealerId = queryInfo.dealerId as string
    }

    // Filter: Type (Daily vs Weekly)
    if (queryInfo.type && queryInfo.type !== 'all') {
      matchQuery.type = queryInfo.type === 'weekly' ? 'Weekly' : 'Daily'
    }

    // Filter: Date Range (Invoices store date natively as YYYY-MM-DD string)
    if (queryInfo.dateStart || queryInfo.dateEnd) {
      matchQuery.date = {}
      if (queryInfo.dateStart) matchQuery.date.$gte = (queryInfo.dateStart as string).split('T')[0]
      if (queryInfo.dateEnd) matchQuery.date.$lte = (queryInfo.dateEnd as string).split('T')[0]
    }

    // Filter: Search text (filter tree by dealer name or invoice number)
    const searchText = ((queryInfo.search as string) || '').trim()
    if (searchText) {
      matchQuery.$or = [
        { dealerName: { $regex: searchText, $options: 'i' } },
        { number: { $regex: searchText, $options: 'i' } },
      ]
    }

    const pipeline = [
      { $match: matchQuery },
      {
        $group: {
          _id: {
            dealer: "$dealerName",
            dealerId: "$dealerId",
            // The grouped date
            date: "$date"
          },
          totalAmount: { $sum: { $toDouble: "$total" } },
          totalPaid: { $sum: { $toDouble: "$paidAmount" } },
          count: { $sum: 1 }
        }
      }
    ]

    const aggregated = await db.collection('turboCleanInvoices').aggregate(pipeline).toArray()

    const tree: any = {}

    for (const row of aggregated) {
      const dealerId = row._id.dealerId || 'unassigned'
      const dealerName = row._id.dealer || 'Unassigned Dealer'
      const dateStr = row._id.date
      if (!dateStr) continue

      const [yearStr, monthStr, dayStr] = dateStr.split('-')
      const year = parseInt(yearStr)
      const dateObj = new Date(Date.UTC(year, parseInt(monthStr) - 1, parseInt(dayStr)))
      const month = dateObj.toLocaleString('default', { month: 'short', timeZone: 'UTC' })
      const day = parseInt(dayStr)

      if (!tree[dealerId]) {
        tree[dealerId] = {
          dealerId,
          dealerName,
          totalAmount: 0,
          totalPaid: 0,
          count: 0,
          years: {}
        }
      }
      const dlrNode = tree[dealerId]
      
      if (!dlrNode.years[year]) {
        dlrNode.years[year] = {
          year,
          totalAmount: 0,
          totalPaid: 0,
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
          totalPaid: 0,
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
          totalPaid: 0,
          count: 0
        }
      }
      const dtNode = moNode.dates[dateStr]

      dtNode.totalAmount += row.totalAmount || 0
      dtNode.totalPaid += row.totalPaid || 0
      dtNode.count += row.count || 0

      moNode.totalAmount += row.totalAmount || 0
      moNode.totalPaid += row.totalPaid || 0
      moNode.count += row.count || 0

      yrNode.totalAmount += row.totalAmount || 0
      yrNode.totalPaid += row.totalPaid || 0
      yrNode.count += row.count || 0

      dlrNode.totalAmount += row.totalAmount || 0
      dlrNode.totalPaid += row.totalPaid || 0
      dlrNode.count += row.count || 0
    }

    const finalTree = Object.values(tree).map((dlr: any) => {
      dlr.years = Object.values(dlr.years).sort((a: any, b: any) => b.year - a.year)
      for (const yr of dlr.years) {
        yr.months = Object.values(yr.months).sort((a: any, b: any) => b.monthNumber - a.monthNumber)
        for (const mo of yr.months) {
           mo.dates = Object.values(mo.dates).sort((a: any, b: any) => b.day - a.day)
        }
      }
      return dlr
    }).sort((a: any, b: any) => a.dealerName.localeCompare(b.dealerName))

    return { success: true, tree: finalTree }
  } catch (error: any) {
    console.error('Error fetching invoices tree:', error)
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
