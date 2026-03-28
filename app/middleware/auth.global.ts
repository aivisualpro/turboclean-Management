export default defineNuxtRouteMiddleware(async (to) => {
  const { user, fetchUser } = useAuth()
  const { getDefaultRoute, isModuleEnabled } = usePermissions()

  // Fast path: user already loaded — skip API call entirely
  if (user.value) {
    if (to.path === '/login') {
      return navigateTo(getDefaultRoute())
    }
    // If landing on root `/` but dashboard is disabled, redirect to first enabled module
    if (to.path === '/' && !isModuleEnabled('dashboard')) {
      const target = getDefaultRoute()
      if (target !== '/') return navigateTo(target)
    }
    return
  }

  // First load only: fetch user from session cookie
  const ok = await fetchUser()

  // Not authenticated and trying to access a protected page → go to login
  if (!ok && to.path !== '/login') {
    return navigateTo('/login')
  }

  // Already authenticated but on the login page → go to default route
  if (ok && to.path === '/login') {
    return navigateTo(getDefaultRoute())
  }

  // If landing on root `/` but dashboard is disabled, redirect to first enabled module
  if (ok && to.path === '/' && !isModuleEnabled('dashboard')) {
    const target = getDefaultRoute()
    if (target !== '/') return navigateTo(target)
  }
})
