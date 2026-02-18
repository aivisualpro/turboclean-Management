<script setup lang="ts">
const props = defineProps<{
  title: string
  description: string
  icon: string
  features: { title: string, description: string, icon: string }[]
  stats?: { label: string, value: string }[]
  status?: 'available' | 'coming-soon' | 'beta'
}>()

const statusConfig = computed(() => {
  switch (props.status) {
    case 'available':
      return { label: 'Available', class: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' }
    case 'beta':
      return { label: 'Beta', class: 'bg-amber-500/10 text-amber-600 border-amber-500/20' }
    default:
      return { label: 'Coming Soon', class: 'bg-primary/10 text-primary border-primary/20' }
  }
})

const { setHeader } = usePageHeader()
setHeader({ title: props.title, description: props.description, icon: props.icon })
</script>

<template>
  <div class="w-full flex flex-col gap-6">
    <!-- Toolbar -->
    <div class="flex items-center justify-between gap-4">
      <Badge variant="outline" :class="statusConfig.class">
        {{ statusConfig.label }}
      </Badge>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm">
          <Icon name="i-lucide-download" class="mr-1 size-4" />
          Export
        </Button>
        <Button size="sm">
          <Icon name="i-lucide-plus" class="mr-1 size-4" />
          Add New
        </Button>
      </div>
    </div>

    <!-- Stats Row -->
    <div v-if="stats?.length" class="grid grid-cols-2 gap-4 md:grid-cols-4">
      <Card v-for="(stat, i) in stats" :key="i" class="@container/stat">
        <CardHeader class="pb-2">
          <CardDescription class="text-xs">
            {{ stat.label }}
          </CardDescription>
          <CardTitle class="text-2xl font-semibold tabular-nums">
            {{ stat.value }}
          </CardTitle>
        </CardHeader>
      </Card>
    </div>

    <!-- Features Grid -->
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Card v-for="(feature, i) in features" :key="i" class="group relative overflow-hidden transition-all duration-300 hover:shadow-md hover:border-primary/30">
        <div class="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        <CardHeader class="relative">
          <div class="flex items-center gap-3">
            <div class="flex items-center justify-center rounded-lg bg-primary/10 p-2 transition-colors group-hover:bg-primary/20">
              <Icon :name="feature.icon" class="size-5 text-primary" />
            </div>
            <CardTitle class="text-base font-semibold">
              {{ feature.title }}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent class="relative">
          <p class="text-sm text-muted-foreground leading-relaxed">
            {{ feature.description }}
          </p>
        </CardContent>
      </Card>
    </div>

    <!-- Empty State / Preview -->
    <Card class="border-dashed">
      <CardContent class="flex flex-col items-center justify-center py-16 text-center">
        <div class="flex items-center justify-center rounded-full bg-muted p-4 mb-4">
          <Icon :name="icon" class="size-10 text-muted-foreground" />
        </div>
        <h3 class="text-lg font-semibold">
          {{ title }} Module
        </h3>
        <p class="mt-2 text-sm text-muted-foreground max-w-md">
          This module is part of the Turbo Clean Management platform. Connect your backend to start managing data in real-time.
        </p>
        <div class="flex gap-2 mt-6">
          <Button variant="outline">
            <Icon name="i-lucide-book-open" class="mr-1 size-4" />
            View Docs
          </Button>
          <Button>
            <Icon name="i-lucide-zap" class="mr-1 size-4" />
            Quick Setup
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
