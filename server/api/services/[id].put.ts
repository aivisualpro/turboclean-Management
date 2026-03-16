import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { appSheetEdit } from '../../utils/appsheet'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    if (!id || id.length !== 24) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid service ID' })
    }
    const body = await readBody(event)
    const { db } = await connectToDatabase()
    
    const updateDoc = {
      service: body.service,
      description: body.description,
      price: body.price !== undefined ? Number(body.price) : undefined,
      tax: body.tax !== undefined ? Number(body.tax) : undefined,
      updatedAt: new Date()
    }
    
    // Remove undefined fields
    Object.keys(updateDoc).forEach(key => (updateDoc as any)[key] === undefined && delete (updateDoc as any)[key])

    await db.collection('turboCleanServices').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc }
    )

    // ── Sync to AppSheet ──
    const appSheetRow: any = { _id: id, ...updateDoc }
    if (appSheetRow.updatedAt) appSheetRow.updatedAt = appSheetRow.updatedAt.toISOString()
    appSheetEdit('Services', [appSheetRow]).catch(err =>
      console.error('[Sync] Failed to edit service in AppSheet:', err)
    )

    return { success: true }
  } catch (error: any) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
