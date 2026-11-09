<script setup lang="ts">
import type { CrmDealership } from '~/composables/useCrmDealerships'
import { Globe, Plus, Trash2, Loader2, Wand2, Car, Sparkles, Link2, ExternalLink, Check, ListChecks, Activity, Ban, ShieldCheck } from 'lucide-vue-next'
import type { ScanPage } from '~/lib/scanScope'
import { HEALTH_META, TONE, checkScanPage, guessPageLabel, normalizeAddress, pagePath, scopeKey } from '~/lib/scanScope'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'vue-sonner'

/**
 * Scan pages for one dealership — the only pages the crawler reads (each inventory list is followed
 * through all of its result pages; nothing else on the site is opened).
 *  - An address must be an inventory list: the home page or one vehicle's page is refused here, with the reason.
 *  - Every page shows its health: what the last test or crawl really found on it.
 *  - "Detect" opens the website in the cloud browser and adds the pages that really list vehicles.
 * Saves to the dealership (`scanPages`), so the crawler and Mission Control use the same list.
 */
const props = defineProps<{ dealership: CrmDealership | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [pages: ScanPage[]] }>()
const { updateDealership } = useCrmDealerships()

const pages = ref<ScanPage[]>([])
const testing = ref(new Set<string>())
const draft = ref('')
const saving = ref(false)
const detecting = ref(false)
interface Found { url: string, label: string, kind: string, cards: number, total: number | null, verified: boolean }
const found = ref<Found[]>([])
const suggestions = ref<Found[]>([])
const detectLog = ref<string[]>([])
const detectNote = ref('')
watch([open, () => props.dealership?.id], () => {
  if (!open.value) return
  pages.value = (props.dealership?.scanPages || []).map(p => ({ ...p }))
  draft.value = ''
  found.value = []
  suggestions.value = []
  detectLog.value = []
  detectNote.value = ''
}, { immediate: true })

const has = (u: string) => { const k = scopeKey(u); return !!k && pages.value.some(p => scopeKey(p.url) === k) }
/** Why a page on the list can never be crawled ('' when it can). */
const problemOf = (u: string) => { const c = checkScanPage(u); return c.ok ? null : c }
const usable = computed(() => pages.value.filter(p => !problemOf(p.url)))
function add(raw: string, label = '') {
  const url = normalizeAddress(raw)
  const fit = checkScanPage(url || raw)
  if (!url || !fit.ok) return toast.error('Not an inventory page', { description: fit.message })
  if (has(url)) return
  pages.value = [...pages.value, { url, label }]
}
function addDraft() {
  // Accept several lines / commas at once.
  for (const part of draft.value.split(/[\n,]+/)) if (part.trim()) add(part)
  draft.value = ''
}
const remove = (i: number) => { pages.value = pages.value.filter((_, j) => j !== i) }
const ago = (iso?: string | null) => { try { return iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : '' } catch { return '' } }
/** The line under a page: why it cannot be crawled, or what its last test / crawl found. */
function healthLine(p: ScanPage): { text: string, tone: keyof typeof TONE } {
  const bad = problemOf(p.url)
  if (bad) return { text: `${bad.short}, not an inventory list — never crawled. Remove it and add the page that lists the vehicles.`, tone: 'bad' }
  const h = p.health
  if (!h) return { text: 'Not tested yet', tone: 'idle' }
  const m = HEALTH_META[h.status] || HEALTH_META.ok
  return h.status === 'ok' ? { text: `${m.label} · ${h.advertised || h.vehicles} vehicles · ${ago(h.at)}`, tone: 'ok' } : { text: `${m.label} · ${ago(h.at)}${h.note ? ` — ${h.note}` : ''}`, tone: m.tone }
}
/** Open one page in the cloud browser and record what is really on it. */
async function test(p: ScanPage) {
  if (!props.dealership || testing.value.has(p.url)) return
  testing.value = new Set(testing.value).add(p.url)
  try {
    const r = await $fetch<{ health: NonNullable<ScanPage['health']> }>('/api/scanner/check-page', { method: 'POST', body: { dealershipId: props.dealership.id, url: p.url } })
    pages.value = pages.value.map(x => x.url === p.url ? { ...x, health: r.health } : x)
  }
  catch (e: any) { toast.error('Could not test the page', { description: e?.data?.message || e?.data?.statusMessage || 'Try again' }) }
  finally { const t = new Set(testing.value); t.delete(p.url); testing.value = t }
}
const KIND_LABEL: Record<string, string> = { used: 'Pre-owned', certified: 'Certified', new: 'New', all: 'Inventory' }
const kindIcon = (k: string) => k === 'new' ? Sparkles : k === 'used' || k === 'certified' ? Car : Globe

