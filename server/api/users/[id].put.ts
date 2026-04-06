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
    
    const updateDoc: Record<string, any> = {
      name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address,
      registerDealers: Array.isArray(body.registerDealers) ? body.registerDealers : undefined,
      role: body.role,
      status: body.status,
      password: body.password,
      workspaceId: body.workspaceId,
      updatedAt: new Date(),
      lastUpdatedBy: 'web-ui',
    }
    
    // Remove undefined fields
    Object.keys(updateDoc).forEach(key => updateDoc[key] === undefined && delete updateDoc[key])

    await db.collection('turboCleanAppUsers').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc }
    )

    // ── Sync to AppSheet (fire-and-forget) ──
    const appSheetRow: any = { _id: id }
    if (updateDoc.name !== undefined) appSheetRow.name = updateDoc.name
    if (updateDoc.email !== undefined) appSheetRow.email = updateDoc.email
    if (updateDoc.phone !== undefined) appSheetRow.phone = updateDoc.phone
    if (updateDoc.address !== undefined) appSheetRow.address = updateDoc.address
    if (updateDoc.role !== undefined) appSheetRow.role = updateDoc.role
    if (updateDoc.status !== undefined) appSheetRow.status = updateDoc.status
    if (updateDoc.password !== undefined) appSheetRow.password = updateDoc.password
    
    if (updateDoc.registerDealers !== undefined) {
      if (!updateDoc.registerDealers.length) {
        appSheetRow.registerDealers = ''
      } else {
        appSheetRow.registerDealers = updateDoc.registerDealers.join(' , ')
      }
    }

    if (Object.keys(appSheetRow).length > 1) {
      await appSheetEdit('AppUsers', [appSheetRow]).catch(err =>
        console.error('[Sync] Failed to edit user in AppSheet:', err)
      )
    }

    return { success: true }
  } catch (error: any) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
