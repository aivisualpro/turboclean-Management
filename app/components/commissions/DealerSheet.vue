<script setup lang="ts">
import { ExternalLink, RotateCcw, FileSpreadsheet, Receipt, CalendarRange } from 'lucide-vue-next'

/** Side panel for one dealer's line: the invoices behind it, how the payout was worked out, and changes for this week. */
const props = defineProps<{ line: any | null, week: any, payees: any[] }>()
const emit = defineEmits<{ (e: 'update', week: any): void, (e: 'close'): void, (e: 'edit-rule', v: { dealerId: string, dealerName: string, payeeId: string }): void }>()
const open = computed({ get: () => !!props.line, set: (v) => { if (!v) emit('close') } })

const payeeName = (id: string) => props.payees.find(p => p.id === id)?.name || id
const busy = ref(false)
const drafts = reactive<Record<string, { amount: any, note: string }>>({})
watch(() => props.line, (l) => {
  for (const k of Object.keys(drafts)) delete drafts[k]
  if (!l) return
  for (const [pid, p] of Object.entries<any>(l.payouts)) drafts[pid] = { amount: p.amount, note: p.note || '' }
}, { immediate: true })

async function run(op: string, fields: Record<string, any>, ok?: string) {
  busy.value = true
  try { emit('update', await patchCommissionWeek(props.week.payDate, op, { dealerId: props.line.dealerId, dealerName: props.line.dealerName, ...fields }, ok)) }
  catch {} finally { busy.value = false }
}
const savePayout = (pid: string) => run('setPayout', { payeeId: pid, amount: Number(drafts[pid]!.amount), note: drafts[pid]!.note }, 'Payout saved for this week')
const resetPayout = (pid: string) => run('setPayout', { payeeId: pid, amount: null }, 'Back to the rule')

