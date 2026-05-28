import { connectToDatabase } from '../../utils/mongodb'
import { getUserSession } from '../../utils/auth'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  try {
    const session = await getUserSession(event)
    const query = getQuery(event)

    const dateStart = (query.dateStart as string) || ''
    const dateEnd = (query.dateEnd as string) || ''

    if (!dateStart || !dateEnd) {
      return { success: true, dealers: [] }
    }

    const { db } = await connectToDatabase()

    const matchQuery: any = {}

    // Session-based dealer filtering
    const isAdmin = session?.role === 'Admin'
    if (!isAdmin && session && session.registerDealers && session.registerDealers.length > 0) {
      const stringDealers = session.registerDealers
      const objDealers = stringDealers.reduce((acc: any[], id: string) => {
        try { acc.push(new ObjectId(id)); return acc } catch { return acc }
      }, [])
      matchQuery.dealerId = { $in: [...stringDealers, ...objDealers] }
    } else if (!isAdmin && session) {
      return { success: true, dealers: [] }
    }

    // Date range filter (Saturday to Friday)
    matchQuery.date = {
      $gte: dateStart.split('T')[0],
      $lte: dateEnd.split('T')[0],
    }

    // Use Weekly invoices — paidAmount is recorded on weekly invoices
    matchQuery.type = 'Weekly'

    const pipeline = [
      { $match: matchQuery },
      {
        $group: {
          _id: {
            dealerId: '$dealerId',
            dealerName: '$dealerName',
          },
          beforeTax: { $sum: { $convert: { input: '$subtotal', to: 'double', onError: 0, onNull: 0 } } },
          afterTax: { $sum: { $convert: { input: '$total', to: 'double', onError: 0, onNull: 0 } } },
          paidAmount: { $sum: { $convert: { input: '$paidAmount', to: 'double', onError: 0, onNull: 0 } } },
          taxTotal: { $sum: { $convert: { input: '$taxTotal', to: 'double', onError: 0, onNull: 0 } } },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.dealerName': 1 } as any },
    ]

    const aggregated = await db.collection('turboCleanInvoices').aggregate(pipeline).toArray()

    // Fetch dealer taxPercentage from the dealers collection
    const dealerIds = aggregated.map((row: any) => row._id.dealerId).filter(Boolean)
    const dealerDocs = await db.collection('turboCleanDealers').find({
      $or: [
        { _id: { $in: dealerIds.reduce((acc: any[], id: string) => { try { acc.push(new ObjectId(id)) } catch {} return acc }, []) } },
        { _id: { $in: dealerIds } },
      ]
    }).project({ _id: 1, taxPercentage: 1 }).toArray()

    const dealerTaxMap = new Map<string, number>()
    for (const d of dealerDocs) {
      dealerTaxMap.set(d._id.toString(), Number(d.taxPercentage) || 0)
    }

    const dealers = aggregated.map((row: any) => {
      const paidAmt = row.paidAmount || 0
      const dealerId = row._id.dealerId || ''

      // Use the dealer's configured taxPercentage
      const taxPct = dealerTaxMap.get(dealerId) || 0

      // Check Amount = paidAmount (includes tax)
      // After Tax = Check Amount / (1 + dealer.taxPercentage / 100)
      // Tax = Check Amount - After Tax
      const paidAfterTax = taxPct > 0
        ? Math.round(paidAmt / (1 + taxPct / 100) * 100) / 100
        : paidAmt
      const paidTax = Math.round((paidAmt - paidAfterTax) * 100) / 100

      return {
        dealerId,
        dealerName: row._id.dealerName || 'Unknown Dealer',
        beforeTax: Math.round(paidAmt * 100) / 100,
        afterTax: paidAfterTax,
        invoiceCount: row.count || 0,
      }
    })

    return { success: true, dealers }
  } catch (error: any) {
    console.error('Error fetching commission data:', error)
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
