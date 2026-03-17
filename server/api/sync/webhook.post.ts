/**
 * AppSheet Webhook Endpoint
 * 
 * This endpoint receives webhook calls from AppSheet when data changes.
 * AppSheet should call this URL whenever a row is added, edited, or deleted.
 * 
 * Supports TWO payload formats:
 * 
 * ── Format 1: Original (simple) ────────────────────────────
 * {
 *   "table": "AppUsers",
 *   "action": "add" | "edit" | "delete",
 *   "row": { ... single row ... }
 * }
 * 
 * ── Format 2: AppSheet native (from bots/webhooks) ─────────
 * URL: https://your-domain.com/api/sync/webhook?table=AppUsers
 * {
 *   "Action": "Add",
 *   "Properties": { ... },
 *   "Rows": [{ ... }, { ... }]
 * }
 * 
 * The table name can be provided via:
 *   - Query parameter: ?table=AppUsers
 *   - Body field: "table": "AppUsers"
 */

import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { REVERSE_TABLE_MAP, appSheetEdit } from '../../utils/appsheet'
import { MAPPER_LOOKUP } from '../../utils/sync-mapper'
import { emitSyncEvent } from '../../utils/sync-events'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const query = getQuery(event)

    // ── Normalize: support both formats ───────────────────
    // Table: from query param, body.table, or body root
    const table = (query.table as string) || body?.table || ''

    // Action: body.action (Format 1) or body.Action (Format 2)
    const action: string = body?.action || body?.Action || ''

    // Rows: body.row as single (Format 1) or body.Rows as array (Format 2)
    const rows: any[] = body?.Rows
      ? (Array.isArray(body.Rows) ? body.Rows : [body.Rows])
      : body?.row
        ? [body.row]
        : []

    if (!table) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Missing table name. Pass via ?table=AppUsers query param or "table" field in body.',
      })
    }

    if (!action) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Missing action. Provide "action" or "Action" in the body.',
      })
    }

    if (!rows.length) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Missing row data. Provide "row" (object) or "Rows" (array) in the body.',
      })
    }

    const collectionName = REVERSE_TABLE_MAP[table]
    if (!collectionName) {
      throw createError({
        statusCode: 400,
        statusMessage: `Unknown AppSheet table: ${table}`,
      })
    }

    const mapper = MAPPER_LOOKUP[table]
    if (!mapper) {
      throw createError({
        statusCode: 400,
        statusMessage: `No mapper found for table: ${table}`,
      })
    }

    const { db } = await connectToDatabase()
    const collection = db.collection(collectionName)

    // ── Process each row ──────────────────────────────────
    const results: any[] = []

    for (const row of rows) {
      const rowId = row._id || row.id || ''

      // Special handling for DealerServices (embedded in Dealers collection)
      if (table === 'DealerServices') {
        const r = await handleDealerServiceSync(db, action, row, rowId)
        results.push(r)
        continue
      }

      switch (action.toLowerCase()) {
        case 'add': {
          const mongoDoc = mapper.toMongo(row)
          
          // If ID is provided and looks like a valid 24-char hex ObjectId, use it
          if (rowId && rowId.length === 24 && /^[0-9a-fA-F]{24}$/.test(rowId)) {
            try {
              // Check if already exists (prevent duplicates)
              const existing = await collection.findOne({ _id: new ObjectId(rowId) })
              if (existing) {
                // Update instead
                await collection.updateOne(
                  { _id: new ObjectId(rowId) },
                  { $set: { ...mongoDoc, updatedAt: new Date() } }
                )
                results.push({ success: true, action: 'updated-existing', id: rowId })
              } else {
                // Insert with the same _id
                await collection.insertOne({ ...mongoDoc, _id: new ObjectId(rowId) } as any)
                results.push({ success: true, action: 'added', id: rowId })
              }
            }
            catch {
              const result = await collection.insertOne(mongoDoc)
              const newId = result.insertedId.toString()
              results.push({ success: true, action: 'added', id: newId, appSheetOldId: rowId })
            }
          }
          else {
            // AppSheet _id is not a valid ObjectId — insert and sync the real ID back
            const result = await collection.insertOne(mongoDoc)
            const newId = result.insertedId.toString()
            results.push({ success: true, action: 'added', id: newId, appSheetOldId: rowId })
          }
          break
        }

        case 'edit': {
          if (!rowId) {
            results.push({ success: false, error: 'Missing _id for edit action' })
            break
          }
          console.log(`[Webhook] EDIT for ${table} rowId=${rowId} - AppSheet row:`, JSON.stringify(row).slice(0, 300))
          const mongoDoc = mapper.toMongo(row)
          console.log(`[Webhook] EDIT mapped to mongoDoc:`, JSON.stringify(mongoDoc).slice(0, 300))

          
          let filter: any
          try {
            filter = { _id: new ObjectId(rowId) }
          }
          catch {
            filter = { _id: rowId }
          }

          const updateResult = await collection.updateOne(filter, {
            $set: { ...mongoDoc, updatedAt: new Date() },
          })

          results.push({
            success: true,
            action: 'edited',
            id: rowId,
            matched: updateResult.matchedCount,
            modified: updateResult.modifiedCount,
          })
          break
        }

        case 'delete': {
          if (!rowId) {
            results.push({ success: false, error: 'Missing _id for delete action' })
            break
          }

          let filter: any
          try {
            filter = { _id: new ObjectId(rowId) }
          }
          catch {
            filter = { _id: rowId }
          }

          const deleteResult = await collection.deleteOne(filter)

          results.push({
            success: true,
            action: 'deleted',
            id: rowId,
            deleted: deleteResult.deletedCount,
          })
          break
        }

        default:
          results.push({ success: false, error: `Unknown action: ${action}` })
      }
    }

    // ── Emit real-time events for all successful operations ──
    for (const r of results) {
      if (r.success) {
        emitSyncEvent({ table, action: r.action || action.toLowerCase(), id: r.id || '' })
      }
    }

    // ── Sync real MongoDB IDs back to AppSheet for new records ──
    // When AppSheet creates a record, its _id differs from MongoDB's ObjectId.
    // Strategy: Delete the old AppSheet row, re-add with the correct MongoDB ObjectId.
    const idUpdates = results.filter(r => r.success && r.appSheetOldId && r.id !== r.appSheetOldId)
    if (idUpdates.length > 0) {
      const { appSheetDelete: delFromAppSheet, appSheetAdd: addToAppSheet } = await import('../../utils/appsheet')
      
      for (const r of idUpdates) {
        // Delete the AppSheet row with the old auto-generated ID
        delFromAppSheet(table, [{ _id: r.appSheetOldId }]).then(() => {
          // Re-add with the correct MongoDB ObjectId + original data
          const mongoDoc = mapper.toMongo(rows.find((row: any) => (row._id || row.id) === r.appSheetOldId) || {})
          const appSheetRow = mapper.toAppSheet({ ...mongoDoc, _id: r.id })
          return addToAppSheet(table, [appSheetRow])
        }).catch(err => {
          console.error(`[Webhook] Failed to sync ID back to AppSheet for ${table}:`, err)
        })
      }
    }

    // Return single result if only one row, array if multiple
    return {
      success: true,
      processed: results.length,
      results: results.length === 1 ? results[0] : results,
    }
  }
  catch (error: any) {
    console.error('[Webhook] Error processing AppSheet webhook:', error)
    if (error.statusCode) throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})

