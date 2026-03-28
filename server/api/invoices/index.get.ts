import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanInvoices')

    const query = getQuery(event)
    const skip = Number(query.skip) || 0
    const limit = Number(query.limit) || 50
    const search = ((query.search as string) || '').trim()
    const statusFilter = (query.status as string) || ''
    const dealerFilter = (query.dealerId as string) || ''

    const matchQuery: any = {}

    // Payment Status filter (Paid / Unpaid)
    if (query.paymentStatus && query.paymentStatus !== 'all') {
      if (query.paymentStatus === 'paid') matchQuery.status = 'Paid'
      else matchQuery.status = { $ne: 'Paid' } 
    }

    // Type filter (Daily / Weekly)
    if (query.type && query.type !== 'all') {
      if (query.type === 'weekly') {
        matchQuery.$and = matchQuery.$and || []
        matchQuery.$and.push({
          $or: [{ type: 'Weekly' }, { type: null }, { type: { $exists: false } }]
        })
      } else {
        matchQuery.type = 'Daily'
      }
    }

    // Date Bounds filter
    if (query.dateStart || query.dateEnd) {
      matchQuery.date = {}
      if (query.dateStart) matchQuery.date.$gte = (query.dateStart as string).split('T')[0]
      if (query.dateEnd) matchQuery.date.$lte = (query.dateEnd as string).split('T')[0]
    }

    // Auth Session filtering
    const session = await import('../../utils/auth').then(m => m.getUserSession(event))
    let allowedDealers: any[] = []

    if (session && session.registerDealers && session.registerDealers.length > 0) {
      const stringDealers = session.registerDealers || []
      const objDealers = stringDealers.reduce((acc: any[], id: string) => {
        try { acc.push(new ObjectId(id)); return acc } catch { return acc }
      }, [])
      allowedDealers = [...stringDealers, ...objDealers]
      
      if (allowedDealers.length === 0) {
        return { invoices: [], meta: { total: 0, limit, skip, search } }
      }
      matchQuery.dealerId = { $in: allowedDealers }
    }

    if (dealerFilter) {
      if (session && session.registerDealers && !session.registerDealers.includes(dealerFilter)) {
        return { invoices: [], meta: { total: 0, limit, skip, search } }
      }
      const dbDealerQuery: any[] = [dealerFilter]
      try { dbDealerQuery.push(new ObjectId(dealerFilter)) } catch {}
      matchQuery.dealerId = { $in: dbDealerQuery }
    }

    if (search) {
      matchQuery.$or = [
        { number: { $regex: search, $options: 'i' } },
        { dealerName: { $regex: search, $options: 'i' } },
        { dealerEmail: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } },
      ]

      if (!isNaN(Number(search))) {
        matchQuery.$or.push(
          { total: Number(search) },
          { subtotal: Number(search) },
        )
      }
    }

    const [invoices, totalCount] = await Promise.all([
      collection.find(matchQuery)
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      collection.countDocuments(matchQuery),
    ])

    const mapped = invoices.map((inv: any) => ({
      id: inv._id.toString(),
      number: inv.number,
      dealerId: inv.dealerId,
      dealerName: inv.dealerName,
      dealerEmail: inv.dealerEmail,
      dealerPhone: inv.dealerPhone,
      dealerAddress: inv.dealerAddress,
      status: inv.status || 'Draft',
      date: inv.date,
      dueDate: inv.dueDate,
      weekNumber: inv.weekNumber,
      weekYear: inv.weekYear,
      weekStart: inv.weekStart,
      weekEnd: inv.weekEnd,
      lineItems: inv.lineItems || [],
      subtotal: inv.subtotal,
      taxTotal: inv.taxTotal,
      total: inv.total,
      paidAmount: inv.paidAmount || 0,
      paymentMethod: inv.paymentMethod || '',
      notes: inv.notes || '',
      type: inv.type || 'Weekly', // Backwards compatibility for old invoices
      createdAt: inv.createdAt,
    }))

    return {
      invoices: mapped,
      totalCount,
      hasMore: (skip + limit) < totalCount,
    }
  } catch (error: any) {
    console.error('Error fetching invoices:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to fetch invoices',
    })
  }
})
