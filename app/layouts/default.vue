<script setup lang="ts">
const { workHeader } = usePageHeader()
</script>

<template>
  <SidebarProvider>
    <LayoutAppSidebar />
    <SidebarInset class="h-dvh overflow-hidden">
      <LayoutHeader />
      <div class="relative flex min-h-0 flex-1 flex-col">
        <!-- While a work screen is open the page under it is out of reach (not clickable, not in the tab order). -->
        <div class="app-scroll flex flex-col flex-1 overflow-auto" :inert="!!workHeader">
          <div class="@container/main p-2 grow relative">
            <slot />
          </div>
        </div>
        <!-- Work screens (the crawler, Mission Control, crawl review — components/layout/WorkScreen.vue) open
             here: over the page area only, so the sidebar and the main header stay on screen and usable. -->
        <div id="page-work" class="pointer-events-none absolute inset-0 z-20" />
      </div>
    </SidebarInset>
    <!-- Phones and tablets (below 1024px): bottom navbar with the person's five pages + the burger -->
    <LayoutMobileNav />
    <LayoutNavCustomize />
  </SidebarProvider>
</template>

<style scoped>

</style>
