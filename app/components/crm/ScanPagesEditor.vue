<script setup lang="ts">
import type { CrmDealership } from '~/composables/useCrmDealerships'
import { AlertTriangle, Check, ListChecks, Loader2, Plus, Wand2, X } from 'lucide-vue-next'
import type { ScanPage } from '~/lib/scanScope'
import { HEALTH_META, TONE, checkScanPage, normalizeAddress, scopeKey } from '~/lib/scanScope'
import { toast } from 'vue-sonner'

/**
 * Scan pages for one dealership — the only pages the crawler reads.
 *
 * One line per link. Five lines are ready to type or paste into; "Add another line" gives more, and
 * pasting several links at once fills one line each. A link is tidied when you leave its line
 * (tracking leftovers removed) and checked on the spot: the home page or a single vehicle's page is
 * marked in red with the reason and is not saved.
 */
const props = defineProps<{ dealership: CrmDealership | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [pages: ScanPage[]] }>()
const { updateDealership } = useCrmDealerships()

const MIN_LINES = 5
interface Line { id: number, url: string, label: string, health: ScanPage['health'] | null }
let nextId = 1
const blank = (): Line => ({ id: nextId++, url: '', label: '', health: null })
const lines = ref<Line[]>([])
const inputs = new Map<number, HTMLInputElement>()
const saving = ref(false)
const detecting = ref(false)
const detectNote = ref('')
interface Found { url: string, label: string, kind: string, cards: number, total: number | null }
const suggestions = ref<Found[]>([])

/** Always five lines to work with, and always an empty one at the end. */
function pad(list: Line[]) {
  const out = [...list]
  while (out.length < MIN_LINES || out[out.length - 1]!.url.trim()) out.push(blank())
  return out
}
watch([open, () => props.dealership?.id], () => {
  if (!open.value) return
  inputs.clear()
  lines.value = pad((props.dealership?.scanPages || []).map(p => ({ id: nextId++, url: p.url, label: p.label || '', health: p.health || null })))
  detectNote.value = ''
  suggestions.value = []
}, { immediate: true })

/** Why a link is left out, in one short line. */
const WHY: Record<string, string> = {
  'Home page': 'This is the home page, not an inventory page — it will not be saved.',
  'One vehicle': 'This is one vehicle\'s page, not the list of vehicles — it will not be saved.',
  'A file': 'This is a file, not a page — it will not be saved.',
  'Not a web address': 'This is not a valid link — it will not be saved.',
}
type State = { kind: 'empty' } | { kind: 'ok', note: string, tone: keyof typeof TONE } | { kind: 'bad', message: string } | { kind: 'twice' }
/** What a line is right now: empty, a usable link, one that cannot be crawled (with the reason), or a repeat. */
function stateOf(l: Line, i: number): State {
  const v = l.url.trim()
  if (!v) return { kind: 'empty' }
  const fit = checkScanPage(v)
  if (!fit.ok) return { kind: 'bad', message: WHY[fit.short] || fit.message }
  const k = scopeKey(v)
  if (lines.value.findIndex(x => x.url.trim() && scopeKey(x.url) === k) !== i) return { kind: 'twice' }
  const h = l.health
  if (!h) return { kind: 'ok', note: '', tone: 'ok' }
  if (h.status === 'ok') return { kind: 'ok', note: `${h.advertised || h.vehicles} vehicles`, tone: 'ok' }
  return { kind: 'ok', note: HEALTH_META[h.status]?.label || '', tone: HEALTH_META[h.status]?.tone || 'warn' }
}
const states = computed(() => lines.value.map((l, i) => stateOf(l, i)))
const good = computed(() => lines.value.filter((_, i) => states.value[i]!.kind === 'ok'))
const skipped = computed(() => states.value.filter(s => s.kind === 'bad').length)