const sheetRow = computed(() => props.week.source === 'sheet' ? null : (props.week.sheet?.perDealer?.[props.line?.dealerId] || null))
/** On spreadsheet weeks: the same dealer and week in the system's invoices. */
const liveLine = computed(() => props.week.source === 'sheet' ? (props.week.live?.lines || []).find((x: any) => x.dealerId === props.line?.dealerId) || null : null)
const invoices = computed(() => props.week.source === 'sheet' ? (liveLine.value?.invoices || []) : (props.line?.invoices || []))
const invoiceLink = (inv: any) => inv.type === 'Monthly' ? '/sales/monthly-invoices' : `/sales/invoices?search=${encodeURIComponent(inv.number)}&date=all_time`
const locked = computed(() => props.week.status !== 'draft')
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent side="right" class="w-full gap-0 overflow-y-auto p-0 sm:max-w-md">
      <template v-if="line">
        <SheetHeader class="border-b px-4 py-3 text-left">
          <SheetTitle class="pr-6 text-base">{{ line.dealerName }}</SheetTitle>
          <SheetDescription class="flex items-center gap-1.5 text-xs">
            <CalendarRange class="size-3.5" />Work {{ dayShort(week.workStart) }} – {{ dayShort(week.workEnd) }} · paid {{ dayMed(week.payDate) }}
          </SheetDescription>
        </SheetHeader>

        <div class="space-y-2 p-2">
          <!-- Money -->
          <div class="grid grid-cols-3 divide-x rounded-xl border bg-card">
            <div class="p-2.5"><p class="text-[11px] text-muted-foreground">Billed</p><p class="text-sm font-semibold tabular-nums">{{ usd(line.billed) }}</p></div>
            <div class="p-2.5"><p class="text-[11px] text-muted-foreground">Sales tax</p><p class="text-sm font-semibold tabular-nums">{{ usd(line.tax) }}</p></div>
            <div class="p-2.5"><p class="text-[11px] text-muted-foreground">Net</p><p class="text-sm font-semibold tabular-nums">{{ usd(line.net) }}</p></div>
          </div>

          <!-- Payout per payee -->
          <section v-for="(p, pid) in line.payouts" :key="pid" class="rounded-xl border bg-card p-3">
            <div class="flex items-center gap-2">
              <h4 class="text-sm font-semibold">{{ payeeName(String(pid)) }}</h4>
              <Badge variant="outline" class="h-5 text-[10px]">{{ ruleText(p.rule) }}</Badge>
              <span v-if="p.overridden || p.manual" class="text-[11px] font-medium text-amber-700 dark:text-amber-400">Changed this week</span>
              <span class="ml-auto text-base font-bold tabular-nums">{{ usd(p.amount) }}</span>
            </div>
            <p class="mt-1 text-[11px] text-muted-foreground">
              <template v-if="p.rule.source === 'sheet'">Amount paid in the spreadsheet for this week.</template>
              <template v-else-if="p.rule.kind === 'percent'">{{ p.rule.value }}% of {{ p.rule.base === 'billed' ? 'billed' : 'net' }} ({{ usd(p.rule.base === 'billed' ? line.billed : line.net) }}){{ p.rule.source === 'default' ? ' — the payee’s standard rate' : ` — rule since ${dayShort(p.rule.from)}` }}.</template>
              <template v-else-if="p.rule.kind === 'fixed'">Fixed {{ usd(p.rule.value) }} a week — rule since {{ dayShort(p.rule.from) }}.</template>
              <template v-else-if="p.rule.kind === 'manual'">Typed in every week. {{ p.needsAmount ? `Suggested ${usd(p.suggested)} (last amount used).` : '' }}</template>
              <template v-if="p.note"> Note: {{ p.note }}</template>
            </p>
            <div v-if="!locked && p.rule.source !== 'sheet' && drafts[pid]" class="mt-2 space-y-1.5">
              <div class="flex gap-1.5">
                <Input v-model="drafts[pid].amount" type="number" step="0.01" class="h-8 w-32 text-right text-sm tabular-nums" :aria-label="`Payout for ${payeeName(String(pid))}`" @keydown.enter="savePayout(String(pid))" />
                <Input v-model="drafts[pid].note" placeholder="Why? (optional)" class="h-8 flex-1 text-sm" />
              </div>
              <div class="flex flex-wrap gap-1.5">
                <Button size="sm" class="h-7 text-xs" :disabled="busy" @click="savePayout(String(pid))">{{ p.rule.kind === 'manual' ? 'Save amount' : 'Use this amount this week' }}</Button>
                <Button v-if="p.overridden || p.manual" variant="ghost" size="sm" class="h-7 gap-1 text-xs" :disabled="busy" @click="resetPayout(String(pid))"><RotateCcw class="size-3" />Back to the rule</Button>
                <Button variant="ghost" size="sm" class="ml-auto h-7 text-xs" @click="emit('edit-rule', { dealerId: line.dealerId, dealerName: line.dealerName, payeeId: String(pid) })">Change the rule…</Button>
              </div>
            </div>
          </section>
          <p v-if="!Object.keys(line.payouts).length" class="rounded-xl border bg-card p-3 text-xs text-muted-foreground">No payee is paid on this dealer (its rule is “Not paid”).</p>

          <!-- Check deposited -->
          <section class="rounded-xl border bg-card p-3">
            <div class="flex items-center gap-2">
              <h4 class="text-sm font-semibold">Dealer's check</h4>
              <Badge variant="outline" class="h-5 text-[10px]" :class="DEPOSIT_META[line.deposited ? 'paid' : line.deposit]?.cls">{{ line.deposited ? 'Deposited' : DEPOSIT_META[line.deposit]?.label }}</Badge>
              <span v-if="line.depositOverride !== null" class="text-[11px] text-muted-foreground">set by hand</span>
            </div>
            <p class="mt-1 text-[11px] text-muted-foreground">{{ week.source === 'sheet' ? 'As ticked in the spreadsheet.' : 'Read from the invoice payment (Mark Paid on /sales/invoices). Tick by hand if the check came in some other way.' }}<template v-if="locked"> Reopen the week to change it.</template></p>
            <div v-if="!locked" class="mt-2 flex flex-wrap gap-1.5">
              <Button variant="outline" size="sm" class="h-7 text-xs" :disabled="busy || line.deposited" @click="run('setDeposited', { value: true }, 'Marked deposited')">Mark deposited</Button>
              <Button variant="outline" size="sm" class="h-7 text-xs" :disabled="busy || !line.deposited" @click="run('setDeposited', { value: false }, 'Marked not deposited')">Not deposited</Button>
              <Button v-if="line.depositOverride !== null" variant="ghost" size="sm" class="h-7 text-xs" :disabled="busy" @click="run('setDeposited', { value: null })">Automatic</Button>
            </div>
          </section>

          <!-- Invoices -->
          <section class="overflow-hidden rounded-xl border bg-card">
            <h4 class="flex items-center gap-1.5 border-b px-3 py-2 text-sm font-semibold"><Receipt class="size-4 text-muted-foreground" />{{ week.source === 'sheet' ? 'Invoices in the system for this week' : 'Invoices behind this line' }}</h4>
            <div v-if="liveLine || (week.source === 'sheet' && week.live)" class="grid grid-cols-3 gap-2 border-b px-3 py-2 text-[12px]">
              <div v-for="k in (['billed', 'net'] as const)" :key="k">
                <p class="capitalize text-muted-foreground">{{ k }} — invoices</p>
                <p class="font-medium tabular-nums">{{ usd(liveLine?.[k] || 0) }}</p>
                <p v-if="Math.abs((liveLine?.[k] || 0) - line[k]) > 0.01" class="text-[11px] tabular-nums text-amber-700 dark:text-amber-400">sheet {{ usd(line[k]) }}</p>
                <p v-else class="text-[11px] text-emerald-700 dark:text-emerald-400">matches the sheet</p>
              </div>
            </div>
            <p v-if="!invoices.length" class="px-3 py-3 text-xs text-muted-foreground">{{ week.source === 'sheet' ? 'No invoice in the system for this dealer and week.' : 'No invoices.' }}</p>
            <ul v-else class="divide-y text-[13px]">
              <li v-for="inv in invoices" :key="inv.id" class="flex items-center gap-2 px-3 py-1.5">
                <div class="min-w-0 flex-1">
                  <NuxtLink :to="invoiceLink(inv)" class="inline-flex items-center gap-1 font-medium hover:underline">{{ inv.number || inv.type }}<ExternalLink class="size-3 opacity-60" /></NuxtLink>
                  <p class="text-[11px] text-muted-foreground">{{ inv.type }} · {{ dayShort(String(inv.date).slice(0, 10)) }} · {{ inv.status }}<template v-if="inv.share != null"> · {{ (inv.share * 100).toFixed(1) }}% of the month</template></p>
                </div>
                <div class="text-right tabular-nums">
                  <p>{{ usd(inv.share != null ? inv.total * inv.share : inv.total) }}</p>
                  <p v-if="inv.paid" class="text-[11px] text-emerald-700 dark:text-emerald-400">paid {{ usd(inv.paid) }}</p>
                </div>
              </li>
            </ul>
            <p v-if="(liveLine || line).sources?.daily" class="border-t bg-amber-500/5 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">No Weekly invoice yet for this week, so its Daily invoices are used.</p>
          </section>

          <!-- Spreadsheet comparison -->
          <section v-if="sheetRow" class="rounded-xl border bg-card p-3">
            <h4 class="flex items-center gap-1.5 text-sm font-semibold"><FileSpreadsheet class="size-4 text-muted-foreground" />In the spreadsheet ({{ week.sheet.tab }})</h4>
            <div class="mt-2 grid grid-cols-3 gap-2 text-[12px]">
              <div v-for="k in (['billed', 'net', 'payout'] as const)" :key="k">
                <p class="capitalize text-muted-foreground">{{ k }}</p>
                <p class="font-medium tabular-nums">{{ usd(sheetRow[k]) }}</p>
                <p v-if="Math.abs(sheetRow[k] - (k === 'payout' ? line.payout : line[k])) > 0.01" class="text-[11px] tabular-nums text-amber-700 dark:text-amber-400">system {{ usd(k === 'payout' ? line.payout : line[k]) }}</p>
                <p v-else class="text-[11px] text-emerald-700 dark:text-emerald-400">matches</p>
              </div>
            </div>
          </section>
        </div>
      </template>
    </SheetContent>
  </Sheet>
</template>
