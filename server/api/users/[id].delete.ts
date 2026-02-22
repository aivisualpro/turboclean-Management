import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    if (!id || id.length !== 24) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid user ID' })
    }
    const { db } = await connectToDatabase()
    await db.collection('turboCleanAppUsers').deleteOne({ _id: new ObjectId(id) })
    return { success: true }
  } catch (error: any) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
