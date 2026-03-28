/**
 * Workspace-based permission system.
 * Maps workspace menu IDs to sidebar routes and dealer sub-tabs.
 */
export function usePermissions() {
  const { user } = useAuth()

  const permissions = computed(() => user.value?.permissions || {})

  // Check if a workspace has a specific module enabled
  // If user has NO workspace assigned (empty permissions), show everything (Admin default)
  function isModuleEnabled(moduleId: string): boolean {
    const perms = permissions.value
    // No workspace assigned → show all
    if (!perms || Object.keys(perms).length === 0) return true
    return perms[moduleId]?.enabled === true
  }

  // Check if a specific sub-tab is enabled within a module
  function isTabEnabled(moduleId: string, tabName: string): boolean {
    const perms = permissions.value
    if (!perms || Object.keys(perms).length === 0) return true
    if (!perms[moduleId]?.enabled) return false
    // If no tabs defined, all tabs are allowed
    if (!perms[moduleId]?.tabs || perms[moduleId]?.tabs.length === 0) return true
    return perms[moduleId]!.tabs.includes(tabName)
  }

  // Map sidebar menu titles → workspace module IDs
  const menuToModuleMap: Record<string, string> = {
    'Dashboard': 'dashboard',
    'App Users': 'users',
    'Services': 'services',
    'Dealers': 'dealers',
    'Work Orders': 'work_orders',
    'Invoices': 'invoices',
    'Tasks': 'tasks',
    'Workspaces': '_settings', // always visible
  }
  // Module ID → route path (ordered by sidebar position)
  const moduleRouteOrder: { id: string; route: string }[] = [
    { id: 'dashboard', route: '/' },
    { id: 'users', route: '/users' },
    { id: 'services', route: '/services' },
    { id: 'dealers', route: '/dealers' },
    { id: 'work_orders', route: '/sales/work-orders' },
    { id: 'invoices', route: '/sales/invoices' },
    { id: 'tasks', route: '/tasks' },
  ]

  // Map dealer sub-tab IDs → workspace dealer tab names
  const dealerTabMap: Record<string, string> = {
    'services': 'Services',
    'contacts': 'Contacts',
    'work-orders': 'Work Orders',
    'invoices': 'Invoices',
    'emails': 'Emails',
  }

  // Check if a sidebar menu item should be visible
  function isMenuVisible(title: string): boolean {
    const moduleId = menuToModuleMap[title]
    if (!moduleId || moduleId === '_settings') return true
    return isModuleEnabled(moduleId)
  }

  // Check if a dealer sub-tab should be visible
  function isDealerTabVisible(tabId: string): boolean {
    const tabName = dealerTabMap[tabId]
    if (!tabName) return true // 'details' tab is always visible
    return isTabEnabled('dealers', tabName)
  }

  // Get the default landing route based on the first enabled module
  function getDefaultRoute(): string {
    const perms = permissions.value
    if (!perms || Object.keys(perms).length === 0) return '/'
    for (const mod of moduleRouteOrder) {
      if (perms[mod.id]?.enabled) return mod.route
    }
    return '/' // fallback
  }

  return {
    permissions,
    isModuleEnabled,
    isTabEnabled,
    isMenuVisible,
    isDealerTabVisible,
    getDefaultRoute,
  }
}
