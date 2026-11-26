<script setup lang="ts">
import { toast } from 'vue-sonner'
import { History } from 'lucide-vue-next'

/**
 * Change how a payee is paid on one dealer, starting from a pay day. Earlier weeks keep the old
 * rule (the history of rules is listed), so re-opening an old week never changes what was paid.
 */
const props = defineProps<{ target: { dealerId: string, dealerName: string, payeeId: string } | null, from: string }>()
const emit = defineEmits<{ (e: 'close'): void, (e: 'saved'): void }>()
const open = computed({ get: () => !!props.target, set: (v) => { if (!v) emit('close') } })

const settings = ref<any>(null)
const form = reactive({ kind: 'percent', value: 75 as any, base: 'net', from: '', note: '' })
const saving = ref(false)

const payee = computed(() => settings.value?.payees.find((p: any) => p.id === props.target?.payeeId))
const history = computed(() => (settings.value?.rules || [])
  .filter((r: any) => r.payeeId === props.target?.payeeId && (r.dealerId === props.target?.dealerId || (!r.dealerId && commissionSameName(r.dealerName, props.target?.dealerName))))
  .sort((a: any, b: any) => b.from.localeCompare(a.from)))

function commissionSameName(a?: string, b?: string) {
  const n = (s?: string) => String(s || '').toLowerCase().replace(/mithcell/g, 'mitchell').replace(/[^a-z0-9]+/g, '')
  return !!a && !!b && n(a) === n(b)
}

watch(() => props.target, async (t) => {
  if (!t) return
  try {
    const res = await $fetch<any>('/api/commissions/settings')
    settings.value = res.settings
    const cur = history.value.find((r: any) => r.from <= props.from)
    Object.assign(form, cur
      ? { kind: cur.kind, value: cur.value, base: cur.base || 'net', note: '' }
      : { kind: 'percent', value: payee.value?.defaultPct ?? 75, base: payee.value?.base || 'net', note: '' })
    form.from = props.from
  }
  catch (e: any) { toast.error(commissionError(e, 'Could not load the plan')); emit('close') }
})

async function save() {
  if (!settings.value || !props.target) return
  saving.value = true
  try {
    const rules = settings.value.rules.filter((r: any) => !(r.payeeId === props.target!.payeeId && r.from === form.from && (r.dealerId === props.target!.dealerId || commissionSameName(r.dealerName, props.target!.dealerName))))
    rules.push({ payeeId: props.target.payeeId, dealerId: props.target.dealerId.startsWith('sheet:') ? null : props.target.dealerId, dealerName: props.target.dealerName, kind: form.kind, value: Number(form.value) || 0, base: form.base, from: form.from, note: form.note })
    await $fetch('/api/commissions/settings', { method: 'PUT', body: { ...settings.value, rules } })
    toast.success(`Rule saved — applies from ${dayShort(form.from)}`)
    emit('saved')
    emit('close')
  }
  catch (e: any) { toast.error(commissionError(e, 'Could not save the rule')) }
  finally { saving.value = false }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>How {{ payee?.name || 'the payee' }} is paid on {{ target?.dealerName }}</DialogTitle>
        <DialogDescription>Applies from the pay day you pick. Weeks before it keep their old rule.</DialogDescription>
      </DialogHeader>
      <div class="space-y-3">
        <div class="grid grid-cols-4 gap-1 rounded-lg border bg-muted/40 p-0.5 text-xs" role="tablist" aria-label="Rule type">
          <button v-for="k in (['percent', 'fixed', 'manual', 'none'] as const)" :key="k" type="button" role="tab" :aria-selected="form.kind === k" class="h-7 rounded-md" :class="form.kind === k ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'" @click="form.kind = k">{{ RULE_LABEL[k] }}</button>
        </div>
        <div v-if="form.kind === 'percent'" class="grid grid-cols-[1fr_1fr] gap-2">
          <label class="space-y-1 text-xs"><span class="text-muted-foreground">Percent</span><Input v-model="form.value" type="number" min="0" max="100" step="0.5" class="h-8" /></label>
          <label class="space-y-1 text-xs"><span class="text-muted-foreground">Of</span>
            <Select v-model="form.base"><SelectTrigger size="sm" class="h-8 w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="net">Net (after sales tax)</SelectItem><SelectItem value="billed">Billed (incl. sales tax)</SelectItem></SelectContent></Select>
          </label>
        </div>
        <label v-else-if="form.kind === 'fixed'" class="block space-y-1 text-xs"><span class="text-muted-foreground">Amount every week the dealer has work</span><Input v-model="form.value" type="number" min="0" step="0.01" class="h-8" /></label>
        <label v-else-if="form.kind === 'manual'" class="block space-y-1 text-xs"><span class="text-muted-foreground">Starting suggestion (each week you type the real amount; the last one is suggested next time)</span><Input v-model="form.value" type="number" min="0" step="0.01" class="h-8" /></label>
        <p v-else class="text-xs text-muted-foreground">{{ payee?.name }} is not paid on this dealer.</p>
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1 text-xs"><span class="text-muted-foreground">From pay day</span><Input v-model="form.from" type="date" class="h-8" /></label>
          <label class="space-y-1 text-xs"><span class="text-muted-foreground">Note</span><Input v-model="form.note" placeholder="optional" class="h-8" /></label>
        </div>
        <div v-if="history.length" class="rounded-lg border">
          <p class="flex items-center gap-1.5 border-b px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground"><History class="size-3.5" />Earlier rules</p>
          <ul class="max-h-32 divide-y overflow-y-auto text-[12px]">
            <li v-for="r in history" :key="r.id" class="flex items-center gap-2 px-2.5 py-1">
              <span class="w-24 text-muted-foreground">from {{ dayShort(r.from) }}</span><span class="flex-1">{{ ruleText(r) }}</span><span class="truncate text-muted-foreground">{{ r.note }}</span>
            </li>
          </ul>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="emit('close')">Cancel</Button>
        <Button :disabled="saving || !form.from" @click="save">Save rule</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
