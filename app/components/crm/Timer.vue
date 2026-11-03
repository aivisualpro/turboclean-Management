<script setup lang="ts">
import { Timer, Square, Play, Loader2, Trash2, ArrowUpRight } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { TIME_CATEGORIES, TIME_CATEGORY_MAP, formatMinutes } from '~/constants/crm'
import { INTERACTION_ICONS } from '~/constants/crm-icons'

/**
 * Top-bar time tracker: start/stop a timer (category + optional dealership), or add time after the fact.
 * One running timer per person; it keeps running across pages and devices.
 */
const route = useRoute()
const { running, loadRunning, start, stop, updateRunning, discardRunning } = useCrmTime()
const open = ref(false)
const tab = ref<'timer' | 'add'>('timer')
const busy = ref(false)

// Start form
const category = ref('')
const dealershipId = ref<string | null>(null)
const note = ref('')
/** On a dealership page, link to it by default. */
const pageDealershipId = computed(() => route.path.startsWith('/crm/dealership/') ? String(route.params.id || '') || null : null)
watch(open, (o) => {
  if (!o) return
  if (!running.value) { dealershipId.value = pageDealershipId.value; note.value = '' }
  tab.value = 'timer'
})

// Ticking clock
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  loadRunning()
  tick = setInterval(() => { now.value = Date.now() }, 1000)
  const f = () => document.visibilityState === 'visible' && loadRunning()
  document.addEventListener('visibilitychange', f)
  onBeforeUnmount(() => { document.removeEventListener('visibilitychange', f); if (tick) clearInterval(tick) })
})
const elapsedSec = computed(() => running.value?.startedAt ? Math.max(0, Math.floor((now.value - new Date(running.value.startedAt).getTime()) / 1000)) : 0)
const clock = computed(() => {
  const s = elapsedSec.value, h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
})
const runningCat = computed(() => running.value ? TIME_CATEGORY_MAP[running.value.category] : null)