/**
 * Handle DealerServices separately since they are embedded
 * in the turboCleanDealers collection as an array field
 */
async function handleDealerServiceSync(db: any, action: string, row: any, rowId: string) {
  const dealersCollection = db.collection('turboCleanDealers')
  const dealerId = row.dealer

  switch (action.toLowerCase()) {
    case 'add': {
      if (!dealerId) {
        throw createError({ statusCode: 400, statusMessage: 'Missing dealer ID for DealerService add' })
      }

      const serviceEntry = {
        id: rowId || new ObjectId().toString(),
        service: row.service || '',
        amount: Number(row.amount) || 0,
        tax: Number(row.tax) || 0,
        total: Number(row.total) || 0,
      }

      let filter: any
      try {
        filter = { _id: new ObjectId(dealerId) }
      }
      catch {
        filter = { _id: dealerId }
      }

      await dealersCollection.updateOne(filter, {
        $push: { services: serviceEntry } as any,
        $set: { updatedAt: new Date() },
      })

      return { success: true, action: 'added-dealer-service', dealerId, serviceId: serviceEntry.id }
    }

    case 'edit': {
      if (!dealerId || !rowId) {
        throw createError({ statusCode: 400, statusMessage: 'Missing dealer or service ID for edit' })
      }

      let filter: any
      try {
        filter = { _id: new ObjectId(dealerId), 'services.id': rowId }
      }
      catch {
        filter = { _id: dealerId, 'services.id': rowId }
      }

      await dealersCollection.updateOne(filter, {
        $set: {
          'services.$.service': row.service || '',
          'services.$.amount': Number(row.amount) || 0,
          'services.$.tax': Number(row.tax) || 0,
          'services.$.total': Number(row.total) || 0,
          updatedAt: new Date(),
        },
      })

      return { success: true, action: 'edited-dealer-service', dealerId, serviceId: rowId }
    }

    case 'delete': {
      if (!dealerId || !rowId) {
        throw createError({ statusCode: 400, statusMessage: 'Missing dealer or service ID for delete' })
      }

      let filter: any
      try {
        filter = { _id: new ObjectId(dealerId) }
      }
      catch {
        filter = { _id: dealerId }
      }

      await dealersCollection.updateOne(filter, {
        $pull: { services: { id: rowId } } as any,
        $set: { updatedAt: new Date() },
      })

      return { success: true, action: 'deleted-dealer-service', dealerId, serviceId: rowId }
    }

    default:
      throw createError({ statusCode: 400, statusMessage: `Unknown DealerService action: ${action}` })
  }
}
