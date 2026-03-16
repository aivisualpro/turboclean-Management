export default defineNuxtRouteMiddleware(async (to) => {
  const { user, fetchUser } = useAuth()

  // Fast path: user already loaded — skip API call entirely
  if (user.value) {
    if (to.path === '/login') {
      return navigateTo('/')
    }
    return
  }

  // First load only: fetch user from session cookie
  const ok = await fetchUser()

  // Not authenticated and trying to access a protected page → go to login
  if (!ok && to.path !== '/login') {
    return navigateTo('/login')
  }

  // Already authenticated but on the login page → go to dashboard
  if (ok && to.path === '/login') {
    return navigateTo('/')
  }
})