/** Leaving a line: tidy the link (https://, no tracking leftovers). What was known about the old link no longer applies. */
function tidyLine(l: Line) {
  const v = l.url.trim()
  if (!v) { l.url = ''; l.label = ''; l.health = null; return }
  const clean = normalizeAddress(v)
  if (clean && clean !== l.url) {
    if (scopeKey(clean) !== scopeKey(l.url)) { l.label = ''; l.health = null }
    l.url = clean
  }
}
function onInput(l: Line) { l.health = null; if (l === lines.value[lines.value.length - 1] && l.url.trim()) lines.value = pad(lines.value) }
/** Several links pasted at once → one line each, starting here. */
function onPaste(e: ClipboardEvent, i: number) {
  const text = e.clipboardData?.getData('text') || ''
  const parts = text.split(/[\s,]+/).map(x => x.trim()).filter(Boolean)
  if (parts.length < 2) return
  e.preventDefault()
  const list = [...lines.value]
  let at = i
  for (const part of parts) {
    while (at < list.length && at !== i && list[at]!.url.trim()) at++
    if (at >= list.length) list.push(blank())
    Object.assign(list[at]!, { url: normalizeAddress(part) || part, label: '', health: null })
    at++
  }
  lines.value = pad(list)
}
function focusLine(i: number) { nextTick(() => inputs.get(lines.value[i]?.id ?? -1)?.focus()) }
function addLine() { lines.value = [...lines.value, blank()]; focusLine(lines.value.length - 1) }
function nextLine(i: number) { tidyLine(lines.value[i]!); if (i === lines.value.length - 1) lines.value = [...lines.value, blank()]; focusLine(i + 1) }
function clearLine(i: number) {
  const list = lines.value.filter((_, j) => j !== i)
  lines.value = pad(list)
}

/** Find the inventory pages automatically; pages that really list vehicles are put on the lines. */
async function detect() {
  if (!props.dealership?.website) return toast.error('This dealership has no website', { description: 'Paste the inventory page links instead.' })
  detecting.value = true
  detectNote.value = 'Reading the website — 20 to 60 seconds…'
  suggestions.value = []
  try {
    const r = await $fetch<any>('/api/scanner/discover', { method: 'POST', body: { dealershipId: props.dealership.id } })
    const found: Found[] = r.pages || []
    const at = new Date().toISOString()
    const list = lines.value.filter(l => l.url.trim())
    let added = 0
    for (const f of found) {
      const health = { status: 'ok' as const, vehicles: f.cards, advertised: f.total, at, note: 'Verified by page detection' }
      const have = list.find(l => scopeKey(l.url) === scopeKey(f.url))
      if (have) have.health = health
      else { list.push({ id: nextId++, url: f.url, label: f.label || '', health }); added++ }
    }
    lines.value = pad(list)
    suggestions.value = found.length ? [] : (r.candidates || []).slice(0, 6)
    detectNote.value = found.length
      ? `${found.length} page${found.length === 1 ? '' : 's'} found · ${found.reduce((n, f) => n + (f.total || f.cards || 0), 0)} vehicles${added ? '' : ' — already on the list'}`
      : suggestions.value.length ? 'No page was confirmed. These menu links might be the right ones:' : 'Nothing found — paste the link of the inventory page.'
  }
  catch (e: any) { detectNote.value = ''; toast.error('Could not read the website', { description: e?.data?.message || e?.data?.statusMessage || 'Try again' }) }
  finally { detecting.value = false }
}
function useSuggestion(s: Found) {
  const list = lines.value.filter(l => l.url.trim())
  if (!list.some(l => scopeKey(l.url) === scopeKey(s.url))) list.push({ id: nextId++, url: s.url, label: s.label || '', health: null })
  lines.value = pad(list)
  suggestions.value = suggestions.value.filter(x => x.url !== s.url)
}

