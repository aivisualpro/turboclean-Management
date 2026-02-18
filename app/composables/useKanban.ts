import type { BoardState, Column, NewTask, Task } from '~/types/kanban'
import { nanoid } from 'nanoid'

const isClient = import.meta.client

const STORAGE_KEY = 'kanban.board.v3'
const TASK_KEY_ID = 'TASK'

function generateTaskId() {
  const key = 'kanban.task.counter'
  let counter = 1

  if (import.meta.client) {
    const saved = localStorage.getItem(key)
    counter = saved ? Number.parseInt(saved) + 1 : 1
    localStorage.setItem(key, counter.toString())
  }

  return `${TASK_KEY_ID}-${counter.toString().padStart(3, '0')}`
}

function generateColumnId(title: string) {
  return title.toLowerCase().replace(/\s+/g, '-')
}

const defaultBoard: BoardState = {
  columns: [
    {
      id: 'backlog',
      title: 'Backlog',
      tasks: [
        {
          id: 'TASK-001',
          title: 'Implement dark mode toggle animation',
          description: 'Add a smooth sun/moon transition animation when toggling between light and dark mode. Use CSS transitions with a 300ms ease-in-out curve.',
          priority: 'low',
          assignee: { id: 'u1', name: 'Sarah Chen', avatar: '/avatars/shadcn.png' },
          dueDate: new Date(Date.now() + 14 * 86400000).toISOString(),
          status: 'backlog',
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
        },
        {
          id: 'TASK-002',
          title: 'Add CSV export to reports module',
          description: 'Users need the ability to export filtered report data as CSV files. Include column headers and respect active filters.',
          priority: 'medium',
          assignee: { id: 'u2', name: 'Alex Morgan', avatar: '/avatars/adeel.png' },
          dueDate: new Date(Date.now() + 21 * 86400000).toISOString(),
          status: 'backlog',
          labels: ['Feature', 'Reports'],
          subtasks: [
            { id: 'st-004', title: 'Create CSV utility function', completed: false },
            { id: 'st-005', title: 'Add export button to report toolbar', completed: false },
            { id: 'st-006', title: 'Handle large datasets with streaming', completed: false },
            { id: 'st-007', title: 'Write unit tests', completed: false },
          ],
          comments: [
            { id: 'cm-003', author: 'Marcus Webb', avatar: '/avatars/avatartion.png', text: 'Should we also support Excel format? Some clients prefer .xlsx over .csv.', createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
          ],
          createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        },
        {
          id: 'TASK-003',
          title: 'Research WebSocket integration for live updates',
          description: 'Evaluate Socket.io vs native WebSockets for real-time dashboard updates. Document performance benchmarks and bundle size impact.',
          priority: 'low',
          assignee: { id: 'u3', name: 'Marcus Webb', avatar: '/avatars/avatartion.png' },
          dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
          status: 'backlog',
          labels: ['Research', 'Infrastructure'],
          subtasks: [
            { id: 'st-008', title: 'Benchmark Socket.io latency', completed: true },
            { id: 'st-009', title: 'Benchmark native WebSocket latency', completed: true },
            { id: 'st-010', title: 'Compare bundle sizes', completed: false },
            { id: 'st-011', title: 'Write recommendation document', completed: false },
          ],
          comments: [
            { id: 'cm-004', author: 'Alex Morgan', avatar: '/avatars/adeel.png', text: 'Consider SSE (Server-Sent Events) as a simpler alternative for one-way updates.', createdAt: new Date(Date.now() - 6 * 86400000).toISOString() },
            { id: 'cm-005', author: 'Marcus Webb', avatar: '/avatars/avatartion.png', text: 'Good point. I\'ll add SSE to the comparison matrix.', createdAt: new Date(Date.now() - 5 * 86400000).toISOString() },
            { id: 'cm-006', author: 'Sarah Chen', avatar: '/avatars/shadcn.png', text: 'Make sure to test with high-traffic simulation (1000+ concurrent users).', createdAt: new Date(Date.now() - 4 * 86400000).toISOString() },
          ],
          createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        },
        {
          id: 'TASK-004',
          title: 'Design multi-tenant architecture',
          description: 'Create an architecture document for supporting multiple organizations within the same deployment. Consider data isolation, theming, and billing.',
          priority: 'high',
          assignee: { id: 'u1', name: 'Sarah Chen', avatar: '/avatars/shadcn.png' },
          dueDate: new Date(Date.now() + 45 * 86400000).toISOString(),
          status: 'backlog',
          labels: ['Architecture', 'Planning'],
          subtasks: [
            { id: 'st-012', title: 'Define tenant isolation strategy', completed: false },
            { id: 'st-013', title: 'Design shared vs separate DB approach', completed: false },
          ],
          comments: [],
          createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
        },
      ],
    },
    {
      id: 'todo',
      title: 'To Do',
      tasks: [
        {
          id: 'TASK-005',
          title: 'Fix pagination on inventory table',
          description: 'The inventory table shows incorrect page counts when filters are applied. The total count is not respecting the active category filter.',
          priority: 'high',
          assignee: { id: 'u2', name: 'Alex Morgan', avatar: '/avatars/adeel.png' },
          dueDate: new Date(Date.now() + 2 * 86400000).toISOString(),
          status: 'todo',
          labels: ['Bug', 'Inventory'],
          subtasks: [
            { id: 'st-014', title: 'Reproduce the bug with filters', completed: true },
            { id: 'st-015', title: 'Fix count query to include filter params', completed: false },
            { id: 'st-016', title: 'Add regression test', completed: false },
          ],
          comments: [
            { id: 'cm-007', author: 'Priya Sharma', avatar: '/avatars/avatartion.png', text: 'This only happens when category filter is active. All other filters work fine.', createdAt: new Date(Date.now() - 1 * 86400000).toISOString() },
            { id: 'cm-008', author: 'Alex Morgan', avatar: '/avatars/adeel.png', text: 'Found it — the count aggregation pipeline is missing the $match stage for category.', createdAt: new Date(Date.now() - 12 * 3600000).toISOString() },
          ],
          createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        },
        {
          id: 'TASK-006',
          title: 'Create vendor onboarding form',
          description: 'Build a multi-step form for onboarding new vendors. Include fields for company info, banking details, tax documents, and compliance certifications.',
          priority: 'medium',
          assignee: { id: 'u4', name: 'Priya Sharma', avatar: '/avatars/avatartion.png' },
          dueDate: new Date(Date.now() + 5 * 86400000).toISOString(),
          status: 'todo',
          labels: ['Feature', 'Vendors'],
          subtasks: [
            { id: 'st-017', title: 'Design multi-step form wireframe', completed: true },
            { id: 'st-018', title: 'Build step 1: Company info', completed: false },
            { id: 'st-019', title: 'Build step 2: Banking details', completed: false },
            { id: 'st-020', title: 'Build step 3: Document uploads', completed: false },
            { id: 'st-021', title: 'Build step 4: Review & submit', completed: false },
          ],
          comments: [
            { id: 'cm-009', author: 'Sarah Chen', avatar: '/avatars/shadcn.png', text: 'Wireframes look great! Let\'s add a progress indicator at the top.', createdAt: new Date(Date.now() - 3 * 86400000).toISOString() },
          ],
          createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
        },
        {
          id: 'TASK-007',
          title: 'Optimize dashboard KPI queries',
          description: 'The main dashboard takes 3.2s to load due to unoptimized MongoDB aggregation pipelines. Target < 500ms load time.',
          priority: 'high',
          assignee: { id: 'u3', name: 'Marcus Webb', avatar: '/avatars/avatartion.png' },
          dueDate: new Date(Date.now() + 3 * 86400000).toISOString(),
          status: 'todo',
          labels: ['Performance', 'Backend'],
          subtasks: [
            { id: 'st-022', title: 'Profile existing aggregation pipelines', completed: true },
            { id: 'st-023', title: 'Add compound indexes', completed: true },
            { id: 'st-024', title: 'Implement query result caching', completed: false },
            { id: 'st-025', title: 'Benchmark before/after', completed: false },
          ],
          comments: [
            { id: 'cm-010', author: 'Marcus Webb', avatar: '/avatars/avatartion.png', text: 'Initial profiling shows the revenue aggregation is the bottleneck — no index on `createdAt`.', createdAt: new Date(Date.now() - 18 * 3600000).toISOString() },
          ],
          createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
        },
        {
          id: 'TASK-008',
          title: 'Add email notifications for order status changes',
          description: 'Send automated email notifications when sale order status changes (confirmed, shipped, delivered). Use the existing email template system.',
          priority: 'medium',
          assignee: { id: 'u1', name: 'Sarah Chen', avatar: '/avatars/shadcn.png' },
          dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
          status: 'todo',
          labels: ['Feature', 'Notifications'],
          subtasks: [
            { id: 'st-026', title: 'Design email templates', completed: false },
            { id: 'st-027', title: 'Create notification trigger in order workflow', completed: false },
            { id: 'st-028', title: 'Add user notification preferences', completed: false },
          ],
          comments: [],
          createdAt: new Date(Date.now() - 6 * 86400000).toISOString(),
        },
      ],
    },
    {
      id: 'in-progress',
      title: 'In Progress',
      tasks: [
        {
          id: 'TASK-009',
          title: 'Build PDF invoice generation',
          description: 'Implement server-side PDF generation for sale order invoices using Google Docs templates. Include line items, totals, and company branding.',
          priority: 'high',
          assignee: { id: 'u2', name: 'Alex Morgan', avatar: '/avatars/adeel.png' },
          dueDate: new Date(Date.now() + 1 * 86400000).toISOString(),
          status: 'in-progress',
          labels: ['Feature', 'Sales'],
          subtasks: [
            { id: 'st-029', title: 'Set up Google Docs API auth', completed: true },
            { id: 'st-030', title: 'Create invoice template', completed: true },
            { id: 'st-031', title: 'Implement placeholder replacement', completed: true },
            { id: 'st-032', title: 'Add line items table generation', completed: false },
            { id: 'st-033', title: 'Test with real sale order data', completed: false },
          ],
          comments: [
            { id: 'cm-011', author: 'Alex Morgan', avatar: '/avatars/adeel.png', text: 'Service account auth is working. Template placeholder replacement is done for header fields.', createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
            { id: 'cm-012', author: 'Sarah Chen', avatar: '/avatars/shadcn.png', text: 'Can we add the company logo to the PDF header? QR code for payment would be nice too.', createdAt: new Date(Date.now() - 1 * 86400000).toISOString() },
            { id: 'cm-013', author: 'Alex Morgan', avatar: '/avatars/adeel.png', text: 'Logo is doable. QR code will need a separate library — let me add a subtask for that.', createdAt: new Date(Date.now() - 8 * 3600000).toISOString() },
          ],
          createdAt: new Date(Date.now() - 8 * 86400000).toISOString(),
        },
        {
          id: 'TASK-010',
          title: 'Implement role-based access control',
          description: 'Add granular RBAC with roles: Admin, Manager, Staff, Viewer. Protect routes and API endpoints based on user role.',
          priority: 'high',
          assignee: { id: 'u3', name: 'Marcus Webb', avatar: '/avatars/avatartion.png' },
          dueDate: new Date(Date.now() + 4 * 86400000).toISOString(),
          status: 'in-progress',
          labels: ['Security', 'Backend'],
          subtasks: [
            { id: 'st-034', title: 'Define role hierarchy and permissions', completed: true },
            { id: 'st-035', title: 'Create middleware for route protection', completed: true },
            { id: 'st-036', title: 'Add role check to API endpoints', completed: false },
            { id: 'st-037', title: 'Build admin role management UI', completed: false },
          ],
          comments: [
            { id: 'cm-014', author: 'Marcus Webb', avatar: '/avatars/avatartion.png', text: 'Route middleware is done. Moving on to API endpoint protection next.', createdAt: new Date(Date.now() - 1 * 86400000).toISOString() },
          ],
          createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
        },
        {
          id: 'TASK-011',
          title: 'Migrate image uploads to Cloudinary',
          description: 'Replace local file storage with Cloudinary CDN. Implement auto-optimization, responsive images, and lazy loading placeholders.',
          priority: 'medium',
          assignee: { id: 'u4', name: 'Priya Sharma', avatar: '/avatars/avatartion.png' },
          dueDate: new Date(Date.now() + 6 * 86400000).toISOString(),
          status: 'in-progress',
          labels: ['Infrastructure', 'Media'],
          subtasks: [
            { id: 'st-038', title: 'Set up Cloudinary account and API keys', completed: true },
            { id: 'st-039', title: 'Create upload utility composable', completed: true },
            { id: 'st-040', title: 'Migrate product images', completed: false },
            { id: 'st-041', title: 'Add responsive image transforms', completed: false },
          ],
          comments: [
            { id: 'cm-015', author: 'Priya Sharma', avatar: '/avatars/avatartion.png', text: 'Upload composable is working with drag & drop support. Average upload time: 1.2s for 2MB images.', createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
            { id: 'cm-016', author: 'Alex Morgan', avatar: '/avatars/adeel.png', text: 'Nice! Make sure to add a 10MB file size limit on the client side.', createdAt: new Date(Date.now() - 1 * 86400000).toISOString() },
          ],
          createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        },
      ],
    },
    {
      id: 'in-review',
      title: 'In Review',
      tasks: [
        {
          id: 'TASK-012',
          title: 'Redesign manufacturing detail page',
          description: 'Overhaul the manufacturing order detail view with better layout, inline editing, theme-adaptive colors, and a searchable SKU dropdown.',
          priority: 'medium',
          assignee: { id: 'u1', name: 'Sarah Chen', avatar: '/avatars/shadcn.png' },
          dueDate: new Date(Date.now() + 1 * 86400000).toISOString(),
          status: 'in-review',
          labels: ['UI/UX', 'Manufacturing'],
          subtasks: [
            { id: 'st-042', title: 'Redesign layout with inline editing', completed: true },
            { id: 'st-043', title: 'Add searchable SKU dropdown', completed: true },
            { id: 'st-044', title: 'Fix theme compatibility for modals', completed: true },
            { id: 'st-045', title: 'Get design approval from PM', completed: false },
          ],
          comments: [
            { id: 'cm-017', author: 'Sarah Chen', avatar: '/avatars/shadcn.png', text: 'All UI changes done. Screenshots attached in the PR for review.', createdAt: new Date(Date.now() - 1 * 86400000).toISOString() },
            { id: 'cm-018', author: 'Alex Morgan', avatar: '/avatars/adeel.png', text: 'Looks amazing! Just one thing — the modal backdrop needs to be slightly darker in light mode.', createdAt: new Date(Date.now() - 6 * 3600000).toISOString() },
          ],
          createdAt: new Date(Date.now() - 12 * 86400000).toISOString(),
        },
        {
          id: 'TASK-013',
          title: 'Add bulk import for inventory items',
          description: 'Support CSV/Excel bulk import with validation, duplicate detection, and a preview step before committing. Handle up to 10,000 rows.',
          priority: 'high',
          assignee: { id: 'u2', name: 'Alex Morgan', avatar: '/avatars/adeel.png' },
          dueDate: new Date(Date.now() - 1 * 86400000).toISOString(),
          status: 'in-review',
          labels: ['Feature', 'Inventory'],
          subtasks: [
            { id: 'st-046', title: 'Build CSV parser with validation', completed: true },
            { id: 'st-047', title: 'Create preview table component', completed: true },
            { id: 'st-048', title: 'Implement batch insert API', completed: true },
            { id: 'st-049', title: 'Add duplicate detection logic', completed: true },
            { id: 'st-050', title: 'Handle error rows gracefully', completed: true },
          ],
          comments: [
            { id: 'cm-019', author: 'Alex Morgan', avatar: '/avatars/adeel.png', text: 'Tested with 8,000 rows CSV — imports in ~4 seconds with client-side chunking.', createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
            { id: 'cm-020', author: 'Marcus Webb', avatar: '/avatars/avatartion.png', text: 'Code looks clean. Approved with minor nit about error message formatting.', createdAt: new Date(Date.now() - 12 * 3600000).toISOString() },
          ],
          createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
        },
        {
          id: 'TASK-014',
          title: 'Implement optimistic UI updates',
          description: 'Add instant UI feedback for all CRUD operations. Show toast notifications and revert on server errors for a seamless user experience.',
          priority: 'medium',
          assignee: { id: 'u3', name: 'Marcus Webb', avatar: '/avatars/avatartion.png' },
          dueDate: new Date(Date.now() + 2 * 86400000).toISOString(),
          status: 'in-review',
          labels: ['Performance', 'Frontend'],
          subtasks: [
            { id: 'st-051', title: 'Create optimistic update utility', completed: true },
            { id: 'st-052', title: 'Apply to create operations', completed: true },
            { id: 'st-053', title: 'Apply to update operations', completed: true },
            { id: 'st-054', title: 'Apply to delete operations', completed: true },
            { id: 'st-055', title: 'Add rollback on error', completed: false },
          ],
          comments: [
            { id: 'cm-021', author: 'Priya Sharma', avatar: '/avatars/avatartion.png', text: 'The UI feels so much faster now! Can we also add skeleton loaders?', createdAt: new Date(Date.now() - 3 * 86400000).toISOString() },
            { id: 'cm-022', author: 'Marcus Webb', avatar: '/avatars/avatartion.png', text: 'Skeleton loaders are out of scope for this task. Will create a separate ticket.', createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
          ],
          createdAt: new Date(Date.now() - 9 * 86400000).toISOString(),
        },
      ],
    },
    {
      id: 'done',
      title: 'Done',
      tasks: [
        {
          id: 'TASK-015',
          title: 'Set up Nuxt 4 project with Shadcn Vue',
          description: 'Initialize the project with Nuxt 4, Shadcn Vue, TailwindCSS 4, and configure the project structure with layouts, composables, and types.',
          priority: 'high',
          assignee: { id: 'u2', name: 'Alex Morgan', avatar: '/avatars/adeel.png' },
          dueDate: new Date(Date.now() - 20 * 86400000).toISOString(),
          status: 'done',
          labels: ['Infrastructure', 'Setup'],
          subtasks: [
            { id: 'st-056', title: 'Initialize Nuxt 4 project', completed: true },
            { id: 'st-057', title: 'Install and configure Shadcn Vue', completed: true },
            { id: 'st-058', title: 'Set up TailwindCSS 4', completed: true },
            { id: 'st-059', title: 'Create folder structure', completed: true },
          ],
          comments: [
            { id: 'cm-023', author: 'Alex Morgan', avatar: '/avatars/adeel.png', text: 'Project scaffolding complete. All base dependencies installed and configured.', createdAt: new Date(Date.now() - 28 * 86400000).toISOString() },
          ],
          createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
        },
        {
          id: 'TASK-016',
          title: 'Build sidebar navigation with collapsible groups',
          description: 'Create a responsive sidebar with nested navigation groups, icons, active state indicators, and keyboard shortcut support.',
          priority: 'medium',
          assignee: { id: 'u1', name: 'Sarah Chen', avatar: '/avatars/shadcn.png' },
          dueDate: new Date(Date.now() - 15 * 86400000).toISOString(),
          status: 'done',
          labels: ['UI/UX', 'Navigation'],
          subtasks: [
            { id: 'st-060', title: 'Build sidebar shell component', completed: true },
            { id: 'st-061', title: 'Add collapsible nav groups', completed: true },
            { id: 'st-062', title: 'Add keyboard shortcuts', completed: true },
          ],
          comments: [
            { id: 'cm-024', author: 'Sarah Chen', avatar: '/avatars/shadcn.png', text: 'Sidebar supports rail mode, collapsible groups, and G+H / G+E shortcuts.', createdAt: new Date(Date.now() - 22 * 86400000).toISOString() },
            { id: 'cm-025', author: 'Marcus Webb', avatar: '/avatars/avatartion.png', text: 'Keyboard shortcuts are a nice touch! Ship it.', createdAt: new Date(Date.now() - 20 * 86400000).toISOString() },
          ],
          createdAt: new Date(Date.now() - 25 * 86400000).toISOString(),
        },
        {
          id: 'TASK-017',
          title: 'Implement dark/light theme with color presets',
          description: 'Add multi-theme support with smooth transitions. Include 8 color presets and persist user preference to localStorage.',
          priority: 'low',
          assignee: { id: 'u4', name: 'Priya Sharma', avatar: '/avatars/avatartion.png' },
          dueDate: new Date(Date.now() - 10 * 86400000).toISOString(),
          status: 'done',
          labels: ['UI/UX', 'Theming'],
          subtasks: [
            { id: 'st-063', title: 'Create CSS custom properties system', completed: true },
            { id: 'st-064', title: 'Build theme switcher component', completed: true },
            { id: 'st-065', title: 'Add 8 color presets', completed: true },
            { id: 'st-066', title: 'Persist preference to localStorage', completed: true },
          ],
          comments: [
            { id: 'cm-026', author: 'Priya Sharma', avatar: '/avatars/avatartion.png', text: 'All 8 color presets implemented and tested across light/dark modes.', createdAt: new Date(Date.now() - 12 * 86400000).toISOString() },
          ],
          createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
        },
        {
          id: 'TASK-018',
          title: 'Create CRUD composable with localStorage',
          description: 'Build a reusable useCrud composable that provides full CRUD operations backed by localStorage for client-side data persistence.',
          priority: 'medium',
          assignee: { id: 'u2', name: 'Alex Morgan', avatar: '/avatars/adeel.png' },
          dueDate: new Date(Date.now() - 8 * 86400000).toISOString(),
          status: 'done',
          labels: ['Feature', 'Composable'],
          subtasks: [
            { id: 'st-067', title: 'Design generic composable API', completed: true },
            { id: 'st-068', title: 'Implement CRUD operations', completed: true },
            { id: 'st-069', title: 'Add localStorage persistence', completed: true },
          ],
          comments: [
            { id: 'cm-027', author: 'Alex Morgan', avatar: '/avatars/adeel.png', text: 'useCrud<T> is fully generic and supports any entity type. Docs added inline.', createdAt: new Date(Date.now() - 16 * 86400000).toISOString() },
            { id: 'cm-028', author: 'Sarah Chen', avatar: '/avatars/shadcn.png', text: 'Clean API. Already using it for the inventory module — works great!', createdAt: new Date(Date.now() - 15 * 86400000).toISOString() },
          ],
          createdAt: new Date(Date.now() - 18 * 86400000).toISOString(),
        },
        {
          id: 'TASK-019',
          title: 'Deploy to Vercel with custom domain',
          description: 'Configure Vercel deployment with environment variables, custom domain DNS setup, and automatic preview deployments for PRs.',
          priority: 'high',
          assignee: { id: 'u3', name: 'Marcus Webb', avatar: '/avatars/avatartion.png' },
          dueDate: new Date(Date.now() - 5 * 86400000).toISOString(),
          status: 'done',
          labels: ['DevOps', 'Deployment'],
          subtasks: [
            { id: 'st-070', title: 'Create Vercel project', completed: true },
            { id: 'st-071', title: 'Configure environment variables', completed: true },
            { id: 'st-072', title: 'Set up custom domain DNS', completed: true },
            { id: 'st-073', title: 'Enable preview deployments', completed: true },
          ],
          comments: [
            { id: 'cm-029', author: 'Marcus Webb', avatar: '/avatars/avatartion.png', text: 'Deployment pipeline complete. Preview deploys trigger on every PR automatically.', createdAt: new Date(Date.now() - 10 * 86400000).toISOString() },
            { id: 'cm-030', author: 'Alex Morgan', avatar: '/avatars/adeel.png', text: 'Custom domain SSL is active. Everything looks good in production.', createdAt: new Date(Date.now() - 8 * 86400000).toISOString() },
          ],
          createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
        },
      ],
    },
  ],
}

// ── Helper to find a task across all columns ──
function findTask(board: BoardState, columnId: string, taskId: string): Task | undefined {
  const col = board.columns.find(c => c.id === columnId)
  return col?.tasks.find(t => t.id === taskId)
}

export function useKanban() {
  const board = useState<BoardState>('kanban-board', () => load())

  onMounted(() => {
    board.value = load()
  })

  function load(): BoardState {
    if (isClient) {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        try { return JSON.parse(raw) as BoardState }
        catch { }
      }
    }
    return defaultBoard
  }

  function persist() {
    if (isClient) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(board.value))
    }
  }

  function addColumn(title: string) {
    const newCol: Column = { id: generateColumnId(title), title, tasks: [] }
    board.value.columns.push(newCol)
    persist()
  }

  function removeColumn(id: string) {
    board.value.columns = board.value.columns.filter(c => c.id !== id)
    persist()
  }

  function updateColumn(id: string, title: string) {
    const col = board.value.columns.find(c => c.id === id)
    if (!col)
      return
    col.title = title
    persist()
  }

  function addTask(columnId: string, payload: NewTask) {
    const col = board.value.columns.find(c => c.id === columnId)
    if (!col)
      return
    col.tasks.unshift({ id: generateTaskId(), createdAt: new Date(), ...payload })
    persist()
  }

  function updateTask(columnId: string, taskId: string, patch: Partial<Task>) {
    const col = board.value.columns.find(c => c.id === columnId)
    if (!col)
      return
    const t = col.tasks.find(t => t.id === taskId)
    if (!t)
      return
    Object.assign(t, patch)
    persist()
  }

  function removeTask(columnId: string, taskId: string) {
    const col = board.value.columns.find(c => c.id === columnId)
    if (!col)
      return
    col.tasks = col.tasks.filter(t => t.id !== taskId)
    persist()
  }

  function setColumns(next: Column[]) {
    board.value.columns = next
    persist()
  }

  // ── Subtask CRUD ──
  function addSubtask(columnId: string, taskId: string, title: string) {
    const task = findTask(board.value, columnId, taskId)
    if (!task)
      return
    if (!task.subtasks)
      task.subtasks = []
    task.subtasks.push({ id: nanoid(8), title, completed: false })
    persist()
  }

  function toggleSubtask(columnId: string, taskId: string, subtaskId: string) {
    const task = findTask(board.value, columnId, taskId)
    if (!task?.subtasks)
      return
    const st = task.subtasks.find(s => s.id === subtaskId)
    if (st)
      st.completed = !st.completed
    persist()
  }

  function removeSubtask(columnId: string, taskId: string, subtaskId: string) {
    const task = findTask(board.value, columnId, taskId)
    if (!task?.subtasks)
      return
    task.subtasks = task.subtasks.filter(s => s.id !== subtaskId)
    persist()
  }

  // ── Comment CRUD ──
  function addComment(columnId: string, taskId: string, text: string) {
    const task = findTask(board.value, columnId, taskId)
    if (!task)
      return
    if (!task.comments)
      task.comments = []
    task.comments.push({
      id: nanoid(8),
      author: 'Alex Morgan',
      avatar: '/avatars/adeel.png',
      text,
      createdAt: new Date().toISOString(),
    })
    persist()
  }

  function removeComment(columnId: string, taskId: string, commentId: string) {
    const task = findTask(board.value, columnId, taskId)
    if (!task?.comments)
      return
    task.comments = task.comments.filter(c => c.id !== commentId)
    persist()
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
