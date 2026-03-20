import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { appSheetEdit } from '../../utils/appsheet'
import * as fs from 'fs'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    const body = await readBody(event)
    const logMsg = `\n--- [PATCH] ${new Date().toISOString()} ---\nID: ${id}\nBODY: ${JSON.stringify(body)}\n`
    fs.appendFileSync('/tmp/patch.log', logMsg)
    
    console.log('[PATCH /api/dealers/:id] ── START ──')
    console.log('[PATCH] id=', id)
    console.log('[PATCH] raw body=', JSON.stringify(body))

    if (!id || id.length !== 24) {
      console.error('[PATCH] Invalid ID! length=', id?.length)
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

    console.log('[PATCH] updateDoc to $set=', JSON.stringify(updateDoc))

    const result = await db.collection('turboCleanDealers').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc }
    )
    console.log('[PATCH] MongoDB result: matchedCount=', result.matchedCount, 'modifiedCount=', result.modifiedCount)

    // Verify the write by re-reading the document
    const verified = await db.collection('turboCleanDealers').findOne({ _id: new ObjectId(id) })
    console.log('[PATCH] Verified doc: isTaxApplied=', verified?.isTaxApplied, 'taxPercentage=', verified?.taxPercentage)

    // ── Fire-and-forget: Sync to AppSheet in background ──
    // This is non-blocking so the HTTP response returns immediately after MongoDB write
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
      // Non-blocking — don't await
      appSheetEdit('Dealers', [appSheetRow])
        .then(() => console.log('[PATCH] AppSheet sync accepted.'))
        .catch(e => console.error('[PATCH] AppSheet sync FAILED (non-blocking):', e?.message))
    }

    console.log('[PATCH] ── END ──')
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
