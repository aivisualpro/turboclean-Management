<script setup lang="ts">
import type { FinalVerdict, ImageGroup, ImageRule, PhotoVerdict, ScanResults, ScannedVehicle } from '~/composables/useInventoryScanner'
import { VERDICT_META } from '~/composables/useInventoryScanner'
import { ImageOff, Search, ExternalLink, Check, Brain, Layers, Trash2, Plus, Sparkles, ChevronDown, Info, ShieldCheck, Link2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/** Review screen: KPIs, every vehicle with its photo verdict + reasons, repeated-image groups, saved rules. */
const props = defineProps<{
  results: ScanResults
  review: (body: any) => Promise<void>
  listRules: () => Promise<{ rules: ImageRule[] }>
  addRule: (body: any) => Promise<any>
  removeRule: (id: string) => Promise<any>
}>()

const r = computed(() => props.results)
const s = computed(() => r.value.summary)
const FINALS: FinalVerdict[] = ['real', 'placeholder', 'stock', 'missing']
/** What people choose from: a placeholder image means the car has no photo, so they are one choice. */
const CHOICES: FinalVerdict[] = ['real', 'placeholder', 'stock']
const noPhoto = (f: FinalVerdict) => f === 'placeholder' || f === 'missing'
const noPhotoCount = computed(() => s.value.by.placeholder + s.value.by.missing)

// ── Donut ──
const segments = computed(() => {
  const total = s.value.total || 1
  let acc = 0
  return (['missing', 'placeholder', 'stock', 'real'] as FinalVerdict[]).map((k) => {
    const frac = (s.value.by[k] || 0) / total
    const seg = { k, frac, start: acc }
    acc += frac
    return seg
  }).filter(x => x.frac > 0)
})
const C = 2 * Math.PI * 52
const pct = (n: number, d: number) => d ? `${Math.round((n / d) * 1000) / 10}%` : '—'

// ── Filters ──
type Filter = 'all' | 'without' | 'nophoto' | FinalVerdict | 'review'
const filter = ref<Filter>('without')
const q = ref('')
const cond = ref<'all' | 'new' | 'used'>('all')
const shown = ref(120)
watch([filter, q, cond], () => { shown.value = 120 })
const tiles = computed(() => [
  { k: 'real' as Filter, label: 'Real photo', n: s.value.by.real, dot: VERDICT_META.real.dot, hex: VERDICT_META.real.hex, sub: '' },
  { k: 'nophoto' as Filter, label: 'No photo', n: noPhotoCount.value, dot: VERDICT_META.missing.dot, hex: VERDICT_META.missing.hex, sub: `${s.value.by.placeholder} placeholder image${s.value.by.placeholder === 1 ? '' : 's'} · ${s.value.by.missing} with no image` },
  { k: 'stock' as Filter, label: 'Stock image', n: s.value.by.stock, dot: VERDICT_META.stock.dot, hex: VERDICT_META.stock.hex, sub: r.value.countStockAsMissing ? 'counted as no photo' : 'counted as photos' },
])
const isWithout = (v: ScannedVehicle) => v.final === 'missing' || v.final === 'placeholder' || (r.value.countStockAsMissing && v.final === 'stock')
const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase()
  return r.value.vehicles.filter((v) => {
    if (filter.value === 'without' && !isWithout(v)) return false
    if (filter.value === 'review' && !(v.verdict === 'review' && !v.override)) return false
    if (filter.value === 'nophoto' && !noPhoto(v.final)) return false
    if (FINALS.includes(filter.value as FinalVerdict) && v.final !== filter.value) return false
    if (cond.value === 'new' && v.condition !== 'new') return false
    if (cond.value === 'used' && v.condition === 'new') return false
    if (needle && !`${v.title} ${v.vin} ${v.stock} ${v.price}`.toLowerCase().includes(needle)) return false
    return true
  })
})
const FILTERS = computed(() => [
  { k: 'without' as Filter, label: 'Without real photo', n: s.value.withoutReal },
  { k: 'all' as Filter, label: 'All', n: s.value.total },
  { k: 'real' as Filter, label: 'Real', n: s.value.by.real },
  { k: 'nophoto' as Filter, label: 'No photo', n: noPhotoCount.value },
  { k: 'stock' as Filter, label: 'Stock', n: s.value.by.stock },
  { k: 'review' as Filter, label: 'Needs review', n: s.value.review },
])

