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
      <SidebarMenuButton size="lg" class="hover:bg-transparent hover:text-sidebar-foreground cursor-default">
        <div class="aspect-square size-8 flex items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground overflow-hidden">
          <img src="/logo.png" alt="Turbo Clean Logo" class="size-8 object-cover" />
        </div>
        <div class="grid flex-1 text-left text-sm leading-tight">
          <span class="truncate font-semibold grow capitalize text-lg tracking-tight">
            Turbo Clean
          </span>
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>
</template>

<style scoped>

</style>
