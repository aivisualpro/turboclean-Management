<script setup lang="ts">
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, CircleSlash, CornerUpLeft, ExternalLink, Loader2, ShieldCheck } from 'lucide-vue-next'
import type { ScopeRow, ScopeStatus } from '~/lib/scanScope'
import { SCOPE_META, TONE, pageHost, pagePath } from '~/lib/scanScope'

/**
 * Scope report — exactly which saved scan pages a crawl read, and how each one went
 * (read in full / partly / blocked / forwards to the home page / empty). Nothing outside
 * these pages is ever read, so this table is the complete list of what the numbers are based on.
 */
const props = withDefaults(defineProps<{
  rows: ScopeRow[]
  /** Start expanded (it always opens by itself when a page needs attention). */
  defaultOpen?: boolean
  /** Show the "without a real photo" column (finished crawls). */
  photos?: boolean
}>(), { defaultOpen: false, photos: true })

const ICON: Record<ScopeStatus, any> = { pending: CircleDashed, running: Loader2, done: CheckCircle2, stuck: AlertTriangle, blocked: AlertTriangle, skipped: CircleDashed, empty: CircleSlash, redirected: CornerUpLeft, error: AlertTriangle }
const meta = (s: ScopeStatus) => SCOPE_META[s] || SCOPE_META.pending
const attention = computed(() => props.rows.filter(r => ['bad', 'warn'].includes(meta(r.status).tone)))
const read = computed(() => props.rows.filter(r => r.status === 'done').length)
const vehicles = computed(() => props.rows.reduce((n, r) => n + (r.vehicles || 0), 0))
const host = computed(() => pageHost(props.rows[0]?.url || ''))
const open = ref(props.defaultOpen || attention.value.length > 0)
watch(() => attention.value.length, (n, was) => { if (n > was) open.value = true })
const pctTone = (p: number | null | undefined) => (p ?? 0) >= 15 ? 'text-rose-600' : (p ?? 0) >= 5 ? 'text-amber-600' : 'text-emerald-600'
</script>

<template>
  <section v-if="rows.length" class="scope-report text-xs" aria-label="Crawl scope">
    <button type="button" class="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/40 transition-colors" :aria-expanded="open" @click="open = !open">
      <ShieldCheck class="size-4 shrink-0" :class="attention.length ? 'text-amber-600' : 'text-emerald-600'" />
      <span class="font-semibold">Scope</span>
      <span class="text-muted-foreground truncate">
        {{ rows.length }} saved scan page{{ rows.length === 1 ? '' : 's' }}<template v-if="host"> on {{ host }}</template> — nothing else on the site was read
      </span>
      <span class="ml-auto flex items-center gap-1.5 shrink-0">
        <span class="rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums" :class="TONE.ok.soft">{{ read }} read in full</span>
        <span v-if="attention.length" class="rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums" :class="TONE.warn.soft">{{ attention.length }} need{{ attention.length === 1 ? 's' : '' }} attention</span>
        <span class="hidden sm:inline text-muted-foreground tabular-nums">{{ vehicles }} vehicles</span>
        <ChevronDown class="size-4 text-muted-foreground transition-transform duration-200" :class="open && 'rotate-180'" />
      </span>
    </button>
    <div v-if="open" class="px-2 pb-2">
      <div class="overflow-x-auto rounded-lg">
        <table class="w-full">
          <thead>
            <tr>
              <th class="text-left">Scan page</th>
              <th class="text-left">Status</th>
              <th class="text-right whitespace-nowrap">Result pages</th>
              <th class="text-right">Vehicles</th>
              <th v-if="photos" class="text-right whitespace-nowrap">No real photo</th>
              <th class="text-left">Note</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.url">
              <td class="max-w-[360px]">
                <a :href="r.url" target="_blank" rel="noopener" class="group inline-flex max-w-full items-center gap-1.5 hover:text-primary" :title="r.url">
                  <span class="font-medium" :class="r.label ? 'whitespace-nowrap' : 'truncate'">{{ r.label || pagePath(r.url) }}</span>
                  <span v-if="r.label" class="text-muted-foreground truncate">{{ pagePath(r.url) }}</span>
                  <ExternalLink class="size-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                </a>
              </td>
              <td class="whitespace-nowrap">
                <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" :class="TONE[meta(r.status).tone].soft">
                  <component :is="ICON[r.status] || CircleDashed" class="size-3" :class="r.status === 'running' && 'animate-spin'" /> {{ meta(r.status).label }}
                </span>
              </td>
              <td class="text-right tabular-nums">{{ r.resultPages || '—' }}</td>
              <td class="text-right tabular-nums whitespace-nowrap">
                <b>{{ r.vehicles }}</b><span v-if="r.advertised" class="text-muted-foreground"> of {{ r.advertised }}</span><span v-if="r.ads" class="text-muted-foreground" :title="`${r.ads} advertisement tile${r.ads === 1 ? '' : 's'} left out of the count`"> · {{ r.ads }} ad{{ r.ads === 1 ? '' : 's' }}</span>
              </td>
              <td v-if="photos" class="text-right tabular-nums whitespace-nowrap">
                <template v-if="r.vehicles"><b :class="pctTone(r.withoutRealPct)">{{ r.withoutRealPct ?? 0 }}%</b> <span class="text-muted-foreground">({{ r.withoutReal ?? 0 }})</span></template>
                <span v-else class="text-muted-foreground">—</span>
              </td>
              <td class="text-muted-foreground min-w-[240px]">
                {{ r.note || (r.landedUrl ? `Forwards to ${pagePath(r.landedUrl)}` : r.status === 'done' ? 'Every result page of this list was read' : '') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
