<script setup lang="ts">
import type { NavGroup, NavLink, NavSectionTitle } from '~/types/nav'
import { SlidersHorizontal } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useSidebar } from '~/components/ui/sidebar'
import { NAV_FAVORITES_MAX } from '~/composables/useNavFavorites'
import { navMenu, navMenuBottom } from '~/constants/menus'

function resolveNavItemComponent(item: NavLink | NavGroup | NavSectionTitle): any {
  if ('children' in item)
    return resolveComponent('LayoutSidebarNavGroup')

  return resolveComponent('LayoutSidebarNavLink')
}

const teams: {
  name: string
  logo: string
  plan: string
}[] = [
  {
    name: 'My Company',
    logo: '/logo.png',
    plan: 'Enterprise',
  },
  {
    name: 'Turbo Clean Management',
    logo: '/logo.png',
    plan: 'Professional',
  },
  {
    name: 'Workspace',
    logo: 'i-lucide-command',
    plan: 'Free',
  },
]

const { user: authUser } = useAuth()
const user = computed(() => ({
  name: authUser.value?.name || 'User',
  role: authUser.value?.role || 'User',
}))

const { isMenuVisible } = usePermissions()
const { sidebar } = useAppSettings()

// Filter nav items by workspace permissions
const filteredNavMenu = computed(() => {
  return navMenu.map(group => ({
    ...group,
    items: group.items.filter((item: any) => isMenuVisible(item.title)),
  })).filter(group => group.items.length > 0)
})

const filteredNavMenuBottom = computed(() => {
  return navMenuBottom.filter((item: any) => isMenuVisible(item.title))
})

// ─── Phones and tablets: the bottom navbar holds the person's five pages, this menu the rest ───
const { isMobile, setOpenMobile } = useSidebar()
const { favorites, restGroups, customizeOpen, add } = useNavFavorites()

function openCustomize() {
  setOpenMobile(false)
  customizeOpen.value = true
}
function pin(item: NavLink) {
  if (add(item.link)) { toast.success(`${item.title} added to your navbar`); return }
  toast.error('Your navbar is full', {
    description: `It holds ${NAV_FAVORITES_MAX} pages — remove one to add ${item.title}.`,
    action: { label: 'Customize', onClick: openCustomize },
  })
}
</script>

<template>
  <Sidebar :collapsible="sidebar?.collapsible" :side="sidebar?.side" :variant="sidebar?.variant">
    <SidebarHeader>
      <LayoutSidebarNavHeader :teams="teams" />
    </SidebarHeader>
    <!-- Phones and tablets: everything that is not in the bottom navbar -->
    <SidebarContent v-if="isMobile" data-testid="mobile-menu">
      <SidebarGroup class="pb-0">
        <button type="button" class="mobile-menu-customize" data-testid="open-nav-customize" @click="openCustomize">
          <SlidersHorizontal class="size-4 shrink-0" />
          <span class="min-w-0 flex-1 truncate text-left">Customize navbar</span>
          <span class="shrink-0 text-xs tabular-nums opacity-80">{{ favorites.length }}/{{ NAV_FAVORITES_MAX }}</span>
        </button>
      </SidebarGroup>
      <SidebarGroup v-for="group in restGroups" :key="group.heading">
        <SidebarGroupLabel>
          {{ group.heading }}
        </SidebarGroupLabel>
        <LayoutSidebarNavLink v-for="item in group.items" :key="item.link" :item="item" pinnable @pin="pin(item)" />
      </SidebarGroup>
      <p v-if="!restGroups.length" class="px-4 py-6 text-center text-xs text-muted-foreground">
        All your pages are in the navbar.
      </p>
    </SidebarContent>
    <SidebarContent v-else>
      <SidebarGroup v-for="(nav, indexGroup) in filteredNavMenu" :key="indexGroup">
        <SidebarGroupLabel v-if="nav.heading">
          {{ nav.heading }}
        </SidebarGroupLabel>
        <component :is="resolveNavItemComponent(item)" v-for="(item, index) in nav.items" :key="index" :item="item" />
      </SidebarGroup>
      <SidebarGroup class="mt-auto">
        <component :is="resolveNavItemComponent(item)" v-for="(item, index) in filteredNavMenuBottom" :key="index" :item="item" size="sm" />
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter>
      <LayoutSidebarNavFooter :user="user" />
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
</template>

<style scoped>

</style>
