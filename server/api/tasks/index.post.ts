import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async (event) => {
  const { db } = await connectToDatabase()
  const body = await readBody(event)
  
  const statusMap: Record<string, string> = {
    'todo': 'To Do',
    'in-progress': 'In Progress',
    'in-review': 'In Review',
    'done': 'Done'
  }

  const newTask = {
    ...body,
    status: statusMap[body.status] || 'To Do',
    createdAt: new Date().toISOString(),
    order: 0 // Ideally find max order or just prepend
  }
  
  const res = await db.collection('turboCleanTasks').insertOne(newTask)
  
  return {
    ...newTask,
    id: res.insertedId.toString()
  }
})
