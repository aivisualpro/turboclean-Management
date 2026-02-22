import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  const { db } = await connectToDatabase()
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)
  
  if (!body || !id) return { success: false }

  const statusMap: Record<string, string> = {
    'todo': 'To Do',
    'in-progress': 'In Progress',
    'in-review': 'In Review',
    'done': 'Done'
  }

  const updateDoc = { ...body }
  delete updateDoc._id
  delete updateDoc.id
  
  if (updateDoc.status && statusMap[updateDoc.status]) {
    updateDoc.status = statusMap[updateDoc.status]
  }

  await db.collection('turboCleanTasks').updateOne(
    { _id: new ObjectId(id) },
    { $set: updateDoc }
  )
  
  return { success: true }
})
