import { connectToDatabase } from '../../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { appSheetAdd } from '../../../utils/appsheet'
import { DealerServicesMapper } from '../../../utils/sync-mapper'

export default defineEventHandler(async (event) => {
  try {
    const { services } = await readBody(event)
    
    if (!services || !Array.isArray(services)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid or missing services array' })
    }

    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanDealers')

    // Group services by dealer
    const dealerUpdates: Record<string, any[]> = {}
    
    for (const s of services) {
      if (!s.dealer || !s.service) continue
      const arr = (dealerUpdates[s.dealer] ??= [])
      
      arr.push({
        id: new ObjectId().toString(),
        service: s.service,
        amount: Number(s.amount) || 0,
        tax: Number(s.tax) || 0,
        total: Number(s.total) || 0
      })
    }

    let count = 0
    const allAppSheetRows: any[] = []

    // Perform updates
    for (const [dealerIdStr, servicesArray] of Object.entries(dealerUpdates)) {
      if (!ObjectId.isValid(dealerIdStr)) {
        console.error(`Invalid ObjectId for dealer: ${dealerIdStr}`)
        continue
      }
      
      await collection.updateOne(
        { _id: new ObjectId(dealerIdStr) },
        { 
          $push: { services: { $each: servicesArray } } as any,
          $set: { updatedAt: new Date() }
        }
      )
      count += servicesArray.length

      // ── Prepare AppSheet sync rows ──
      for (const svc of servicesArray) {
        allAppSheetRows.push(DealerServicesMapper.toAppSheet({
          _id: svc.id,
          dealer: dealerIdStr,
          service: svc.service,
          amount: svc.amount,
          tax: svc.tax,
          total: svc.total,
        }))
      }
    }

    // ── Sync to AppSheet ──
    if (allAppSheetRows.length > 0) {
      appSheetAdd('DealerServices', allAppSheetRows).catch(err =>
        console.error('[Sync] Failed to add dealer services to AppSheet:', err)
      )
    }

    return {
      success: true,
      count
    }
  } catch (error: any) {
    console.error('Error importing dealer services:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to import dealer services'
    })
  }
})
