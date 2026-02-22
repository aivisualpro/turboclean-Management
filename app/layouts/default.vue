<script setup lang="ts">
</script>

<template>
  <SidebarProvider>
    <LayoutAppSidebar />
    <SidebarInset class="h-screen overflow-hidden">
      <LayoutHeader />
      <div class="flex flex-col flex-1 overflow-auto">
        <div class="@container/main p-4 lg:p-6 grow relative">
          <slot />
        </div>
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>

<style scoped>

</style>
