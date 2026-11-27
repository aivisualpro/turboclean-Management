<script setup lang="ts">
const route = useRoute()
const { headerState } = usePageHeader()

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

// CRM time tracker — available on every page for anyone with CRM access.
const { isModuleEnabled } = usePermissions()
const { user } = useAuth()
const showTimer = computed(() => !!user.value && isModuleEnabled('crm_dealership'))
</script>

<template>
  <!-- Below 1024px (see "Mobile shell" in tailwind.css): no sidebar button (the burger is in the bottom
       navbar), and the page's actions drop to a second, sideways-scrolling row when they do not fit. -->
  <header class="app-header sticky top-0 z-10 h-11 shrink-0 m-2 mb-0 flex items-center gap-3 rounded-lg px-2">
    <div class="app-header-title flex items-center gap-3 min-w-0">
      <SidebarTrigger class="max-lg:hidden" />
      <Separator orientation="vertical" class="h-4 max-lg:hidden" />
      <div class="flex items-center gap-2.5 min-w-0">
        <Icon v-if="headerState.icon" :name="headerState.icon" class="size-5 shrink-0 text-primary" />
        <!-- Title only: route descriptions are never shown in the header. -->
        <h1 class="text-base lg:text-lg font-semibold leading-none truncate">
          {{ displayTitle }}
        </h1>
      </div>
    </div>
    <div id="page-header-actions" class="ml-auto flex items-center gap-2">
      <slot />
    </div>
    <div class="app-header-timer flex shrink-0 items-center empty:hidden">
      <ClientOnly>
        <CrmTimer v-if="showTimer" />
      </ClientOnly>
    </div>
  </header>
</template>
