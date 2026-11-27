<script setup lang="ts">
import { ArrowDown, ArrowUp, Check, Plus, RotateCcw, X } from 'lucide-vue-next'
import { NAV_FAVORITES_MAX } from '~/composables/useNavFavorites'

/**
 * "Customize navbar" — pick up to five pages for the bottom bar and put them in order.
 * Opened from the menu (burger button). Changes apply at once and are saved to the person's account.
 */
const { favorites, groups, isFavorite, isFull, isCustom, customizeOpen, add, remove, move, reset } = useNavFavorites()
const emptySlots = computed(() => Math.max(0, NAV_FAVORITES_MAX - favorites.value.length))
</script>

<template>
  <Sheet v-model:open="customizeOpen">
    <SheetContent side="bottom" class="nav-customize max-h-[88dvh] gap-0 p-0" data-testid="nav-customize">
      <SheetHeader class="shrink-0 gap-0.5 border-b px-2 py-2 pr-10 text-left">
        <SheetTitle class="text-base">Customize navbar</SheetTitle>
        <SheetDescription class="text-xs">
          Pick up to {{ NAV_FAVORITES_MAX }} pages for the bottom bar. Everything else stays in the menu.
        </SheetDescription>
      </SheetHeader>

      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        <!-- In the bar -->
        <div class="flex items-center justify-between gap-2 pb-1.5">
          <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            In your navbar <span class="tabular-nums">({{ favorites.length }}/{{ NAV_FAVORITES_MAX }})</span>
          </p>
          <Button v-if="isCustom" variant="ghost" size="sm" class="h-8 gap-1.5 text-xs" @click="reset">
            <RotateCcw class="size-3.5" /> Reset
          </Button>
        </div>
        <ol class="grid gap-1.5">
          <li
            v-for="(item, index) in favorites" :key="item.link"
            class="flex items-center gap-2 rounded-lg border-2 border-primary bg-card px-2 py-1.5" data-testid="nav-fav-row"
          >
            <span class="grid size-6 shrink-0 place-items-center rounded-md bg-primary text-[11px] font-semibold tabular-nums text-primary-foreground">{{ index + 1 }}</span>
            <Icon :name="item.icon || 'i-lucide-circle'" class="size-4 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ item.title }}</span>
            <Button variant="outline" size="icon" class="size-9" :disabled="index === 0" :aria-label="`Move ${item.title} earlier`" @click="move(item.link, -1)">
              <ArrowUp class="size-4" />
            </Button>
            <Button variant="outline" size="icon" class="size-9" :disabled="index === favorites.length - 1" :aria-label="`Move ${item.title} later`" @click="move(item.link, 1)">
              <ArrowDown class="size-4" />
            </Button>
            <Button variant="outline" size="icon" class="size-9 text-destructive" :aria-label="`Remove ${item.title} from the navbar`" @click="remove(item.link)">
              <X class="size-4" />
            </Button>
          </li>
          <li
            v-for="n in emptySlots" :key="`empty-${n}`"
            class="flex h-[52px] items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 text-xs text-muted-foreground"
          >
            Empty — add a page from the list below
          </li>
        </ol>

        <!-- Everything the person may open -->
        <div v-for="group in groups" :key="group.heading" class="pt-3">
          <p class="pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{{ group.heading }}</p>
          <ul class="grid gap-1 sm:grid-cols-2">
            <li v-for="item in group.items" :key="item.link">
              <button
                type="button"
                class="flex h-11 w-full items-center gap-2 rounded-lg border px-2 text-left text-sm transition-colors disabled:opacity-50"
                :class="isFavorite(item.link) ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted'"
                :disabled="!isFavorite(item.link) && isFull"
                :aria-pressed="isFavorite(item.link)"
                :title="!isFavorite(item.link) && isFull ? 'The navbar is full — remove a page first' : undefined"
                data-testid="nav-pick"
                @click="isFavorite(item.link) ? remove(item.link) : add(item.link)"
              >
                <Icon :name="item.icon || 'i-lucide-circle'" class="size-4 shrink-0 text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
                <Check v-if="isFavorite(item.link)" class="size-4 shrink-0 text-primary" />
                <Plus v-else class="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          </ul>
        </div>
        <p v-if="isFull" class="pt-2 text-center text-xs text-muted-foreground">
          The navbar is full. Remove a page to add another one.
        </p>
      </div>

      <div class="shrink-0 border-t p-2">
        <Button class="h-10 w-full" @click="customizeOpen = false">Done</Button>
      </div>
    </SheetContent>
  </Sheet>
</template>
