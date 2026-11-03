<script setup lang="ts">
const color = useColorMode()
const isDark = computed(() => color.value === 'dark')
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon" title="Toggle Color Scheme" aria-label="button dark toggle">
        <Icon :name="isDark ? 'i-lucide-moon-star' : 'i-lucide-sun'" size="18" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuGroup>
        <DropdownMenuItem
          flex="~ gap-2"
          :class="{ 'bg-accent text-accent-foreground': color.preference === 'light' }"
          @click="color.preference = 'light'"
        >
          <Icon name="i-lucide-sun" size="16" />
          <span>Light</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          flex="~ gap-2"
          :class="{ 'bg-accent text-accent-foreground': color.preference === 'dark' }"
          @click="color.preference = 'dark'"
        >
          <Icon name="i-lucide-moon-star" size="16" />
          <span>Dark</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          flex="~ gap-2"
          :class="{ 'bg-accent text-accent-foreground': color.preference === 'system' }"
          @click="color.preference = 'system'"
        >
          <Icon name="i-lucide-monitor" size="16" />
          <span>System</span>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
