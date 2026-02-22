<script setup lang="ts">
const route = useRoute()
const id = route.params.id as string

// Redirect /dealers/:id to /dealers/:id/services
navigateTo(`/dealers/${id}/services`, { replace: true })
</script>

<template>
  <div></div>
</template>
