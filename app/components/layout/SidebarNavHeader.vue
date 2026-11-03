<script setup lang="ts">
import { useSidebar } from '~/components/ui/sidebar'

const props = defineProps<{
  teams: {
    name: string
    logo: string
    plan: string
  }[]
}>()

const { isMobile } = useSidebar()

const activeTeam = ref(props.teams[0])
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <SidebarMenuButton size="lg" class="h-11 py-0 hover:bg-transparent hover:text-sidebar-foreground cursor-default">
        <div class="aspect-square size-8 flex items-center justify-center">
          <img src="/logo.png" alt="ZRZ OPS logo" class="size-8 object-contain" />
        </div>
        <div class="grid flex-1 text-left text-sm leading-tight">
          <span class="truncate font-semibold grow text-lg tracking-tight">
            ZRZ OPS
          </span>
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>
  <!-- Same height as the main header (44px); the line lines up with the header's bottom edge -->
  <hr class="-mt-2 h-0.5 border-0 rounded-full bg-primary">
</template>

<style scoped>

</style>
