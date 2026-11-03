/**
 * Workspace-based permission system.
 * Maps workspace menu IDs to sidebar routes and dealer sub-tabs.
 */
export function usePermissions() {
  const { user } = useAuth()

  const permissions = computed(() => user.value?.permissions || {})

  // Check if a workspace has a specific module enabled
  // If user has NO workspace assigned (empty permissions), show everything (Admin default)
  // Admins always see everything, regardless of workspace configuration.
  const isAdminRole = computed(() => user.value?.role === 'Admin')

  function isModuleEnabled(moduleId: string): boolean {
    const perms = permissions.value
    // No workspace assigned → show all
    if (!perms || Object.keys(perms).length === 0) return true
    if (isAdminRole.value) return true
    // Module added after this workspace was last saved (key absent) → visible
    // until an admin explicitly configures it in Workspaces & Permissions.
    if (!(moduleId in perms)) return true
    return perms[moduleId]?.enabled === true
  }

  // Check if a specific sub-tab is enabled within a module
  function isTabEnabled(moduleId: string, tabName: string): boolean {
    const perms = permissions.value
    if (!perms || Object.keys(perms).length === 0) return true
    if (isAdminRole.value) return true
    if (!(moduleId in perms)) return true
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
    'Dealership': 'crm_dealership',
    'Pipeline': 'crm_dealership',
    'Today': 'crm_dealership',
    'Email': 'crm_dealership',
    'Lost deals': 'crm_dealership',
    'Won deals': 'crm_dealership',
    'Time & ROI': 'crm_dealership',
    'CRM Dashboard': 'crm_dealership',
    'Analytics': 'crm_dealership',
    'Data quality': 'crm_dealership',
    'Automation Center': 'automations',
    'Approval Queue': 'automations',
    'Priorities': 'automations',
    'Insights': 'automations',
    'Workspaces': '_settings', // always visible
    'General Settings': 'general_settings',
  }
  // Module ID → route path (ordered by sidebar position)
  const moduleRouteOrder: { id: string; route: string }[] = [
    { id: 'dashboard', route: '/' },
    { id: 'users', route: '/users' },
    { id: 'services', route: '/services' },
    { id: 'dealers', route: '/dealers' },
    { id: 'work_orders', route: '/sales/work-orders' },
    { id: 'invoices', route: '/sales/invoices' },
    { id: 'crm_dealership', route: '/crm/dealership' },
    { id: 'automations', route: '/automations' },
    { id: 'general_settings', route: '/settings/general' },
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

  // Check if a CRUD action (Add, Edit, Delete) is allowed for a module
  function isActionAllowed(moduleId: string, action: 'Add' | 'Edit' | 'Delete'): boolean {
    const perms = permissions.value
    // No workspace → all actions allowed (admin default)
    if (!perms || Object.keys(perms).length === 0) return true
    if (isAdminRole.value) return true
    if (!(moduleId in perms)) return true
    // Module not enabled → no actions allowed
    if (!perms[moduleId]?.enabled) return false
    // If no tabs defined → all actions allowed
    if (!perms[moduleId]?.tabs || perms[moduleId]?.tabs.length === 0) return true
    return perms[moduleId]!.tabs.includes(action)
  }

  // Admin-only check (import/export)
  const isAdmin = computed(() => user.value?.email === 'admin@aivisualpro.com')

  return {
    permissions,
    isModuleEnabled,
    isTabEnabled,
    isMenuVisible,
    isDealerTabVisible,
    getDefaultRoute,
    isActionAllowed,
    isAdmin,
  }
}
