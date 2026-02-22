export default defineNuxtRouteMiddleware(async (to) => {
  const { user, fetchUser } = useAuth()

  // If we don't have user data yet, try to fetch from session cookie
  if (!user.value) {
    const ok = await fetchUser()

    // Not authenticated and trying to access a protected page → go to login
    if (!ok && to.path !== '/login') {
      return navigateTo('/login')
    }

    // Already authenticated but on the login page → go to dashboard
    if (ok && to.path === '/login') {
      return navigateTo('/')
    }
  } else if (to.path === '/login') {
    // User already loaded and on login page → go to dashboard
    return navigateTo('/')
  }
})
