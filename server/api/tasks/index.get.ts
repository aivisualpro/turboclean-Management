import { connectToDatabase } from '../../utils/mongodb'
import type { Task } from '../../../app/types/kanban'

export default defineEventHandler(async () => {
  const { db } = await connectToDatabase()
  const tasks = await db.collection('turboCleanTasks').find({}).sort({ order: 1 }).toArray()
  
  // Transform to match KanbanBoard frontend format
  const columnsMap: Record<string, { id: string, title: string, tasks: any[] }> = {
    'To Do': { id: 'todo', title: 'To Do', tasks: [] },
    'In Progress': { id: 'in-progress', title: 'In Progress', tasks: [] },
    'In Review': { id: 'in-review', title: 'In Review', tasks: [] },
    'Done': { id: 'done', title: 'Done', tasks: [] }
  }

  for (const task of tasks) {
    const statusCol = columnsMap[task.status as string]
    if (statusCol) {
      // Map _id to id
      const mappedTask = {
        ...task,
        id: task._id.toString()
      }
      statusCol.tasks.push(mappedTask)
    }
  }

  return {
    columns: Object.values(columnsMap)
  }
})
