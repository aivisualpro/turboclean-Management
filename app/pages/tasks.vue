<script setup lang="ts">
import KanbanBoard from '~/components/kanban/KanbanBoard.vue'
const { setHeader } = usePageHeader()
setHeader({ title: 'Tasks' })
</script>

<template>
  <div class="h-full">
    <div class="flex flex-col gap-4 h-full">
      <KanbanBoard />
    </div>


  </div>
</template>
