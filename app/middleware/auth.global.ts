export default defineNuxtRouteMiddleware(async (to) => {
  // Skip auth check for the login page itself
  if (to.path === '/login') return

  const { user, fetchUser } = useAuth()

  // If we don't have user data yet, try to fetch from session cookie
  if (!user.value) {
    const ok = await fetchUser()
    if (!ok) {
      return navigateTo('/login')
    }
  }
})
