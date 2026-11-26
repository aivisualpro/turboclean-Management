<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Plus, Trash2, Save, Users, Percent, Repeat, Building2, Landmark, Link2, FileSpreadsheet, Loader2, Undo2 } from 'lucide-vue-next'

/**
 * The commission plan: who is paid, how much per dealer, the weekly deductions, company overhead and
 * tax set-asides. Everything here was read from the 2026 spreadsheet on first use and can be changed.
 */
const props = defineProps<{ payDate: string }>()
const emit = defineEmits<{ (e: 'saved'): void }>()

const data = ref<any>(null)
const plan = ref<any>(null)
const loading = ref(false)
const saving = ref(false)
const dirty = computed(() => !!plan.value && !!data.value && JSON.stringify(plan.value) !== JSON.stringify(data.value.settings))

async function load() {
  loading.value = true
  try {
    data.value = await $fetch<any>('/api/commissions/settings')
    plan.value = JSON.parse(JSON.stringify(data.value.settings))
    if (!rulePayee.value) rulePayee.value = plan.value.payees[0]?.id || ''
  }
  catch (e: any) { toast.error(commissionError(e, 'Could not load the plan')) }
  finally { loading.value = false }
}
onMounted(load)

async function save() {
  saving.value = true
  try {
    await $fetch('/api/commissions/settings', { method: 'PUT', body: plan.value })
    toast.success('Plan saved — open weeks are recalculated')
    await load()
    emit('saved')
  }
  catch (e: any) { toast.error(commissionError(e, 'Could not save the plan')) }
  finally { saving.value = false }
}
const newId = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`
const today = new Date().toISOString().slice(0, 10)

// ── Payees
function addPayee() { plan.value.payees.push({ id: newId('p'), name: 'New payee', defaultPct: 75, base: 'net', active: true, scope: 'listed', fundedBy: null }) }
// ── Recurring
function addRecurring() { plan.value.recurring.push({ id: newId('rc'), payeeId: plan.value.payees[0]?.id, label: 'New item', amount: -100, every: 'week', from: props.payDate, to: null, active: true }) }
// ── Overhead / set-asides / presets
function addOverhead() { plan.value.overhead.push({ id: newId('oh'), label: 'New expense', amount: 0, per: 'month', from: null, to: null, active: true }) }
function addSetAside() { plan.value.setAsides.push({ id: newId('sa'), label: 'Set-aside', pct: 0, base: 'billed', kind: 'other', from: null, to: null, active: true }) }
function addPreset() { plan.value.presets.push({ id: newId('pr'), label: 'New item', amount: 0 }) }
const remove = (list: any[], i: number) => list.splice(i, 1)

// ── Dealer rules (current rule per dealer, with history)
const rulePayee = ref('')
const ruleSearch = ref('')
const onlyExceptions = ref(true)
const ruleTarget = ref<any>(null)
/** Show the dealer's name from the system; a spreadsheet name is used only until it is linked. */
const nameOf = (r: any) => {
  const id = r.dealerId || data.value?.sheetNames.find((x: any) => x.name === r.dealerName)?.dealerId
  return (id && data.value?.dealers.find((d: any) => d.id === id)?.name) || r.dealerName || r.dealerId
}
const ruleRows = computed(() => {
  if (!plan.value) return []
  const payee = plan.value.payees.find((p: any) => p.id === rulePayee.value)
  if (!payee) return []
  const groups = new Map<string, any[]>()
  for (const r of plan.value.rules.filter((x: any) => x.payeeId === payee.id)) {
    const key = r.dealerId || `name:${String(r.dealerName).toLowerCase()}`
    groups.set(key, [...(groups.get(key) || []), r])
  }
  const rows = [...groups.values()].map((rs) => {
    const sorted = [...rs].sort((a, b) => b.from.localeCompare(a.from))
    const current = sorted.find(r => r.from <= props.payDate) || sorted[sorted.length - 1]
    return { key: current.dealerId || current.dealerName, dealerId: current.dealerId, dealerName: nameOf(current), linked: !!current.dealerId || !!data.value?.sheetNames.find((s: any) => s.name === current.dealerName && s.dealerId), current, history: sorted, upcoming: sorted.filter(r => r.from > props.payDate) }
  })
  if (!onlyExceptions.value && payee.scope === 'all') {
    for (const d of data.value?.dealers || []) {
      if (rows.some(r => r.dealerId === d.id || commissionNameKey(r.dealerName) === commissionNameKey(d.name))) continue
      rows.push({ key: d.id, dealerId: d.id, dealerName: d.name, linked: true, current: null, history: [], upcoming: [] })
    }
  }
  const q = ruleSearch.value.trim().toLowerCase()
  return rows.filter(r => !q || r.dealerName?.toLowerCase().includes(q)).sort((a, b) => String(a.dealerName).localeCompare(String(b.dealerName)))
})
function commissionNameKey(s: string) { return String(s || '').toLowerCase().replace(/mithcell/g, 'mitchell').replace(/[^a-z0-9]+/g, '') }
function editRule(row: any) {
  if (dirty.value) return toast.warning('Save your other changes first')
  const sheetId = data.value?.sheetNames.find((s: any) => s.name === row.dealerName)?.dealerId
  ruleTarget.value = { dealerId: row.dealerId || sheetId || `sheet:${row.dealerName}`, dealerName: row.dealerName, payeeId: rulePayee.value }
}
const payeeName = (id: string) => plan.value?.payees.find((p: any) => p.id === id)?.name || id

// ── Spreadsheet names → dealers
function mapName(name: string, id: string) {
  plan.value.nameMap = { ...plan.value.nameMap }
  if (!id || id === '__auto') delete plan.value.nameMap[name]
  else plan.value.nameMap[name] = id
}
const unlinked = computed(() => (data.value?.sheetNames || []).filter((s: any) => !s.dealerId))

// ── Import the 2026 spreadsheet history
const importing = ref(false)
const preview = ref<any>(null)
async function runImport(dryRun: boolean, overwrite = false) {
  if (dirty.value) return toast.warning('Save your changes first')
  importing.value = true
  try {
    const res = await $fetch<any>('/api/commissions/import-sheet', { method: 'POST', body: { dryRun, overwrite } })
    if (dryRun) preview.value = res
    else { preview.value = null; toast.success(`${res.imported} pay days imported from the spreadsheet`); await load(); emit('saved') }
  }
  catch (e: any) { toast.error(commissionError(e, 'Import failed')) }
  finally { importing.value = false }
}

const SECTIONS = [
  { id: 'payees', label: 'Payees', icon: Users },
  { id: 'rules', label: 'Dealer rules', icon: Percent },
  { id: 'recurring', label: 'Weekly deductions', icon: Repeat },
  { id: 'company', label: 'Overhead & set-asides', icon: Building2 },
  { id: 'names', label: 'Spreadsheet', icon: FileSpreadsheet },
] as const
const section = ref<(typeof SECTIONS)[number]['id']>('payees')
</script>

<template>
  <div class="space-y-2">
    <div v-if="!plan" class="flex items-center justify-center gap-2 py-24 text-muted-foreground"><Loader2 class="size-4 animate-spin" />Loading the plan…</div>
    <template v-else>
      <div v-if="!plan.configured" class="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-[13px]">
        <FileSpreadsheet class="size-4 text-primary" />
        <p class="min-w-0 flex-1">This plan was read from the <b class="font-medium">2026 spreadsheet</b> (75% to Carlos, the dealer exceptions, his weekly deductions, overhead and the income-tax set-aside). Check it and press <b class="font-medium">Save plan</b> to start using it.</p>
      </div>

      <div class="flex flex-col gap-2 lg:flex-row">
        <!-- Section nav -->
        <nav class="flex shrink-0 gap-1 overflow-x-auto rounded-xl border bg-card p-1 lg:w-52 lg:flex-col" aria-label="Plan sections">
          <button
            v-for="s in SECTIONS" :key="s.id" type="button" class="flex items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors"
            :class="section === s.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'" :aria-current="section === s.id ? 'page' : undefined" @click="section = s.id"
          >
            <component :is="s.icon" class="size-4 shrink-0" />{{ s.label }}
            <span v-if="s.id === 'names' && unlinked.length" class="ml-auto rounded bg-amber-500/20 px-1 text-[10px] font-semibold text-amber-800 dark:text-amber-300">{{ unlinked.length }}</span>
          </button>
          <div class="mt-auto hidden border-t p-2 lg:block">
            <Button class="h-8 w-full gap-1.5" :disabled="!dirty || saving" @click="save"><Loader2 v-if="saving" class="size-3.5 animate-spin" /><Save v-else class="size-3.5" />Save plan</Button>
            <Button v-if="dirty" variant="ghost" class="mt-1 h-7 w-full gap-1 text-xs" @click="load"><Undo2 class="size-3" />Undo changes</Button>
          </div>
        </nav>

        <div class="min-w-0 flex-1 space-y-2">
          <!-- PAYEES -->
          <section v-if="section === 'payees'" class="overflow-hidden rounded-xl border bg-card">
            <header class="flex items-center gap-2 border-b px-3 py-2.5">
              <h3 class="text-sm font-semibold">Payees</h3>
              <CrmHint text="People paid a commission. “Every dealer” = everyone with revenue gets the standard %, unless the dealer has its own rule. “Paid by” = paid out of another payee's share (shown, not a company cost)." />
              <Button variant="outline" size="sm" class="ml-auto h-7 gap-1 text-xs" @click="addPayee"><Plus class="size-3.5" />Add payee</Button>
            </header>
            <table class="w-full">
              <thead><tr><th class="text-left">Name</th><th class="text-right">Standard %</th><th class="text-left">Of</th><th class="text-left">Dealers</th><th class="text-left">Paid by</th><th class="text-center">Active</th><th /></tr></thead>
              <tbody>
                <tr v-for="(p, i) in plan.payees" :key="p.id">
                  <td><Input v-model="p.name" class="h-7 text-[13px]" aria-label="Name" /></td>
                  <td class="w-28"><Input v-model.number="p.defaultPct" type="number" min="0" max="100" step="0.5" class="h-7 text-right text-[13px]" aria-label="Standard percent" /></td>
                  <td class="w-36"><Select v-model="p.base"><SelectTrigger size="sm" class="h-7 w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="net">Net</SelectItem><SelectItem value="billed">Billed</SelectItem></SelectContent></Select></td>
                  <td class="w-40"><Select v-model="p.scope"><SelectTrigger size="sm" class="h-7 w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Every dealer</SelectItem><SelectItem value="listed">Only listed dealers</SelectItem></SelectContent></Select></td>
                  <td class="w-40"><Select :model-value="p.fundedBy || '__none'" @update:model-value="(v: any) => p.fundedBy = v === '__none' ? null : v"><SelectTrigger size="sm" class="h-7 w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none">The company</SelectItem><SelectItem v-for="o in plan.payees.filter((x: any) => x.id !== p.id)" :key="o.id" :value="o.id">{{ o.name }}</SelectItem></SelectContent></Select></td>
                  <td class="text-center"><Switch v-model="p.active" :aria-label="`${p.name} active`" /></td>
                  <td class="w-10"><Button variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-destructive" :disabled="plan.payees.length < 2" aria-label="Remove payee" @click="remove(plan.payees, i)"><Trash2 class="size-3.5" /></Button></td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- DEALER RULES -->
          <section v-if="section === 'rules'" class="overflow-hidden rounded-xl border bg-card">
            <header class="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
              <h3 class="text-sm font-semibold">Dealer rules</h3>
              <CrmHint text="How a payee is paid on each dealer. Each change starts on a pay day; earlier weeks keep the old rule. Shown as of the pay day open on the Week tab." />
              <Select v-model="rulePayee"><SelectTrigger size="sm" class="h-7 w-36 text-xs" aria-label="Payee"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="p in plan.payees" :key="p.id" :value="p.id">{{ p.name }}</SelectItem></SelectContent></Select>
              <label class="flex items-center gap-1.5 text-xs text-muted-foreground"><Switch v-model="onlyExceptions" />Only exceptions</label>
              <Input v-model="ruleSearch" placeholder="Find a dealer" class="ml-auto h-7 w-44 text-xs" />
            </header>
            <p v-if="dirty" class="border-b bg-amber-500/5 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">Save your other changes before changing a dealer rule.</p>
            <table class="w-full">
              <thead><tr><th class="text-left">Dealer</th><th class="text-left">Now ({{ dayShort(payDate) }})</th><th class="text-left">Since</th><th class="text-left">History</th><th /></tr></thead>
              <tbody>
                <tr v-for="r in ruleRows" :key="r.key">
                  <td class="font-medium">{{ r.dealerName }}<span v-if="!r.linked" class="ml-1.5 text-[10px] font-normal text-amber-700 dark:text-amber-400">not linked</span></td>
                  <td>
                    <span v-if="r.current" class="inline-flex h-5 items-center rounded border bg-muted/60 px-1.5 text-[11px]">{{ r.current.kind === 'manual' ? 'Typed in weekly' : ruleText(r.current) }}</span>
                    <span v-else class="text-[11px] text-muted-foreground">Standard {{ plan.payees.find((p: any) => p.id === rulePayee)?.defaultPct }}%</span>
                    <span v-if="r.upcoming.length" class="ml-1.5 text-[10px] text-sky-700 dark:text-sky-400">then {{ ruleText(r.upcoming[r.upcoming.length - 1]) }} from {{ dayShort(r.upcoming[r.upcoming.length - 1].from) }}</span>
                  </td>
                  <td class="text-[12px] text-muted-foreground">{{ r.current ? dayShort(r.current.from) : '—' }}</td>
                  <td class="text-[11px] text-muted-foreground">{{ r.history.length > 1 ? r.history.slice(1).map((h: any) => `${ruleText(h)} from ${dayShort(h.from)}`).join(' · ') : '' }}</td>
                  <td class="w-24 text-right"><Button variant="ghost" size="sm" class="h-7 text-xs" :disabled="dirty" @click="editRule(r)">Change…</Button></td>
                </tr>
                <tr v-if="!ruleRows.length"><td colspan="5" class="py-6 text-center text-xs text-muted-foreground">{{ onlyExceptions ? `Every dealer pays ${payeeName(rulePayee)} the standard rate. Turn off “Only exceptions” to add a rule.` : 'No dealers match.' }}</td></tr>
              </tbody>
            </table>
          </section>

          <!-- RECURRING -->
          <section v-if="section === 'recurring'" class="space-y-2">
            <div class="overflow-hidden rounded-xl border bg-card">
              <header class="flex items-center gap-2 border-b px-3 py-2.5">
                <h3 class="text-sm font-semibold">Weekly deductions &amp; additions</h3>
                <CrmHint text="Added to the payee's statement automatically. Negative = taken off (insurance, donation); positive = added. “Monthly” items land on the first pay day of each month. Each week you can still skip or change one." />
                <Button variant="outline" size="sm" class="ml-auto h-7 gap-1 text-xs" @click="addRecurring"><Plus class="size-3.5" />Add</Button>
              </header>
              <table class="w-full">
                <thead><tr><th class="text-left">Payee</th><th class="text-left">What</th><th class="text-right">Amount</th><th class="text-left">Every</th><th class="text-left">From</th><th class="text-left">Until</th><th class="text-center">On</th><th /></tr></thead>
                <tbody>
                  <tr v-for="(r, i) in plan.recurring" :key="r.id" :class="(r.to && r.to < today) && 'opacity-60'">
                    <td class="w-32"><Select v-model="r.payeeId"><SelectTrigger size="sm" class="h-7 w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="p in plan.payees" :key="p.id" :value="p.id">{{ p.name }}</SelectItem></SelectContent></Select></td>
                    <td><Input v-model="r.label" class="h-7 text-[13px]" /></td>
                    <td class="w-28"><Input v-model.number="r.amount" type="number" step="0.01" class="h-7 text-right text-[13px] tabular-nums" :class="r.amount < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'" /></td>
                    <td class="w-28"><Select v-model="r.every"><SelectTrigger size="sm" class="h-7 w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="week">Week</SelectItem><SelectItem value="month">Month</SelectItem></SelectContent></Select></td>
                    <td class="w-36"><Input v-model="r.from" type="date" class="h-7 text-xs" /></td>
                    <td class="w-36"><Input :model-value="r.to || ''" type="date" class="h-7 text-xs" @update:model-value="(v: any) => r.to = v || null" /></td>
                    <td class="text-center"><Switch v-model="r.active" /></td>
                    <td class="w-10"><Button variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-destructive" aria-label="Remove" @click="remove(plan.recurring, i)"><Trash2 class="size-3.5" /></Button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="overflow-hidden rounded-xl border bg-card">
              <header class="flex items-center gap-2 border-b px-3 py-2.5">
                <h3 class="text-sm font-semibold">Quick-add buttons</h3>
                <CrmHint text="One-off items you add to a week with one click (e.g. Jeep). The amount is a starting value you can change." />
                <Button variant="outline" size="sm" class="ml-auto h-7 gap-1 text-xs" @click="addPreset"><Plus class="size-3.5" />Add</Button>
              </header>
              <div class="flex flex-wrap gap-2 p-3">
                <div v-for="(p, i) in plan.presets" :key="p.id" class="flex items-center gap-1 rounded-lg border p-1">
                  <Input v-model="p.label" class="h-7 w-32 text-xs" /><Input v-model.number="p.amount" type="number" step="0.01" class="h-7 w-24 text-right text-xs" />
                  <Button variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-destructive" aria-label="Remove" @click="remove(plan.presets, i)"><Trash2 class="size-3.5" /></Button>
                </div>
              </div>
            </div>
          </section>

          <!-- COMPANY -->
          <section v-if="section === 'company'" class="space-y-2">
            <div class="overflow-hidden rounded-xl border bg-card">
              <header class="flex items-center gap-2 border-b px-3 py-2.5">
                <Building2 class="size-4 text-muted-foreground" /><h3 class="text-sm font-semibold">Company overhead</h3>
                <CrmHint text="Running costs taken off each week's profit. Monthly amounts count as ×12 ÷ 52 a week ($179 a month = $41.31 a week), like the spreadsheet." />
                <Button variant="outline" size="sm" class="ml-auto h-7 gap-1 text-xs" @click="addOverhead"><Plus class="size-3.5" />Add</Button>
              </header>
              <table class="w-full">
                <thead><tr><th class="text-left">Expense</th><th class="text-right">Amount</th><th class="text-left">Per</th><th class="text-right">A week</th><th class="text-left">From</th><th class="text-left">Until</th><th class="text-center">On</th><th /></tr></thead>
                <tbody>
                  <tr v-for="(o, i) in plan.overhead" :key="o.id" :class="(o.to && o.to < today) && 'opacity-60'">
                    <td><Input v-model="o.label" class="h-7 text-[13px]" /></td>
                    <td class="w-28"><Input v-model.number="o.amount" type="number" step="0.01" class="h-7 text-right text-[13px]" /></td>
                    <td class="w-28"><Select v-model="o.per"><SelectTrigger size="sm" class="h-7 w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="week">Week</SelectItem><SelectItem value="month">Month</SelectItem><SelectItem value="year">Year</SelectItem></SelectContent></Select></td>
                    <td class="w-24 text-right text-[12px] tabular-nums text-muted-foreground">{{ usd(o.per === 'week' ? o.amount : o.per === 'year' ? o.amount / 52 : o.amount * 12 / 52) }}</td>
                    <td class="w-36"><Input :model-value="o.from || ''" type="date" class="h-7 text-xs" @update:model-value="(v: any) => o.from = v || null" /></td>
                    <td class="w-36"><Input :model-value="o.to || ''" type="date" class="h-7 text-xs" @update:model-value="(v: any) => o.to = v || null" /></td>
                    <td class="text-center"><Switch v-model="o.active" /></td>
                    <td class="w-10"><Button variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-destructive" aria-label="Remove" @click="remove(plan.overhead, i)"><Trash2 class="size-3.5" /></Button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="overflow-hidden rounded-xl border bg-card">
              <header class="flex items-center gap-2 border-b px-3 py-2.5">
                <Landmark class="size-4 text-muted-foreground" /><h3 class="text-sm font-semibold">Set-asides</h3>
                <CrmHint text="Money put aside each week. The spreadsheet takes income tax as a % of the billed total (7% until Feb 20, 10% since Feb 27) and Zakat as 2.5% of profit." />
                <Button variant="outline" size="sm" class="ml-auto h-7 gap-1 text-xs" @click="addSetAside"><Plus class="size-3.5" />Add</Button>
              </header>
              <table class="w-full">
                <thead><tr><th class="text-left">Name</th><th class="text-right">%</th><th class="text-left">Of</th><th class="text-left">Track as</th><th class="text-left">From</th><th class="text-left">Until</th><th class="text-center">On</th><th /></tr></thead>
                <tbody>
                  <tr v-for="(a, i) in plan.setAsides" :key="a.id" :class="(a.to && a.to < today) && 'opacity-60'">
                    <td><Input v-model="a.label" class="h-7 text-[13px]" /></td>
                    <td class="w-24"><Input v-model.number="a.pct" type="number" min="0" max="100" step="0.1" class="h-7 text-right text-[13px]" /></td>
                    <td class="w-36"><Select v-model="a.base"><SelectTrigger size="sm" class="h-7 w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="billed">Billed (incl. tax)</SelectItem><SelectItem value="net">Net</SelectItem><SelectItem value="profit">Net profit</SelectItem></SelectContent></Select></td>
                    <td class="w-36"><Select v-model="a.kind"><SelectTrigger size="sm" class="h-7 w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="incomeTax">Income tax (tick when paid)</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></td>
                    <td class="w-36"><Input :model-value="a.from || ''" type="date" class="h-7 text-xs" @update:model-value="(v: any) => a.from = v || null" /></td>
                    <td class="w-36"><Input :model-value="a.to || ''" type="date" class="h-7 text-xs" @update:model-value="(v: any) => a.to = v || null" /></td>
                    <td class="text-center"><Switch v-model="a.active" /></td>
                    <td class="w-10"><Button variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-destructive" aria-label="Remove" @click="remove(plan.setAsides, i)"><Trash2 class="size-3.5" /></Button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="rounded-xl border bg-card px-3 py-2.5">
              <h3 class="flex items-center gap-1.5 text-sm font-semibold">Monthly invoices <CrmHint text="Monthly invoices (/sales/monthly-invoices) cover a whole month. Spread = each pay day gets the share of the month its work week covers (7 of 30 days ≈ 23%). Lump sum = the whole invoice counts on the pay day after the month ends." /></h3>
              <div class="mt-2 inline-flex h-8 rounded-lg border bg-muted/40 p-0.5 text-xs" role="tablist">
                <button type="button" role="tab" :aria-selected="plan.monthlyAllocation === 'spread'" class="rounded-md px-3" :class="plan.monthlyAllocation === 'spread' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'" @click="plan.monthlyAllocation = 'spread'">Spread over the weeks</button>
                <button type="button" role="tab" :aria-selected="plan.monthlyAllocation === 'lump'" class="rounded-md px-3" :class="plan.monthlyAllocation === 'lump' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'" @click="plan.monthlyAllocation = 'lump'">Lump sum after month end</button>
              </div>
            </div>
          </section>

          <!-- SPREADSHEET -->
          <section v-if="section === 'names'" class="space-y-2">
            <div class="rounded-xl border bg-card px-3 py-2.5">
              <h3 class="flex items-center gap-1.5 text-sm font-semibold"><FileSpreadsheet class="size-4 text-muted-foreground" />2026 spreadsheet history</h3>
              <p class="mt-1 text-[12px] text-muted-foreground">
                Brings in the {{ data.sheetWeeks }} weekly tabs (Jan 2 – Nov 20) as paid weeks: Carlos's payout per dealer, his deductions, the advances (“1st check”) and the tax payments — so the year's totals are complete.
                The invoice totals in the system stay visible next to them, and any week that doesn't match is flagged.
                <b v-if="data.importedWeeks" class="font-medium text-foreground">{{ data.importedWeeks }} weeks already imported.</b>
              </p>
              <div class="mt-2 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" class="h-8 gap-1.5" :disabled="importing" @click="runImport(true)"><Loader2 v-if="importing" class="size-3.5 animate-spin" />Preview import</Button>
                <Button v-if="preview" size="sm" class="h-8" :disabled="importing" @click="runImport(false)">Import {{ preview.imported }} pay day{{ preview.imported === 1 ? '' : 's' }}</Button>
                <Button v-if="data.importedWeeks" variant="ghost" size="sm" class="h-8 text-xs" :disabled="importing" @click="runImport(false, true)">Re-import (replace imported weeks)</Button>
              </div>
              <div v-if="preview" class="mt-2 rounded-lg border bg-muted/30 p-2 text-[12px]">
                <p><b class="font-medium">{{ preview.imported }}</b> to import · {{ preview.kept }} kept (they already have a statement)</p>
                <p v-if="preview.unmapped.length" class="mt-1 text-amber-800 dark:text-amber-300">Not linked to a dealer yet: {{ preview.unmapped.join(', ') }} — link them below first for the best comparison (you can also import now and link later).</p>
              </div>
            </div>
            <div class="overflow-hidden rounded-xl border bg-card">
              <header class="flex items-center gap-2 border-b px-3 py-2.5">
                <Link2 class="size-4 text-muted-foreground" /><h3 class="text-sm font-semibold">Spreadsheet names → dealers</h3>
                <CrmHint text="The spreadsheet spells dealers its own way (“MITHCELL VOLVO”, “Ford”). Each name is linked to a dealer in the system automatically when it's clear; pick the dealer for the rest." />
                <span v-if="unlinked.length" class="ml-auto text-[11px] font-medium text-amber-700 dark:text-amber-400">{{ unlinked.length }} not linked</span>
              </header>
              <table class="w-full">
                <thead><tr><th class="text-left">In the spreadsheet</th><th class="text-left">Dealer in the system</th></tr></thead>
                <tbody>
                  <tr v-for="s in data.sheetNames" :key="s.name">
                    <td class="font-medium">{{ s.name }}</td>
                    <td class="w-80">
                      <Select :model-value="plan.nameMap[s.name] || (s.dealerId ? `__found:${s.dealerId}` : '__auto')" @update:model-value="(v: any) => mapName(s.name, String(v).startsWith('__found:') ? '' : v)">
                        <SelectTrigger size="sm" class="h-7 w-full text-xs" :class="!s.dealerId && !plan.nameMap[s.name] && 'border-amber-500/60'"><SelectValue placeholder="Pick a dealer" /></SelectTrigger>
                        <SelectContent class="max-h-72">
                          <SelectItem v-if="s.dealerId && !s.mapped" :value="`__found:${s.dealerId}`">{{ data.dealers.find((d: any) => d.id === s.dealerId)?.name }} (found automatically)</SelectItem>
                          <SelectItem v-else value="__auto">— Pick a dealer —</SelectItem>
                          <SelectItem value="__ignore">Not a dealer / ignore</SelectItem>
                          <SelectItem v-for="d in data.dealers" :key="d.id" :value="d.id">{{ d.name }}</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <div class="sticky bottom-0 flex items-center gap-2 rounded-xl border bg-card/95 px-3 py-2 backdrop-blur lg:hidden">
            <span class="text-xs text-muted-foreground">{{ dirty ? 'Unsaved changes' : 'All saved' }}</span>
            <Button class="ml-auto h-8 gap-1.5" :disabled="!dirty || saving" @click="save"><Save class="size-3.5" />Save plan</Button>
          </div>
          <p v-if="dirty" class="hidden text-right text-[11px] text-amber-700 dark:text-amber-400 lg:block">Unsaved changes — press Save plan.</p>
        </div>
      </div>
    </template>
    <CommissionsRuleDialog :target="ruleTarget" :from="payDate" @close="ruleTarget = null" @saved="load(); emit('saved')" />
  </div>
</template>
