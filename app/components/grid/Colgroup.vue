<script setup lang="ts" generic="K extends string">
import type { GridLayout } from '~/composables/useGridLayout'

/**
 * The <colgroup> of a data grid: the fixed leading column (row checkbox), one <col> per visible
 * column carrying its width, and a spacer that takes whatever is left when the columns are narrower
 * than the view. A component of its own so a resize re-renders these few elements and not the rows.
 */
const props = defineProps<{ grid: GridLayout<K> }>()
const { columns, sizes } = props.grid
</script>

<template>
  <colgroup>
    <col v-if="grid.leadWidth" :style="{ width: `${grid.leadWidth}px` }">
    <col v-for="c in columns" :key="c.key" :data-col="c.key" :style="{ width: `${sizes[c.key]}px` }">
    <col>
  </colgroup>
</template>
