import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { appSheetEdit, appSheetAdd, appSheetDelete } from '../../utils/appsheet'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    const body = await readBody(event)

    if (!id || id.length !== 24) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid dealer ID' })
    }
    const { db } = await connectToDatabase()
    console.log(`[PATCH] Dealer ${id} - Body:`, JSON.stringify(body))

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
    if (body.services !== undefined) {
      updateDoc.services = Array.isArray(body.services) ? body.services.map((srv: any) => ({
        ...srv,
        id: srv.id || srv._id || new ObjectId().toString()
      })) : []
    }

    let filter: any
    try {
      filter = { _id: new ObjectId(id) }
    } catch {
      filter = { _id: id }
    }

    // Snapshot existing service IDs BEFORE the update so we can diff new vs existing
    let existingServiceIds = new Set<string>()
    if (updateDoc.services !== undefined) {
      const existing = await db.collection('turboCleanDealers').findOne(filter, { projection: { services: 1 } })
      existingServiceIds = new Set((existing?.services || []).map((s: any) => s.id || s._id || '').filter(Boolean))
    }

    const result = await db.collection('turboCleanDealers').updateOne(
      filter,
      { $set: updateDoc }
    )
    console.log(`[PATCH] updateOne result: matched=${result.matchedCount}, modified=${result.modifiedCount}`)

    // Verify the write
    const verified = await db.collection('turboCleanDealers').findOne(filter)

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
        .catch(e => console.error('[PATCH] AppSheet Dealers sync failed:', e?.message))
    }

    // ── Sync individual service rows to AppSheet DealerServices table ──
    // Split into 'new' (Add) vs 'existing' (Edit) to avoid 404 warnings.
    if (updateDoc.services !== undefined && Array.isArray(updateDoc.services)) {
      const allRows = (updateDoc.services as any[]).map((srv: any) => ({
        _id: srv.id || srv._id || '',
        dealer: id,
        service: srv.service || '',
        Amount: Number(srv.amount) || 0,
        Tax: Number(srv.tax) || 0,
        Total: Number(srv.total) || 0,
      })).filter(r => r._id)

      const newRows      = allRows.filter(r => !existingServiceIds.has(r._id))
      const existingRows = allRows.filter(r =>  existingServiceIds.has(r._id))

      const currentServiceIds = new Set(allRows.map(r => r._id))
      const deletedRows = Array.from(existingServiceIds)
        .filter(sid => !currentServiceIds.has(sid))
        .map(sid => ({ _id: sid }))

      if (newRows.length > 0) {
        console.log(`[PATCH] Adding ${newRows.length} new service rows to AppSheet DealerServices`)
        appSheetAdd('DealerServices', newRows)
          .catch(e => console.error('[PATCH] AppSheet DealerServices Add failed:', e?.message))
      }
      if (existingRows.length > 0) {
        console.log(`[PATCH] Editing ${existingRows.length} existing service rows in AppSheet DealerServices`)
        appSheetEdit('DealerServices', existingRows)
          .catch(e => console.error('[PATCH] AppSheet DealerServices Edit failed:', e?.message))
      }
      if (deletedRows.length > 0) {
        console.log(`[PATCH] Deleting ${deletedRows.length} removed service rows from AppSheet DealerServices`)
        appSheetDelete('DealerServices', deletedRows)
          .catch(e => console.error('[PATCH] AppSheet DealerServices Delete failed:', e?.message))
      }
    }

    return {
      success: true,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      isTaxApplied: verified?.isTaxApplied,
      taxPercentage: verified?.taxPercentage,
      services: verified?.services,
    }
  } catch (error: any) {
    console.error('[PATCH] ERROR:', error.message)
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
