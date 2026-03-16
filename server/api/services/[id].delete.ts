import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { appSheetDelete } from '../../utils/appsheet'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    if (!id || id.length !== 24) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid service ID' })
    }
    const { db } = await connectToDatabase()
    await db.collection('turboCleanServices').deleteOne({ _id: new ObjectId(id) })

    // ── Sync to AppSheet ──
    appSheetDelete('Services', [{ _id: id }]).catch(err =>
      console.error('[Sync] Failed to delete service from AppSheet:', err)
    )

    return { success: true }
  } catch (error: any) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