/** Server-side discovery: menu links + known platform paths + AI shortlist, each candidate opened and its vehicle cards counted. */
async function detect() {
  if (!props.dealership?.website) return toast.error('This dealership has no website')
  detecting.value = true
  detectNote.value = 'Opening the website, reading its menus and checking each inventory page — 20 to 60 seconds…'
  try {
    const r = await $fetch<any>('/api/scanner/discover', { method: 'POST', body: { dealershipId: props.dealership.id } })
    found.value = r.pages || []
    suggestions.value = r.candidates || []
    detectLog.value = r.log || []
    // Verified pages go straight onto the list (still only saved when you press Save).
    let added = 0
    const at = new Date().toISOString()
    for (const f of found.value) {
      const health = { status: 'ok' as const, vehicles: f.cards, advertised: f.total, at, note: 'Verified by page detection' }
      if (has(f.url)) pages.value = pages.value.map(p => scopeKey(p.url) === scopeKey(f.url) ? { ...p, health } : p)
      else { pages.value = [...pages.value, { url: f.url, label: f.label, health }]; added++ }
    }
    detectNote.value = found.value.length
      ? `${found.value.length} page${found.value.length === 1 ? '' : 's'} verified — ${found.value.reduce((n: number, f: Found) => n + (f.total || f.cards), 0)} vehicles${r.aiUsed ? ' · AI helped read the menus' : ''}${added ? ` · ${added} added below` : ''}`
      : 'No page with vehicle listings was found — try a suggestion or paste the address of the inventory page.'
    if (!found.value.length && !suggestions.value.length) toast('No inventory pages found automatically', { description: 'Paste the inventory page addresses below.' })
  }
  catch (e: any) { detectNote.value = ''; toast.error(e?.data?.message || e?.data?.statusMessage || 'Could not open the website') }
  finally { detecting.value = false }
}
async function save() {
  if (!props.dealership) return
  saving.value = true
  try {
    // Addresses that can never be crawled (a home page saved by an older version) are not saved again.
    const d = await updateDealership(props.dealership.id, { scanPages: usable.value.map(p => ({ url: p.url, label: p.label })) } as any)
    emit('saved', d.scanPages || [])
    toast.success(usable.value.length ? `${usable.value.length} scan page${usable.value.length === 1 ? '' : 's'} saved` : 'Scan pages cleared — this dealership is skipped by crawls until pages are picked')
    open.value = false
  }
  catch (e: any) { toast.error('Could not save', { description: e?.data?.message || e?.data?.statusMessage || 'Try again' }) }
  finally { saving.value = false }
}
const short = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
const draftProblem = computed(() => { for (const part of draft.value.split(/[\n,]+/)) { const v = part.trim(); if (v) { const c = checkScanPage(v); if (!c.ok) return `${short(v)} — ${c.message}` } } return '' })
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2"><ListChecks class="size-4 text-red-600" /> Scan pages — {{ dealership?.name }}</DialogTitle>
        <DialogDescription class="text-xs">The only pages the crawler reads for this dealership (used, new, certified…). Each list is followed through all of its result pages; nothing else on the site is opened — never the home page.</DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <!-- Current pages -->
        <ul v-if="pages.length" class="rounded-xl border divide-y">
          <li v-for="(p, i) in pages" :key="p.url" class="flex items-start gap-2 px-3 py-2 text-sm" :class="problemOf(p.url) && 'bg-rose-500/5'">
            <span v-if="problemOf(p.url)" class="mt-0.5 size-6 shrink-0 rounded-md bg-rose-500/10 text-rose-600 flex items-center justify-center"><Ban class="size-3.5" /></span>
            <span v-else class="mt-0.5 size-6 shrink-0 rounded-md bg-red-600/10 text-red-600 text-[11px] font-semibold flex items-center justify-center tabular-nums">{{ usable.indexOf(p) + 1 }}</span>
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ p.label || (problemOf(p.url) ? problemOf(p.url)!.short : guessPageLabel(p.url)) }}</p>
              <p class="truncate text-[11px] text-muted-foreground">{{ problemOf(p.url) ? short(p.url) || p.url : pagePath(p.url) }}</p>
              <p class="mt-0.5 text-[11px] leading-snug" :class="TONE[healthLine(p).tone].text">{{ healthLine(p).text }}</p>
            </div>
            <Button v-if="!problemOf(p.url)" variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-foreground" :disabled="testing.has(p.url)" :aria-label="`Test ${p.label || pagePath(p.url)}`" title="Test this page — opens it and counts the vehicles" @click="test(p)"><Loader2 v-if="testing.has(p.url)" class="size-3.5 animate-spin" /><Activity v-else class="size-3.5" /></Button>
            <a :href="p.url" target="_blank" rel="noopener" class="mt-1.5 text-muted-foreground hover:text-foreground" title="Open in my browser"><ExternalLink class="size-3.5" /></a>
            <Button variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-rose-600" aria-label="Remove" @click="remove(i)"><Trash2 class="size-3.5" /></Button>
          </li>
        </ul>
        <div v-else class="rounded-xl border-2 border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-6 text-center text-sm text-muted-foreground">
          No scan pages yet — this dealership is <b class="text-foreground">skipped</b> by crawls until you detect or add its inventory pages.
        </div>

        <!-- Add -->
        <div class="space-y-2">
          <Label class="text-xs">Add page addresses <span class="text-muted-foreground font-normal">(one per line, or paste several)</span></Label>
          <div class="flex gap-2">
            <Textarea v-model="draft" rows="2" class="text-sm min-h-0 font-mono" placeholder="https://www.dealer.com/used-inventory/index.htm" :aria-invalid="!!draftProblem" @keydown.enter.exact.prevent="!draftProblem && addDraft()" />
            <Button variant="outline" class="shrink-0 h-auto gap-1.5" :disabled="!draft.trim() || !!draftProblem" @click="addDraft"><Plus class="size-4" /> Add</Button>
          </div>
          <p v-if="draftProblem" class="text-[11px] leading-snug text-rose-600 dark:text-rose-400" role="alert">{{ draftProblem }}</p>
          <p v-else class="flex items-center gap-1.5 text-[11px] text-muted-foreground"><ShieldCheck class="size-3.5 text-emerald-600" /> Only inventory lists can be saved — the home page is refused, so a crawl can never wander the whole site.</p>
        </div>

        <!-- Detect -->
        <div class="rounded-xl border bg-muted/20 p-3 space-y-2">
          <div class="flex items-center gap-2">
            <Button size="sm" class="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" :disabled="detecting || !dealership?.website" @click="detect"><Loader2 v-if="detecting" class="size-4 animate-spin" /><Wand2 v-else class="size-4" /> Detect inventory pages</Button>
            <span class="text-[11px] text-muted-foreground">{{ detectNote || `Opens ${dealership?.website ? short(dealership.website) : 'the website'}, reads its menus (AI helps), opens each candidate and keeps only pages that really list vehicles.` }}</span>
          </div>
          <ul v-if="found.length" class="space-y-1">
            <li v-for="f in found" :key="f.url" class="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-xs">
              <Check class="size-3.5 text-emerald-600 shrink-0" />
              <span class="font-medium">{{ f.label }}</span>
              <span v-if="KIND_LABEL[f.kind]" class="text-muted-foreground">· {{ KIND_LABEL[f.kind] }}</span>
              <span class="ml-auto tabular-nums text-emerald-700 dark:text-emerald-300">{{ f.total ? `${f.total} vehicles` : `${f.cards}+ on screen` }}</span>
              <Button v-if="!has(f.url)" variant="ghost" size="sm" class="h-6 px-2 text-[11px]" @click="add(f.url, f.label)"><Plus class="size-3" /> Add</Button>
            </li>
          </ul>
          <div v-if="suggestions.length" class="space-y-1">
            <p class="text-[11px] text-muted-foreground">Other menu links that might be inventory (not verified):</p>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="s in suggestions" :key="s.url" type="button" class="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 h-7 text-[11px] font-medium hover:border-primary/40 disabled:opacity-50" :title="s.url" :disabled="has(s.url)" @click="add(s.url, s.label)">
                <Check v-if="has(s.url)" class="size-3 text-emerald-600" /><component :is="kindIcon(s.kind)" v-else class="size-3 text-muted-foreground" />
                {{ s.label }}<span v-if="KIND_LABEL[s.kind]" class="text-muted-foreground">· {{ KIND_LABEL[s.kind] }}</span>
              </button>
            </div>
          </div>
          <details v-if="detectLog.length" class="text-[11px] text-muted-foreground"><summary class="cursor-pointer">What was checked</summary><pre class="mt-1 whitespace-pre-wrap font-mono text-[10px] leading-4">{{ detectLog.join('\n') }}</pre></details>
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" @click="open = false">Cancel</Button>
        <Button :disabled="saving" class="min-w-28 gap-1.5" @click="save"><Loader2 v-if="saving" class="size-4 animate-spin" /><Link2 v-else class="size-4" /> Save pages</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
