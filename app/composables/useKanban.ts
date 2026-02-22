import type { BoardState, Column, NewTask, Task } from '~/types/kanban'
import { nanoid } from 'nanoid'

const isClient = import.meta.client

const defaultBoard: BoardState = {
  columns: [
    { id: 'todo', title: 'To Do', tasks: [] },
    { id: 'in-progress', title: 'In Progress', tasks: [] },
    { id: 'in-review', title: 'In Review', tasks: [] },
    { id: 'done', title: 'Done', tasks: [] },
  ],
}

// ── Helper to find a task across all columns ──
function findTask(board: BoardState, columnId: string, taskId: string): Task | undefined {
  const col = board.columns.find(c => c.id === columnId)
  return col?.tasks.find(t => t.id === taskId)
}

export function useKanban() {
  const board = useState<BoardState>('kanban-board', () => ({ columns: [] }))

  async function loadBoard() {
    try {
      if (isClient) {
        const { columns } = await $fetch<{ columns: Column[] }>('/api/tasks')
        board.value.columns = columns
      }
    } catch {
      board.value = defaultBoard
    }
  }

  onMounted(() => {
    loadBoard()
  })

  // We remove persist() completely since we'll rely on specific endpoint calls
  async function persist() {
    // Left for backwards compatibility if needed, but we don't use localStorage anymore
  }

  function addColumn(title: string) {
    // Disabled as per requirements
  }

  function removeColumn(id: string) {
    // Disabled as per requirements
  }

  function updateColumn(id: string, title: string) {
    // Disabled as per requirements
  }

  async function addTask(columnId: string, payload: NewTask) {
    try {
      const newTask = await $fetch<Task>('/api/tasks', { 
        method: 'POST', 
        body: { status: columnId, ...payload } 
      })
      const col = board.value.columns.find(c => c.id === columnId)
      if (col) {
        col.tasks.unshift(newTask)
      }
    } catch (e) {
      console.error('Failed to add task', e)
    }
  }

  async function updateTask(columnId: string, taskId: string, patch: Partial<Task>) {
    const col = board.value.columns.find(c => c.id === columnId)
    if (!col) return
    const t = col.tasks.find(t => t.id === taskId)
    if (!t) return
    Object.assign(t, patch) // Optimistic update
    
    try {
       await $fetch(`/api/tasks/${taskId}`, {
         method: 'PUT',
         body: patch
       })
    } catch (e) {
      // Revert in a real app, ignoring for brevity
      console.error('Failed to update task', e)
    }
  }

  async function removeTask(columnId: string, taskId: string) {
    const col = board.value.columns.find(c => c.id === columnId)
    if (!col) return
    col.tasks = col.tasks.filter(t => t.id !== taskId) // Optimistic
    
    try {
      await $fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE' as any
      })
    } catch (e) {
      console.error('Failed to delete task', e)
    }
  }

  async function setColumns(next: Column[]) {
    // Triggered on drag and drop reordering
    board.value.columns = next // Optimistic Update

    try {
      // Wait to persist to server to update statuses and indexes globally
      await $fetch('/api/tasks/board', {
        method: 'PUT',
        body: { columns: next }
      })
    } catch (e) {
      console.error('Failed to reorder columns/tasks', e)
    }
  }

  // ── Subtask CRUD ──
  function addSubtask(columnId: string, taskId: string, title: string) {
    const task = findTask(board.value, columnId, taskId)
    if (!task) return
    if (!task.subtasks) task.subtasks = []
    task.subtasks.push({ id: nanoid(8), title, completed: false })
    updateTask(columnId, taskId, { subtasks: task.subtasks })
  }

  function toggleSubtask(columnId: string, taskId: string, subtaskId: string) {
    const task = findTask(board.value, columnId, taskId)
    if (!task?.subtasks) return
    const st = task.subtasks.find(s => s.id === subtaskId)
    if (st) {
       st.completed = !st.completed
       updateTask(columnId, taskId, { subtasks: task.subtasks })
    }
  }

  function removeSubtask(columnId: string, taskId: string, subtaskId: string) {
    const task = findTask(board.value, columnId, taskId)
    if (!task?.subtasks) return
    task.subtasks = task.subtasks.filter(s => s.id !== subtaskId)
    updateTask(columnId, taskId, { subtasks: task.subtasks })
  }

  // ── Comment CRUD ──
  function addComment(columnId: string, taskId: string, text: string) {
    const task = findTask(board.value, columnId, taskId)
    if (!task) return
    if (!task.comments) task.comments = []
    task.comments.push({
      id: nanoid(8),
      author: 'Alex Morgan',
      avatar: '/avatars/adeel.png',
      text,
      createdAt: new Date().toISOString(),
    })
    updateTask(columnId, taskId, { comments: task.comments })
  }

  function removeComment(columnId: string, taskId: string, commentId: string) {
    const task = findTask(board.value, columnId, taskId)
    if (!task?.comments) return
    task.comments = task.comments.filter(c => c.id !== commentId)
    updateTask(columnId, taskId, { comments: task.comments })
  }

  return {
    board,
    addColumn,
    removeColumn,
    updateColumn,
    addTask,
    updateTask,
    removeTask,
    setColumns,
    persist,
    addSubtask,
    toggleSubtask,
    removeSubtask,
    addComment,
    removeComment,
  }
}
