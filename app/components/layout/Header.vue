<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { navMenu } from '~/constants/menus'

const route = useRoute()
const router = useRouter()
const { headerState, workHeader } = usePageHeader()

// Derive fallback title from route when no explicit title is set
const fallbackTitle = computed(() => {
  if (route.path === '/')
    return 'Dashboard'
  const segments = route.path.split('/').filter(s => s !== '')
  const last = segments[segments.length - 1] || ''
  return last
    .replace(/-/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
})

const displayTitle = computed(() => workHeader.value?.title || headerState.title || fallbackTitle.value)
const displayIcon = computed(() => workHeader.value ? workHeader.value.icon : headerState.icon)

// ─── Back button — in front of the title on every detail page ───
// A detail page is any page under a record (/crm/dealership/123, /dealers/9/services, /users/4): its
// list is the address up to the record. Nothing to do in pages; `setHeader({ back })` overrides it.
const backTo = computed(() => {
  if (headerState.back === false) return ''
  if (headerState.back) return headerState.back
  const pattern = route.matched.at(-1)?.path || ''
  const record = pattern.indexOf('/:')
  return record > 0 ? pattern.slice(0, record) : ''
})
/** "Back to Dealership": the list's name as the menu calls it. */
const listName = computed(() => {
  const find = (items: any[]): string => {
    for (const it of items || []) {
      if (it?.link === backTo.value) return String(it.title || '')
      const inner = find(it?.children || it?.items || [])
      if (inner) return inner
    }
    return ''
  }
  return find(navMenu as any[])
})
const showBack = computed(() => !!workHeader.value || !!backTo.value)
const backLabel = computed(() => workHeader.value ? (workHeader.value.backLabel || 'Back') : listName.value ? `Back to ${listName.value}` : 'Back')
function goBack() {
  if (workHeader.value) return workHeader.value.back()
  const target = backTo.value
  // Came from that list during this visit: step back to it as it was left (scroll position, filters).
  const previous = String((router.options.history.state as any)?.back || '')
  if (previous && previous.split(/[?#]/)[0] === target) router.back()
  else navigateTo(target)
}

// CRM time tracker — available on every page for anyone with CRM access.
const { isModuleEnabled } = usePermissions()
const { user } = useAuth()
const showTimer = computed(() => !!user.value && isModuleEnabled('crm_dealership'))
</script>

<template>
  <!-- Below 1024px (see "Mobile shell" in tailwind.css): no sidebar button (the burger is in the bottom
       navbar), and the page's actions drop to a second, sideways-scrolling row when they do not fit.
       While a work screen is open (data-work) the header is that screen's: its title, its controls. -->
  <header class="app-header sticky top-0 z-10 h-11 shrink-0 m-2 mb-0 flex items-center gap-3 rounded-lg px-2" :data-work="workHeader ? '' : undefined">
    <div class="app-header-title flex items-center gap-3 min-w-0">
      <SidebarTrigger class="max-lg:hidden" />
      <Separator orientation="vertical" class="h-4 max-lg:hidden" />
      <div class="flex items-center gap-2.5 min-w-0">
        <button
          v-if="showBack" type="button" class="app-header-back inline-flex size-8 shrink-0 items-center justify-center rounded-md border-2 border-primary bg-background text-foreground shadow-sm transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :title="backLabel" :aria-label="backLabel" @click="goBack"
        >
          <ArrowLeft class="size-4" stroke-width="2.5" />
        </button>
        <Icon v-if="displayIcon" :name="displayIcon" class="size-5 shrink-0 text-primary" />
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
