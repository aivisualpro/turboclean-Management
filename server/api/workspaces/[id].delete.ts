import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    if (!id || !ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })

    const { db } = await connectToDatabase()
    const result = await db.collection('turboCleanWorkspaces').deleteOne({ _id: new ObjectId(id) })

    if (result.deletedCount === 0) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })

    return { success: true, message: 'Workspace deleted' }
  } catch (error: any) {
    return createError({ statusCode: 500, statusMessage: error.message || 'Failed to delete workspace' })
  }
})
