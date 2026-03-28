// Route path prefixes → workspace module IDs
const routeToModule: { prefix: string; moduleId: string }[] = [
  { prefix: '/users', moduleId: 'users' },
  { prefix: '/services', moduleId: 'services' },
  { prefix: '/dealers', moduleId: 'dealers' },
  { prefix: '/sales/work-orders', moduleId: 'work_orders' },
  { prefix: '/sales/invoices', moduleId: 'invoices' },
  { prefix: '/tasks', moduleId: 'tasks' },
]

function getModuleForRoute(path: string): string | null {
  for (const r of routeToModule) {
    if (path === r.prefix || path.startsWith(r.prefix + '/')) return r.moduleId
  }
  // Root `/` maps to dashboard
  if (path === '/') return 'dashboard'
  return null
}

export default defineNuxtRouteMiddleware(async (to) => {
  const { user, fetchUser } = useAuth()
  const { getDefaultRoute, isModuleEnabled } = usePermissions()

  // Skip permission checks for auth/settings routes
  const skipPaths = ['/login', '/register', '/forgot-password', '/settings/workspaces']
  if (skipPaths.some(p => to.path === p || to.path.startsWith(p + '/'))) {
    // Still handle login redirect if already authenticated
    if (user.value && to.path === '/login') {
      return navigateTo(getDefaultRoute())
    }
    if (!user.value && to.path === '/login') {
      const ok = await fetchUser()
      if (ok) return navigateTo(getDefaultRoute())
      return
    }
    return
  }

  // Fast path: user already loaded
  if (user.value) {
    return enforcePermissions(to.path)
  }

  // First load: fetch user from session cookie
  const ok = await fetchUser()

  if (!ok) {
    return navigateTo('/login')
  }

  return enforcePermissions(to.path)

  function enforcePermissions(path: string) {
    const moduleId = getModuleForRoute(path)
    // If we can identify the module and it's disabled → redirect to first allowed
    if (moduleId && !isModuleEnabled(moduleId)) {
      return navigateTo(getDefaultRoute())
    }
  }
})
