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
          let filterId: any = rowId;
          
          if (rowId && rowId.length === 24 && /^[0-9a-fA-F]{24}$/.test(rowId)) {
            try { filterId = new ObjectId(rowId) } catch { filterId = rowId }
          } else if (!rowId) {
            filterId = new ObjectId()
          }

          try {
            const existing = await collection.findOne({ _id: filterId })
            if (existing) {
              await collection.updateOne(
                { _id: filterId },
                { $set: { ...mongoDoc, updatedAt: new Date() } }
              )
              results.push({ success: true, action: 'updated-existing', id: filterId.toString() })
            } else {
              await collection.insertOne({ ...mongoDoc, _id: filterId } as any)
              results.push({ success: true, action: 'added', id: filterId.toString() })
            }
          } catch (e: any) {
            console.error('[Webhook] Error during add:', e)
            results.push({ success: false, action: 'added', error: e.message })
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

          const existing = await collection.findOne(filter)
          
          // Echo prevention: If the web-ui updated this document recently,
          // this webhook is just an echo of our own appSheetEdit() call.
          // SKIP the MongoDB write entirely to prevent any overwriting.
          if (existing && existing.lastUpdatedBy === 'web-ui' && existing.updatedAt) {
            const timeDiff = new Date().getTime() - new Date(existing.updatedAt).getTime()
            if (timeDiff < 30000) {
              console.log(`[Webhook] ECHO detected for ${table}/${rowId} — skipping MongoDB write (web-ui updated ${Math.round(timeDiff/1000)}s ago)`)
              results.push({
                success: true,
                action: 'edited',
                id: rowId,
                matched: 0,
                modified: 0,
                isEcho: true,
              })
              break
            }
          }

          // For Dealers: ALWAYS preserve isTaxApplied and taxPercentage from MongoDB.
          if (existing && table === 'Dealers') {
            if (existing.isTaxApplied !== undefined) {
              mongoDoc.isTaxApplied = existing.isTaxApplied
            }
            if (existing.taxPercentage !== undefined) {
              mongoDoc.taxPercentage = existing.taxPercentage
            }
          }

          // For AppUsers: ALWAYS preserve registerDealers from MongoDB.
          // MongoDB stores dealer ObjectIds, AppSheet stores dealer names as comma-separated text.
          // The mapper would convert names back to an array of name-strings, corrupting the ID array.
          if (existing && table === 'AppUsers') {
            if (existing.registerDealers !== undefined) {
              mongoDoc.registerDealers = existing.registerDealers
            }
          }

          // Ensure mongoDoc doesn't forcefully overwrite lastUpdatedBy from the mapper
          delete mongoDoc.lastUpdatedBy

          const updateResult = await collection.updateOne(filter, {
            $set: { ...mongoDoc, updatedAt: new Date(), lastUpdatedBy: 'appsheet-webhook' },
          })

          results.push({
            success: true,
            action: 'edited',
            id: rowId,
            matched: updateResult.matchedCount,
            modified: updateResult.modifiedCount,
            isEcho: false,
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
      if (r.success && !r.isEcho) {
        emitSyncEvent({ table, action: r.action || action.toLowerCase(), id: r.id || '' })
      } else if (r.isEcho) {
        console.log(`[Webhook] Skipped SSE broadcast to frontend for echo event on ${table}/${r.id}`)
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

  // AppSheet column names are capitalized (Amount/Tax/Total) but some webhook
  // bot templates send them lowercase — accept both so values never land as 0.
  // Also tolerate currency-formatted strings like "$1,234.00".
  const parseMoney = (v: any) => typeof v === 'number' ? v : (parseFloat(String(v ?? '').replace(/[^\d.-]/g, '')) || 0)
  const amount = parseMoney(row.amount ?? row.Amount)
  const tax = parseMoney(row.tax ?? row.Tax)
  const total = parseMoney(row.total ?? row.Total)
  const service = row.service ?? row.Service ?? ''

  switch (action.toLowerCase()) {
    case 'add': {
      if (!dealerId) {
        throw createError({ statusCode: 400, statusMessage: 'Missing dealer ID for DealerService add' })
      }

      const serviceEntry = {
        id: rowId || new ObjectId().toString(),
        service,
        amount,
        tax,
        total,
      }

      let filter: any
      try {
        filter = { _id: new ObjectId(dealerId) }
      }
      catch {
        filter = { _id: dealerId }
      }

      // Dedupe: if this service id already exists on the dealer (e.g. AppSheet
      // echoing back a row the web app just created), don't push a duplicate.
      const existingDealer = await dealersCollection.findOne(
        { ...filter, 'services.id': serviceEntry.id },
        { projection: { _id: 1 } },
      )
      if (existingDealer) {
        console.log(`[Webhook] DealerService ${serviceEntry.id} already exists on dealer ${dealerId} — skipping duplicate add (echo)`)
        return { success: true, action: 'added-dealer-service', dealerId, serviceId: serviceEntry.id, isEcho: true }
      }

      await dealersCollection.updateOne(filter, {
        $push: { services: serviceEntry } as any,
        $set: { updatedAt: new Date(), lastUpdatedBy: 'appsheet-webhook' },
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

      // Echo prevention: if the incoming values match what MongoDB already has,
      // or the web app rewrote THIS exact row seconds ago, this is AppSheet
      // echoing our own change back — skip the write so rapid consecutive
      // edits can't be reverted. (Row-scoped: edits to OTHER services on the
      // same dealer are never suppressed.)
      const dealerDoc = await dealersCollection.findOne(filter, { projection: { services: 1, updatedAt: 1, lastUpdatedBy: 1, lastWebServiceWrite: 1 } })
      if (!dealerDoc) {
        let dealerFilter: any
        try {
          dealerFilter = { _id: new ObjectId(dealerId) }
        }
        catch {
          dealerFilter = { _id: dealerId }
        }

        // Don't resurrect a row the web app just deleted (delete may still be
        // in flight to AppSheet, producing a late edit webhook for it).
        const recentDelete = await db.collection('turboCleanSyncOutbox').findOne({
          table: 'DealerServices',
          action: 'Delete',
          rowKey: rowId,
          createdAt: { $gte: new Date(Date.now() - 10 * 60_000) },
        }, { projection: { _id: 1 } }).catch(() => null)
        if (recentDelete) {
          console.log(`[Webhook] DealerService ${rowId} was deleted from the web app recently — ignoring late AppSheet edit`)
          return { success: true, action: 'edited-dealer-service', dealerId, serviceId: rowId, isEcho: true }
        }

        // Legacy rows are keyed by `_id` instead of `id` — don't create a duplicate
        const legacyMatch = await dealersCollection.findOne(
          { ...dealerFilter, 'services._id': rowId },
          { projection: { _id: 1 } },
        )
        if (legacyMatch) {
          console.log(`[Webhook] DealerService ${rowId} exists under legacy _id key — skipping to avoid duplicate`)
          return { success: true, action: 'edited-dealer-service', dealerId, serviceId: rowId, matched: 1 }
        }

        // Service row genuinely missing locally — self-heal by adding it
        // instead of silently dropping the AppSheet edit.
        const healResult = await dealersCollection.updateOne(dealerFilter, {
          $push: { services: { id: rowId, service, amount, tax, total } } as any,
          $set: { updatedAt: new Date(), lastUpdatedBy: 'appsheet-webhook' },
        })
        console.log(`[Webhook] DealerService ${rowId} not found locally on edit — ${healResult.matchedCount ? 'added it (self-heal)' : `dealer ${dealerId} not found either, skipped`}`)
        return { success: true, action: 'edited-dealer-service', dealerId, serviceId: rowId, matched: healResult.matchedCount }
      }
      else {
        const current = (dealerDoc.services || []).find((s: any) => s.id === rowId)
        const valuesMatch = current
          && (current.service || '') === service
          && Number(current.amount || 0) === amount
          && Number(current.tax || 0) === tax
          && Number(current.total || 0) === total
        const lastWeb = dealerDoc.lastWebServiceWrite
        const recentWebWriteSameRow = lastWeb && lastWeb.id === rowId && lastWeb.at
          && (Date.now() - new Date(lastWeb.at).getTime()) < 30000
        if (valuesMatch || recentWebWriteSameRow) {
          console.log(`[Webhook] ECHO detected for DealerServices/${rowId} — skipping MongoDB write (${valuesMatch ? 'values identical' : 'web-ui rewrote this row <30s ago'})`)
          return { success: true, action: 'edited-dealer-service', dealerId, serviceId: rowId, isEcho: true }
        }
      }

      await dealersCollection.updateOne(filter, {
        $set: {
          'services.$.service': service,
          'services.$.amount': amount,
          'services.$.tax': tax,
          'services.$.total': total,
          updatedAt: new Date(),
          lastUpdatedBy: 'appsheet-webhook',
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
        $set: { updatedAt: new Date(), lastUpdatedBy: 'appsheet-webhook' },
      })

      return { success: true, action: 'deleted-dealer-service', dealerId, serviceId: rowId }
    }

    default:
      throw createError({ statusCode: 400, statusMessage: `Unknown DealerService action: ${action}` })
  }
}
