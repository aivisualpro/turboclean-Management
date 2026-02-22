import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  const { db } = await connectToDatabase()
  const id = getRouterParam(event, 'id')
  
  if (!id) return { success: false }
  
  await db.collection('turboCleanTasks').deleteOne({ _id: new ObjectId(id) })
  
  return { success: true }
})
