import { ObjectId } from 'mongodb'
import { connectToDatabase } from '../../utils/mongodb'
import { AUTOMATIONS_COLLECTION } from '../../utils/invoice-automation'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing automation ID' })

    const { db } = await connectToDatabase()

    let objectId: any = id
    try { objectId = new ObjectId(id) } catch {}

    const result = await db.collection(AUTOMATIONS_COLLECTION).deleteOne({ _id: objectId })
    if (result.deletedCount === 0) {
      throw createError({ statusCode: 404, statusMessage: 'Automation not found' })
    }

    // Run history is kept for auditability (auto-expires via TTL)
    return { success: true }
  }
  catch (error: any) {
    if (error?.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to delete automation' })
  }
})
