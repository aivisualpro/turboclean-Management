<script setup lang="ts">
import type { FinalVerdict, ImageRule, ScanResults, ScannedVehicle } from '~/composables/useInventoryScanner'
import { VERDICT_META } from '~/composables/useInventoryScanner'
import { ImageOff, Search, ExternalLink, Check, Brain, Layers, Trash2, Plus, Sparkles, Info, Link2, Ban, AlertTriangle, X, MoreHorizontal, RotateCcw, RefreshCw, Loader2, ChevronDown, ChevronUp, HelpCircle, Pencil } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * Crawl results — one simple screen.
 *
 *   1. One headline: how many vehicles have no real photo.
 *   2. Big tabs, one per answer: All · No photo · Stock image · Blurry · Real photo (· Not sure · Ads).
 *   3. Every car shows its photo and four buttons — Real / No photo / Stock / Blurry. One click corrects it.
 *      Cars that share a picture (or stand on the same stock background) are ONE card: decide once for all.
 *   4. Tick cars (Shift for a range, or "Select all") to mark many at once.
 *
 * Nothing here teaches the scanner for other dealerships unless asked ("Remember this exact picture");
 * every change can be undone, and "Reset my changes" puts the scanner's own calls back.
 */
const props = defineProps<{
  results: ScanResults
  review: (body: any) => Promise<void>
  listRules: () => Promise<{ rules: ImageRule[] }>
  addRule: (body: any) => Promise<any>
  removeRule: (id: string) => Promise<any>
  /** Download and judge every photo again (no new crawl). When absent the button is not shown. */
  recheck?: () => Promise<{ before: { withoutReal: number }, after: { withoutReal: number }, seconds: number } | null>
}>()

const r = computed(() => props.results)
const s = computed(() => r.value.summary)
const coverage = computed<{ checked: number, advertised: number | null, blocked: { url: string, page: number }[] } | null>(() => (r.value as any).coverage || null)
/** What people choose from. A placeholder image ("photos coming soon") means the car has no photo: one choice. */
const CHOICES: FinalVerdict[] = ['real', 'placeholder', 'stock', 'blurry']
const noPhoto = (f: FinalVerdict) => f === 'placeholder' || f === 'missing'
/** The choice a verdict belongs to ("missing" is shown as "No photo"). */
const choiceOf = (f: FinalVerdict): FinalVerdict => f === 'missing' ? 'placeholder' : f
const noPhotoCount = computed(() => s.value.by.placeholder + s.value.by.missing)
const blurryCount = computed(() => s.value.by.blurry || 0)
const tone = computed(() => (s.value.withoutRealPct ?? 0) >= 25 ? 'text-rose-600 dark:text-rose-400' : (s.value.withoutRealPct ?? 0) >= 10 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')
/** The AI did not look at this crawl's photos: say so — the calls are the built-in checks only. */
const aiOff = computed(() => {
  const pc = r.value.photoCheck
  if (!pc || pc.provider || !pc.off) return ''
  return pc.off === 'no-key' ? 'The server has no AI key (ANTHROPIC_API_KEY or GOOGLE_GEMINI_API_KEY in Vercel → Settings → Environment Variables).'
    : pc.off === 'switched-off' ? 'It was switched off on the server when this crawl ran. It is always on now — press “Check photos again”.'
      : 'The AI service could not be reached during this crawl — press “Check photos again”.'
})

// ── Tabs ──
type Tab = 'all' | 'nophoto' | 'stock' | 'blurry' | 'real' | 'review' | 'ads'
const tab = ref<Tab>('all')
const q = ref('')
const cond = ref<'all' | 'new' | 'used'>('all')
/** Crawl page (URL) filter — offered when the crawl covered 2+ pages. */
const page = ref('all')
const scope = computed(() => props.results.scope || [])
const crawlPages = computed<{ url: string, label: string, total: number, withoutReal: number, withoutRealPct: number | null }[]>(() => ((r.value as any).crawlPages || []).filter((p: any) => p.total > 0))
const shown = ref(120)
watch([tab, q, cond, page], () => { shown.value = 120 })
/** Advertisement / promo tile — shown under "Ads", never counted. */
const isAdCard = (v: ScannedVehicle) => v.listing ? v.listing === 'ad' : !!v.adReason
const adCount = computed(() => r.value.vehicles.filter(isAdCard).length)
const unsure = (v: ScannedVehicle) => v.verdict === 'review' && !v.override
const tabs = computed(() => [
  { k: 'all' as Tab, label: 'All vehicles', n: s.value.total, dot: 'bg-foreground/60', sub: 'everything the crawl found' },
  { k: 'nophoto' as Tab, label: 'No photo', n: noPhotoCount.value, dot: VERDICT_META.placeholder.dot, sub: 'counted as missing' },
  { k: 'stock' as Tab, label: 'Stock image', n: s.value.by.stock, dot: VERDICT_META.stock.dot, sub: r.value.countStockAsMissing ? 'counted as missing' : 'not counted as missing' },
  { k: 'blurry' as Tab, label: 'Blurry photo', n: blurryCount.value, dot: VERDICT_META.blurry.dot, sub: 'listed apart, not counted' },
  { k: 'real' as Tab, label: 'Real photo', n: s.value.by.real, dot: VERDICT_META.real.dot, sub: 'nothing to do' },
  ...(s.value.review ? [{ k: 'review' as Tab, label: 'Not sure', n: s.value.review, dot: VERDICT_META.review.dot, sub: 'the scanner asks you' }] : []),
  ...(adCount.value ? [{ k: 'ads' as Tab, label: 'Ads', n: adCount.value, dot: 'bg-zinc-500', sub: 'left out of every count' }] : []),
])
watch(tabs, (t) => { if (!t.some(x => x.k === tab.value)) tab.value = 'all' })
/** In "All", what needs a look comes first. */
const RANK: Record<string, number> = { review: 0, placeholder: 1, missing: 1, stock: 2, blurry: 3, real: 4 }
const rank = (v: ScannedVehicle) => unsure(v) ? 0 : (RANK[v.final] ?? 4)
const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase()
  const list = r.value.vehicles.filter((v) => {
    if ((tab.value === 'ads') !== isAdCard(v)) return false
    if (tab.value === 'review' && !unsure(v)) return false
    if (tab.value === 'nophoto' && !noPhoto(v.final)) return false
    if ((tab.value === 'stock' || tab.value === 'blurry' || tab.value === 'real') && v.final !== tab.value) return false
    if (page.value !== 'all' && (v as any).listUrl !== page.value) return false
    if (cond.value === 'new' && v.condition !== 'new') return false
    if (cond.value === 'used' && v.condition === 'new') return false
    if (needle && !`${v.title} ${v.vin} ${v.stock} ${v.price}`.toLowerCase().includes(needle)) return false
    return true
  })
  return tab.value === 'all' ? [...list].sort((a, b) => rank(a) - rank(b)) : list
})

