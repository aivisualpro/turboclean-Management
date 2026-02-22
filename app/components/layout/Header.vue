<script setup lang="ts">
const route = useRoute()
const { headerState, clearHeader } = usePageHeader()

// Clear header state on route change so pages without setHeader() don't show stale info
watch(() => route.fullPath, () => {
  clearHeader()
})

// Derive fallback title from route when no explicit title is set
const fallbackTitle = computed(() => {
  if (route.fullPath === '/')
    return 'Dashboard'
  const segments = route.fullPath.split('/').filter(s => s !== '')
  const last = segments[segments.length - 1] || ''
  return last
    .replace(/-/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
})

const displayTitle = computed(() => headerState.title || fallbackTitle.value)
</script>

<template>
  <header class="sticky top-0 md:peer-data-[variant=inset]:top-2 z-10 h-(--header-height) flex items-center gap-4 border-b bg-background px-4 md:px-6 md:rounded-tl-xl md:rounded-tr-xl">
    <div class="flex items-center gap-4 min-w-0">
      <SidebarTrigger />
      <Separator orientation="vertical" class="h-4" />
      <div class="flex items-center gap-2.5 min-w-0">
        <Icon v-if="headerState.icon" :name="headerState.icon" class="size-5 shrink-0 text-primary" />
        <div class="min-w-0">
          <h1 class="text-sm font-semibold leading-tight truncate">
            {{ displayTitle }}
          </h1>
          <p v-if="headerState.description" class="text-xs text-muted-foreground leading-tight truncate hidden md:block">
            {{ headerState.description }}
          </p>
        </div>
      </div>
    </div>
    <div id="page-header-actions" class="ml-auto flex items-center gap-2">
      <slot />
    </div>
  </header>
</template>
