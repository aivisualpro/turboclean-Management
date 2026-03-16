/**
 * Sync Status/Health Endpoint
 * 
 * GET /api/sync/status
 * 
 * Tests connectivity to AppSheet and returns row counts
 * for both MongoDB and AppSheet to verify sync state.
 */

import { connectToDatabase } from '../../utils/mongodb'
import { appSheetFind, TABLE_MAP } from '../../utils/appsheet'

export default defineEventHandler(async () => {
  try {
    const { db } = await connectToDatabase()
    const status: Record<string, { mongo: number; appsheet: number | string; synced: boolean }> = {}

    // Check each table
    const tableEntries = Object.entries(TABLE_MAP) as [string, string][]

    for (const [collectionName, appSheetTable] of tableEntries) {
      let mongoCount = 0
      let appSheetCount: number | string = 'error'

      try {
        // Special case for DealerServices (embedded)
        if (appSheetTable === 'DealerServices') {
          const dealers = await db.collection('turboCleanDealers').find({}).toArray()
          mongoCount = dealers.reduce((sum: number, d: any) => sum + (d.services?.length || 0), 0)
        }
        else {
          mongoCount = await db.collection(collectionName).countDocuments()
        }
      }
      catch (err) {
        console.error(`[SyncStatus] MongoDB error for ${collectionName}:`, err)
      }

      try {
        const rows = await appSheetFind(appSheetTable)
        appSheetCount = Array.isArray(rows) ? rows.length : 0
      }
      catch (err) {
        console.error(`[SyncStatus] AppSheet error for ${appSheetTable}:`, err)
      }

      status[appSheetTable] = {
        mongo: mongoCount,
        appsheet: appSheetCount,
        synced: mongoCount === appSheetCount,
      }
    }

    return {
      success: true,
      appId: '7dc0e030-a298-4b45-a6ca-7ca25702b8d3',
      timestamp: new Date().toISOString(),
      tables: status,
    }
  }
  catch (error: any) {
    console.error('[SyncStatus] Error:', error)
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