const img = (v: ScannedVehicle) => v.imageId ? r.value.images[v.imageId] : null
/** Photos are not stored — the dealer's own image is shown. Track the ones their server refuses. */
const broken = ref(new Set<string>())
const photoSrc = (v: ScannedVehicle) => { const u = img(v)?.url || v.image?.url || ''; return u && !broken.value.has(u) ? u : '' }
function onBroken(u: string) { const next = new Set(broken.value); next.add(u); broken.value = next }
const busy = ref(false)
async function setVerdict(v: ScannedVehicle, verdict: FinalVerdict | null) {
  busy.value = true
  try { await props.review({ vehicles: [{ key: v.key, verdict }] }) } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not update') } finally { busy.value = false }
}
async function acceptAllReview() {
  const list = r.value.vehicles.filter(v => v.verdict === 'review' && !v.override)
  if (!list.length) return
  busy.value = true
  try { await props.review({ vehicles: list.map(v => ({ key: v.key, verdict: v.suggested })) }); toast.success(`${list.length} accepted as suggested`) } finally { busy.value = false }
}
async function toggleStock(v: boolean) {
  busy.value = true
  try { await props.review({ countStockAsMissing: v }) } finally { busy.value = false }
}

// ── Repeated images & rules ──
async function setGroup(g: ImageGroup, verdict: FinalVerdict | null) {
  busy.value = true
  try { await props.review({ clusters: [{ id: g.id, verdict }] }) } finally { busy.value = false }
}
const groupFinal = (g: ImageGroup) => { const f = g.override || (g.verdict === 'review' ? null : g.verdict); return f === 'missing' ? 'placeholder' : f }
async function remember(g: ImageGroup) {
  const verdict = groupFinal(g)
  if (!verdict || !g.hash) return
  busy.value = true
  try {
    await props.addRule({ hash: g.hash, verdict, thumb: g.url, label: `${VERDICT_META[verdict].label} (seen on ${g.vehicles} vehicles)` })
    await props.review({ reapplyRules: true })
    await loadRules()
    toast.success('Remembered — this image will be recognised on every dealership from now on')
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save the rule') } finally { busy.value = false }
}
async function rememberVehicle(v: ScannedVehicle, verdict: FinalVerdict) {
  const i = img(v)
  if (!i?.hash) return toast.error('This image could not be fingerprinted')
  busy.value = true
  try {
    await props.addRule({ hash: i.hash, verdict, thumb: i.url, label: `${VERDICT_META[verdict].label} — ${v.title}` })
    await props.review({ reapplyRules: true })
    await loadRules()
    toast.success('Rule saved — applied to this scan and every future scan')
  } finally { busy.value = false }
}
const rules = ref<ImageRule[]>([])
const showRules = ref(false)
async function loadRules() { try { rules.value = (await props.listRules()).rules } catch {} }
onMounted(loadRules)
const urlRule = ref({ text: '', verdict: 'placeholder' as FinalVerdict })
async function addUrlRule() {
  if (!urlRule.value.text.trim()) return
  busy.value = true
  try { await props.addRule({ urlContains: urlRule.value.text.trim(), verdict: urlRule.value.verdict }); urlRule.value.text = ''; await props.review({ reapplyRules: true }); await loadRules(); toast.success('Rule added and applied') }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not add the rule') } finally { busy.value = false }
}
async function delRule(rule: ImageRule) {
  busy.value = true
  try { await props.removeRule(rule.id); await props.review({ reapplyRules: true }); await loadRules() } finally { busy.value = false }
}
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }
const conf = (v: ScannedVehicle) => `${Math.round((v.confidence || 0) * 100)}%`
const pillFor = (v: ScannedVehicle): PhotoVerdict => v.override ? v.override : v.verdict === 'review' ? 'review' : v.final
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- KPI band -->
    <section class="shrink-0 grid grid-cols-1 xl:grid-cols-[minmax(0,330px)_minmax(0,1fr)_minmax(0,280px)] gap-2 p-2 border-b bg-muted/20">
      <div class="rounded-xl border bg-card p-3 flex items-center gap-4">
        <svg viewBox="0 0 120 120" class="size-28 shrink-0 -rotate-90" role="img" :aria-label="`${s.withoutRealPct ?? 0}% of vehicles without a real photo`">
          <circle cx="60" cy="60" r="52" fill="none" class="stroke-muted" stroke-width="12" />
          <circle
            v-for="seg in segments" :key="seg.k" cx="60" cy="60" r="52" fill="none" :stroke="VERDICT_META[seg.k].hex" stroke-width="12"
            :stroke-dasharray="`${Math.max(0, seg.frac * C - 1.5)} ${C}`" :stroke-dashoffset="-seg.start * C" stroke-linecap="butt" class="transition-all duration-700"
          />
        </svg>
        <div class="min-w-0">
          <p class="text-[11px] uppercase tracking-wider text-muted-foreground">Without a real photo</p>
          <p class="text-4xl font-bold tabular-nums leading-tight" :class="(s.withoutRealPct ?? 0) >= 25 ? 'text-rose-600' : (s.withoutRealPct ?? 0) >= 10 ? 'text-amber-600' : 'text-emerald-600'">{{ s.withoutRealPct ?? 0 }}%</p>
          <p class="text-xs text-muted-foreground"><span class="font-semibold text-foreground tabular-nums">{{ s.withoutReal }}</span> of {{ s.total }} vehicles</p>
          <p v-if="r.advertised" class="text-[11px] text-muted-foreground mt-1">Site advertises {{ r.advertised }} · scanned {{ s.total }} on {{ r.pages.length }} page{{ r.pages.length === 1 ? '' : 's' }}</p>
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button v-for="t in tiles" :key="t.k" type="button" class="rounded-xl border bg-card p-3 text-left hover:bg-muted/40 transition-colors" :class="filter === t.k && 'ring-2 ring-primary'" @click="filter = t.k">
          <div class="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground"><span class="size-2 rounded-full" :class="t.dot" /> {{ t.label }}</div>
          <p class="text-2xl font-bold tabular-nums mt-1">{{ t.n }}</p>
          <div class="h-1.5 rounded-full bg-muted mt-1.5 overflow-hidden"><div class="h-full rounded-full transition-all duration-700" :style="{ width: pct(t.n, s.total), background: t.hex }" /></div>
          <p class="text-[11px] text-muted-foreground mt-1 tabular-nums">{{ pct(t.n, s.total) }}<span v-if="t.sub"> · {{ t.sub }}</span></p>
        </button>
      </div>
      <div class="rounded-xl border bg-card p-3 text-sm space-y-1.5">
        <p class="text-[11px] uppercase tracking-wider text-muted-foreground">What gets saved</p>
        <div class="flex justify-between"><span>Used</span><span class="tabular-nums"><b>{{ s.counts.usedMissingPhotos }}</b> / {{ s.counts.usedTotal }} · {{ s.usedPct ?? 0 }}%</span></div>
        <div class="flex justify-between"><span>New</span><span class="tabular-nums"><b>{{ s.counts.newMissingPhotos }}</b> / {{ s.counts.newTotal }} · {{ s.newPct ?? 0 }}%</span></div>
        <label class="flex items-center justify-between gap-2 pt-1 border-t text-xs"><span>Count stock images as no photo</span><Switch :model-value="r.countStockAsMissing" :disabled="busy" @update:model-value="toggleStock" /></label>
      </div>
    </section>

    <div class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
      <!-- Vehicles -->
      <section class="min-h-0 flex flex-col">
        <div class="shrink-0 flex flex-wrap items-center gap-2 p-2 border-b">
          <div role="tablist" class="inline-flex flex-wrap rounded-lg border bg-muted/40 p-0.5">
            <button v-for="f in FILTERS" :key="f.k" type="button" role="tab" :aria-selected="filter === f.k" class="rounded-md px-2.5 py-1 text-xs font-medium inline-flex items-center gap-1.5 transition-colors" :class="filter === f.k ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'" @click="filter = f.k">
              {{ f.label }} <span class="tabular-nums opacity-70">{{ f.n }}</span>
            </button>
          </div>
          <Button v-if="s.review" size="sm" variant="outline" class="h-7 text-xs gap-1" :disabled="busy" @click="acceptAllReview"><Check class="size-3.5" /> Accept {{ s.review }} suggestions</Button>
          <div class="ml-auto flex items-center gap-2">
            <Select v-model="cond"><SelectTrigger class="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">New + used</SelectItem><SelectItem value="used">Used</SelectItem><SelectItem value="new">New</SelectItem></SelectContent></Select>
            <div class="relative"><Search class="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input v-model="q" placeholder="Search title, VIN, stock…" class="h-8 w-56 pl-8 text-xs" /></div>
          </div>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto p-2">
          <div v-if="!filtered.length" class="py-20 text-center text-sm text-muted-foreground">Nothing in this view.</div>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
            <article v-for="v in filtered.slice(0, shown)" :key="v.key" class="group rounded-xl border bg-card overflow-hidden flex flex-col [content-visibility:auto] [contain-intrinsic-size:300px]" :class="isWithout(v) && 'ring-1 ' + VERDICT_META[v.final].ring">
              <div class="relative aspect-[4/3] bg-muted/50 overflow-hidden">
                <img v-if="photoSrc(v)" :src="photoSrc(v)" :alt="v.title" class="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="onBroken(photoSrc(v))">
                <div v-else class="size-full flex flex-col items-center justify-center gap-1 text-muted-foreground"><ImageOff class="size-7" /><span class="text-[11px]">{{ v.image?.url ? 'Could not load' : 'No photo' }}</span></div>
                <span class="absolute top-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 backdrop-blur bg-background/80" :class="VERDICT_META[pillFor(v)].pill">{{ v.override ? `${VERDICT_META[v.override].short} · set by you` : VERDICT_META[pillFor(v)].short }}{{ !v.override && v.verdict === 'review' ? ` → ${VERDICT_META[v.suggested].short}?` : '' }}</span>
                <span v-if="!v.override" class="absolute top-2 right-2 rounded-full bg-black/55 text-white px-1.5 py-0.5 text-[10px] tabular-nums" title="How sure the scanner is">{{ conf(v) }}</span>
                <span v-if="img(v)?.text" class="absolute bottom-2 left-2 right-2 truncate rounded bg-black/60 text-white px-1.5 py-0.5 text-[10px]" title="Text read on the image">“{{ img(v)!.text }}”</span>
              </div>
              <div class="p-2.5 flex-1 flex flex-col gap-1">
                <p class="text-sm font-medium leading-snug line-clamp-2" :title="v.title">{{ v.title || 'Vehicle' }}</p>
                <p class="text-xs text-muted-foreground flex flex-wrap gap-x-2">
                  <span v-if="v.price" class="text-foreground font-medium">{{ v.price }}</span>
                  <span v-if="v.condition" class="capitalize">{{ v.condition }}</span>
                  <span v-if="v.stock">#{{ v.stock }}</span>
                </p>
                <p v-if="v.vin" class="text-[10px] font-mono text-muted-foreground truncate">{{ v.vin }}</p>
                <p class="text-[11px] text-muted-foreground line-clamp-2 mt-auto" :title="v.reasons.join('\n')">{{ v.reasons[0] }}</p>
              </div>
              <footer class="border-t px-2 py-1.5 flex items-center gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger as-child><Button size="sm" variant="ghost" class="h-7 px-2 text-xs gap-1" :disabled="busy">Mark as <ChevronDown class="size-3" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="start" class="w-60">
                    <DropdownMenuItem v-for="k in CHOICES" :key="k" @click="setVerdict(v, k)"><span class="size-2 rounded-full" :class="VERDICT_META[k].dot" /> {{ VERDICT_META[k].label }}<Check v-if="k === 'placeholder' ? noPhoto(v.final) : v.final === k" class="size-3.5 ml-auto" /></DropdownMenuItem>
                    <DropdownMenuItem v-if="v.override" @click="setVerdict(v, null)">Undo my change</DropdownMenuItem>
                    <template v-if="img(v)?.hash">
                      <DropdownMenuSeparator />
                      <DropdownMenuItem @click="rememberVehicle(v, 'placeholder')"><Brain class="size-4" /> Always treat this image as “No photo”</DropdownMenuItem>
                      <DropdownMenuItem @click="rememberVehicle(v, 'stock')"><Brain class="size-4" /> Always treat this image as stock</DropdownMenuItem>
                      <DropdownMenuItem @click="rememberVehicle(v, 'real')"><Brain class="size-4" /> Always treat this image as real</DropdownMenuItem>
                    </template>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Popover>
                  <PopoverTrigger as-child><Button size="icon" variant="ghost" class="size-7" aria-label="Why"><Info class="size-3.5" /></Button></PopoverTrigger>
                  <PopoverContent class="w-80 text-xs space-y-2">
                    <p class="font-semibold text-sm">Why “{{ VERDICT_META[pillFor(v)].label }}”</p>
                    <ul class="space-y-1 list-disc pl-4"><li v-for="x in v.reasons" :key="x">{{ x }}</li></ul>
                    <p v-if="img(v)" class="text-muted-foreground break-all">Image: {{ host(img(v)!.url) }}<span v-if="img(v)!.w"> · {{ img(v)!.w }}×{{ img(v)!.h }}</span></p>
                    <p class="text-muted-foreground">Page {{ v.page }} · confidence {{ conf(v) }}</p>
                  </PopoverContent>
                </Popover>
                <a v-if="v.url" :href="v.url" target="_blank" rel="noopener" class="ml-auto inline-flex items-center gap-1 text-[11px] text-primary hover:underline">Listing <ExternalLink class="size-3" /></a>
              </footer>
            </article>
          </div>
          <div v-if="filtered.length > shown" class="py-3 text-center"><Button variant="outline" size="sm" @click="shown += 240">Show {{ Math.min(240, filtered.length - shown) }} more of {{ filtered.length - shown }}</Button></div>
        </div>
      </section>

      <!-- Repeated images + rules -->
      <aside class="min-h-0 overflow-y-auto border-t lg:border-t-0 lg:border-l p-2 space-y-2 bg-muted/10">
        <div class="rounded-xl border bg-card overflow-hidden">
          <header class="px-3 py-2 border-b flex items-center gap-2"><Layers class="size-4 text-muted-foreground" /><h4 class="text-sm font-semibold">Repeated images</h4><span class="ml-auto text-[11px] text-muted-foreground">{{ r.clusters.length }}</span></header>
          <p class="px-3 pt-2 text-[11px] text-muted-foreground">A real photo belongs to one car. When the same picture shows up on several different cars it means “No photo” (a placeholder) or a stock image.</p>
          <p v-if="!r.clusters.length" class="px-3 py-3 text-xs text-muted-foreground flex items-center gap-1.5"><ShieldCheck class="size-4 text-emerald-500" /> Every photo is unique.</p>
          <ul class="divide-y">
            <li v-for="g in r.clusters" :key="g.id" class="p-3 space-y-2">
              <div class="flex gap-2.5">
                <img v-if="g.url && !broken.has(g.url)" :src="g.url" alt="" class="size-16 rounded-md object-cover border shrink-0" referrerpolicy="no-referrer" @error="onBroken(g.url)">
                <span v-else class="size-16 rounded-md border bg-muted flex items-center justify-center shrink-0"><ImageOff class="size-5 text-muted-foreground" /></span>
                <div class="min-w-0 text-xs">
                  <p class="font-semibold">On {{ g.vehicles }} vehicles</p>
                  <p class="text-muted-foreground line-clamp-2">{{ g.models > 1 ? `${g.models} different models` : g.modelNames[0] }}</p>
                  <p class="text-[10px] text-muted-foreground truncate" :title="g.url">{{ host(g.url) }}</p>
                </div>
              </div>
              <div class="inline-flex rounded-md border bg-muted/40 p-0.5 w-full">
                <button v-for="k in (['real', 'placeholder', 'stock'] as FinalVerdict[])" :key="k" type="button" class="flex-1 rounded px-1.5 py-1 text-[11px] font-medium transition-colors" :class="groupFinal(g) === k ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'" :disabled="busy" @click="setGroup(g, k)">{{ VERDICT_META[k].short }}</button>
              </div>
              <Button v-if="g.hash && groupFinal(g)" size="sm" variant="ghost" class="h-7 w-full text-[11px] gap-1.5" :disabled="busy" @click="remember(g)"><Brain class="size-3.5" /> Remember for every dealership</Button>
            </li>
          </ul>
        </div>

        <div class="rounded-xl border bg-card overflow-hidden">
          <button type="button" class="w-full px-3 py-2 flex items-center gap-2 text-left" @click="showRules = !showRules">
            <Sparkles class="size-4 text-violet-500" /><span class="text-sm font-semibold">Teach the scanner</span>
            <span class="ml-auto text-[11px] text-muted-foreground">{{ rules.length }} rule{{ rules.length === 1 ? '' : 's' }}</span><ChevronDown class="size-3.5 transition-transform" :class="showRules && 'rotate-180'" />
          </button>
          <div v-if="showRules" class="border-t p-3 space-y-3">
            <div class="space-y-1.5">
              <Label class="text-xs flex items-center gap-1"><Link2 class="size-3.5" /> Image address contains</Label>
              <div class="flex gap-1.5">
                <Input v-model="urlRule.text" placeholder="e.g. comingsoon or evoximages" class="h-8 text-xs" @keydown.enter.prevent="addUrlRule" />
                <Select v-model="urlRule.verdict"><SelectTrigger class="h-8 w-[118px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="placeholder">No photo</SelectItem><SelectItem value="stock">Stock</SelectItem><SelectItem value="real">Real</SelectItem></SelectContent></Select>
                <Button size="icon" class="size-8 shrink-0" :disabled="busy || !urlRule.text.trim()" aria-label="Add rule" @click="addUrlRule"><Plus class="size-4" /></Button>
              </div>
            </div>
            <ul class="space-y-1.5">
              <li v-for="rule in rules" :key="rule.id" class="flex items-center gap-2 text-xs">
                <img v-if="rule.thumb && !broken.has(rule.thumb)" :src="rule.thumb" alt="" class="size-8 rounded object-cover border" referrerpolicy="no-referrer" @error="onBroken(rule.thumb)">
                <span v-else class="size-8 rounded border bg-muted flex items-center justify-center"><Link2 class="size-3.5 text-muted-foreground" /></span>
                <div class="min-w-0 flex-1"><p class="truncate">{{ rule.urlContains ? `“${rule.urlContains}”` : rule.label }}</p><p class="text-[10px] text-muted-foreground"><span :class="VERDICT_META[rule.verdict].pill" class="rounded px-1">{{ VERDICT_META[rule.verdict].short }}</span> · used {{ rule.hits || 0 }}×</p></div>
                <Button size="icon" variant="ghost" class="size-7" aria-label="Delete rule" :disabled="busy" @click="delRule(rule)"><Trash2 class="size-3.5" /></Button>
              </li>
              <li v-if="!rules.length" class="text-[11px] text-muted-foreground">No rules yet. Use “Remember for every dealership” on a repeated image, or “Always treat this image as…” on any vehicle.</li>
            </ul>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
