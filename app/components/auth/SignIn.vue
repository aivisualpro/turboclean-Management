<script setup lang="ts">
import { Loader2, AlertCircle } from 'lucide-vue-next'
import PasswordInput from '~/components/PasswordInput.vue'

const email = ref('')
const password = ref('')
const { login, loading, error } = useAuth()
const { getDefaultRoute } = usePermissions()

async function onSubmit(event: Event) {
  event.preventDefault()
  if (!email.value || !password.value) return

  const ok = await login(email.value, password.value)
  if (ok) {
    // Redirect to the first enabled module (or dashboard if enabled)
    await nextTick()
    await navigateTo(getDefaultRoute())
  }
}
</script>

<template>
  <form class="grid gap-6" @submit="onSubmit">
    <!-- Error Alert -->
    <div v-if="error" class="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
      <AlertCircle class="size-4 shrink-0" />
      <span>{{ error }}</span>
    </div>

    <div class="grid gap-2">
      <Label for="email">
        Email
      </Label>
      <Input
        id="email"
        v-model="email"
        type="email"
        placeholder="name@example.com"
        :disabled="loading"
        auto-capitalize="none"
        auto-complete="email"
        auto-correct="off"
      />
    </div>
    <div class="grid gap-2">
      <div class="flex items-center">
        <Label for="password">
          Password
        </Label>
      </div>
      <PasswordInput id="password" v-model="password" :disabled="loading" />
    </div>
    <Button type="submit" class="w-full" :disabled="loading">
      <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
      {{ loading ? 'Signing in...' : 'Sign In' }}
    </Button>
  </form>
</template>

<style scoped>

</style>
