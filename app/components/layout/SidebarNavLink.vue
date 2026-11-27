<script setup lang="ts">
import type { SidebarMenuButtonVariants } from '~/components/ui/sidebar'
import type { NavLink } from '~/types/nav'
import { Star } from 'lucide-vue-next'
import { useSidebar } from '~/components/ui/sidebar'

withDefaults(defineProps<{
  item: NavLink
  size?: SidebarMenuButtonVariants['size']
  /** Shows a star that adds this page to the bottom navbar (phones and tablets). */
  pinnable?: boolean
}>(), {
  size: 'default',
  pinnable: false,
})

defineEmits<{ pin: [] }>()

const { setOpenMobile } = useSidebar()
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <SidebarMenuButton as-child :tooltip="item.title" :size="size" :data-active="item.link === $route.path">
        <NuxtLink :to="item.link" @click="setOpenMobile(false)">
          <Icon :name="item.icon || ''" />
          <span>{{ item.title }}</span>
          <span v-if="item.new" class="rounded-md bg-[#adfa1d] px-1.5 py-0.5 text-xs text-black leading-none no-underline group-hover:no-underline">
            New
          </span>
        </NuxtLink>
      </SidebarMenuButton>
      <SidebarMenuAction v-if="pinnable" :aria-label="`Add ${item.title} to the navbar`" title="Add to navbar" @click="$emit('pin')">
        <Star />
      </SidebarMenuAction>
    </SidebarMenuItem>
  </SidebarMenu>
</template>

<style scoped>

</style>
