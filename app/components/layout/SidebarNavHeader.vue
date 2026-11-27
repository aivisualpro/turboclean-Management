<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { useSidebar } from '~/components/ui/sidebar'

const props = defineProps<{
  teams: {
    name: string
    logo: string
    plan: string
  }[]
}>()

const { isMobile, setOpenMobile } = useSidebar()

const activeTeam = ref(props.teams[0])
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem class="flex items-center gap-1">
      <SidebarMenuButton size="lg" class="h-11 min-w-0 flex-1 py-0 hover:bg-transparent hover:text-sidebar-foreground cursor-default">
        <div class="aspect-square size-8 flex items-center justify-center">
          <img src="/logo.png" alt="ZRZ OPS logo" class="size-8 object-contain" />
        </div>
        <div class="grid flex-1 text-left text-sm leading-tight">
          <span class="truncate font-semibold grow text-lg tracking-tight">
            ZRZ OPS
          </span>
        </div>
      </SidebarMenuButton>
      <!-- Phones and tablets: the menu is a panel over the page, so it gets its own close button -->
      <button
        v-if="isMobile" type="button" aria-label="Close the menu" data-testid="mobile-menu-close"
        class="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        @click="setOpenMobile(false)"
      >
        <X class="size-5" />
      </button>
    </SidebarMenuItem>
  </SidebarMenu>
  <!-- Same height as the main header (44px); the line lines up with the header's bottom edge -->
  <hr class="-mt-2 h-0.5 border-0 rounded-full bg-primary">
</template>

<style scoped>

</style>
