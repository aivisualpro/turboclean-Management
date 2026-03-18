import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { appSheetEdit } from '../../utils/appsheet'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    const body = await readBody(event)
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

    // ── Sync to AppSheet — but NOT isTaxApplied / taxPercentage ──
    // These are web-only fields. Sending them to AppSheet triggers a webhook
    // echo that overwrites MongoDB back to the old values. We manage them
    // exclusively in MongoDB.
    const hasNonTaxFields = (
      body.dealer !== undefined ||
      body.phone !== undefined ||
      body.email !== undefined ||
      body.address !== undefined ||
      body.notes !== undefined ||
      body.status !== undefined ||
      body.contacts !== undefined
    )

    if (hasNonTaxFields) {
      const appSheetRow: Record<string, any> = { _id: id }
      if (updateDoc.dealer !== undefined) appSheetRow.dealer = updateDoc.dealer
      if (updateDoc.phone !== undefined) appSheetRow.phone = updateDoc.phone
      if (updateDoc.email !== undefined) appSheetRow.email = updateDoc.email
      if (updateDoc.address !== undefined) appSheetRow.address = updateDoc.address
      if (updateDoc.notes !== undefined) appSheetRow.notes = updateDoc.notes
      if (updateDoc.status !== undefined) appSheetRow.status = updateDoc.status

      console.log('[PATCH] AppSheet sync row=', JSON.stringify(appSheetRow))
      try {
        const appSheetResult = await appSheetEdit('Dealers', [appSheetRow])
        console.log('[PATCH] AppSheet sync result=', JSON.stringify(appSheetResult)?.slice(0, 300))
      } catch (syncErr: any) {
        console.error('[PATCH] AppSheet sync FAILED:', syncErr.message)
      }
    } else {
      console.log('[PATCH] Skipping AppSheet sync — only tax fields changed (no echo webhook).')
    }

    // Delayed re-verification: check if webhook overwrites the value
    setTimeout(async () => {
      try {
        const { db: db2 } = await connectToDatabase()
        const recheck = await db2.collection('turboCleanDealers').findOne({ _id: new ObjectId(id) })
        console.log('[PATCH] 3s RE-CHECK: isTaxApplied=', recheck?.isTaxApplied, 'taxPercentage=', recheck?.taxPercentage)
      } catch (e: any) {
        console.error('[PATCH] 3s RE-CHECK failed:', e.message)
      }
    }, 3000)

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
