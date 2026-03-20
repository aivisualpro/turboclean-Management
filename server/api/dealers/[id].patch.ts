import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { appSheetEdit } from '../../utils/appsheet'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    const body = await readBody(event)

    if (!id || id.length !== 24) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid dealer ID' })
    }
    const { db } = await connectToDatabase()

    const updateDoc: Record<string, any> = {
      updatedAt: new Date(),
      lastUpdatedBy: 'web-ui'
    }

    // Only set fields that are explicitly provided
    if (body.isTaxApplied !== undefined) updateDoc.isTaxApplied = Boolean(body.isTaxApplied)
    if (body.taxPercentage !== undefined) updateDoc.taxPercentage = Number(body.taxPercentage)
    if (body.dealer !== undefined) updateDoc.dealer = body.dealer
    if (body.phone !== undefined) updateDoc.phone = body.phone
    if (body.email !== undefined) updateDoc.email = body.email
    if (body.address !== undefined) updateDoc.address = body.address
    if (body.notes !== undefined) updateDoc.notes = body.notes
    if (body.status !== undefined) updateDoc.status = body.status
    if (body.contacts !== undefined) updateDoc.contacts = body.contacts

    const result = await db.collection('turboCleanDealers').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc }
    )

    // Verify the write
    const verified = await db.collection('turboCleanDealers').findOne({ _id: new ObjectId(id) })

    // ── Sync changed fields to AppSheet (fire-and-forget) ──
    // The webhook handler will detect this as an echo and skip the write-back.
    const appSheetRow: Record<string, any> = { _id: id }
    if (updateDoc.dealer !== undefined) appSheetRow.dealer = updateDoc.dealer
    if (updateDoc.phone !== undefined) appSheetRow.phone = updateDoc.phone
    if (updateDoc.email !== undefined) appSheetRow.email = updateDoc.email
    if (updateDoc.address !== undefined) appSheetRow.address = updateDoc.address
    if (updateDoc.notes !== undefined) appSheetRow.notes = updateDoc.notes
    if (updateDoc.status !== undefined) appSheetRow.status = updateDoc.status
    if (updateDoc.isTaxApplied !== undefined) appSheetRow.isTaxApplied = updateDoc.isTaxApplied ? 'Y' : 'N'
    if (updateDoc.taxPercentage !== undefined) appSheetRow.taxPercentage = updateDoc.taxPercentage

    if (Object.keys(appSheetRow).length > 1) {
      appSheetEdit('Dealers', [appSheetRow])
        .catch(e => console.error('[PATCH] AppSheet sync failed:', e?.message))
    }

    return {
      success: true,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      isTaxApplied: verified?.isTaxApplied,
      taxPercentage: verified?.taxPercentage,
    }
  } catch (error: any) {
    console.error('[PATCH] ERROR:', error.message)
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