// ── Cars that share a picture, or stand on the same stock background, are one card ──
interface Group { id: string, kind: 'picture' | 'backdrop', cars: ScannedVehicle[], url: string, final: FinalVerdict | 'mixed' }
type Row = { type: 'group', g: Group, open: boolean } | { type: 'car', v: ScannedVehicle, inGroup: boolean }
const opened = ref<Set<string>>(new Set())
function toggleGroup(id: string) { const n = new Set(opened.value); if (n.has(id)) n.delete(id); else n.add(id); opened.value = n }
const groupOf = (v: ScannedVehicle) => v.clusterId ? `c:${v.clusterId}` : v.backdropId ? `b:${v.backdropId}` : ''
const rows = computed<Row[]>(() => {
  const list = filtered.value
  const by = new Map<string, ScannedVehicle[]>()
  for (const v of list) { const k = groupOf(v); if (k) by.set(k, [...(by.get(k) || []), v]) }
  const out: Row[] = []
  const done = new Set<string>()
  for (const v of list) {
    const k = groupOf(v)
    const cars = k ? by.get(k)! : []
    if (!k || cars.length < 2) { out.push({ type: 'car', v, inGroup: false }); continue }
    if (done.has(k)) continue
    done.add(k)
    const finals = new Set(cars.map(c => choiceOf(c.final)))
    const g: Group = { id: k, kind: k.startsWith('c:') ? 'picture' : 'backdrop', cars, url: cars.map(photoSrc).find(Boolean) || '', final: finals.size === 1 ? [...finals][0]! : 'mixed' }
    const open = opened.value.has(k)
    out.push({ type: 'group', g, open })
    if (open) for (const c of cars) out.push({ type: 'car', v: c, inGroup: true })
  }
  return out
})
const models = (g: Group) => { const m = [...new Set(g.cars.map(c => `${c.make} ${c.model}`.trim()).filter(Boolean))]; return m.length === 1 ? m[0]! : `${m.length} different models` }

const img = (v: ScannedVehicle) => v.imageId ? r.value.images[v.imageId] : null
/** Photos are not stored — the dealer's own image is shown. Track the ones their server refuses. */
const broken = ref(new Set<string>())
function photoSrc(v: ScannedVehicle) { const u = img(v)?.url || v.image?.url || ''; return u && !broken.value.has(u) ? u : '' }
function onBroken(u: string) { const next = new Set(broken.value); next.add(u); broken.value = next }

// ── Changes go to the server one after the other; the screen stays usable meanwhile ──
const pending = ref(0)
const busy = computed(() => pending.value > 0)
let chain: Promise<unknown> = Promise.resolve()
function send(body: any): Promise<void> {
  pending.value++
  const job = chain.then(() => props.review(body))
  chain = job.catch(() => {})
  return job.finally(() => { pending.value-- })
}
const fail = (e: any, what = 'Nothing was changed') => toast.error(what, { description: e?.data?.statusMessage || e?.message || 'Try again.' })
const plural = (n: number) => `${n} vehicle${n === 1 ? '' : 's'}`

// ── Check the photos again (no new crawl) ──
const rechecking = ref(false)

