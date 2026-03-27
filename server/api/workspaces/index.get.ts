import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const workspaces = await db.collection('turboCleanWorkspaces').find({}).sort({ createdAt: -1 }).toArray()
    
    // Map _id to id for frontend parity
    const mapped = workspaces.map(w => ({ ...w, id: w._id.toString() }))
    
    return { success: true, workspaces: mapped }
  } catch (error: any) {
    return createError({ statusCode: 500, statusMessage: error.message || 'Failed to fetch workspaces' })
  }
})
