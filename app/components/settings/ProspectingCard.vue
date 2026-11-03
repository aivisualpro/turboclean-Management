<script setup lang="ts">
/**
 * Settings › General → "Prospecting search area": where "Search Web" on /crm/dealership looks for dealerships.
 * Saved to settings{type:'general'}.prospecting via PUT /api/crm/prospecting/config.
 */
import { toast } from 'vue-sonner'
import { Binoculars, CheckCircle2, Coins, Crosshair, Loader2, MapPin, RotateCcw, Save, Search, ShieldAlert, Target } from 'lucide-vue-next'
import { OPEN_STAGES, STAGE_STYLE } from '~/constants/crm'
import type { ProspectingConfig } from '~/composables/useProspecting'
import { PLACE_TYPES, apiError, formatUsd, useProspecting } from '~/composables/useProspecting'

const api = useProspecting()
const loading = ref(true)
const saving = ref(false)
const locating = ref(false)
const apiKeyConfigured = ref(false)
const pricing = ref({ pricePer1000: 35, freeMonthlyCalls: 1000 })
const saved = ref<string>('')

const DEFAULTS: ProspectingConfig = {
  origin: { address: '351 Foster St', city: 'South Windsor', state: 'CT', postalCode: '06074', country: 'USA', lat: 41.826485, lng: -72.52834 },
  radiusMiles: 75,
  queries: ['car dealer'],
  includedType: 'car_dealer',
  strictType: true,
  excludeKeywords: ['rental', 'rent a car', 'auto parts', 'salvage', 'junk', 'scrap', 'tire', 'collision', 'body shop', 'car wash', 'towing', 'detailing'],
  minReviews: 0,
  maxApiCalls: 400,
  defaultStage: 'Research Needed',
}
const form = ref<ProspectingConfig>(structuredClone(DEFAULTS))
const radius = computed({ get: () => [Number(form.value.radiusMiles) || 1], set: (v: number[]) => { form.value.radiusMiles = v[0] ?? form.value.radiusMiles } })
const typeValue = computed({ get: () => form.value.includedType || '__any', set: (v: string) => { form.value.includedType = v === '__any' ? '' : v } })
const isDirty = computed(() => JSON.stringify(form.value) !== saved.value)
const maxScanCost = computed(() => (Number(form.value.maxApiCalls) || 0) * pricing.value.pricePer1000 / 1000)
const areaSqMi = computed(() => Math.round(Math.PI * (Number(form.value.radiusMiles) || 0) ** 2))
const coordsValid = computed(() => {
  const lat = Number(form.value.origin.lat), lng = Number(form.value.origin.lng)
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
})

onMounted(async () => {
  try {
    const r = await api.getConfig()
    form.value = { ...structuredClone(DEFAULTS), ...r.config, origin: { ...DEFAULTS.origin, ...r.config.origin } }
    apiKeyConfigured.value = r.apiKeyConfigured
    pricing.value = r.pricing
    saved.value = JSON.stringify(form.value)
  }
  catch (e) { toast.error(`Couldn't load the prospecting settings: ${apiError(e)}`) }
  finally { loading.value = false }
})

async function locate() {
  const o = form.value.origin
  const query = [o.address, o.city, o.state, o.postalCode, o.country].filter(Boolean).join(', ')
  if (!query.trim()) return toast.error('Enter the address first')
  locating.value = true
  try {
    const { result } = await api.geocode(query)
    if (!result) return toast.error('Google could not find that address')
    form.value.origin = { ...o, lat: result.lat, lng: result.lng, postalCode: o.postalCode || result.postalCode || '' }
    toast.success('Coordinates updated', { description: result.formattedAddress })
  }
  catch (e) { toast.error(apiError(e, 'Lookup failed')) }
  finally { locating.value = false }
}

async function save() {
  if (!coordsValid.value) return toast.error('Latitude / longitude are not valid')
  saving.value = true
  try {
    const f = form.value
    const { config } = await api.saveConfig({
      ...f,
      origin: { ...f.origin, lat: Number(f.origin.lat), lng: Number(f.origin.lng) },
      radiusMiles: Number(f.radiusMiles),
      minReviews: Number(f.minReviews),
      maxApiCalls: Number(f.maxApiCalls),
    })
    form.value = { ...form.value, ...config, origin: { ...config.origin } }
    saved.value = JSON.stringify(form.value)
    toast.success('Search area saved', { description: `${config.radiusMiles} mi around ${config.origin.city || 'base'}` })
  }
  catch (e) { toast.error(apiError(e, 'Save failed')) }
  finally { saving.value = false }
}
function resetDefaults() { form.value = structuredClone(DEFAULTS) }
</script>