async function doStart(cat = category.value) {
  if (!cat) { toast.error('Pick what you are working on'); return }
  busy.value = true
  try {
    const res = await start({ category: cat, dealershipId: dealershipId.value, note: note.value.trim() })
    if (res.stopped) toast.success(`Saved ${formatMinutes(res.stopped.minutes)} of ${TIME_CATEGORY_MAP[res.stopped.category]?.label.toLowerCase()}`)
    category.value = ''
    open.value = false
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not start the timer') } finally { busy.value = false }
}
async function doStop() {
  busy.value = true
  try {
    const e = await stop()
    if (e) toast.success(`Saved ${formatMinutes(e.minutes)} of ${TIME_CATEGORY_MAP[e.category]?.label.toLowerCase()}`, { description: e.capped ? 'The timer ran over 12 hours, so it was capped — edit it on the Time page.' : e.dealershipName || undefined })
    open.value = false
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not stop the timer') } finally { busy.value = false }
}
async function doDiscard() {
  busy.value = true
  try { await discardRunning(); toast('Timer discarded'); open.value = false } catch { toast.error('Could not discard') } finally { busy.value = false }
}
async function switchCategory(cat: string) {
  if (!running.value || running.value.category === cat) return
  // Switching = stop this block, start a new one (so each block keeps one category).
  dealershipId.value = running.value.dealershipId
  await doStart(cat)
}
async function relink(id: string | null) {
  if (!running.value || running.value.dealershipId === id) return
  try { await updateRunning({ dealershipId: id }) } catch { toast.error('Could not update the timer') }
}
const runningDealership = computed({
  get: () => running.value?.dealershipId || null,
  set: (v: string | null) => { relink(v) },
})
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <!-- One element for both states so the popover keeps its anchor when the timer starts/stops. -->
      <Button variant="outline" size="sm" class="h-9" :class="running ? 'gap-2 border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10' : 'gap-1.5'"
        :title="running ? `Timer running — ${runningCat?.label}${running.dealershipName ? ` · ${running.dealershipName}` : ''}` : 'Track time'">
        <template v-if="running">
          <span class="relative flex size-2"><span class="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping" /><span class="relative inline-flex size-2 rounded-full bg-emerald-500" /></span>
          <span class="tabular-nums font-semibold text-xs">{{ clock }}</span>
          <span class="hidden md:inline text-xs text-muted-foreground max-w-28 truncate">{{ runningCat?.short }}</span>
        </template>
        <template v-else><Timer class="size-4" /><span class="hidden md:inline text-xs">Track time</span></template>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-[340px] p-0">
      <div class="flex border-b text-xs">
        <button type="button" class="flex-1 py-2 font-medium transition-colors" :class="tab === 'timer' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'" @click="tab = 'timer'">Timer</button>
        <button type="button" class="flex-1 py-2 font-medium transition-colors" :class="tab === 'add' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'" @click="tab = 'add'">Add time</button>
      </div>

      <div v-if="tab === 'timer'" class="p-3 space-y-3">
        <!-- Running -->
        <template v-if="running">
          <div class="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 flex items-center gap-3">
            <component :is="INTERACTION_ICONS[runningCat?.icon || 'StickyNote']" class="size-4 text-emerald-600 shrink-0" />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium truncate">{{ runningCat?.label }}</p>
              <p class="text-[11px] text-muted-foreground">Started {{ new Date(running.startedAt!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}</p>
            </div>
            <span class="text-lg font-bold tabular-nums">{{ clock }}</span>
          </div>
          <div class="space-y-1.5">
            <p class="text-[11px] font-medium text-muted-foreground">Dealership</p>
            <CrmDealershipPicker v-model="runningDealership" />
          </div>
          <div class="space-y-1.5">
            <p class="text-[11px] font-medium text-muted-foreground">Switch to (saves this block, starts a new one)</p>
            <div class="grid grid-cols-3 gap-1.5">
              <button v-for="c in TIME_CATEGORIES.filter(c => c.key !== running?.category)" :key="c.key" type="button" :disabled="busy" class="rounded-md border px-2 py-1.5 text-[11px] flex items-center gap-1.5 hover:bg-muted text-muted-foreground hover:text-foreground" :title="c.label" @click="switchCategory(c.key)">
                <component :is="INTERACTION_ICONS[c.icon]" class="size-3.5 shrink-0" /><span class="truncate">{{ c.short }}</span>
              </button>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <Button variant="ghost" size="sm" class="text-muted-foreground" :disabled="busy" @click="doDiscard"><Trash2 class="size-3.5" /> Discard</Button>
            <Button class="flex-1" :disabled="busy" @click="doStop"><Loader2 v-if="busy" class="size-4 animate-spin" /><Square v-else class="size-3.5 fill-current" /> Stop &amp; save</Button>
          </div>
        </template>

        <!-- Idle -->
        <template v-else>
          <p class="text-[11px] font-medium text-muted-foreground">What are you working on?</p>
          <div class="grid grid-cols-3 gap-1.5">
            <button v-for="c in TIME_CATEGORIES" :key="c.key" type="button" class="rounded-md border px-2 py-1.5 text-[11px] flex items-center gap-1.5 transition-colors text-left"
              :class="category === c.key ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted text-muted-foreground hover:text-foreground'" :title="c.label" @click="category = c.key" @dblclick="doStart(c.key)">
              <component :is="INTERACTION_ICONS[c.icon]" class="size-3.5 shrink-0" /><span class="truncate">{{ c.short }}</span>
            </button>
          </div>
          <CrmDealershipPicker v-model="dealershipId" />
          <Input v-model="note" placeholder="Note (optional)" class="h-9 text-sm" @keydown.enter.prevent="doStart()" />
          <Button class="w-full" :disabled="busy || !category" @click="doStart()"><Loader2 v-if="busy" class="size-4 animate-spin" /><Play v-else class="size-3.5 fill-current" /> Start timer</Button>
        </template>
      </div>

      <div v-else class="p-3">
        <CrmTimeQuickAdd :dealership-id="pageDealershipId" @saved="open = false" />
      </div>

      <NuxtLink to="/crm/time" class="flex items-center justify-center gap-1 border-t py-2 text-[11px] text-primary hover:bg-muted/40" @click="open = false">Time &amp; ROI report <ArrowUpRight class="size-3" /></NuxtLink>
    </PopoverContent>
  </Popover>
</template>
