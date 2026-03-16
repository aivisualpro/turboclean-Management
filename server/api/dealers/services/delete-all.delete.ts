import { connectToDatabase } from '../../../utils/mongodb'
import { appSheetFind, appSheetDelete } from '../../../utils/appsheet'

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

    // ── Sync to AppSheet: Delete all DealerServices ──
    try {
      const existingRows = await appSheetFind('DealerServices')
      if (Array.isArray(existingRows) && existingRows.length > 0) {
        const deleteRows = existingRows.map((r: any) => ({ _id: r._id || r.id }))
        // Delete in batches of 100
        for (let i = 0; i < deleteRows.length; i += 100) {
          const batch = deleteRows.slice(i, i + 100)
          await appSheetDelete('DealerServices', batch)
        }
      }
    }
    catch (syncErr) {
      console.error('[Sync] Failed to delete dealer services from AppSheet:', syncErr)
    }

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
