/**
 * Full Sync Endpoint — Pull all AppSheet data → MongoDB
 * 
 * POST /api/sync/pull-from-appsheet
 * 
 * Use this to pull all data from AppSheet tables into MongoDB.
 * It uses the AppSheet Find API to fetch all rows.
 * 
 * Query param: ?table=AppUsers (optional, sync a single table)
 * Query param: ?mode=merge|replace (default: merge)
 * 
 * merge = upsert (insert or update by _id)
 * replace = drop collection data and re-insert
 */

import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { appSheetFind, REVERSE_TABLE_MAP } from '../../utils/appsheet'
import { MAPPER_LOOKUP } from '../../utils/sync-mapper'

const TABLES_TO_SYNC = ['AppUsers', 'Dealers', 'Services', 'WorkOrders', 'DealerServices']

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const singleTable = (query.table as string) || ''
    const mode = (query.mode as string) || 'merge'
    const { db } = await connectToDatabase()

    const results: Record<string, { pulled: number; status: string }> = {}
    const tablesToProcess = singleTable ? [singleTable] : TABLES_TO_SYNC

    for (const tableName of tablesToProcess) {
      const collectionName = REVERSE_TABLE_MAP[tableName]
      const mapper = MAPPER_LOOKUP[tableName]

      if (!collectionName || !mapper) {
        results[tableName] = { pulled: 0, status: `skipped – unknown table` }
        continue
      }

      // Fetch all rows from AppSheet
      const appSheetRows = await appSheetFind(tableName)

      if (!appSheetRows || !Array.isArray(appSheetRows)) {
        results[tableName] = { pulled: 0, status: 'no data returned from AppSheet' }
        continue
      }

      // Special handling for DealerServices (embedded)
      if (tableName === 'DealerServices') {
        await handleDealerServicesPull(db, appSheetRows, mode)
        results[tableName] = { pulled: appSheetRows.length, status: 'done' }
        continue
      }

      const collection = db.collection(collectionName)

      if (mode === 'replace') {
        // For Dealers: snapshot tax fields before replace so we can restore them
        let taxSnapshot: Map<string, { isTaxApplied?: boolean; taxPercentage?: number }> | null = null
        if (tableName === 'Dealers') {
          const existingDocs = await collection.find({}, { projection: { _id: 1, isTaxApplied: 1, taxPercentage: 1 } }).toArray()
          taxSnapshot = new Map()
          for (const doc of existingDocs) {
            taxSnapshot.set(doc._id.toString(), {
              isTaxApplied: doc.isTaxApplied,
              taxPercentage: doc.taxPercentage,
            })
          }
        }

        // Delete all existing data and re-insert
        await collection.deleteMany({})
        const docs = appSheetRows.map((row: any) => {
          const mongoDoc = mapper.toMongo(row)
          const rowId = row._id || row.id

          // Restore tax fields from snapshot
          if (taxSnapshot && rowId && taxSnapshot.has(rowId)) {
            const snap = taxSnapshot.get(rowId)!
            if (snap.isTaxApplied !== undefined) mongoDoc.isTaxApplied = snap.isTaxApplied
            if (snap.taxPercentage !== undefined) mongoDoc.taxPercentage = snap.taxPercentage
          }

          if (rowId && rowId.length === 24) {
            try {
              return { ...mongoDoc, _id: new ObjectId(rowId) }
            }
            catch { /* fall through */ }
          }
          return mongoDoc
        })
        if (docs.length > 0) {
          await collection.insertMany(docs as any[])
        }
      }
      else {
        // Merge mode: upsert each row
        for (const row of appSheetRows) {
          const mongoDoc = mapper.toMongo(row)
          const rowId = row._id || row.id

          if (rowId && rowId.length === 24) {
            try {
              // For Dealers: preserve web-only tax fields from MongoDB
              // AppSheet may hold stale values that would overwrite user settings
              if (tableName === 'Dealers') {
                const existing = await collection.findOne({ _id: new ObjectId(rowId) })
                if (existing) {
                  if (existing.isTaxApplied !== undefined) {
                    mongoDoc.isTaxApplied = existing.isTaxApplied
                  }
                  if (existing.taxPercentage !== undefined) {
                    mongoDoc.taxPercentage = existing.taxPercentage
                  }
                }
              }

              await collection.updateOne(
                { _id: new ObjectId(rowId) },
                { $set: { ...mongoDoc, updatedAt: new Date() } },
                { upsert: true }
              )
              continue
            }
            catch { /* fall through */ }
          }

          // If no valid _id, just insert
          await collection.insertOne(mongoDoc)
        }
      }

      results[tableName] = { pulled: appSheetRows.length, status: 'done' }
    }

    return { success: true, mode, results }
  }
  catch (error: any) {
    console.error('[FullSync] Error pulling from AppSheet:', error)
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})

/**
 * Handle pulling DealerServices from AppSheet
 * Since DealerServices are embedded arrays inside Dealers,
 * we group by dealer and update each dealer's services array
 */
async function handleDealerServicesPull(db: any, appSheetRows: any[], mode: string) {
  const dealersCollection = db.collection('turboCleanDealers')

  // Group services by dealer
  const dealerServicesMap: Record<string, any[]> = {}

  for (const row of appSheetRows) {
    const dealerId = row.dealer || ''
    if (!dealerId) continue
    if (!dealerServicesMap[dealerId]) {
      dealerServicesMap[dealerId] = []
    }
    dealerServicesMap[dealerId].push({
      id: row._id || row.id || new ObjectId().toString(),
      service: row.service || '',
      amount: Number(row.amount) || 0,
      tax: Number(row.tax) || 0,
      total: Number(row.total) || 0,
    })
  }

  for (const [dealerId, services] of Object.entries(dealerServicesMap)) {
    let filter: any
    try {
      filter = { _id: new ObjectId(dealerId) }
    }
    catch {
      filter = { _id: dealerId }
    }

    if (mode === 'replace') {
      await dealersCollection.updateOne(filter, {
        $set: { services, updatedAt: new Date() },
      })
    }
    else {
      // Merge: replace services array entirely for each dealer
      // (since individual services don't have unique _ids from AppSheet context)
      await dealersCollection.updateOne(filter, {
        $set: { services, updatedAt: new Date() },
      })
    }
  }
}