/** One click on a car's button. Clicking the answer you set yourself takes it back. */
const acting = ref<Set<string>>(new Set())
async function choose(v: ScannedVehicle, k: FinalVerdict) {
  if (rechecking.value) return
  const mine = !!v.override && choiceOf(v.override) === k
  // Already that, by the scanner's own call: nothing to change.
  if (!mine && !v.override && choiceOf(v.final) === k && !unsure(v)) return
  acting.value = new Set(acting.value).add(v.key)
  try { await send({ vehicles: [{ key: v.key, verdict: mine ? null : k }] }) }
  catch (e) { fail(e) }
  finally { const n = new Set(acting.value); n.delete(v.key); acting.value = n }
}
async function markCars(list: ScannedVehicle[], verdict: FinalVerdict | null, what: string) {
  if (!list.length || rechecking.value) return
  const before = list.map(v => ({ key: v.key, verdict: v.override }))
  try {
    await send({ vehicles: list.map(v => ({ key: v.key, verdict })) })
    toast.success(verdict ? `${what} marked as “${VERDICT_META[verdict].label}”` : `${what} back to the scanner’s call`, {
      duration: 12_000,
      action: { label: 'Undo', onClick: () => send({ vehicles: before }).then(() => { toast('Undone') }).catch(e => fail(e, 'Could not undo')) },
    })
  } catch (e) { fail(e) }
}
const markGroup = (g: Group, k: FinalVerdict) => markCars(g.cars, k, plural(g.cars.length))
async function setListing(list: ScannedVehicle[], ad: boolean | null) {
  if (!list.length) return
  const before = list.map(v => ({ key: v.key, ad: v.listing === 'ad' ? true : v.listing === 'vehicle' ? false : null }))
  try {
    await send({ listings: list.map(v => ({ key: v.key, ad })) })
    toast.success(ad === true ? `${plural(list.length)} left out — not counted` : ad === false ? `${plural(list.length)} counted as vehicles` : 'Back to the scanner’s call', { duration: 12_000, action: { label: 'Undo', onClick: () => send({ listings: before }).then(() => { toast('Undone') }).catch(e => fail(e, 'Could not undo')) } })
  } catch (e) { fail(e) }
}
function toggleStock(v: boolean) { send({ countStockAsMissing: v }).catch(e => fail(e)) }

// ── Select several (or all) and mark them in one go ──
const picked = ref<Set<string>>(new Set())
const pickedList = computed(() => r.value.vehicles.filter(v => picked.value.has(v.key)))
const pickedCount = computed(() => pickedList.value.length)
const allPicked = computed(() => filtered.value.length > 0 && filtered.value.every(v => picked.value.has(v.key)))
const somePicked = computed(() => filtered.value.some(v => picked.value.has(v.key)))
const pickedHasChange = computed(() => pickedList.value.some(v => v.override))
const pickedAds = computed(() => pickedList.value.filter(isAdCard).length)
let lastPicked: string | null = null
/** Tick / untick one vehicle; with Shift, everything between it and the last one ticked. */
function togglePick(v: ScannedVehicle, e?: MouseEvent | KeyboardEvent) {
  const next = new Set(picked.value)
  const list = filtered.value
  const a = e?.shiftKey && lastPicked ? list.findIndex(x => x.key === lastPicked) : -1
  const b = list.findIndex(x => x.key === v.key)
  if (a >= 0 && b >= 0 && a !== b) { for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(list[i]!.key) }
  else if (next.has(v.key)) next.delete(v.key)
  else next.add(v.key)
  lastPicked = v.key
  picked.value = next
}
const groupPicked = (g: Group) => g.cars.every(c => picked.value.has(c.key))
function pickGroup(g: Group) { const next = new Set(picked.value); const on = !groupPicked(g); for (const c of g.cars) { if (on) next.add(c.key); else next.delete(c.key) } picked.value = next }
/** Every vehicle in the current view (tab, page and search) — not only the ones scrolled into sight. */
function pickAll(on: boolean) {
  const next = new Set(picked.value)
  for (const v of filtered.value) { if (on) next.add(v.key); else next.delete(v.key) }
  picked.value = next
}
function clearPicked() { picked.value = new Set(); lastPicked = null }
watch(() => r.value.scanId, () => { clearPicked(); opened.value = new Set() })
async function markPicked(verdict: FinalVerdict | null) { const list = pickedList.value; clearPicked(); await markCars(list, verdict, plural(list.length)) }
async function markPickedListing(ad: boolean) { const list = pickedList.value; clearPicked(); await setListing(list, ad) }

// ── Everything a person changed on this crawl ──
const changes = computed(() => r.value.vehicles.filter(v => v.override || v.listing).length + r.value.clusters.filter(c => c.override).length)
async function resetAll() {
  const before = {
    vehicles: r.value.vehicles.filter(v => v.override).map(v => ({ key: v.key, verdict: v.override })),
    clusters: r.value.clusters.filter(c => c.override).map(c => ({ id: c.id, verdict: c.override })),
    listings: r.value.vehicles.filter(v => v.listing).map(v => ({ key: v.key, ad: v.listing === 'ad' })),
  }
  const n = changes.value
  try {
    await send({ reset: true })
    clearPicked()
    toast.success(`${n} change${n === 1 ? '' : 's'} taken back — these are the scanner’s own calls`, { duration: 15_000, action: { label: 'Undo', onClick: () => send(before).then(() => { toast('Your changes are back') }).catch(e => fail(e, 'Could not undo')) } })
  } catch (e) { fail(e) }
}

async function recheckPhotos() {
  if (!props.recheck || rechecking.value) return
  rechecking.value = true
  try {
    await chain
    const x = await props.recheck()
    clearPicked()
    if (x) toast.success('Photos checked again', { description: x.after.withoutReal === x.before.withoutReal ? `Still ${x.after.withoutReal} without a real photo.` : `Without a real photo: ${x.before.withoutReal} → ${x.after.withoutReal}.`, duration: 12_000 })
  } catch (e) { fail(e, 'The photos could not be checked again') } finally { rechecking.value = false }
}