<template>
  <div class="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
    <div class="border-b bg-muted/30 p-2 flex flex-wrap items-center gap-2">
      <div class="p-2 bg-primary/10 text-primary rounded-lg border border-primary/20">
        <Binoculars class="size-5" />
      </div>
      <div class="min-w-0 flex-1">
        <h3 class="font-semibold text-base leading-none">Prospecting · Search area</h3>
        <p class="text-sm text-muted-foreground mt-1.5">Where <b class="font-medium text-foreground">Search Web</b> on Dealerships looks for new dealers (Google Places).</p>
      </div>
      <Badge v-if="!loading" variant="outline" :class="apiKeyConfigured ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'" class="gap-1">
        <CheckCircle2 v-if="apiKeyConfigured" class="size-3.5" /><ShieldAlert v-else class="size-3.5" />
        {{ apiKeyConfigured ? 'Google Places connected' : 'API key missing' }}
      </Badge>
    </div>

    <div v-if="loading" class="grid h-64 place-items-center"><Loader2 class="size-5 animate-spin text-primary" /></div>

    <div v-else class="grid gap-2 p-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <!-- Form -->
      <div class="space-y-2">
        <div v-if="!apiKeyConfigured" class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
          Add <code class="rounded bg-background/60 px-1 font-mono">GOOGLE_PLACES_API_KEY</code> to <code class="font-mono">.env</code> (local) and Vercel → Settings → Environment Variables, then restart / redeploy. The key stays on the server.
        </div>

        <fieldset class="rounded-lg border p-2 space-y-2">
          <legend class="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><MapPin class="size-3" /> Base location</legend>
          <label class="block space-y-1"><span class="text-xs font-medium text-muted-foreground">Address</span>
            <Input v-model="form.origin.address" class="h-8" placeholder="351 Foster St" />
          </label>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label class="col-span-2 space-y-1"><span class="text-xs font-medium text-muted-foreground">City</span><Input v-model="form.origin.city" class="h-8" /></label>
            <label class="space-y-1"><span class="text-xs font-medium text-muted-foreground">State</span><Input v-model="form.origin.state" class="h-8 uppercase" maxlength="20" /></label>
            <label class="space-y-1"><span class="text-xs font-medium text-muted-foreground">Postal code</span><Input v-model="form.origin.postalCode" class="h-8 tabular-nums" /></label>
          </div>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <label class="space-y-1"><span class="text-xs font-medium text-muted-foreground">Country</span><Input v-model="form.origin.country" class="h-8" /></label>
            <label class="space-y-1"><span class="text-xs font-medium text-muted-foreground">Latitude</span><Input v-model="form.origin.lat" type="number" step="0.000001" class="h-8 tabular-nums" /></label>
            <label class="space-y-1"><span class="text-xs font-medium text-muted-foreground">Longitude</span><Input v-model="form.origin.lng" type="number" step="0.000001" class="h-8 tabular-nums" /></label>
            <Button variant="outline" size="sm" class="h-8 gap-1.5" :disabled="locating || !apiKeyConfigured" title="Look up the coordinates of this address" @click="locate">
              <Loader2 v-if="locating" class="size-3.5 animate-spin" /><Crosshair v-else class="size-3.5" /> Locate
            </Button>
          </div>
          <p class="text-[11px] text-muted-foreground">Tip: drag the pin on the map to fine-tune the base location.</p>
        </fieldset>

        <fieldset class="rounded-lg border p-2 space-y-2">
          <legend class="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Target class="size-3" /> Range</legend>
          <div class="flex items-center gap-2">
            <Slider v-model="radius" :min="5" :max="200" :step="5" class="flex-1" />
            <div class="flex items-center gap-1">
              <Input v-model="form.radiusMiles" type="number" min="1" max="250" class="h-8 w-20 text-right tabular-nums" />
              <span class="text-xs text-muted-foreground">mi</span>
            </div>
          </div>
          <p class="text-[11px] text-muted-foreground tabular-nums">Covers ≈ {{ areaSqMi.toLocaleString() }} sq mi around {{ form.origin.city || 'base' }}.</p>
        </fieldset>

        <fieldset class="rounded-lg border p-2 space-y-2">
          <legend class="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Search class="size-3" /> What to search</legend>
          <div class="grid gap-2 sm:grid-cols-2">
            <label class="space-y-1"><span class="text-xs font-medium text-muted-foreground">Google place type</span>
              <Select v-model="typeValue"><SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem v-for="t in PLACE_TYPES" :key="t.value || '__any'" :value="t.value || '__any'">{{ t.label }}</SelectItem></SelectContent></Select>
            </label>
            <label class="space-y-1"><span class="text-xs font-medium text-muted-foreground">Stage for added dealerships</span>
              <Select v-model="form.defaultStage"><SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                <SelectContent class="max-h-72"><SelectItem v-for="s in OPEN_STAGES" :key="s" :value="s"><span class="flex items-center gap-2"><span class="size-1.5 rounded-full" :class="STAGE_STYLE[s]?.dot" />{{ s }}</span></SelectItem></SelectContent></Select>
            </label>
          </div>
          <div class="space-y-1">
            <span class="text-xs font-medium text-muted-foreground">Search terms <span class="font-normal">(each term is a separate sweep — more terms = more API calls)</span></span>
            <TagsInput v-model="form.queries" class="min-h-8">
              <TagsInputItem v-for="t in form.queries" :key="t" :value="t"><TagsInputItemText /><TagsInputItemDelete /></TagsInputItem>
              <TagsInputInput placeholder="e.g. used car dealer" />
            </TagsInput>
          </div>
          <div class="space-y-1">
            <span class="text-xs font-medium text-muted-foreground">Skip businesses whose name contains</span>
            <TagsInput v-model="form.excludeKeywords" class="min-h-8">
              <TagsInputItem v-for="t in form.excludeKeywords" :key="t" :value="t"><TagsInputItemText /><TagsInputItemDelete /></TagsInputItem>
              <TagsInputInput placeholder="Add a word…" />
            </TagsInput>
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            <label class="space-y-1"><span class="text-xs font-medium text-muted-foreground">Minimum Google reviews</span>
              <Input v-model="form.minReviews" type="number" min="0" class="h-8 tabular-nums" />
            </label>
            <label class="space-y-1"><span class="text-xs font-medium text-muted-foreground flex items-center gap-1"><Coins class="size-3" /> API-call budget per scan</span>
              <Input v-model="form.maxApiCalls" type="number" min="10" max="5000" step="10" class="h-8 tabular-nums" />
            </label>
          </div>
          <p class="text-[11px] text-muted-foreground">
            Google bills Text Search at about {{ formatUsd(pricing.pricePer1000) }} per 1,000 calls after the first {{ pricing.freeMonthlyCalls.toLocaleString() }} each month.
            This budget caps one scan at <b class="text-foreground tabular-nums">{{ formatUsd(maxScanCost) }}</b>. A 75-mile scan typically uses 100–300 calls.
          </p>
        </fieldset>
      </div>

      <!-- Map preview -->
      <div class="flex min-h-[320px] flex-col overflow-hidden rounded-lg border">
        <ClientOnly>
          <CrmDiscoverMap
            v-if="coordsValid"
            class="flex-1"
            :origin="{ lat: Number(form.origin.lat), lng: Number(form.origin.lng) }"
            :radius-miles="Number(form.radiusMiles) || 1"
            :show-legend="false"
            :wheel-zoom="false"
            draggable-origin
            @update:origin="v => { form.origin.lat = v.lat; form.origin.lng = v.lng }"
          />
          <div v-else class="grid flex-1 place-items-center text-xs text-muted-foreground">Enter valid coordinates to preview the area</div>
        </ClientOnly>
        <div class="flex items-center justify-between gap-2 border-t bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground tabular-nums">
          <span class="truncate">{{ [form.origin.address, form.origin.city, form.origin.state, form.origin.postalCode].filter(Boolean).join(', ') }}</span>
          <span class="shrink-0">{{ Number(form.origin.lat).toFixed(5) }}, {{ Number(form.origin.lng).toFixed(5) }}</span>
        </div>
      </div>
    </div>

    <div class="border-t bg-muted/40 p-2 flex items-center justify-between gap-2">
      <Button variant="ghost" size="sm" class="h-8 gap-1.5 text-xs" :disabled="loading" @click="resetDefaults"><RotateCcw class="size-3.5" /> Reset to defaults</Button>
      <div class="flex items-center gap-2">
        <span v-if="isDirty && !loading" class="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>
        <Button size="sm" class="h-8 gap-1.5" :disabled="saving || loading || !isDirty" @click="save">
          <Loader2 v-if="saving" class="size-4 animate-spin" /><Save v-else class="size-4" /> Save search area
        </Button>
      </div>
    </div>
  </div>
</template>
