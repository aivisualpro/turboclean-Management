import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  const { db } = await connectToDatabase()
  const body = await readBody(event)

  // body is columns array
  const { columns } = body

  // Update status and order for all tasks based on their column position
  const bulkOperations = []
  
  const statusMap: Record<string, string> = {
    'todo': 'To Do',
    'in-progress': 'In Progress',
    'in-review': 'In Review',
    'done': 'Done'
  }

  for (const col of columns) {
    const status = statusMap[col.id]
    if (!status) continue
    
    for (let i = 0; i < col.tasks.length; i++) {
      const task = col.tasks[i]
      if (!task.id) continue

      try {
        bulkOperations.push({
          updateOne: {
            filter: { _id: new ObjectId(task.id) },
            update: { $set: { status, order: i } }
          }
        })
      } catch (e) {
        // Handle invalid ObjectIds if necessary
      }
    }
  }

  if (bulkOperations.length > 0) {
    await db.collection('turboCleanTasks').bulkWrite(bulkOperations)
  }

  return { success: true }
})
