<script setup lang="ts">
import { AlertTriangle, CheckCircle2, CopyX, Loader2, Merge, Search } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * Clear duplicates — dealerships that were entered more than once (same name, city and state;
 * typically the same list imported twice).
 *
 * Reviewed before anything changes: every group shows the record that stays and the ones that
 * are folded into it. Nothing is deleted — contacts, activity, emails, audits and scan pages of a
 * duplicate move onto the kept record and the duplicate is archived as "merged". One click undoes
 * the whole run.
 */
interface Row { id: string, code: string, name: string, city: string, state: string, stage: string, website: string, won: boolean, createdAt: string | null, links: { contacts: number, activities: number, emails: number, audits: number }, scanPages: number }
interface Group { key: string, reason: string, keep: Row, remove: Row[] }

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ changed: [] }>()

const loading = ref(false)
const failed = ref('')
const groups = ref<Group[]>([])
const off = ref<Set<string>>(new Set())
const query = ref('')
const working = ref(false)
const problems = ref<{ name: string, message: string }[]>([])

async function load() {
  loading.value = true; failed.value = ''; problems.value = []
  try {
    const r = await $fetch<{ groups: Group[], records: number }>('/api/crm/data-quality/duplicates')
    groups.value = r.groups
    off.value = new Set()
  } catch (e: any) { failed.value = e?.data?.statusMessage || 'The list of duplicates could not be loaded.' } finally { loading.value = false }
}
watch(open, (o) => { if (o) { query.value = ''; load() } })

const shown = computed(() => { const q = query.value.trim().toLowerCase(); return q ? groups.value.filter(g => `${g.keep.name} ${g.keep.city} ${g.keep.code} ${g.remove.map(r => r.code).join(' ')}`.toLowerCase().includes(q)) : groups.value })
const chosen = computed(() => groups.value.filter(g => !off.value.has(g.key)))
const chosenRecords = computed(() => chosen.value.reduce((n, g) => n + g.remove.length, 0))
const totalRecords = computed(() => groups.value.reduce((n, g) => n + g.remove.length, 0))
const allOn = computed(() => shown.value.length > 0 && shown.value.every(g => !off.value.has(g.key)))
const someOn = computed(() => shown.value.some(g => !off.value.has(g.key)))
function toggle(key: string) { const s = new Set(off.value); s.has(key) ? s.delete(key) : s.add(key); off.value = s }
function toggleAll() { const s = new Set(off.value); const on = allOn.value; for (const g of shown.value) on ? s.add(g.key) : s.delete(g.key); off.value = s }

