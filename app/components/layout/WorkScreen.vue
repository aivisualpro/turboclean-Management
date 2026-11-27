<script setup lang="ts">
/**
 * A work screen — the crawler, Mission Control, a crawl review — that takes over the PAGE AREA only.
 *
 * It is not a window on top of the app: the sidebar and the main header stay on screen and usable.
 * While it is open the main header belongs to it — its title, a back button in front of the title
 * (closes the screen), and its controls (slot `actions`) where the page's buttons normally are.
 *
 *   <LayoutWorkScreen v-model:open="open" title="Inventory crawler · Kia of Groton" icon="i-lucide-scan-search" @back="close">
 *     <template #actions> …tabs, chips… </template>
 *     …the screen…
 *   </LayoutWorkScreen>
 *
 * `@back` — the back button or Escape was pressed: the parent decides (ask about unsaved work, then
 * set `open` to false). Without a listener the screen simply closes.
 * `leaveGuard` — asked when the person walks away through the sidebar or the browser's Back while the
 * screen is open; return false to stay.
 */
const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  title: string
  /** Icon in the main header (an `i-lucide-…` name). */
  icon?: string
  /** Tooltip of the back button ("Back to Kia of Groton"). */
  backLabel?: string
  /** Classes of the screen's box (its own border / background). */
  panelClass?: string
  /** Escape is busy elsewhere right now (a field inside is being edited). */
  holdEscape?: boolean
  leaveGuard?: () => boolean
  onBack?: () => void
}>()

const { openWork } = usePageHeader()
function back() {
  if (props.onBack) props.onBack()
  else open.value = false
}

// The header is this screen's while it is open (getters: the title follows the props).
const entry = { get title() { return props.title }, get icon() { return props.icon }, get backLabel() { return props.backLabel }, back }
let giveBack: (() => void) | null = null
const panel = ref<HTMLElement | null>(null)
watch(open, (isOpen) => {
  giveBack?.()
  giveBack = isOpen ? openWork(entry) : null
  // Keyboard users land in the screen, not in the page behind it.
  if (isOpen) nextTick(() => panel.value?.focus({ preventScroll: true }))
}, { immediate: true })

/** Escape closes the screen — unless something inside it is open (a menu, a dialog) or being typed in. */
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value || e.defaultPrevented || props.holdEscape) return
  if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"], [data-reka-popper-content-wrapper]')) return
  const el = e.target as HTMLElement | null
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
  back()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); giveBack?.(); giveBack = null })
onBeforeRouteLeave(() => { if (open.value && props.leaveGuard && !props.leaveGuard()) return false })
</script>

<template>
  <ClientOnly>
    <Teleport defer to="#page-work">
      <Transition enter-active-class="transition duration-150 ease-out" enter-from-class="opacity-0" leave-active-class="transition duration-100 ease-in" leave-to-class="opacity-0">
        <section v-if="open" role="region" :aria-label="title" class="work-screen pointer-events-auto absolute inset-0 flex flex-col bg-background p-2">
          <div ref="panel" tabindex="-1" class="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg outline-none" :class="panelClass">
            <slot />
          </div>
        </section>
      </Transition>
    </Teleport>
    <!-- The screen's controls sit in the main header, where the page's buttons normally are (those are hidden meanwhile). -->
    <Teleport v-if="open && $slots.actions" defer to="#page-header-actions">
      <div data-work-actions class="contents">
        <slot name="actions" />
      </div>
    </Teleport>
  </ClientOnly>
</template>
