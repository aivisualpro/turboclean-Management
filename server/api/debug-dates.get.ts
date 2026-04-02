import { connectToDatabase } from '../utils/mongodb'

export default defineEventHandler(async () => {
  const { db } = await connectToDatabase()
  const count = await db.collection('turboCleanWorkOrders').countDocuments()
  
  return {
    totalWorkOrders: count
  }
})
