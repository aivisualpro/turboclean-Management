import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { ServicesMapper } from '../../utils/sync-mapper'
import { syncToAppSheet } from '../../utils/appsheet-sync'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    if (!id || id.length !== 24) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid service ID' })
    }
    const body = await readBody(event)
    const { db } = await connectToDatabase()
    const services = db.collection('turboCleanServices')

    const updateDoc = {
      service: body.service,
      description: body.description,
      updatedAt: new Date()
    }

    // Remove undefined fields
    Object.keys(updateDoc).forEach(key => (updateDoc as any)[key] === undefined && delete (updateDoc as any)[key])

    await services.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc }
    )

    // ── Sync to AppSheet: Edit only the changed columns; the full row is used
    //    only if the row is missing in AppSheet and must be re-created.
    //    Outbox-backed: auto-retried in the background on failure. ──
    const appSheetRow: Record<string, any> = { _id: id }
    if ((updateDoc as any).service !== undefined) appSheetRow.service = (updateDoc as any).service
    if ((updateDoc as any).description !== undefined) appSheetRow.description = (updateDoc as any).description

    const updated = await services.findOne({ _id: new ObjectId(id) })
    const appSheet = (updated && Object.keys(appSheetRow).length > 1)
      ? await syncToAppSheet(db, 'Services', 'Upsert', [appSheetRow], {
          addRows: [ServicesMapper.toAppSheet(updated)],
        })
      : { ok: true, queued: false }

    return { success: true, appSheet }
  } catch (error: any) {
    if (error?.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