async function save() {
  if (!props.dealership) return
  for (const l of lines.value) tidyLine(l)
  saving.value = true
  try {
    // Only links that can be crawled are saved; a line marked in red is left out.
    const d = await updateDealership(props.dealership.id, { scanPages: good.value.map(l => ({ url: l.url.trim(), label: l.label })) } as any)
    emit('saved', d.scanPages || [])
    const n = good.value.length
    toast.success(n ? `${n} scan page${n === 1 ? '' : 's'} saved` : 'No scan pages saved — this dealership is skipped by crawls', skipped.value ? { description: `${skipped.value} link${skipped.value === 1 ? ' was' : 's were'} left out (not an inventory page).` } : undefined)
    open.value = false
  }
  catch (e: any) { toast.error('Could not save', { description: e?.data?.message || e?.data?.statusMessage || 'Try again' }) }
  finally { saving.value = false }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-2xl [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 min-w-0"><ListChecks class="size-4 shrink-0 text-red-600" /> <span class="truncate">Scan pages — {{ dealership?.name }}</span></DialogTitle>
        <DialogDescription class="text-xs">Paste the inventory page links, one per line. Only these pages are crawled.</DialogDescription>
      </DialogHeader>

      <div class="min-w-0 space-y-2">
        <ol class="max-h-[52vh] space-y-1.5 overflow-y-auto pr-0.5">
          <li v-for="(l, i) in lines" :key="l.id" class="min-w-0">
            <div class="flex min-w-0 items-center gap-2">
              <span class="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground" aria-hidden="true">{{ i + 1 }}</span>
              <div class="relative min-w-0 flex-1">
                <input
                  :ref="(el) => { if (el) inputs.set(l.id, el as HTMLInputElement); else inputs.delete(l.id) }"
                  v-model="l.url" type="url" inputmode="url" autocomplete="off" spellcheck="false"
                  class="h-9 w-full min-w-0 rounded-md border bg-transparent pl-3 text-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                  :class="[states[i]!.kind === 'bad' ? 'border-rose-500/70' : states[i]!.kind === 'twice' ? 'border-amber-500/70' : 'border-input', states[i]!.kind === 'ok' && (states[i] as any).note ? 'pr-32' : 'pr-9']"
                  :placeholder="i === 0 ? 'https://www.dealer.com/used-inventory/' : 'Paste a link'"
                  :aria-label="`Scan page link ${i + 1}`" :aria-invalid="states[i]!.kind === 'bad'" :aria-describedby="states[i]!.kind === 'bad' || states[i]!.kind === 'twice' ? `scan-line-${l.id}` : undefined"
                  @input="onInput(l)" @blur="tidyLine(l)" @paste="onPaste($event, i)" @keydown.enter.prevent="nextLine(i)"
                >
                <span v-if="states[i]!.kind === 'ok'" class="pointer-events-none absolute inset-y-0 right-2.5 flex items-center gap-1.5 text-[11px] tabular-nums" :class="TONE[(states[i] as any).tone as keyof typeof TONE].text">
                  <span v-if="(states[i] as any).note" class="max-w-24 truncate">{{ (states[i] as any).note }}</span><Check v-if="(states[i] as any).tone === 'ok'" class="size-3.5 shrink-0" /><AlertTriangle v-else class="size-3.5 shrink-0" />
                </span>
                <AlertTriangle v-else-if="states[i]!.kind !== 'empty'" class="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2" :class="states[i]!.kind === 'bad' ? 'text-rose-600' : 'text-amber-600'" />
              </div>
              <Button variant="ghost" size="icon" class="size-8 shrink-0 text-muted-foreground hover:text-rose-600" :class="!l.url && (lines.length <= MIN_LINES || i === lines.length - 1) && 'invisible'" :aria-label="`Remove link ${i + 1}`" title="Remove this line" @click="clearLine(i)"><X class="size-4" /></Button>
            </div>
            <p v-if="states[i]!.kind === 'bad'" :id="`scan-line-${l.id}`" class="ml-7 mr-10 mt-1 text-[11px] leading-snug text-rose-600 dark:text-rose-400">{{ (states[i] as any).message }}</p>
            <p v-else-if="states[i]!.kind === 'twice'" :id="`scan-line-${l.id}`" class="ml-7 mr-10 mt-1 text-[11px] leading-snug text-amber-700 dark:text-amber-300">Same page as a line above — saved once.</p>
          </li>
        </ol>

        <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pl-7">
          <Button variant="ghost" size="sm" class="h-8 gap-1.5 px-2 text-xs" @click="addLine"><Plus class="size-3.5" /> Add another line</Button>
          <span class="text-[11px] text-muted-foreground">Tip: paste several links at once — each gets its own line.</span>
        </div>

        <div v-if="detectNote || suggestions.length" class="min-w-0 space-y-1.5 pl-7">
          <p v-if="detectNote" class="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 v-if="detecting" class="size-3.5 shrink-0 animate-spin" />{{ detectNote }}</p>
          <div v-if="suggestions.length" class="flex flex-wrap gap-1.5">
            <button v-for="s in suggestions" :key="s.url" type="button" class="inline-flex h-7 max-w-full items-center gap-1 rounded-full border bg-background px-2.5 text-[11px] font-medium hover:border-primary/50" :title="s.url" @click="useSuggestion(s)"><Plus class="size-3 shrink-0 text-muted-foreground" /><span class="truncate">{{ s.label || s.url }}</span></button>
          </div>
        </div>
      </div>

      <DialogFooter class="gap-2 sm:justify-between">
        <Button variant="outline" class="gap-1.5" :disabled="detecting || !dealership?.website" :title="dealership?.website ? 'Reads the website and adds the pages that really list vehicles' : 'This dealership has no website'" @click="detect"><Loader2 v-if="detecting" class="size-4 animate-spin" /><Wand2 v-else class="size-4" /> {{ detecting ? 'Detecting…' : 'Detect automatically' }}</Button>
        <div class="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="ghost" @click="open = false">Cancel</Button>
          <Button :disabled="saving" class="min-w-32 gap-1.5" @click="save"><Loader2 v-if="saving" class="size-4 animate-spin" /><Check v-else class="size-4" /> {{ good.length ? `Save ${good.length} page${good.length === 1 ? '' : 's'}` : 'Save' }}</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
