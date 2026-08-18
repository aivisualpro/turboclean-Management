import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { syncToAppSheet } from '../../utils/appsheet-sync'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    if (!id || id.length !== 24) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid user ID' })
    }
    const { db } = await connectToDatabase()
    await db.collection('turboCleanAppUsers').deleteOne({ _id: new ObjectId(id) })

    // ── Sync to AppSheet (outbox-backed: auto-retried in the background on failure) ──
    const appSheet = await syncToAppSheet(db, 'AppUsers', 'Delete', [{ _id: id }])

    return { success: true, appSheet }
  } catch (error: any) {
    if (error?.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
