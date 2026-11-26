<script setup lang="ts">
import { Landmark, CheckCircle2, Circle } from 'lucide-vue-next'

/** The company side of the week: where each dollar of net revenue went, and the taxes to send. */
const props = defineProps<{ week: any }>()
const emit = defineEmits<{ (e: 'update', week: any): void }>()

const t = computed(() => props.week.totals)
// Fixed series order and colours (same as the year chart): contractors, overhead, tax set-aside, profit.
const SERIES = [
  { key: 'contractors', label: 'Paid to contractors', color: 'var(--cm-s1)' },
  { key: 'overhead', label: 'Overhead', color: 'var(--cm-s3)' },
  { key: 'setAside', label: 'Tax set-aside', color: 'var(--cm-s4)' },
  { key: 'profit', label: 'Net profit', color: 'var(--cm-s2)' },
] as const
const parts = computed(() => {
  const v = { contractors: t.value.paidToContractors, overhead: t.value.overhead, setAside: t.value.setAsideTotal, profit: Math.max(0, t.value.netProfit) }
  const total = Object.values(v).reduce((s, n) => s + Math.max(0, n), 0) || 1
  return SERIES.map(s => ({ ...s, value: v[s.key], share: Math.max(0, v[s.key]) / total * 100 }))
})

const busy = ref<string | null>(null)
async function toggleTax(tax: any) {
  busy.value = tax.id
  try { emit('update', await patchCommissionWeek(props.week.payDate, 'setTax', { id: tax.id, label: tax.label, paid: !tax.paid, amount: tax.due }, tax.paid ? 'Marked not paid' : 'Marked paid')) }
  catch {} finally { busy.value = null }
}
</script>

<template>
  <section class="flex flex-col overflow-hidden rounded-xl border bg-card" data-testid="company-card">
    <header class="flex items-center gap-2 border-b px-3 py-2.5">
      <Landmark class="size-4 text-muted-foreground" />
      <h3 class="text-sm font-semibold">Company result</h3>
      <span class="ml-auto text-[11px] text-muted-foreground tabular-nums">{{ pctText(t.marginPct) }} margin</span>
    </header>
    <div class="space-y-2 px-3 py-2.5">
      <!-- One bar: how the week's net revenue was used -->
      <div>
        <div class="flex h-3 w-full gap-0.5 overflow-hidden rounded" role="img" :aria-label="parts.map(p => `${p.label} ${usd(p.value)}`).join(', ')">
          <div v-for="p in parts" v-show="p.share > 0" :key="p.key" class="h-full first:rounded-l last:rounded-r" :style="{ width: `${p.share}%`, background: p.color }" :title="`${p.label}: ${usd(p.value)} (${p.share.toFixed(1)}%)`" />
        </div>
      </div>
      <dl class="space-y-1 text-[13px]">
        <div class="flex items-center justify-between font-medium"><dt class="flex items-center gap-1.5">Net revenue <CrmHint text="Billed minus sales tax (the sheet's “After tax”)." /></dt><dd class="tabular-nums">{{ usd(t.net) }}</dd></div>
        <div v-for="p in parts.slice(0, 3)" :key="p.key" class="flex items-center justify-between">
          <dt class="flex items-center gap-1.5 text-muted-foreground"><span class="size-2 rounded-sm" :style="{ background: p.color }" />{{ p.label }}</dt>
          <dd class="tabular-nums">−{{ usd(p.value) }}</dd>
        </div>
        <div v-if="t.overheadItems?.length" class="pl-3.5 text-[11px] text-muted-foreground">{{ t.overheadItems.map((o: any) => `${o.label} ${usd(o.amount)}`).join(' · ') }}</div>
        <div v-for="s in t.setAsides" :key="s.id" class="pl-3.5 text-[11px] text-muted-foreground">{{ s.label }}: {{ s.pct }}% of {{ s.base === 'billed' ? 'billed' : 'net' }}</div>
        <div class="flex items-center justify-between border-t pt-1.5 font-semibold">
          <dt class="flex items-center gap-1.5"><span class="size-2 rounded-sm" :style="{ background: 'var(--cm-s2)' }" />Net profit <CrmHint text="Net revenue minus what contractors are paid (after their deductions), weekly overhead and the tax set-aside." /></dt>
          <dd class="text-base tabular-nums" :class="t.netProfit < 0 ? 'text-rose-700 dark:text-rose-400' : ''">{{ usd(t.netProfit) }}</dd>
        </div>
        <div v-for="r in t.reserves" :key="r.id" class="flex items-center justify-between text-[12px] text-muted-foreground">
          <dt>{{ r.label }} ({{ r.pct }}% of profit)</dt><dd class="tabular-nums">{{ usd(r.amount) }}</dd>
        </div>
      </dl>
    </div>
    <div class="border-t px-3 py-2.5">
      <p class="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Taxes to send <CrmHint text="Tick when the money has been paid. Works on approved weeks too." /></p>
      <div class="space-y-1">
        <button
          v-for="tax in week.taxes" :key="tax.id" type="button"
          class="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors hover:bg-muted/60 disabled:opacity-60"
          :disabled="busy === tax.id" :aria-pressed="!!tax.paid" @click="toggleTax(tax)"
        >
          <CheckCircle2 v-if="tax.paid" class="size-4 shrink-0 text-emerald-600" /><Circle v-else class="size-4 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate">{{ tax.label }}</span>
          <span class="text-[11px] text-muted-foreground">{{ tax.paid ? `Paid ${tax.date ? dayShort(tax.date) : ''}` : 'Not paid' }}</span>
          <span class="w-24 text-right font-medium tabular-nums">{{ usd(tax.amount ?? tax.due) }}</span>
        </button>
      </div>
    </div>
  </section>
</template>
