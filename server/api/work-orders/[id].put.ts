import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    if (!id || !ObjectId.isValid(id)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })
    }

    const body = await readBody(event)

    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanWorkOrders')

    // Prepare update data
    const updateData: any = {}
    if (body.amount !== undefined) updateData.amount = Number(body.amount)
    if (body.tax !== undefined) updateData.tax = Number(body.tax)
    if (body.total !== undefined) updateData.total = Number(body.total)
    if (body.notes !== undefined) updateData.notes = body.notes
    if (body.dealerServiceId !== undefined) updateData.dealerServiceId = body.dealerServiceId
    if (body.upload !== undefined) updateData.upload = body.upload
    if (body.vin !== undefined) updateData.vin = body.vin
    if (body.stockNumber !== undefined) updateData.stockNumber = body.stockNumber
    if (body.date !== undefined) updateData.date = new Date(body.date)
    
    updateData.lastUpdatedBy = 'Admin' // or extract from session if available
    updateData.updatedAt = new Date()

    const result = await collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    )

    if (result.matchedCount === 0) {
      throw createError({ statusCode: 404, statusMessage: 'Work Order not found' })
    }

    return { success: true, message: 'Work Order updated successfully' }
  } catch (error: any) {
    console.error('Error updating work order:', error)
    throw createError({
      statusCode: error.statusCode || 500,
      statusMessage: error.statusMessage || 'Failed to update work order'
    })
  }
})