// ── Saved rules (asked for, never automatic): "always treat this picture as…" for every dealership ──
const rules = ref<ImageRule[]>([])
const rulesOpen = ref(false)
async function loadRules() { try { rules.value = (await props.listRules()).rules } catch {} }
onMounted(loadRules)
async function remember(v: ScannedVehicle, verdict: FinalVerdict) {
  const i = img(v)
  if (!i?.hash) return toast.error('This picture could not be measured, so it cannot be remembered')
  pending.value++
  try {
    const { rule } = await props.addRule({ scanId: r.value.scanId, imageId: i.id, verdict, thumb: i.url, label: `${VERDICT_META[verdict].label} — ${v.title}` })
    await props.review({ reapplyRules: true })
    await loadRules()
    toast.success(`Remembered: this picture is “${VERDICT_META[verdict].label}”`, { description: 'On this crawl and every future crawl, at every dealership.', duration: 12_000, action: { label: 'Undo', onClick: () => delRule(rule) } })
  } catch (e) { fail(e, 'The rule was not saved') } finally { pending.value-- }
}
const urlRule = ref({ text: '', verdict: 'placeholder' as FinalVerdict })
async function addUrlRule() {
  if (!urlRule.value.text.trim()) return
  pending.value++
  try { await props.addRule({ urlContains: urlRule.value.text.trim(), verdict: urlRule.value.verdict }); urlRule.value.text = ''; await props.review({ reapplyRules: true }); await loadRules(); toast.success('Rule added and applied to this crawl') }
  catch (e) { fail(e, 'The rule was not added') } finally { pending.value-- }
}
async function delRule(rule: { id: string }) {
  pending.value++
  try { await props.removeRule(rule.id); await props.review({ reapplyRules: true }); await loadRules(); toast('Rule removed — this crawl was judged again without it') }
  catch (e) { fail(e, 'The rule was not removed') } finally { pending.value-- }
}
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }
/** The label on a car: what counts now. */
const labelOf = (v: ScannedVehicle) => VERDICT_META[choiceOf(v.final)]
/** A button is "pressed" for a decided car; where the scanner is not sure, its guess is only outlined. */
const pressed = (v: ScannedVehicle, k: FinalVerdict) => !isAdCard(v) && !unsure(v) && choiceOf(v.final) === k
const guessed = (v: ScannedVehicle, k: FinalVerdict) => !isAdCard(v) && unsure(v) && choiceOf(v.final) === k
const usedLine = computed(() => `${s.value.counts.usedMissingPhotos} of ${s.value.counts.usedTotal}`)
const newLine = computed(() => `${s.value.counts.newMissingPhotos} of ${s.value.counts.newTotal}`)
</script>

