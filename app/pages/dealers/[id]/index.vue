<script setup lang="ts">
const route = useRoute()
const id = route.params.id as string

// Redirect /dealers/:id to /dealers/:id/details
navigateTo(`/dealers/${id}/details`, { replace: true })
</script>

<template>
  <div></div>
</template>
