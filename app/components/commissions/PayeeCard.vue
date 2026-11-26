<script setup lang="ts">
import { Plus, Trash2, Repeat, Wallet, Undo2, Banknote, Check } from 'lucide-vue-next'

/**
 * One payee's payout for the week, laid out like a pay slip:
 * commission → deductions / additions → net payable → payments made → balance still to pay.
 */
const props = defineProps<{ payee: any, payDate: string, locked: boolean, presets: any[] }>()
const emit = defineEmits<{ (e: 'update', week: any): void }>()

const busy = ref(false)
async function run(op: string, fields: Record<string, any>, ok?: string) {
  busy.value = true
  try { emit('update', await patchCommissionWeek(props.payDate, op, { payeeId: props.payee.id, ...fields }, ok)) }
  catch {} finally { busy.value = false }
}

// ── Add deduction / addition
const addOpen = ref(false)
const adj = reactive({ label: '', amount: '' as any, sign: -1 as 1 | -1, note: '' })
function usePreset(p: any) {
  adj.label = p.label
  adj.sign = p.amount > 0 ? 1 : -1
  adj.amount = p.amount ? Math.abs(p.amount) : ''
}
async function addAdjustment() {
  const amount = Math.abs(Number(adj.amount)) * adj.sign
  if (!adj.label.trim() || !amount) return
  await run('addAdjustment', { label: adj.label.trim(), amount, note: adj.note }, `${adj.sign < 0 ? 'Deduction' : 'Addition'} added`)
  Object.assign(adj, { label: '', amount: '', sign: -1, note: '' })
  addOpen.value = false
}

// ── Recurring item: skip this week or change the amount
const editRc = ref<string | null>(null)
const rcAmount = ref<any>('')
function startRc(a: any) { editRc.value = a.id; rcAmount.value = a.amount }
async function saveRc(a: any) {
  await run('setRecurring', { recurringId: a.recurringId, label: a.label, amount: Number(rcAmount.value) === a.defaultAmount ? null : Number(rcAmount.value) })
  editRc.value = null
}

// ── Payments
const payOpen = ref(false)
const pay = reactive({ amount: '' as any, date: new Date().toISOString().slice(0, 10), method: 'Check', note: '' })
function openPay() { pay.amount = props.payee.balance > 0 ? props.payee.balance : ''; payOpen.value = true }
async function addPayment() {
  if (!Number(pay.amount)) return
  await run('addPayment', { amount: Number(pay.amount), date: pay.date, method: pay.method, note: pay.note }, 'Payment recorded')
  payOpen.value = false
  pay.note = ''
}

const paidPct = computed(() => props.payee.netPayable > 0 ? Math.min(100, Math.max(0, props.payee.paid / props.payee.netPayable * 100)) : 0)
</script>

