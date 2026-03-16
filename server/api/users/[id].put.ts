import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { appSheetEdit } from '../../utils/appsheet'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    if (!id || id.length !== 24) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid user ID' })
    }
    const body = await readBody(event)
    const { db } = await connectToDatabase()
    
    const updateDoc = {
      name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address,
      role: body.role,
      status: body.status,
      password: body.password,
      updatedAt: new Date()
    }
    
    // Remove undefined fields
    Object.keys(updateDoc).forEach(key => (updateDoc as any)[key] === undefined && delete (updateDoc as any)[key])

    await db.collection('turboCleanAppUsers').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc }
    )

    // ── Sync to AppSheet ──
    const appSheetRow: any = { _id: id, ...updateDoc }
    if (appSheetRow.updatedAt) appSheetRow.updatedAt = appSheetRow.updatedAt.toISOString()
    appSheetEdit('AppUsers', [appSheetRow]).catch(err =>
      console.error('[Sync] Failed to edit user in AppSheet:', err)
    )

    return { success: true }
  } catch (error: any) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
