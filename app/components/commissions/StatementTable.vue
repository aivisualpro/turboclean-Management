<script setup lang="ts">
import { ArrowDown, ArrowUp, ChevronsUpDown, PenLine, Search as SearchIcon, TriangleAlert } from 'lucide-vue-next'

/** The week's dealer lines — the sheet's main table, with rules, check status and spreadsheet comparison. */
const props = defineProps<{ week: any, payees: any[] }>()
const emit = defineEmits<{ (e: 'open', line: any): void, (e: 'update', week: any): void }>()

const search = ref('')
const filter = ref<'all' | 'waiting' | 'changed' | 'needs'>('all')
const sortKey = ref<'dealerName' | 'billed' | 'tax' | 'net' | 'payout' | 'margin'>('dealerName')
const sortDir = ref<1 | -1>(1)
function sortBy(k: typeof sortKey.value) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 1 ? -1 : 1
  else { sortKey.value = k; sortDir.value = k === 'dealerName' ? 1 : -1 }
}

const companyPayees = computed(() => props.payees.filter(p => !p.fundedBy))
const mainPayee = computed(() => companyPayees.value.length === 1 ? companyPayees.value[0] : null)
/** Extra column: on system weeks compare with the spreadsheet's payout; on spreadsheet weeks compare with the invoices in the system. */
const compareMode = computed<'sheet' | 'invoices' | null>(() => props.week.source === 'sheet' ? (props.week.live ? 'invoices' : null) : (props.week.sheet ? 'sheet' : null))
const hasSheet = computed(() => !!compareMode.value)
const liveLine = (l: any) => props.week.live?.lines?.find((x: any) => x.dealerId === l.dealerId)
const invoiceDiff = (l: any) => { const x = liveLine(l); return x ? Math.round((x.net - l.net) * 100) / 100 : null }
const locked = computed(() => props.week.status !== 'draft')

const changed = (l: any) => Object.values<any>(l.payouts).some(p => p.overridden)
const needs = (l: any) => Object.values<any>(l.payouts).some(p => p.needsAmount)
const counts = computed(() => ({
  all: props.week.lines.length,
  waiting: props.week.lines.filter((l: any) => !l.deposited && l.billed > 0).length,
  changed: props.week.lines.filter(changed).length,
  needs: props.week.lines.filter(needs).length,
}))

const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  let list = props.week.lines.filter((l: any) => !q || l.dealerName.toLowerCase().includes(q))
  if (filter.value === 'waiting') list = list.filter((l: any) => !l.deposited && l.billed > 0)
  if (filter.value === 'changed') list = list.filter(changed)
  if (filter.value === 'needs') list = list.filter(needs)
  const k = sortKey.value
  return [...list].sort((a: any, b: any) => (k === 'dealerName' ? a.dealerName.localeCompare(b.dealerName) : (a[k] - b[k])) * sortDir.value)
})
const sum = (k: string) => rows.value.reduce((s: number, l: any) => s + (l[k] || 0), 0)
const sheetPayout = (l: any) => props.week.sheet?.perDealer?.[l.dealerId]?.payout
const sheetDiff = (l: any) => { const s = sheetPayout(l); return s == null ? null : Math.round((l.payout - s) * 100) / 100 }

// Inline amount for "typed in weekly" rules (and any payout when there is only one payee)
const editing = ref<string | null>(null)
const draft = ref<any>('')
const saving = ref(false)
function startEdit(l: any) {
  if (locked.value || !mainPayee.value) return emit('open', l)
  const p = l.payouts[mainPayee.value.id]
  if (!p || p.rule.source === 'sheet') return emit('open', l)
  editing.value = l.dealerId
  draft.value = p.amount
  nextTick(() => (document.querySelector(`[data-edit="${CSS.escape(l.dealerId)}"]`) as HTMLInputElement | null)?.select())
}
async function commit(l: any) {
  if (editing.value !== l.dealerId) return
  const p = l.payouts[mainPayee.value!.id]
  const value = Number(draft.value)
  editing.value = null
  if (!Number.isFinite(value) || (Math.abs(value - p.amount) < 0.005 && !p.needsAmount)) return
  saving.value = true
  try { emit('update', await patchCommissionWeek(props.week.payDate, 'setPayout', { dealerId: l.dealerId, dealerName: l.dealerName, payeeId: mainPayee.value!.id, amount: value }, `${l.dealerName}: ${usd(value)}`)) }
  catch {} finally { saving.value = false }
}

const FILTERS = [
  { key: 'all', label: 'All' }, { key: 'waiting', label: 'Check not in' }, { key: 'changed', label: 'Changed' }, { key: 'needs', label: 'Needs amount' },
] as const
const COLS = [
  { key: 'billed', label: 'Billed', hint: 'Invoice totals including sales tax (the sheet’s “Before tax”).' },
  { key: 'tax', label: 'Sales tax', hint: 'Sales tax on the invoices.' },
  { key: 'net', label: 'Net', hint: 'Billed minus sales tax (the sheet’s “After tax”). Commission is worked out on this.' },
] as const
</script>

