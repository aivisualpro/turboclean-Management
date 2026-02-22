import { connectToDatabase } from '../../utils/mongodb'

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

    // Build mongo query
    const matchQuery: any = {}

    if (statusFilter) {
      matchQuery.status = statusFilter
    }

    if (dealerFilter) {
      matchQuery.dealerId = dealerFilter
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
