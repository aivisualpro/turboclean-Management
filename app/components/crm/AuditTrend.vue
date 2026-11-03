<script setup lang="ts">
import type { CrmAudit } from '~/composables/useCrmDealerships'
import { format } from 'date-fns'

/**
 * Missing-photo rate over time. Single series: thin line, visible markers,
 * crosshair tooltip on hover, text in text tokens. Oldest → newest.
 */
const props = defineProps<{ audits: CrmAudit[] }>()
const W = 640, H = 160, PL = 36, PR = 12, PT = 14, PB = 26

const points = computed(() => {
  const list = [...props.audits].filter(a => a.missingPhotoPct !== null).sort((a, b) => a.auditedAt.localeCompare(b.auditedAt))
  if (!list.length) return []
  const xs = list.map(a => new Date(a.auditedAt).getTime())
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const span = Math.max(maxX - minX, 1)
  const maxY = Math.max(10, Math.ceil(Math.max(...list.map(a => a.missingPhotoPct!)) / 10) * 10)
  return list.map((a, i) => ({
    a,
    x: list.length === 1 ? (PL + (W - PL - PR) / 2) : PL + ((xs[i]! - minX) / span) * (W - PL - PR),
    y: PT + (1 - a.missingPhotoPct! / maxY) * (H - PT - PB),
    maxY,
  }))
})
const maxY = computed(() => points.value[0]?.maxY ?? 100)
const ticks = computed(() => [0, maxY.value / 2, maxY.value])
const yFor = (v: number) => PT + (1 - v / maxY.value) * (H - PT - PB)
const path = computed(() => points.value.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
const area = computed(() => points.value.length > 1 ? `${path.value} L${points.value.at(-1)!.x.toFixed(1)},${yFor(0)} L${points.value[0]!.x.toFixed(1)},${yFor(0)} Z` : '')

const hover = ref<number | null>(null)
function onMove(e: MouseEvent) {
  const svg = (e.currentTarget as SVGSVGElement)
  const rect = svg.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width * W
  let best = 0, bd = Infinity
  points.value.forEach((p, i) => { const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = i } })
  hover.value = points.value.length ? best : null
}
const hp = computed(() => hover.value !== null ? points.value[hover.value] : null)
</script>

<template>
  <div class="relative">
    <svg :viewBox="`0 0 ${W} ${H}`" class="w-full h-40 select-none" role="img" aria-label="Missing-photo rate over time" @mousemove="onMove" @mouseleave="hover = null">
      <!-- grid + axis -->
      <g class="text-muted-foreground/40">
        <line v-for="t in ticks" :key="t" :x1="PL" :x2="W - PR" :y1="yFor(t)" :y2="yFor(t)" stroke="currentColor" stroke-width="1" :stroke-dasharray="t === 0 ? '' : '2 4'" />
      </g>
      <g class="fill-muted-foreground" font-size="10">
        <text v-for="t in ticks" :key="t" :x="PL - 6" :y="yFor(t) + 3" text-anchor="end">{{ t }}%</text>
        <template v-if="points.length">
          <text :x="points[0]!.x" :y="H - 8" text-anchor="start">{{ format(new Date(points[0]!.a.auditedAt), 'MMM d, yy') }}</text>
          <text v-if="points.length > 1" :x="points.at(-1)!.x" :y="H - 8" text-anchor="end">{{ format(new Date(points.at(-1)!.a.auditedAt), 'MMM d, yy') }}</text>
        </template>
      </g>
      <!-- series -->
      <path v-if="area" :d="area" class="fill-violet-500/10" />
      <path v-if="points.length > 1" :d="path" fill="none" class="stroke-violet-500" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <g v-for="(p, i) in points" :key="p.a.id">
        <circle :cx="p.x" :cy="p.y" r="4" class="fill-violet-500 stroke-background" stroke-width="2" />
        <circle :cx="p.x" :cy="p.y" r="12" fill="transparent" @mouseenter="hover = i" />
      </g>
      <!-- crosshair -->
      <line v-if="hp" :x1="hp.x" :x2="hp.x" :y1="PT" :y2="yFor(0)" class="stroke-foreground/30" stroke-width="1" />
    </svg>
    <div v-if="hp" class="pointer-events-none absolute -top-1 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md" :style="{ left: `${Math.min(Math.max(hp.x / W * 100, 10), 85)}%`, transform: 'translateX(-50%)' }">
      <p class="font-medium">{{ format(new Date(hp.a.auditedAt), 'MMM d, yyyy') }}</p>
      <p class="text-muted-foreground tabular-nums">{{ hp.a.missingPhotoPct }}% missing · {{ hp.a.totalMissingPhotos }} of {{ hp.a.totalVehicles }}</p>
    </div>
  </div>
</template>
