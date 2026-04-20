import process from 'node:process'
import { connectToDatabase } from '../utils/mongodb'

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    await db.collection('turboCleanEmailLogs').drop()
    return { success: true, message: "Dropped turboCleanEmailLogs collection successfully!" }
  } catch (error: any) {
    if (error.codeName === 'NamespaceNotFound') {
        return { success: true, message: "Collection already dropped or doesn't exist!" }
    }
    console.error('Failed to drop:', error)
    return { success: false, error: error.message }
  }
})
