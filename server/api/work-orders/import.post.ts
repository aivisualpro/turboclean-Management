import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const workOrders = body.workOrders
    
    if (!workOrders || !Array.isArray(workOrders)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid or missing workOrders array' })
    }

    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanWorkOrders')

    const documentsToInsert = workOrders.map((wo: any) => ({
      dealer: wo.dealer?.length === 24 ? new ObjectId(wo.dealer) : wo.dealer,
      date: typeof wo.date === 'string' ? new Date(wo.date) : wo.date,
      stockNumber: wo.stockNumber || '',
      vin: wo.vin || '',
      dealerServiceId: wo.dealerServiceId?.length === 24 ? new ObjectId(wo.dealerServiceId) : wo.dealerServiceId,
      amount: Number(wo.amount) || 0,
      tax: Number(wo.tax) || 0,
      total: Number(wo.total) || 0,
      notes: wo.notes || '',
      createdAt: new Date(),
      updatedAt: new Date(),
    }))

    if (documentsToInsert.length > 0) {
      await collection.insertMany(documentsToInsert)
    }

    return {
      success: true,
      count: documentsToInsert.length
    }
  } catch (error: any) {
    console.error('Error importing work orders:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to import work orders'
    })
  }
})
