import { connectToDatabase } from '../../utils/mongodb'
import { appSheetAdd } from '../../utils/appsheet'
import { AppUsersMapper } from '../../utils/sync-mapper'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { db } = await connectToDatabase()
    
    const doc = {
      name: body.name || '',
      email: body.email || '',
      phone: body.phone || '',
      address: body.address || '',
      role: body.role || 'User',
      status: body.status || 'Active',
      password: body.password || '',
      createdAt: new Date(),
      updatedAt: new Date()
    }
    
    const result = await db.collection('turboCleanAppUsers').insertOne(doc)
    
    // ── Sync to AppSheet ──
    const insertedDoc = { ...doc, _id: result.insertedId }
    appSheetAdd('AppUsers', [AppUsersMapper.toAppSheet(insertedDoc)]).catch(err =>
      console.error('[Sync] Failed to add user to AppSheet:', err)
    )

    return { success: true, id: result.insertedId.toString() }
  } catch (error: any) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