<template>
  <section class="flex flex-col overflow-hidden rounded-xl border bg-card" :data-testid="`payee-${payee.id}`">
    <header class="flex items-center gap-2 border-b px-3 py-2.5">
      <div class="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">{{ payee.name.slice(0, 1) }}</div>
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm font-semibold">{{ payee.name }}</h3>
        <p class="truncate text-[11px] text-muted-foreground">
          <template v-if="payee.fundedBy">Paid by {{ payee.fundedByName }} out of their share — not a company cost</template>
          <template v-else>Payout statement</template>
        </p>
      </div>
      <Badge v-if="!payee.fundedBy" variant="outline" class="h-6 gap-1 tabular-nums" :class="payee.balance <= 0.005 ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400' : ''">
        <Check v-if="payee.balance <= 0.005" class="size-3" />{{ payee.balance <= 0.005 ? 'Paid in full' : `${usd(payee.balance)} due` }}
      </Badge>
    </header>

    <div class="space-y-0.5 px-3 py-2 text-[13px]">
      <div class="flex items-center justify-between py-1">
        <span class="flex items-center gap-1.5 font-medium">Commission earned <CrmHint text="The sum of this payee's payout on every dealer this week (see the Payout column)." /></span>
        <span class="font-semibold tabular-nums">{{ usd(payee.commission) }}</span>
      </div>

      <template v-if="!payee.fundedBy">
        <p class="pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Deductions &amp; additions</p>
        <div v-if="!payee.adjustments.length" class="py-1 text-xs text-muted-foreground">None this week.</div>
        <div v-for="a in payee.adjustments" :key="a.id" class="group flex min-h-7 items-center gap-2">
          <Repeat v-if="a.kind === 'recurring'" class="size-3.5 shrink-0 text-muted-foreground" :title="`Every ${a.every}`" />
          <span v-else class="size-3.5 shrink-0" />
          <span class="min-w-0 flex-1 truncate" :class="a.skipped && 'text-muted-foreground line-through'" :title="a.note || ''">{{ a.label }}<span v-if="a.note && a.kind !== 'recurring'" class="ml-1 text-[11px] text-muted-foreground">· {{ a.note }}</span></span>
          <template v-if="editRc === a.id">
            <Input v-model="rcAmount" type="number" step="0.01" class="h-7 w-24 text-right text-xs" @keydown.enter="saveRc(a)" @keydown.esc="editRc = null" />
            <Button size="sm" class="h-7 px-2 text-xs" :disabled="busy" @click="saveRc(a)">Save</Button>
          </template>
          <template v-else>
            <div v-if="!locked" class="flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <template v-if="a.kind === 'recurring'">
                <Button variant="ghost" size="sm" class="h-6 px-1.5 text-[11px]" :disabled="busy" @click="startRc(a)">Edit</Button>
                <Button variant="ghost" size="sm" class="h-6 px-1.5 text-[11px]" :disabled="busy" @click="run('setRecurring', { recurringId: a.recurringId, label: a.label, skip: !a.skipped })">{{ a.skipped ? 'Include' : 'Skip' }}</Button>
              </template>
              <Button v-else variant="ghost" size="icon" class="size-6 text-muted-foreground hover:text-destructive" aria-label="Remove" :disabled="busy" @click="run('removeAdjustment', { id: a.id }, 'Removed')"><Trash2 class="size-3.5" /></Button>
            </div>
            <span class="w-24 text-right tabular-nums" :class="a.skipped ? 'text-muted-foreground line-through' : a.amount < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'">{{ signedUsd(a.amount) }}</span>
          </template>
        </div>

        <Popover v-if="!locked" v-model:open="addOpen">
          <PopoverTrigger as-child>
            <Button variant="ghost" size="sm" class="-ml-2 h-7 gap-1 px-2 text-xs text-primary"><Plus class="size-3.5" />Add deduction or addition</Button>
          </PopoverTrigger>
          <PopoverContent align="start" class="w-80 p-3">
            <p class="mb-2 text-xs font-medium">Add to {{ payee.name }}'s payout this week</p>
            <div v-if="presets.length" class="mb-2 flex flex-wrap gap-1">
              <button v-for="p in presets" :key="p.id" type="button" class="rounded-md border px-2 py-0.5 text-[11px] hover:bg-muted" @click="usePreset(p)">{{ p.label }}<span v-if="p.amount" class="ml-1 text-muted-foreground">{{ signedUsd(p.amount) }}</span></button>
            </div>
            <div class="space-y-2">
              <div class="inline-flex h-8 w-full rounded-lg border bg-muted/40 p-0.5 text-xs" role="tablist">
                <button type="button" role="tab" :aria-selected="adj.sign < 0" class="flex-1 rounded-md" :class="adj.sign < 0 ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'" @click="adj.sign = -1">Take off (−)</button>
                <button type="button" role="tab" :aria-selected="adj.sign > 0" class="flex-1 rounded-md" :class="adj.sign > 0 ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'" @click="adj.sign = 1">Add (+)</button>
              </div>
              <Input v-model="adj.label" placeholder="What is it? e.g. Jeep, Supplies" class="h-8 text-sm" />
              <Input v-model="adj.amount" type="number" min="0" step="0.01" placeholder="Amount" class="h-8 text-sm" @keydown.enter="addAdjustment" />
              <Input v-model="adj.note" placeholder="Note (optional)" class="h-8 text-sm" />
              <Button size="sm" class="h-8 w-full" :disabled="busy || !adj.label.trim() || !Number(adj.amount)" @click="addAdjustment">Add</Button>
            </div>
          </PopoverContent>
        </Popover>

        <div class="mt-1 flex items-center justify-between border-t py-1.5">
          <span class="flex items-center gap-1.5 font-semibold">Net payable <CrmHint text="Commission earned plus additions minus deductions — what this payee is owed for the week." /></span>
          <span class="text-base font-bold tabular-nums">{{ usd(payee.netPayable) }}</span>
        </div>

        <p class="pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Payments made</p>
        <div v-if="!payee.payments.length" class="py-1 text-xs text-muted-foreground">Nothing paid yet.</div>
        <div v-for="p in payee.payments" :key="p.id" class="group flex min-h-7 items-center gap-2">
          <Banknote class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate">{{ p.note || p.method || 'Payment' }} <span class="text-[11px] text-muted-foreground">· {{ dayShort(p.date) }}{{ p.method && p.note ? ` · ${p.method}` : '' }}</span></span>
          <Button variant="ghost" size="icon" class="size-6 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100" aria-label="Remove payment" :disabled="busy" @click="run('removePayment', { id: p.id }, 'Payment removed')"><Undo2 class="size-3.5" /></Button>
          <span class="w-24 text-right tabular-nums">−{{ usd(p.amount) }}</span>
        </div>

        <div class="mt-1 rounded-lg border bg-muted/30 px-2.5 py-2">
          <div class="flex items-baseline justify-between">
            <span class="text-xs font-medium">Balance to pay</span>
            <span class="text-xl font-bold tabular-nums" :class="payee.balance <= 0.005 ? 'text-emerald-700 dark:text-emerald-400' : 'text-primary'">{{ usd(Math.max(0, payee.balance)) }}</span>
          </div>
          <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" :aria-valuenow="Math.round(paidPct)" aria-valuemin="0" aria-valuemax="100" aria-label="Share paid">
            <div class="h-full rounded-full bg-emerald-500 transition-all" :style="{ width: `${paidPct}%` }" />
          </div>
          <p class="mt-1 text-[11px] text-muted-foreground tabular-nums">{{ usd(payee.paid) }} of {{ usd(payee.netPayable) }} paid<template v-if="payee.balance < -0.005"> · overpaid by {{ usd(-payee.balance) }}</template></p>
        </div>

        <Popover v-model:open="payOpen">
          <PopoverTrigger as-child>
            <Button variant="outline" size="sm" class="mt-2 h-8 w-full gap-1.5" @click="openPay"><Wallet class="size-3.5" />Record a payment</Button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-72 p-3">
            <p class="mb-2 text-xs font-medium">Payment to {{ payee.name }}</p>
            <div class="grid grid-cols-[64px_1fr] items-center gap-2 text-xs">
              <label class="text-muted-foreground" for="pay-amt">Amount</label><Input id="pay-amt" v-model="pay.amount" type="number" step="0.01" class="h-8" />
              <label class="text-muted-foreground" for="pay-date">Date</label><Input id="pay-date" v-model="pay.date" type="date" class="h-8" />
              <label class="text-muted-foreground">Method</label>
              <Select v-model="pay.method"><SelectTrigger size="sm" class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="m in ['Check', 'Bank transfer', 'Zelle', 'Cash', 'Other']" :key="m" :value="m">{{ m }}</SelectItem></SelectContent></Select>
              <label class="text-muted-foreground" for="pay-note">Note</label><Input id="pay-note" v-model="pay.note" placeholder="e.g. 1st check (advance)" class="h-8" />
            </div>
            <Button size="sm" class="mt-3 h-8 w-full" :disabled="busy || !Number(pay.amount)" @click="addPayment">Save payment</Button>
          </PopoverContent>
        </Popover>
      </template>
    </div>
  </section>
</template>
