import { MongoClient } from 'mongodb'

const defaultTasks = [
  // To Do (formerly Backlog + To Do)
  {
    title: 'Implement dark mode toggle animation',
    description: 'Add a smooth sun/moon transition animation when toggling between light and dark mode. Use CSS transitions with a 300ms ease-in-out curve.',
    priority: 'low',
    assignee: { id: 'u1', name: 'Sarah Chen', avatar: '/avatars/shadcn.png' },
    dueDate: new Date(Date.now() + 14 * 86400000).toISOString(),
    status: 'To Do',
    labels: ['UI/UX', 'Enhancement'],
    subtasks: [
      { id: 'st-001', title: 'Design sun/moon SVG icons', completed: true },
      { id: 'st-002', title: 'Add CSS transition keyframes', completed: false },
      { id: 'st-003', title: 'Wire toggle to color mode composable', completed: false },
    ],
    comments: [
      { id: 'cm-001', author: 'Sarah Chen', avatar: '/avatars/shadcn.png', text: 'I found a great reference animation on Dribbble. Will share the link.', createdAt: new Date(Date.now() - 4 * 86400000).toISOString() },
      { id: 'cm-002', author: 'Alex Morgan', avatar: '/avatars/adeel.png', text: 'Make sure we use `prefers-reduced-motion` media query for accessibility.', createdAt: new Date(Date.now() - 3 * 86400000).toISOString() },
    ],
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    order: 0,
  },
  {
    title: 'Add CSV export to reports module',
    description: 'Users need the ability to export filtered report data as CSV files. Include column headers and respect active filters.',
    priority: 'medium',
    assignee: { id: 'u2', name: 'Alex Morgan', avatar: '/avatars/adeel.png' },
    dueDate: new Date(Date.now() + 21 * 86400000).toISOString(),
    status: 'To Do',
    labels: ['Feature', 'Reports'],
    subtasks: [
      { id: 'st-004', title: 'Create CSV utility function', completed: false },
      { id: 'st-005', title: 'Add export button to report toolbar', completed: false },
      { id: 'st-006', title: 'Handle large datasets with streaming', completed: false },
      { id: 'st-007', title: 'Write unit tests', completed: false },
    ],
    comments: [],
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    order: 1,
  },
  {
    title: 'Fix pagination on inventory table',
    description: 'The inventory table shows incorrect page counts when filters are applied.',
    priority: 'high',
    assignee: { id: 'u2', name: 'Alex Morgan', avatar: '/avatars/adeel.png' },
    dueDate: new Date(Date.now() + 2 * 86400000).toISOString(),
    status: 'To Do',
    labels: ['Bug', 'Inventory'],
    subtasks: [],
    comments: [],
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    order: 2,
  },

  // In Progress
  {
    title: 'Build PDF invoice generation',
    description: 'Implement server-side PDF generation for sale order invoices using Google Docs templates.',
    priority: 'high',
    assignee: { id: 'u2', name: 'Alex Morgan', avatar: '/avatars/adeel.png' },
    dueDate: new Date(Date.now() + 1 * 86400000).toISOString(),
    status: 'In Progress',
    labels: ['Feature', 'Sales'],
    subtasks: [],
    comments: [],
    createdAt: new Date(Date.now() - 8 * 86400000).toISOString(),
    order: 0,
  },
  {
    title: 'Implement role-based access control',
    description: 'Add granular RBAC with roles: Admin, Manager, Staff, Viewer. Protect routes and API endpoints based on user role.',
    priority: 'high',
    assignee: { id: 'u3', name: 'Marcus Webb', avatar: '/avatars/avatartion.png' },
    dueDate: new Date(Date.now() + 4 * 86400000).toISOString(),
    status: 'In Progress',
    labels: ['Security', 'Backend'],
    subtasks: [],
    comments: [],
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    order: 1,
  },

  // In Review
  {
    title: 'Redesign manufacturing detail page',
    description: 'Overhaul the manufacturing order detail view with better layout, inline editing, theme-adaptive colors.',
    priority: 'medium',
    assignee: { id: 'u1', name: 'Sarah Chen', avatar: '/avatars/shadcn.png' },
    dueDate: new Date(Date.now() + 1 * 86400000).toISOString(),
    status: 'In Review',
    labels: ['UI/UX', 'Manufacturing'],
    subtasks: [],
    comments: [],
    createdAt: new Date(Date.now() - 12 * 86400000).toISOString(),
    order: 0,
  },

  // Done
  {
    title: 'Set up Nuxt 4 project with Shadcn Vue',
    description: 'Initialize the project with Nuxt 4, Shadcn Vue, TailwindCSS 4, and configure the project structure.',
    priority: 'high',
    assignee: { id: 'u2', name: 'Alex Morgan', avatar: '/avatars/adeel.png' },
    dueDate: new Date(Date.now() - 20 * 86400000).toISOString(),
    status: 'Done',
    labels: ['Infrastructure', 'Setup'],
    subtasks: [],
    comments: [],
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    order: 0,
  }
]

async function seed() {
  const uri = 'mongodb+srv://admin_db_user:w3wD0fC2k0T9XjuU@cluster0.xjohmmi.mongodb.net/'
  const client = new MongoClient(uri)
  try {
    await client.connect()
    const db = client.db('turboClean')
    await db.collection('turboCleanTasks').deleteMany({})
    await db.collection('turboCleanTasks').insertMany(defaultTasks)
    console.log('Seed successful')
  } catch (error) {
    console.error('Seed error:', error)
  } finally {
    await client.close()
  }
}

seed()
