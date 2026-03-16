/**
 * Full Sync Endpoint — Push all MongoDB data → AppSheet
 * 
 * POST /api/sync/push-to-appsheet
 * 
 * Use this to do an initial full sync from your database to AppSheet.
 * It reads all collections and pushes them to the corresponding AppSheet tables.
 * 
 * Query param: ?table=AppUsers (optional, sync a single table)
 */

import { connectToDatabase } from '../../utils/mongodb'
import { appSheetAdd, appSheetFind, TABLE_MAP } from '../../utils/appsheet'
import {
  AppUsersMapper,
  DealersMapper,
  DealerServicesMapper,
  ServicesMapper,
  WorkOrdersMapper,
} from '../../utils/sync-mapper'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const singleTable = (query.table as string) || ''
    const { db } = await connectToDatabase()

    const results: Record<string, { pushed: number; status: string }> = {}

    // ── AppUsers ──
    if (!singleTable || singleTable === 'AppUsers') {
      const docs = await db.collection('turboCleanAppUsers').find({}).toArray()
      const rows = docs.map(AppUsersMapper.toAppSheet)
      if (rows.length > 0) {
        // Push in batches of 100
        for (let i = 0; i < rows.length; i += 100) {
          const batch = rows.slice(i, i + 100)
          await appSheetAdd('AppUsers', batch)
        }
      }
      results.AppUsers = { pushed: rows.length, status: 'done' }
    }

    // ── Dealers ──
    if (!singleTable || singleTable === 'Dealers') {
      const docs = await db.collection('turboCleanDealers').find({}).toArray()
      const rows = docs.map(DealersMapper.toAppSheet)
      if (rows.length > 0) {
        for (let i = 0; i < rows.length; i += 100) {
          const batch = rows.slice(i, i + 100)
          await appSheetAdd('Dealers', batch)
        }
      }
      results.Dealers = { pushed: rows.length, status: 'done' }
    }

    // ── DealerServices (embedded in Dealers) ──
    if (!singleTable || singleTable === 'DealerServices') {
      const dealers = await db.collection('turboCleanDealers').find({}).toArray()
      const rows: any[] = []
      for (const dealer of dealers) {
        if (Array.isArray(dealer.services)) {
          for (const svc of dealer.services) {
            rows.push(DealerServicesMapper.toAppSheet({
              _id: svc.id || svc._id,
              dealer: dealer._id.toString(),
              service: svc.service,
              amount: svc.amount,
              tax: svc.tax,
              total: svc.total,
            }))
          }
        }
      }
      if (rows.length > 0) {
        for (let i = 0; i < rows.length; i += 100) {
          const batch = rows.slice(i, i + 100)
          await appSheetAdd('DealerServices', batch)
        }
      }
      results.DealerServices = { pushed: rows.length, status: 'done' }
    }

    // ── Services ──
    if (!singleTable || singleTable === 'Services') {
      const docs = await db.collection('turboCleanServices').find({}).toArray()
      const rows = docs.map(ServicesMapper.toAppSheet)
      if (rows.length > 0) {
        for (let i = 0; i < rows.length; i += 100) {
          const batch = rows.slice(i, i + 100)
          await appSheetAdd('Services', batch)
        }
      }
      results.Services = { pushed: rows.length, status: 'done' }
    }

    // ── WorkOrders ──
    if (!singleTable || singleTable === 'WorkOrders') {
      const docs = await db.collection('turboCleanWorkOrders').find({}).toArray()
      const rows = docs.map(WorkOrdersMapper.toAppSheet)
      if (rows.length > 0) {
        for (let i = 0; i < rows.length; i += 100) {
          const batch = rows.slice(i, i + 100)
          await appSheetAdd('WorkOrders', batch)
        }
      }
      results.WorkOrders = { pushed: rows.length, status: 'done' }
    }

    return { success: true, results }
  }
  catch (error: any) {
    console.error('[FullSync] Error pushing to AppSheet:', error)
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
