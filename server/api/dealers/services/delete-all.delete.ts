import { connectToDatabase } from '../../../utils/mongodb'

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanDealers')

    // Empty the services array for all dealers
    const result = await collection.updateMany(
      {},
      {
        $set: { services: [], updatedAt: new Date() }
      }
    )

    return {
      success: true,
      count: result.modifiedCount
    }
  } catch (error: any) {
    console.error('Error deleting all dealer services:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to delete all dealer services'
    })
  }
})
