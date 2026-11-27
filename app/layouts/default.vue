<script setup lang="ts">
</script>

<template>
  <SidebarProvider>
    <LayoutAppSidebar />
    <SidebarInset class="h-dvh overflow-hidden">
      <LayoutHeader />
      <div class="app-scroll flex flex-col flex-1 overflow-auto">
        <div class="@container/main p-2 grow relative">
          <slot />
        </div>
      </div>
    </SidebarInset>
    <!-- Phones and tablets (below 1024px): bottom navbar with the person's five pages + the burger -->
    <LayoutMobileNav />
    <LayoutNavCustomize />
  </SidebarProvider>
</template>

<style scoped>

</style>
