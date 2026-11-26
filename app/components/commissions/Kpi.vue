<script setup lang="ts">
import NumberFlow from '@number-flow/vue'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-vue-next'

/**
 * A headline number: label + "i", the value (animates when it changes), change vs the previous
 * week, and a small trend line of the last weeks. `goodWhenUp=false` for costs (up = amber).
 */
const props = withDefaults(defineProps<{
  label: string
  hint: string
  value: number
  previous?: number | null
  series?: number[]
  sub?: string
  tone?: 'default' | 'primary' | 'good' | 'warn'
  goodWhenUp?: boolean
  format?: 'usd' | 'pct'
}>(), { previous: null, series: () => [], sub: '', tone: 'default', goodWhenUp: true, format: 'usd' })

const numberFormat = computed(() => props.format === 'pct'
  ? { style: 'decimal', minimumFractionDigits: 1, maximumFractionDigits: 1 } as const
  : { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 } as const)

const delta = computed(() => {
  if (props.previous == null) return null
  const d = props.value - props.previous
  if (Math.abs(d) < 0.005) return { dir: 0, text: 'same as last week' }
  const rel = props.previous ? Math.abs(d / props.previous) * 100 : null
  const amt = props.format === 'pct' ? `${Math.abs(d).toFixed(1)} pts` : usdShort(Math.abs(d))
  return { dir: d > 0 ? 1 : -1, text: `${amt}${rel != null && props.format !== 'pct' ? ` · ${rel.toFixed(rel >= 10 ? 0 : 1)}%` : ''}` }
})
const deltaGood = computed(() => !delta.value || delta.value.dir === 0 ? null : (delta.value.dir > 0) === props.goodWhenUp)

// Sparkline: 0..1 scaled polyline in a 100×28 box
const spark = computed(() => {
  const s = props.series.filter(v => Number.isFinite(v))
  if (s.length < 2) return null
  const min = Math.min(...s), max = Math.max(...s)
  const span = max - min || 1
  const pts = s.map((v, i) => [(i / (s.length - 1)) * 100, 26 - ((v - min) / span) * 24] as const)
  return { line: pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' '), area: `0,28 ${pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')} 100,28`, last: pts[pts.length - 1]! }
})
</script>

<template>
  <div
    class="relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card px-3 pb-2 pt-2.5"
    :class="{ 'bg-primary/[0.04]': tone === 'primary', 'bg-emerald-500/[0.05]': tone === 'good', 'bg-amber-500/[0.06]': tone === 'warn' }"
  >
    <p class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <slot name="icon" />
      <span class="truncate">{{ label }}</span>
      <CrmHint :text="hint" :label="label" />
    </p>
    <p class="mt-1 text-[22px] font-bold leading-7 tracking-tight tabular-nums" :class="{ 'text-primary': tone === 'primary', 'text-emerald-700 dark:text-emerald-400': tone === 'good' }">
      <NumberFlow :value="format === 'pct' ? value : Math.round(value * 100) / 100" :format="numberFormat" />
      <span v-if="format === 'pct'" class="text-base">%</span>
    </p>
    <div class="mt-0.5 flex min-h-4 items-center gap-1.5 text-[11px]">
      <span
        v-if="delta" class="inline-flex items-center gap-0.5 tabular-nums"
        :class="deltaGood === null ? 'text-muted-foreground' : deltaGood ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'"
        :title="`Change vs the previous pay day`"
      >
        <ArrowUpRight v-if="delta.dir > 0" class="size-3" /><ArrowDownRight v-else-if="delta.dir < 0" class="size-3" /><Minus v-else class="size-3" />
        {{ delta.text }}
      </span>
      <span v-if="sub" class="truncate text-muted-foreground">{{ sub }}</span>
    </div>
    <svg v-if="spark" viewBox="0 0 100 28" preserveAspectRatio="none" class="pointer-events-none mt-1.5 h-7 w-full text-primary" aria-hidden="true">
      <polygon :points="spark.area" class="fill-current opacity-[0.08]" />
      <polyline :points="spark.line" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
    <div v-else class="mt-1.5 h-7" />
  </div>
</template>
