<script setup lang="ts">
import { Menu } from 'lucide-vue-next'
import { useSidebar } from '~/components/ui/sidebar'

/**
 * Bottom navbar for phones and tablets (below 1024px; hidden on desktop by the "Mobile shell"
 * block in tailwind.css): the person's own pages (up to five, see useNavFavorites) plus the
 * burger button that opens the menu with everything else.
 */
const { favorites, activeLink, load } = useNavFavorites()
const { openMobile, setOpenMobile } = useSidebar()

// On the server too, so the first paint already shows the person's own bar.
onServerPrefetch(load)
onMounted(load)

/** The current page is not in the bar → it lives in the menu, so the burger is the lit one. */
const inMenu = computed(() => !favorites.value.some(f => f.link === activeLink.value))
</script>

<template>
  <nav class="mobile-nav" aria-label="Main navigation" data-testid="mobile-nav">
    <NuxtLink
      v-for="item in favorites" :key="item.link" :to="item.link"
      class="mobile-nav-item" :data-active="activeLink === item.link" :aria-current="activeLink === item.link ? 'page' : undefined"
      :title="item.title"
    >
      <Icon :name="item.icon || 'i-lucide-circle'" class="mobile-nav-icon" />
      <span class="mobile-nav-label">{{ item.short || item.title }}</span>
    </NuxtLink>
    <button
      type="button" class="mobile-nav-item mobile-nav-burger" :data-active="openMobile" :data-current="inMenu"
      aria-label="Open the menu" aria-haspopup="dialog" :aria-expanded="openMobile" data-testid="mobile-nav-burger"
      @click="setOpenMobile(true)"
    >
      <Menu class="mobile-nav-icon" />
      <span class="mobile-nav-label">Menu</span>
    </button>
  </nav>
</template>
