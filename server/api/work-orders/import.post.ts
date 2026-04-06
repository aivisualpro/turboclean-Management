import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { appSheetAdd } from '../../utils/appsheet'
import { WorkOrdersMapper } from '../../utils/sync-mapper'

export default defineEventHandler(async (event) => {
  try {
    let body;
    if ((event.node.req as any).body) {
      body = typeof (event.node.req as any).body === 'string' 
        ? JSON.parse((event.node.req as any).body) 
        : (event.node.req as any).body;
    } else {
      const rawBody = await new Promise<string>((resolve, reject) => {
        let data = ''
        event.node.req.on('data', chunk => { data += chunk })
        event.node.req.on('end', () => resolve(data))
        event.node.req.on('error', reject)
      })
      body = JSON.parse(rawBody)
    }
    const workOrders = body.workOrders
    
    if (!workOrders || !Array.isArray(workOrders)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid or missing workOrders array' })
    }

    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanWorkOrders')

    const documentsToInsert = workOrders.map((wo: any) => ({
      dealer: wo.dealer?.length === 24 ? new ObjectId(wo.dealer) : wo.dealer,
      date: (() => {
        if (!wo.date) return new Date()
        const d = new Date(wo.date)
        if (isNaN(d.getTime())) return new Date()
        // If it was parsed as local midnight (3/30 -> 2026-03-29T19:00:00Z in +05:00), 
        // we snap it to UTC midnight of the day it was intended for.
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
      })(),
      stockNumber: typeof wo.stockNumber === 'string' ? wo.stockNumber.toUpperCase() : (wo.stockNumber || ''),
      poNumber: wo.poNumber || '',
      vin: wo.vin || '',
      dealerServiceId: wo.dealerServiceId?.length === 24 ? new ObjectId(wo.dealerServiceId) : wo.dealerServiceId,
      amount: Number(wo.amount) || 0,
      tax: Number(wo.tax) || 0,
      total: Number(wo.total) || 0,
      notes: wo.notes || '',
      isInvoiced: wo.isInvoiced === true,
      isCustom: wo.isCustom === true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))

    if (documentsToInsert.length > 0) {
      const result = await collection.insertMany(documentsToInsert)
      
      // ── Sync to AppSheet ──
      const insertedIds = Object.values(result.insertedIds)
      const appSheetRows = documentsToInsert.map((doc: any, i: number) =>
        WorkOrdersMapper.toAppSheet({ ...doc, _id: insertedIds[i] })
      )
      appSheetAdd('WorkOrders', appSheetRows).catch(err =>
        console.error('[Sync] Failed to add work orders to AppSheet:', err)
      )
    }

    return {
      success: true,
      count: documentsToInsert.length
    }
  } catch (error: any) {
    console.error('Error importing work orders:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to import work orders'
    })
  }
})