<template>
  <section class="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card" data-testid="statement">
    <header class="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <h3 class="mr-1 text-sm font-semibold">Dealers</h3>
      <div class="inline-flex h-7 items-center rounded-lg border bg-muted/40 p-0.5 text-[11px]" role="tablist" aria-label="Show">
        <button
          v-for="f in FILTERS" :key="f.key" v-show="f.key === 'all' || counts[f.key]" type="button" role="tab" :aria-selected="filter === f.key"
          class="h-full whitespace-nowrap rounded-md px-2" :class="filter === f.key ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'" @click="filter = f.key"
        >{{ f.label }} <span class="tabular-nums opacity-70">{{ counts[f.key] }}</span></button>
      </div>
      <div class="relative ml-auto">
        <SearchIcon class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="search" placeholder="Find a dealer" class="h-7 w-44 pl-7 text-xs" aria-label="Find a dealer" />
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-auto">
      <table class="w-full">
        <thead class="sticky top-0 z-10">
          <tr>
            <th class="text-left">
              <button type="button" class="inline-flex items-center gap-1 uppercase" @click="sortBy('dealerName')">Dealer<component :is="sortKey === 'dealerName' ? (sortDir === 1 ? ArrowUp : ArrowDown) : ChevronsUpDown" class="size-3 opacity-60" /></button>
            </th>
            <th v-for="c in COLS" :key="c.key" class="text-right">
              <button type="button" class="inline-flex items-center gap-1 uppercase" :title="c.hint" @click="sortBy(c.key)">{{ c.label }}<component :is="sortKey === c.key ? (sortDir === 1 ? ArrowUp : ArrowDown) : ChevronsUpDown" class="size-3 opacity-60" /></button>
            </th>
            <th class="text-left" title="How the payout is worked out for this dealer">Rule</th>
            <th class="text-right">
              <button type="button" class="inline-flex items-center gap-1 uppercase" :title="mainPayee ? `What ${mainPayee.name} earns on this dealer` : 'Paid to contractors'" @click="sortBy('payout')">{{ mainPayee ? mainPayee.name : 'Payout' }}<component :is="sortKey === 'payout' ? (sortDir === 1 ? ArrowUp : ArrowDown) : ChevronsUpDown" class="size-3 opacity-60" /></button>
            </th>
            <th class="text-right">
              <button type="button" class="inline-flex items-center gap-1 uppercase" title="Net minus payout — what the company keeps from this dealer" @click="sortBy('margin')">Company<component :is="sortKey === 'margin' ? (sortDir === 1 ? ArrowUp : ArrowDown) : ChevronsUpDown" class="size-3 opacity-60" /></button>
            </th>
            <th class="text-center" title="Has the dealer's check been deposited?">Check</th>
            <th v-if="compareMode === 'sheet'" class="text-right" title="Payout in the spreadsheet for this week, compared with the system">Sheet</th>
            <th v-else-if="compareMode === 'invoices'" class="text-right" title="Net revenue of the invoices in the system for this dealer and week, compared with the spreadsheet">Invoices</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="l in rows" :key="l.dealerId"
            class="group cursor-pointer transition-colors hover:bg-muted/50"
            :class="needs(l) && 'bg-amber-500/[0.06]'"
            tabindex="0" @click="emit('open', l)" @keydown.enter="emit('open', l)"
          >
            <td class="max-w-[240px]">
              <span class="block truncate font-medium">{{ l.dealerName }}</span>
              <span v-if="l.sources.monthly || l.sources.daily || String(l.dealerId).startsWith('sheet:')" class="block truncate text-[11px] text-muted-foreground">
                <template v-if="String(l.dealerId).startsWith('sheet:')">Not linked to a dealer yet</template>
                <template v-else-if="l.sources.daily">Daily invoices (no weekly yet)</template>
                <template v-else-if="l.sources.monthly && !l.sources.weekly">Monthly invoice share</template>
                <template v-else>incl. {{ usd(l.sources.monthly) }} monthly</template>
              </span>
            </td>
            <td class="text-right tabular-nums text-muted-foreground">{{ usd(l.billed) }}</td>
            <td class="text-right tabular-nums text-muted-foreground">{{ usd(l.tax) }}</td>
            <td class="text-right font-medium tabular-nums">{{ usd(l.net) }}</td>
            <td>
              <span class="inline-flex flex-wrap items-center gap-1">
                <span v-for="(p, pid) in l.payouts" :key="pid" class="inline-flex h-5 items-center gap-1 rounded border px-1.5 text-[11px] tabular-nums" :class="p.rule.source === 'default' ? 'border-transparent text-muted-foreground' : 'bg-muted/60'">
                  <template v-if="companyPayees.length > 1">{{ payees.find(x => x.id === pid)?.name?.slice(0, 1) }} ·</template>{{ ruleText(p.rule) }}
                </span>
              </span>
            </td>
            <td class="text-right font-semibold tabular-nums" @click.stop="startEdit(l)">
              <Input
                v-if="editing === l.dealerId" v-model="draft" :data-edit="l.dealerId" type="number" step="0.01"
                class="ml-auto h-7 w-28 text-right text-[13px] tabular-nums" @click.stop @keydown.enter="commit(l)" @keydown.esc="editing = null" @blur="commit(l)"
              />
              <span v-else-if="needs(l)" class="inline-flex items-center gap-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-1.5 text-amber-800 dark:text-amber-300" title="Type in this week's amount">
                <PenLine class="size-3" />{{ usd(l.payout) }}
              </span>
              <span v-else class="inline-flex items-center gap-1" :class="!locked && mainPayee && 'decoration-dotted underline-offset-4 group-hover:underline'" :title="locked ? '' : 'Click to change this week'">
                <span v-if="changed(l)" class="size-1.5 rounded-full bg-amber-500" title="Changed this week" />{{ usd(l.payout) }}
              </span>
            </td>
            <td class="text-right tabular-nums" :class="l.margin < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-muted-foreground'">{{ usd(l.margin) }}</td>
            <td class="text-center">
              <Badge variant="outline" class="h-5 px-1.5 text-[10px]" :class="DEPOSIT_META[l.deposited ? 'paid' : l.deposit]?.cls">{{ l.deposited ? 'Deposited' : DEPOSIT_META[l.deposit]?.label }}</Badge>
            </td>
            <td v-if="compareMode === 'invoices'" class="text-right tabular-nums">
              <span v-if="!liveLine(l)" class="text-[11px] text-amber-700 dark:text-amber-400">no invoice</span>
              <span v-else-if="Math.abs(invoiceDiff(l)!) < 0.02" class="text-[11px] text-emerald-700 dark:text-emerald-400">✓ matches</span>
              <span v-else class="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400" :title="`Invoices net ${usd(liveLine(l).net)}`"><TriangleAlert class="size-3" />{{ invoiceDiff(l)! > 0 ? '+' : '' }}{{ usd(invoiceDiff(l)) }}</span>
            </td>
            <td v-else-if="hasSheet" class="text-right tabular-nums">
              <template v-if="sheetPayout(l) == null"><span class="text-[11px] text-amber-700 dark:text-amber-400">not in sheet</span></template>
              <span v-else-if="Math.abs(sheetDiff(l)!) < 0.02" class="text-[11px] text-emerald-700 dark:text-emerald-400">✓ {{ usd(sheetPayout(l)) }}</span>
              <span v-else class="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400" :title="`Spreadsheet ${usd(sheetPayout(l))}`"><TriangleAlert class="size-3" />{{ sheetDiff(l)! > 0 ? '+' : '' }}{{ usd(sheetDiff(l)) }}</span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="hasSheet ? 9 : 8" class="py-10 text-center">
              <p class="text-sm font-medium">{{ week.lines.length ? 'No dealers match' : 'No invoices for this work week' }}</p>
              <p class="mt-1 text-xs text-muted-foreground">{{ week.lines.length ? 'Try another filter or search.' : `Nothing was invoiced between ${dayShort(week.workStart)} and ${dayShort(week.workEnd)} yet.` }}</p>
            </td>
          </tr>
        </tbody>
        <tfoot v-if="rows.length" class="sticky bottom-0 z-10">
          <tr class="bg-muted font-semibold">
            <td>Total <span class="text-[11px] font-normal text-muted-foreground">· {{ rows.length }} dealer{{ rows.length === 1 ? '' : 's' }}</span></td>
            <td class="text-right tabular-nums">{{ usd(sum('billed')) }}</td>
            <td class="text-right tabular-nums">{{ usd(sum('tax')) }}</td>
            <td class="text-right tabular-nums">{{ usd(sum('net')) }}</td>
            <td class="text-[11px] font-normal text-muted-foreground">{{ sum('net') ? pctText(sum('payout') / sum('net') * 100) : '' }} avg</td>
            <td class="text-right tabular-nums text-primary">{{ usd(sum('payout')) }}</td>
            <td class="text-right tabular-nums">{{ usd(sum('margin')) }}</td>
            <td />
            <td v-if="compareMode === 'invoices'" class="text-right text-[11px] tabular-nums" title="Net revenue of all invoices in the system for this week">{{ usd(week.live.net) }}</td>
            <td v-else-if="hasSheet" class="text-right text-[11px] tabular-nums" title="Spreadsheet total payout">{{ usd(week.sheet.totals.payout) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </section>
</template>
