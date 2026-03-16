import { connectToDatabase } from '../../utils/mongodb'
import { appSheetAdd } from '../../utils/appsheet'
import { ServicesMapper } from '../../utils/sync-mapper'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { db } = await connectToDatabase()
    
    const doc = {
      service: body.service || '',
      description: body.description || '',
      createdAt: new Date(),
      updatedAt: new Date()
    }
    
    const result = await db.collection('turboCleanServices').insertOne(doc)
    
    // ── Sync to AppSheet ──
    const insertedDoc = { ...doc, _id: result.insertedId }
    appSheetAdd('Services', [ServicesMapper.toAppSheet(insertedDoc)]).catch(err =>
      console.error('[Sync] Failed to add service to AppSheet:', err)
    )

    return { success: true, id: result.insertedId.toString() }
  } catch (error: any) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
