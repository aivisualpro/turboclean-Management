import { connectToDatabase } from '../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  const { db } = await connectToDatabase()
  try {
    const dealerId = '663363ad5cbadaec5dfddedc' // dummy ID format
    const startStr = '2026-04-14'
    const endStr = '2026-04-20'
    const possibleDealerIds: any[] = [dealerId]
    try { possibleDealerIds.push(new ObjectId(dealerId)) } catch {}
    
    // Test the logic using the exact query from generate.post.ts
    const t0 = Date.now()
    const rawWOs = await db.collection('turboCleanWorkOrders').find({
      dealer: { $in: possibleDealerIds }
    }).toArray()
    const t1 = Date.now()
    return { success: true, count: rawWOs.length, time: t1 - t0 }
  } catch (err: any) {
    return { success: false, error: err.message, stack: err.stack }
  }
})
