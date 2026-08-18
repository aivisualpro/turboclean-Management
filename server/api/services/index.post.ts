import { connectToDatabase } from '../../utils/mongodb'
import { ServicesMapper } from '../../utils/sync-mapper'
import { syncToAppSheet } from '../../utils/appsheet-sync'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { db } = await connectToDatabase()

    const service = typeof body.service === 'string' ? body.service.trim() : ''
    if (!service) {
      throw createError({ statusCode: 400, statusMessage: 'Service name is required' })
    }

    const doc = {
      service,
      description: body.description || '',
      createdAt: new Date(),
      updatedAt: new Date()
    }

    const result = await db.collection('turboCleanServices').insertOne(doc)

    // ── Sync to AppSheet (outbox-backed: auto-retried in the background on failure) ──
    const insertedDoc = { ...doc, _id: result.insertedId }
    const appSheet = await syncToAppSheet(db, 'Services', 'Add', [ServicesMapper.toAppSheet(insertedDoc)])

    return { success: true, id: result.insertedId.toString(), appSheet }
  } catch (error: any) {
    if (error?.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
