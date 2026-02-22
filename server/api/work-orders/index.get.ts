import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanWorkOrders')

    const queryInfo = getQuery(event)
    const limit = Number(queryInfo.limit) || 50
    const skip = Number(queryInfo.skip) || 0
    const search = (queryInfo.search as string) || ''

    // Build the exact query
    const matchQuery: any = {}
    if (search) {
      matchQuery.$or = [
        { stockNumber: { $regex: search, $options: 'i' } },
        { vin: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } }
      ]
    }

    // Modern aggregation pipeline for related data lookup
    const pipeline = [
      { $match: matchQuery },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'turboCleanDealers',
          localField: 'dealer',
          foreignField: '_id',
          as: 'dealerDoc'
        }
      },
      {
        $lookup: {
          from: 'turboCleanDealerServices',
          localField: 'dealerServiceId',
          foreignField: '_id',
          as: 'dealerServiceDoc'
        }
      },
      {
        $addFields: {
          dealerName: { $arrayElemAt: ['$dealerDoc.name', 0] },
          serviceName: { $arrayElemAt: ['$dealerServiceDoc.serviceName', 0] },
          status: 'Pending', // Assign a default status
        }
      },
      {
        $project: {
          dealerDoc: 0,
          dealerServiceDoc: 0
        }
      }
    ]

    const workOrders = await collection.aggregate(pipeline).toArray()
    
    // Also get total count for this query to know if there's more
    const totalCount = await collection.countDocuments(matchQuery)

    // Map them to the format targeted by the frontend table
    const mapped = workOrders.map((wo: any) => ({
      id: wo._id.toString(),
      date: wo.date ? new Date(wo.date).toISOString() : new Date().toISOString(),
      stockNumber: wo.stockNumber || '',
      vin: wo.vin || '',
      dealerName: wo.dealerName || wo.dealer?.toString() || '',
      dealerServiceId: wo.serviceName || wo.dealerServiceId?.toString() || '',
      amount: Number(wo.amount) || 0,
      tax: Number(wo.tax) || 0,
      total: Number(wo.total) || 0,
      notes: wo.notes || '',
      status: wo.status
    }))

    return {
      workOrders: mapped,
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
