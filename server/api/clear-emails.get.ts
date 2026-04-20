import { connectToDatabase } from '../utils/mongodb'

export default defineEventHandler(async () => {
  const { db } = await connectToDatabase()
  try {
    // Option A: Just delete all email logs
    const result = await db.collection('turboCleanEmailLogs').deleteMany({})
    
    // Alternative if we only wanted to remove attachments:
    // const result = await db.collection('turboCleanEmailLogs').updateMany({}, { $unset: { attachments: "" } })
    
    return { success: true, deletedCount: result.deletedCount, message: "Cleared all email logs to free up space!" }
  } catch (err: any) {
    return { success: false, error: err.message, stack: err.stack }
  }
})
