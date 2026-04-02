<script setup lang="ts">
const { setHeader } = usePageHeader()
setHeader({ title: 'Tasks' })
const { loadBoard, board } = useKanban()
onMounted(() => {
  loadBoard()
})
</script>

<template>
  <div class="h-full">
    <div class="flex flex-col gap-4 h-full">
      <KanbanBoard>
        <template #fallback>
          <div class="flex items-center justify-center h-full">
            <Icon name="lucide:loader-2" class="size-6 animate-spin text-muted-foreground" />
          </div>
        </template>
      </KanbanBoard>
    </div>
  </div>
</template>
