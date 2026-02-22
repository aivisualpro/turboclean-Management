import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanWorkOrders')

    // Fetch all work orders
    const workOrders = await collection.find({}).sort({ createdAt: -1 }).toArray()

    // Map them to the format expected by the frontend (SalesDocument)
    return workOrders.map(wo => ({
      id: wo._id.toString(),
      number: wo.stockNumber ? `WO-${wo.stockNumber}` : `WO-${wo._id.toString().substring(0, 6)}`,
      client: wo.dealer ? wo.dealer.toString() : 'Unknown Dealer',
      clientEmail: '',
      clientAddress: '',
      status: 'Sent', // default or derive from some field
      date: wo.date ? new Date(wo.date).toISOString() : new Date().toISOString(),
      notes: wo.notes || '',
      lineItems: [
        {
          id: 'li' + wo._id.toString(),
          description: `Service for VIN: ${wo.vin || 'Unknown'}`,
          quantity: 1,
          unitPrice: Number(wo.amount) || 0,
          discount: 0,
          tax: 0
        }
      ],
      subtotal: Number(wo.amount) || 0,
      taxTotal: Number(wo.tax) || 0,
      discountTotal: 0,
      total: Number(wo.total) || 0,
      createdAt: wo.createdAt ? new Date(wo.createdAt).toISOString() : new Date().toISOString(),
      vin: wo.vin,
      dealerServiceId: wo.dealerServiceId ? wo.dealerServiceId.toString() : ''
    }))

  } catch (error: any) {
    console.error('Error fetching work orders:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to fetch work orders'
    })
  }
})