/** What the kept record already has — the reason it was picked. */
function has(r: Row) {
  const parts = [
    r.won ? 'won account' : '',
    r.links.contacts ? `${r.links.contacts} contact${r.links.contacts === 1 ? '' : 's'}` : '',
    r.links.activities ? `${r.links.activities} activit${r.links.activities === 1 ? 'y' : 'ies'}` : '',
    r.links.emails ? `${r.links.emails} email${r.links.emails === 1 ? '' : 's'}` : '',
    r.links.audits ? `${r.links.audits} audit${r.links.audits === 1 ? '' : 's'}` : '',
    r.scanPages ? `${r.scanPages} scan page${r.scanPages === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}
const carries = (r: Row) => r.links.contacts + r.links.activities + r.links.emails + r.links.audits + r.scanPages > 0

async function undo(batch: string, n: number) {
  try {
    const r = await $fetch<{ restored: number }>('/api/crm/data-quality/duplicates', { method: 'POST', body: { undo: batch } })
    toast.success(`Undone — ${r.restored} dealership${r.restored === 1 ? ' is' : 's are'} back in the list`)
    emit('changed')
  } catch (e: any) { toast.error('Could not undo', { description: e?.data?.statusMessage || `The ${n} merged records are still in the archive.` }) }
}

async function run() {
  if (!chosen.value.length || working.value) return
  working.value = true; problems.value = []
  try {
    const r = await $fetch<{ batch: string, groups: number, merged: number, skipped: number, failed: { name: string, message: string }[], remaining: number }>('/api/crm/data-quality/duplicates', { method: 'POST', body: { keys: chosen.value.map(g => g.key) } })
    emit('changed')
    if (r.merged) {
      toast.success(`${r.merged} duplicate${r.merged === 1 ? '' : 's'} merged`, {
        description: `${r.groups} dealership${r.groups === 1 ? '' : 's'} cleaned up — nothing was deleted.`,
        duration: 20_000,
        action: { label: 'Undo', onClick: () => undo(r.batch, r.merged) },
      })
    }
    problems.value = r.failed || []
    // Anything left (un-ticked, changed meanwhile, or refused) stays on screen; otherwise we are done.
    if (!r.failed?.length && !r.skipped && !r.remaining) open.value = false
    else { await load(); problems.value = r.failed || []; if (r.skipped) toast.warning(`${r.skipped} group${r.skipped === 1 ? ' was' : 's were'} skipped`, { description: 'Those records changed while this window was open — check them below.' }) }
  } catch (e: any) { toast.error('Duplicates were not merged', { description: e?.data?.statusMessage || 'Nothing changed. Try again.' }) } finally { working.value = false }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-3xl max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden [&>*]:min-w-0">
      <DialogHeader class="px-5 pt-5 pb-4 border-b">
        <div class="flex items-start gap-3">
          <div class="size-10 shrink-0 rounded-xl bg-amber-500/10 flex items-center justify-center"><CopyX class="size-5 text-amber-600 dark:text-amber-400" /></div>
          <div class="min-w-0">
            <DialogTitle class="text-base">Clear duplicates</DialogTitle>
            <DialogDescription class="text-xs mt-1">
              Dealerships entered more than once — same name, city and state. One record is kept; the contacts, activity, emails, audits and scan pages of the others move onto it.
              <b class="text-foreground">Nothing is deleted</b>, and the whole run can be undone.
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div v-if="loading" class="flex-1 min-h-48 flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 class="size-4 animate-spin" /> Looking for duplicates…</div>
      <div v-else-if="failed" class="flex-1 min-h-48 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle class="size-6 text-amber-500" />
        <p class="text-sm text-muted-foreground">{{ failed }}</p>
        <Button size="sm" variant="outline" @click="load">Try again</Button>
      </div>
      <div v-else-if="!groups.length" class="flex-1 min-h-48 flex flex-col items-center justify-center gap-2 p-6 text-center">
        <CheckCircle2 class="size-7 text-emerald-500" />
        <p class="text-sm font-medium">No duplicates</p>
        <p class="text-xs text-muted-foreground max-w-sm">Every dealership is in the list once. Look-alikes that need a person to decide (same phone, same name in another city) are under Data quality.</p>
      </div>
      <template v-else>
        <div class="shrink-0 flex flex-wrap items-center gap-2 px-5 py-2.5 border-b bg-muted/30">
          <p class="text-sm"><b class="tabular-nums">{{ totalRecords }}</b> duplicate record{{ totalRecords === 1 ? '' : 's' }} of <b class="tabular-nums">{{ groups.length }}</b> dealership{{ groups.length === 1 ? '' : 's' }}</p>
          <div class="relative ml-auto w-52 max-w-full">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input v-model="query" placeholder="Find a dealership…" class="h-8 pl-8 text-xs" aria-label="Find a dealership in the list" />
          </div>
        </div>
        <div v-if="problems.length" role="alert" class="shrink-0 px-5 py-2 border-b bg-rose-500/5 text-xs text-rose-700 dark:text-rose-300">
          <p class="font-semibold">{{ problems.length }} could not be merged:</p>
          <p v-for="(p, i) in problems.slice(0, 4)" :key="i">{{ p.name }} — {{ p.message }}</p>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto p-2">
          <table class="w-full text-sm">
            <thead class="sticky top-0 z-10">
              <tr>
                <th class="w-10 px-3 py-2 text-left"><Checkbox :model-value="allOn ? true : (someOn ? 'indeterminate' : false)" aria-label="Tick or untick every dealership shown" @update:model-value="toggleAll" /></th>
                <th class="px-2 py-2 text-left font-medium">Dealership</th>
                <th class="px-2 py-2 text-left font-medium">Kept</th>
                <th class="px-2 py-2 pr-5 text-left font-medium">Merged into it</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr v-for="g in shown" :key="g.key" class="align-top transition-colors hover:bg-muted/40" :class="off.has(g.key) && 'opacity-50'">
                <td class="px-3 py-2.5"><Checkbox :model-value="!off.has(g.key)" :aria-label="`Merge the duplicates of ${g.keep.name}`" @update:model-value="toggle(g.key)" /></td>
                <td class="px-2 py-2.5 min-w-0">
                  <p class="font-medium leading-snug">{{ g.keep.name }}</p>
                  <p class="text-xs text-muted-foreground">{{ [g.keep.city, g.keep.state].filter(Boolean).join(', ') || 'No city on file' }}<template v-if="g.keep.website"> · {{ g.keep.website }}</template></p>
                </td>
                <td class="px-2 py-2.5 whitespace-nowrap">
                  <p class="font-mono text-xs">{{ g.keep.code }}</p>
                  <p class="text-[11px] text-muted-foreground whitespace-normal max-w-[14rem]">{{ has(g.keep) || g.keep.stage || 'the older record' }}</p>
                </td>
                <td class="px-2 py-2.5 pr-5">
                  <div class="flex flex-wrap gap-1">
                    <span v-for="r in g.remove" :key="r.id" class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px]" :class="carries(r) ? 'border-sky-500/40 bg-sky-500/5 text-sky-700 dark:text-sky-300' : 'text-muted-foreground'" :title="carries(r) ? `Moves onto the kept record: ${has(r)}` : 'An empty copy'">
                      {{ r.code }}<template v-if="carries(r)"> · {{ has(r) }}</template>
                    </span>
                  </div>
                </td>
              </tr>
              <tr v-if="!shown.length"><td colspan="4" class="px-5 py-8 text-center text-xs text-muted-foreground">No dealership matches “{{ query }}”.</td></tr>
            </tbody>
          </table>
        </div>
      </template>

      <DialogFooter class="px-5 py-3 border-t flex-row items-center gap-2 sm:justify-between">
        <p class="text-[11px] text-muted-foreground mr-auto">{{ groups.length && !loading ? `${chosen.length} of ${groups.length} ticked` : '' }}</p>
        <Button variant="ghost" :disabled="working" @click="open = false">{{ groups.length ? 'Cancel' : 'Close' }}</Button>
        <Button v-if="groups.length && !loading" class="gap-1.5 min-w-44" :disabled="working || !chosenRecords" @click="run">
          <Loader2 v-if="working" class="size-4 animate-spin" /><Merge v-else class="size-4" />
          {{ working ? 'Merging…' : `Merge ${chosenRecords} duplicate${chosenRecords === 1 ? '' : 's'}` }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
