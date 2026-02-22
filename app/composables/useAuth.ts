interface AuthUser {
  id: string
  name: string
  email: string
  role: string
}

const useAuthState = () => {
  const user = useState<AuthUser | null>('auth_user', () => null)
  const isLoggedIn = computed(() => !!user.value)
  return { user, isLoggedIn }
}

export function useAuth() {
  const { user, isLoggedIn } = useAuthState()
  const loading = ref(false)
  const error = ref('')

  async function login(email: string, password: string) {
    loading.value = true
    error.value = ''
    try {
      const res = await $fetch<{ success: boolean; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      })
      user.value = res.user
      return true
    } catch (err: any) {
      const msg = err?.data?.statusMessage || err?.statusMessage || 'Login failed'
      error.value = msg
      return false
    } finally {
      loading.value = false
    }
  }

  async function fetchUser() {
    try {
      const headers = import.meta.server ? useRequestHeaders(['cookie']) as Record<string, string> : undefined
      const res = await $fetch<{ user: AuthUser }>('/api/auth/me', { headers })
      user.value = res.user
      return true
    } catch {
      user.value = null
      return false
    }
  }

  async function logout() {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // ignore
    }
    user.value = null
    await navigateTo('/login')
  }

  return { user, isLoggedIn, loading, error, login, fetchUser, logout }
}