<template>
  <!-- Desktop: fixed frame, the vehicle list scrolls. Phone / tablet: the whole screen scrolls as one page. -->
  <div class="flex flex-col h-full min-h-0 overflow-y-auto lg:overflow-hidden">
    <!-- 1 · The headline -->
    <header class="shrink-0 border-b bg-card p-2 flex flex-wrap items-center gap-x-6 gap-y-2">
      <div class="flex items-center gap-3 min-w-0">
        <p class="text-4xl font-bold tabular-nums leading-none" :class="tone">{{ s.withoutRealPct ?? 0 }}%</p>
        <div class="min-w-0">
          <p class="text-sm font-semibold leading-snug"><span class="tabular-nums">{{ s.withoutReal }}</span> of <span class="tabular-nums">{{ s.total }}</span> vehicles have no real photo</p>
          <p class="text-xs text-muted-foreground tabular-nums">
            Pre-owned <b class="text-foreground">{{ usedLine }}</b><template v-if="s.counts.newTotal"> · New <b class="text-foreground">{{ newLine }}</b></template><template v-if="blurryCount"> · {{ blurryCount }} blurry (not counted)</template><template v-if="adCount"> · {{ adCount }} ad{{ adCount === 1 ? '' : 's' }} left out</template>
          </p>
        </div>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <span v-if="busy && !rechecking" class="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" role="status"><Loader2 class="size-3.5 animate-spin" /> Saving…</span>
        <label class="inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs select-none cursor-pointer" title="On: a stock image counts as “no real photo” in the headline, the report and the email. Off: only cars with no photo count.">
          <span>Count stock images as missing</span><Switch :model-value="r.countStockAsMissing" :disabled="rechecking" aria-label="Count stock images as missing" @update:model-value="toggleStock" />
        </label>
        <Button v-if="recheck" size="sm" variant="outline" class="h-8 gap-1.5 text-xs" :disabled="rechecking" title="Download and judge every photo again with the latest checks. The dealer’s list is not crawled again." @click="recheckPhotos"><Loader2 v-if="rechecking" class="size-3.5 animate-spin" /><RefreshCw v-else class="size-3.5" /> {{ rechecking ? 'Checking…' : 'Check photos again' }}</Button>
        <Button size="sm" variant="outline" class="h-8 gap-1.5 text-xs" @click="rulesOpen = true"><Brain class="size-3.5" /> Saved rules<span v-if="rules.length" class="tabular-nums text-muted-foreground">{{ rules.length }}</span></Button>
        <Button v-if="changes" size="sm" variant="ghost" class="h-8 gap-1.5 text-xs" :disabled="rechecking" title="Take back every change made by hand on this crawl" @click="resetAll"><RotateCcw class="size-3.5" /> Reset my changes<span class="tabular-nums text-muted-foreground">{{ changes }}</span></Button>
      </div>
      <p v-if="r.advertised && r.advertised > s.total" class="basis-full rounded-md bg-amber-500/10 px-2 py-1 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
        Checked <b>{{ s.total }}</b> of the <b>{{ r.advertised }}</b> vehicles the site lists — {{ r.advertised - s.total }} not reached{{ coverage?.blocked?.length ? ` (the site blocked result page ${coverage!.blocked.map((b: any) => b.page).join(', ')})` : '' }}. The % is of the {{ s.total }} checked.
      </p>
    </header>

    <!-- Things to know before trusting the numbers (only when there is something) -->
    <div v-if="rechecking" role="status" class="shrink-0 border-b bg-sky-500/10 px-3 py-2 text-xs flex items-center gap-2"><Loader2 class="size-4 animate-spin text-sky-600" /><p><b>Checking every photo again…</b> this takes about a minute. The dealer’s list is not crawled again, and your own changes are kept.</p></div>
    <div v-if="results.unreliable" role="alert" class="shrink-0 border-b border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm flex items-start gap-2">
      <AlertTriangle class="size-5 text-rose-600 dark:text-rose-400 shrink-0 mt-px" />
      <p class="leading-snug"><span class="font-semibold">These numbers are not reliable.</span> {{ results.unreliable }}</p>
    </div>
    <div v-if="aiOff && !rechecking" role="status" class="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs flex items-start gap-2">
      <Sparkles class="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-px" />
      <p class="leading-snug"><span class="font-semibold">The AI did not look at these photos</span> — expect more to correct by hand. {{ aiOff }}</p>
    </div>
    <CrmScannerScopeReport v-if="scope.length" :rows="scope" class="shrink-0 border-b bg-card" />

    <!-- 2 · One tab per answer -->
    <div role="tablist" aria-label="Show" class="shrink-0 flex gap-2 overflow-x-auto p-2 border-b bg-muted/20">
      <button
        v-for="t in tabs" :key="t.k" type="button" role="tab" :aria-selected="tab === t.k"
        class="shrink-0 min-w-[132px] rounded-xl border-2 bg-card px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="tab === t.k ? 'border-primary shadow-sm' : 'border-border hover:border-foreground/30'" @click="tab = t.k"
      >
        <span class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" :class="tab === t.k ? 'text-foreground' : 'text-muted-foreground'"><span class="size-2 rounded-full" :class="t.dot" /> {{ t.label }}</span>
        <span class="block text-2xl font-bold tabular-nums leading-tight">{{ t.n }}</span>
        <span class="block text-[11px] text-muted-foreground whitespace-nowrap">{{ t.sub }}</span>
      </button>
    </div>

    <!-- 3 · The cars -->
    <section class="lg:flex-1 lg:min-h-0 flex flex-col">
      <div class="shrink-0 flex flex-wrap items-center gap-2 p-2 border-b">
        <label class="inline-flex h-8 items-center gap-2 rounded-lg border bg-card px-2.5 text-xs font-medium select-none transition-colors" :class="filtered.length ? 'cursor-pointer hover:bg-muted/50' : 'opacity-50 pointer-events-none'" title="Tick every vehicle in this view to mark them in one go. Tip: tick one, then Shift-click another to tick everything in between.">
          <Checkbox :model-value="allPicked ? true : (somePicked ? 'indeterminate' : false)" :disabled="!filtered.length" aria-label="Select every vehicle in this view" @update:model-value="pickAll(!allPicked)" />
          <span class="tabular-nums">{{ allPicked ? `All ${filtered.length} selected` : `Select all ${filtered.length}` }}</span>
        </label>
        <p class="hidden xl:flex items-center gap-1.5 text-[11px] text-muted-foreground"><HelpCircle class="size-3.5" /> Wrong call? Press the right button on the car. Tick cars to change many at once.</p>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <Select v-if="crawlPages.length > 1" v-model="page"><SelectTrigger class="h-8 w-[190px] text-xs" aria-label="Inventory page"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All {{ crawlPages.length }} pages</SelectItem><SelectItem v-for="p in crawlPages" :key="p.url" :value="p.url">{{ p.label }} · {{ p.withoutReal }} of {{ p.total }}</SelectItem></SelectContent></Select>
          <Select v-model="cond"><SelectTrigger class="h-8 w-[118px] text-xs" aria-label="New or used"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">New + used</SelectItem><SelectItem value="used">Pre-owned</SelectItem><SelectItem value="new">New</SelectItem></SelectContent></Select>
          <div class="relative"><Search class="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input v-model="q" placeholder="Search title, VIN, stock…" class="h-8 w-44 sm:w-56 pl-8 text-xs" aria-label="Search the vehicles" /></div>
        </div>
      </div>

      <div class="lg:flex-1 lg:min-h-0 lg:overflow-y-auto p-2">
        <div v-if="!filtered.length" class="py-20 text-center text-sm text-muted-foreground">{{ q ? `No vehicle matches “${q}” here.` : 'Nothing here.' }}</div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-2">
          <template v-for="row in rows.slice(0, shown)" :key="row.type === 'group' ? row.g.id : row.v.key">
            <!-- Several cars, one picture (or one stock background): decide once -->
            <article v-if="row.type === 'group'" class="rounded-xl border-2 border-dashed bg-card overflow-hidden flex flex-col" :class="groupPicked(row.g) ? 'border-primary' : 'border-foreground/25'">
              <div class="relative aspect-[4/3] bg-muted/50 overflow-hidden">
                <img v-if="row.g.url" :src="row.g.url" alt="" class="size-full object-cover" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="onBroken(row.g.url)">
                <div v-else class="size-full flex items-center justify-center text-muted-foreground"><ImageOff class="size-7" /></div>
                <button type="button" role="checkbox" :aria-checked="groupPicked(row.g)" :aria-label="`Select these ${row.g.cars.length} vehicles`" class="absolute top-2 left-2 z-[1] inline-flex size-6 items-center justify-center rounded-md border-2 shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :class="groupPicked(row.g) ? 'bg-primary border-primary text-primary-foreground' : 'bg-background/95 border-foreground/40 text-transparent hover:border-primary hover:text-primary/50'" @click.stop="pickGroup(row.g)"><Check class="size-4" stroke-width="3" /></button>
                <span class="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-black/70 px-2.5 py-1.5 text-xs font-semibold text-white"><Layers class="size-3.5 shrink-0" /> {{ row.g.kind === 'picture' ? 'One picture' : 'One background' }} on {{ row.g.cars.length }} cars</span>
              </div>
              <div class="p-2.5 flex-1 flex flex-col gap-1">
                <p class="text-sm font-medium leading-snug">{{ row.g.cars.length }} cars · {{ models(row.g) }}</p>
                <p class="text-[11px] text-muted-foreground leading-snug">{{ row.g.kind === 'picture' ? 'The very same picture on each of them. A real photo belongs to one car.' : 'A different car on the same stock background each time — not photos of these cars.' }}</p>
                <p v-if="row.g.final === 'mixed'" class="text-[11px] font-medium text-amber-700 dark:text-amber-300">Marked differently car by car — pick one to make them all the same.</p>
              </div>
              <div class="px-2 pb-2">
                <p class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">All {{ row.g.cars.length }} are</p>
                <div class="grid grid-cols-4 gap-1" role="group" :aria-label="`What these ${row.g.cars.length} cars show`">
                  <button v-for="k in CHOICES" :key="k" type="button" :aria-pressed="row.g.final === k" :disabled="rechecking" class="rounded-md border px-1 py-1.5 text-[11px] font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" :class="row.g.final === k ? VERDICT_META[k].solid : 'bg-background text-muted-foreground hover:text-foreground hover:border-foreground/40'" @click="markGroup(row.g, k)">{{ VERDICT_META[k].short }}</button>
                </div>
              </div>
              <footer class="border-t px-2 py-1.5">
                <button type="button" class="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline" :aria-expanded="row.open" @click="toggleGroup(row.g.id)"><component :is="row.open ? ChevronUp : ChevronDown" class="size-3.5" /> {{ row.open ? 'Hide' : 'Show' }} the {{ row.g.cars.length }} cars</button>
              </footer>
            </article>

            <!-- One car -->
            <article v-else class="group rounded-xl border bg-card overflow-hidden flex flex-col [content-visibility:auto] [contain-intrinsic-size:340px] transition-shadow" :class="[picked.has(row.v.key) ? 'ring-2 ring-primary border-primary' : '', row.inGroup ? 'bg-muted/30' : '', acting.has(row.v.key) ? 'opacity-70' : '']">
              <div class="relative aspect-[4/3] bg-muted/50 overflow-hidden" :class="pickedCount && 'cursor-pointer'" @click="pickedCount ? togglePick(row.v, $event) : undefined">
                <img v-if="photoSrc(row.v)" :src="photoSrc(row.v)" :alt="row.v.title" class="size-full object-cover" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="onBroken(photoSrc(row.v))">
                <div v-else class="size-full flex flex-col items-center justify-center gap-1 text-muted-foreground"><ImageOff class="size-7" /><span class="text-[11px]">{{ row.v.image?.url ? 'The picture did not load' : 'No picture on the listing' }}</span></div>
                <span v-if="picked.has(row.v.key)" class="absolute inset-0 bg-primary/10 pointer-events-none" aria-hidden="true" />
                <button
                  type="button" role="checkbox" :aria-checked="picked.has(row.v.key)" :aria-label="`Select ${row.v.title || 'this vehicle'}`"
                  class="absolute top-2 left-2 z-[1] inline-flex size-6 items-center justify-center rounded-md border-2 shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :class="picked.has(row.v.key) ? 'bg-primary border-primary text-primary-foreground' : 'bg-background/95 border-foreground/40 text-transparent hover:border-primary hover:text-primary/50'"
                  @click.stop="togglePick(row.v, $event)" @keydown.space.prevent="togglePick(row.v, $event)"
                ><Check class="size-4" stroke-width="3" /></button>
                <span v-if="isAdCard(row.v)" class="absolute top-2 left-10 rounded-full bg-zinc-900/85 px-2 py-0.5 text-[10px] font-semibold text-white">Ad — not counted</span>
                <span v-else-if="unsure(row.v)" class="absolute top-2 left-10 inline-flex items-center gap-1 rounded-full bg-background/95 px-2 py-0.5 text-[10px] font-semibold text-foreground shadow-sm ring-1 ring-sky-500/60"><HelpCircle class="size-3 text-sky-500" /> Not sure — is it {{ labelOf(row.v).short.toLowerCase() }}?</span>
                <span v-else class="absolute top-2 left-10 inline-flex items-center gap-1.5 rounded-full bg-background/95 px-2 py-0.5 text-[10px] font-semibold text-foreground shadow-sm ring-1 ring-border"><span class="size-1.5 rounded-full" :class="labelOf(row.v).dot" /> {{ labelOf(row.v).label }}<template v-if="row.v.override"> · by you <Pencil class="size-2.5 text-muted-foreground" /></template></span>
                <span v-if="img(row.v)?.text" class="absolute bottom-2 left-2 right-2 truncate rounded bg-black/60 text-white px-1.5 py-0.5 text-[10px]" title="Text read on the picture">“{{ img(row.v)!.text }}”</span>
              </div>
              <div class="p-2.5 flex-1 flex flex-col gap-1">
                <p class="text-sm font-medium leading-snug line-clamp-2" :title="row.v.title">{{ row.v.title || 'Vehicle' }}</p>
                <p class="text-xs text-muted-foreground flex flex-wrap gap-x-2">
                  <span v-if="row.v.price" class="text-foreground font-medium">{{ row.v.price }}</span>
                  <span v-if="row.v.condition" class="capitalize">{{ row.v.condition === 'used' ? 'Pre-owned' : row.v.condition }}</span>
                  <span v-if="row.v.stock">#{{ row.v.stock }}</span>
                </p>
                <p class="text-[11px] text-muted-foreground line-clamp-2 mt-auto" :title="[row.v.adReason, ...row.v.reasons].filter(Boolean).join('\n')">{{ isAdCard(row.v) ? (row.v.adReason || 'Marked as an ad by you') : row.v.override ? 'Set by you.' : row.v.reasons[0] }}</p>
              </div>
              <!-- One click says what this picture is -->
              <div class="px-2 pb-2 grid grid-cols-4 gap-1" role="group" :aria-label="`What the picture of ${row.v.title || 'this vehicle'} is`">
                <button
                  v-for="k in CHOICES" :key="k" type="button" :aria-pressed="pressed(row.v, k)" :disabled="rechecking || isAdCard(row.v)"
                  :title="row.v.override && choiceOf(row.v.override) === k ? 'Set by you — press again to take it back' : guessed(row.v, k) ? `The scanner’s guess — press to confirm: ${VERDICT_META[k].label}` : `This is: ${VERDICT_META[k].label}`"
                  class="rounded-md border px-1 py-1.5 text-[11px] font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                  :class="pressed(row.v, k) ? VERDICT_META[k].solid : guessed(row.v, k) ? 'bg-background text-foreground border-dashed border-sky-500' : 'bg-background text-muted-foreground hover:text-foreground hover:border-foreground/40'"
                  @click="choose(row.v, k)"
                >{{ VERDICT_META[k].short }}</button>
              </div>
              <footer class="border-t px-1.5 py-1 flex items-center gap-0.5">
                <Popover>
                  <PopoverTrigger as-child><Button size="sm" variant="ghost" class="h-7 px-1.5 text-[11px] gap-1 text-muted-foreground"><Info class="size-3.5" /> Why</Button></PopoverTrigger>
                  <PopoverContent class="w-80 text-xs space-y-2">
                    <p class="font-semibold text-sm">Why “{{ unsure(row.v) ? 'Not sure' : labelOf(row.v).label }}”</p>
                    <p v-if="row.v.override" class="text-muted-foreground">You set this. The scanner’s own call was “{{ VERDICT_META[row.v.verdict === 'review' ? row.v.suggested : row.v.verdict].label }}”:</p>
                    <ul class="space-y-1 list-disc pl-4"><li v-for="x in row.v.reasons" :key="x">{{ x }}</li></ul>
                    <p v-if="img(row.v)" class="text-muted-foreground break-all">Picture from {{ host(img(row.v)!.url) }}<span v-if="img(row.v)!.w"> · {{ img(row.v)!.w }}×{{ img(row.v)!.h }}</span><span v-if="img(row.v)!.sharp != null"> · sharpness {{ img(row.v)!.sharp }} of 100</span></p>
                  </PopoverContent>
                </Popover>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child><Button size="sm" variant="ghost" class="h-7 px-1.5 text-[11px] gap-1 text-muted-foreground" :disabled="rechecking" :aria-label="`More for ${row.v.title || 'this vehicle'}`"><MoreHorizontal class="size-3.5" /> More</Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="start" class="w-72">
                    <DropdownMenuItem v-if="row.v.override" @click="markCars([row.v], null, '1 vehicle')"><RotateCcw class="size-4" /> Take my change back</DropdownMenuItem>
                    <DropdownMenuItem v-if="!isAdCard(row.v)" @click="setListing([row.v], true)"><Ban class="size-4" /> Not a vehicle (an ad) — leave it out</DropdownMenuItem>
                    <DropdownMenuItem v-else @click="setListing([row.v], false)"><Check class="size-4" /> It is a vehicle — count it</DropdownMenuItem>
                    <template v-if="img(row.v)?.hash">
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel class="text-[11px] font-normal text-muted-foreground">Remember this exact picture — every crawl, every dealership</DropdownMenuLabel>
                      <DropdownMenuItem @click="remember(row.v, 'placeholder')"><Brain class="size-4" /> Always “No photo”</DropdownMenuItem>
                      <DropdownMenuItem @click="remember(row.v, 'stock')"><Brain class="size-4" /> Always “Stock image”</DropdownMenuItem>
                      <DropdownMenuItem @click="remember(row.v, 'real')"><Brain class="size-4" /> Always “Real photo”</DropdownMenuItem>
                    </template>
                  </DropdownMenuContent>
                </DropdownMenu>
                <a v-if="row.v.url" :href="row.v.url" target="_blank" rel="noopener" class="ml-auto inline-flex items-center gap-1 px-1.5 text-[11px] text-primary hover:underline">Listing <ExternalLink class="size-3" /></a>
              </footer>
            </article>
          </template>
        </div>
        <div v-if="rows.length > shown" class="py-3 text-center"><Button variant="outline" size="sm" @click="shown += 240">Show {{ Math.min(240, rows.length - shown) }} more</Button></div>
      </div>

      <!-- 4 · Ticked cars: mark them all in one go -->
      <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="translate-y-2 opacity-0" leave-active-class="transition duration-150 ease-in" leave-to-class="translate-y-2 opacity-0">
        <div v-if="pickedCount" role="region" aria-label="Selected vehicles" class="sticky bottom-0 z-10 lg:static shrink-0 border-t-2 border-primary bg-card p-2 flex flex-wrap items-center gap-2 shadow-[0_-10px_24px_-14px_rgba(0,0,0,0.35)]">
          <span class="inline-flex items-center gap-2 text-sm font-semibold"><span class="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-foreground">{{ pickedCount }}</span> selected</span>
          <button v-if="!allPicked && filtered.length > 1" type="button" class="text-xs font-medium text-primary underline-offset-2 hover:underline" @click="pickAll(true)">Select all {{ filtered.length }} in this view</button>
          <span class="hidden sm:block h-5 w-px bg-border" aria-hidden="true" />
          <span class="text-xs text-muted-foreground">Mark as</span>
          <Button v-for="k in CHOICES" :key="k" size="sm" variant="outline" class="h-8 gap-1.5 text-xs" :disabled="rechecking" @click="markPicked(k)"><span class="size-2 rounded-full" :class="VERDICT_META[k].dot" /> {{ VERDICT_META[k].label }}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child><Button size="icon" variant="outline" class="size-8" :disabled="rechecking" aria-label="More actions for the selected vehicles"><MoreHorizontal class="size-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" class="w-64">
              <DropdownMenuItem :disabled="!pickedHasChange" @click="markPicked(null)"><RotateCcw class="size-4" /> Take my changes back</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem v-if="pickedAds < pickedCount" @click="markPickedListing(true)"><Ban class="size-4" /> Not vehicles (ads) — leave out</DropdownMenuItem>
              <DropdownMenuItem v-if="pickedAds" @click="markPickedListing(false)"><Check class="size-4" /> They are vehicles — count them</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" class="ml-auto h-8 gap-1.5 text-xs" @click="clearPicked"><X class="size-3.5" /> Clear</Button>
        </div>
      </Transition>
    </section>

    <!-- Saved rules: only what someone asked the scanner to remember -->
    <Dialog v-model:open="rulesOpen">
      <DialogContent class="sm:max-w-lg max-h-[85vh] p-0 gap-0 flex flex-col overflow-hidden [&>*]:min-w-0">
        <DialogHeader class="px-5 pt-5 pb-4 border-b">
          <DialogTitle class="text-base flex items-center gap-2"><Brain class="size-4 text-violet-500" /> Saved rules</DialogTitle>
          <DialogDescription class="text-xs">Pictures the scanner was told to always treat one way — on every crawl, at every dealership. Nothing is added here unless you choose “Remember this exact picture” on a car. Removing a rule judges this crawl again without it.</DialogDescription>
        </DialogHeader>
        <div class="flex-1 min-h-0 overflow-y-auto p-2">
          <ul class="divide-y">
            <li v-for="rule in rules" :key="rule.id" class="flex items-center gap-2 px-2 py-2 text-xs">
              <img v-if="rule.thumb && !broken.has(rule.thumb)" :src="rule.thumb" alt="" class="size-12 rounded-md object-cover border shrink-0" referrerpolicy="no-referrer" @error="onBroken(rule.thumb)">
              <span v-else class="size-12 rounded-md border bg-muted flex items-center justify-center shrink-0"><Link2 class="size-4 text-muted-foreground" /></span>
              <div class="min-w-0 flex-1"><p class="truncate font-medium">{{ rule.urlContains ? `Picture address contains “${rule.urlContains}”` : rule.label }}</p><p class="text-[11px] text-muted-foreground"><span :class="VERDICT_META[rule.verdict].pill" class="rounded px-1 ring-1">{{ VERDICT_META[rule.verdict].label }}</span> · used {{ rule.hits || 0 }}×</p></div>
              <Button size="icon" variant="ghost" class="size-8 text-muted-foreground hover:text-rose-600" :aria-label="`Remove the rule ${rule.label}`" :disabled="busy" @click="delRule(rule)"><Trash2 class="size-4" /></Button>
            </li>
            <li v-if="!rules.length" class="px-2 py-8 text-center text-xs text-muted-foreground">No rules. The scanner judges every picture on its own.</li>
          </ul>
        </div>
        <div class="shrink-0 border-t p-2 space-y-1.5">
          <Label class="text-xs flex items-center gap-1"><Link2 class="size-3.5" /> Or: every picture whose address contains</Label>
          <div class="flex gap-2">
            <Input v-model="urlRule.text" placeholder="e.g. comingsoon or evoximages" class="h-8 text-xs" @keydown.enter.prevent="addUrlRule" />
            <Select v-model="urlRule.verdict"><SelectTrigger class="h-8 w-[128px] text-xs" aria-label="Treat as"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="placeholder">No photo</SelectItem><SelectItem value="stock">Stock image</SelectItem><SelectItem value="real">Real photo</SelectItem></SelectContent></Select>
            <Button size="icon" class="size-8 shrink-0" :disabled="busy || !urlRule.text.trim()" aria-label="Add rule" @click="addUrlRule"><Plus class="size-4" /></Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
