import { connectToDatabase } from '../../utils/mongodb'
import { appSheetAdd } from '../../utils/appsheet'
import { DealersMapper } from '../../utils/sync-mapper'

export default defineEventHandler(async (event) => {
  try {
    let parsedBody;
    if ((event.node.req as any).body) {
      parsedBody = typeof (event.node.req as any).body === 'string' 
        ? JSON.parse((event.node.req as any).body) 
        : (event.node.req as any).body;
    } else {
      const rawBody = await new Promise<string>((resolve, reject) => {
        let data = ''
        event.node.req.on('data', chunk => { data += chunk })
        event.node.req.on('end', () => resolve(data))
        event.node.req.on('error', reject)
      })
      parsedBody = JSON.parse(rawBody)
    }
    const { dealers } = parsedBody;
    
    if (!dealers || !Array.isArray(dealers)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid or missing dealers array' })
    }

    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanDealers')

    // Map frontend Dealer payload to turboCleanDealers schema
    const dealersToInsert = dealers.map((d: any) => ({
      dealer: d.dealerName || '',
      phone: d.contacts?.[0]?.phones?.[0]?.number || '',
      email: d.contacts?.[0]?.emails?.[0] || '',
      address: d.address || '',
      notes: d.notes || '',
      status: d.status || 'Pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    }))

    if (dealersToInsert.length > 0) {
      const result = await collection.insertMany(dealersToInsert)
      
      // ── Sync to AppSheet ──
      const insertedIds = Object.values(result.insertedIds)
      const appSheetRows = dealersToInsert.map((doc: any, i: number) => 
        DealersMapper.toAppSheet({ ...doc, _id: insertedIds[i] })
      )
      await appSheetAdd('Dealers', appSheetRows).catch(err =>
        console.error('[Sync] Failed to add dealers to AppSheet:', err)
      )
    }

    return {
      success: true,
      count: dealersToInsert.length
    }
  } catch (error: any) {
    console.error('Error importing dealers:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to import dealers'
    })
  }
})
