<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { AlertTriangle, CheckCircle2, DatabaseZap, Loader2, Plus, Search } from 'lucide-vue-next'

/**
 * AppSheet → app recovery: lists rows that exist in AppSheet but not in the app
 * (e.g. added while the AppSheet webhook was being rejected) and adds the ticked ones.
 * Never changes or deletes existing records. API: POST /api/sync/missing-from-appsheet
 */

interface Row { id: string, label: string, warning?: string, note?: string }
interface TableReport {
  table: string
  checked: number
  alreadyInApp: number
  missing: Row[]
  skipped: Row[]
  added?: number
  failed?: { id: string, label: string, error: string }[]
  error?: string
}

const TABLE_LABELS: Record<string, string> = {
  Dealers: 'Dealers',
  Services: 'Services',
  AppUsers: 'Users',
  DealerServices: 'Dealer services',
  WorkOrders: 'Work orders',
}

const since = ref('2026-11-05')
const checking = ref(false)
const adding = ref(false)
const report = ref<TableReport[] | null>(null)
const lastAdd = ref<TableReport[] | null>(null)
const picked = ref(new Set<string>())

const key = (table: string, id: string) => `${table}:${id}`
const totalMissing = computed(() => (report.value || []).reduce((n, t) => n + t.missing.length, 0))
const pickedCount = computed(() => picked.value.size)

function toggle(table: string, id: string) {
  const s = new Set(picked.value)
  const k = key(table, id)
  s.has(k) ? s.delete(k) : s.add(k)
  picked.value = s
}
function setTable(t: TableReport, on: boolean) {
  const s = new Set(picked.value)
  for (const r of t.missing) on ? s.add(key(t.table, r.id)) : s.delete(key(t.table, r.id))
  picked.value = s
}
const allPicked = (t: TableReport) => t.missing.length > 0 && t.missing.every(r => picked.value.has(key(t.table, r.id)))

async function check() {
  checking.value = true
  lastAdd.value = null
  try {
    const res: any = await $fetch('/api/sync/missing-from-appsheet', { method: 'POST', body: { since: since.value, dryRun: true } })
    report.value = res.tables
    // Tick everything except rows that look like they were re-entered by hand
    picked.value = new Set(res.tables.flatMap((t: TableReport) => t.missing.filter(r => !r.warning).map(r => key(t.table, r.id))))
    const n = res.tables.reduce((a: number, t: TableReport) => a + t.missing.length, 0)
    n ? toast.info(`${n} record(s) are in AppSheet but missing in the app`) : toast.success('Nothing missing — the app has every AppSheet record')
  }
  catch (e: any) {
    toast.error(`Check failed: ${e?.data?.statusMessage || e?.message || e}`)
  }
  finally {
    checking.value = false
  }
}

async function addPicked() {
  if (!pickedCount.value) return
  adding.value = true
  try {
    const res: any = await $fetch('/api/sync/missing-from-appsheet', { method: 'POST', body: { since: since.value, dryRun: false, ids: [...picked.value] } })
    lastAdd.value = res.tables
    const failed = res.tables.reduce((a: number, t: TableReport) => a + (t.failed?.length || 0), 0)
    failed ? toast.warning(`Added ${res.added}, ${failed} failed — see the list`) : toast.success(`Added ${res.added} record(s) from AppSheet`)
    // Refresh the list so it shows what is still missing
    await check()
  }
  catch (e: any) {
    toast.error(`Add failed: ${e?.data?.statusMessage || e?.message || e}`)
  }
  finally {
    adding.value = false
  }
}
</script>

<template>
  <div class="flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
    <div class="shrink-0 border-b bg-muted/30 p-5 flex flex-wrap items-center gap-3">
      <div class="p-2 bg-primary/10 text-primary rounded-lg border border-primary/20">
        <DatabaseZap class="size-5" />
      </div>
      <div class="flex-1 min-w-[220px]">
        <h3 class="font-semibold text-base leading-none">Missing records from AppSheet</h3>
        <p class="text-sm text-muted-foreground mt-1.5">
          Finds records that exist in AppSheet but never reached the app, and adds the ones you tick.
          Existing records are never changed or deleted.
        </p>
      </div>
      <div class="flex items-end gap-2">
        <div class="grid gap-1">
          <Label class="text-xs text-muted-foreground">Work orders dated from</Label>
          <Input v-model="since" type="date" class="h-9 w-40 text-sm" />
        </div>
        <Button :disabled="checking || adding" class="gap-2" @click="check">
          <Loader2 v-if="checking" class="size-4 animate-spin" />
          <Search v-else class="size-4" />
          {{ report ? 'Check again' : 'Find missing records' }}
        </Button>
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
      <p v-if="!report && !checking" class="text-sm text-muted-foreground">
        Nothing is written until you press <b>Add</b>. Checking reads every AppSheet table (work orders only from the date above), so it can take a minute.
      </p>
      <div v-if="checking && !report" class="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 class="size-4 animate-spin" /> Reading AppSheet…
      </div>

      <!-- Result of the last Add -->
      <div v-if="lastAdd" class="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
        <div v-for="t in lastAdd" :key="`a-${t.table}`">
          <template v-if="t.added || t.failed?.length">
            <span class="font-medium">{{ TABLE_LABELS[t.table] || t.table }}:</span>
            added {{ t.added || 0 }}<span v-if="t.failed?.length" class="text-rose-600">, {{ t.failed.length }} failed</span>
            <ul v-if="t.failed?.length" class="ml-4 list-disc text-xs text-rose-600">
              <li v-for="f in t.failed" :key="f.id">{{ f.label }} — {{ f.error }}</li>
            </ul>
          </template>
        </div>
      </div>

      <template v-if="report">
        <div v-for="t in report" :key="t.table" class="rounded-lg border">
          <div class="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
            <span class="font-medium text-sm">{{ TABLE_LABELS[t.table] || t.table }}</span>
            <Badge v-if="t.error" variant="destructive">Error</Badge>
            <Badge v-else-if="t.missing.length" variant="secondary" class="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">{{ t.missing.length }} missing</Badge>
            <Badge v-else variant="secondary" class="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">All there</Badge>
            <span class="text-xs text-muted-foreground">{{ t.checked }} checked in AppSheet · {{ t.alreadyInApp }} already in the app</span>
            <button v-if="t.missing.length" type="button" class="ml-auto text-xs text-primary hover:underline" @click="setTable(t, !allPicked(t))">
              {{ allPicked(t) ? 'Untick all' : 'Tick all' }}
            </button>
          </div>
          <p v-if="t.error" class="px-3 py-2 text-xs text-rose-600">{{ t.error }}</p>
          <ul v-if="t.missing.length" class="divide-y max-h-80 overflow-y-auto">
            <li v-for="r in t.missing" :key="r.id" class="flex items-start gap-2 px-3 py-2 text-sm">
              <input type="checkbox" class="mt-0.5 size-4 accent-primary cursor-pointer" :checked="picked.has(key(t.table, r.id))" @change="toggle(t.table, r.id)">
              <div class="min-w-0">
                <div class="truncate">{{ r.label }}</div>
                <div v-if="r.warning" class="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle class="size-3.5 shrink-0" />{{ r.warning }}</div>
                <div v-if="r.note" class="text-xs text-muted-foreground">{{ r.note }}</div>
                <div class="text-[11px] text-muted-foreground/70 font-mono">{{ r.id }}</div>
              </div>
            </li>
          </ul>
          <details v-if="t.skipped.length" class="px-3 py-2 text-xs text-muted-foreground">
            <summary class="cursor-pointer">{{ t.skipped.length }} can't be added</summary>
            <ul class="ml-4 list-disc mt-1">
              <li v-for="(r, i) in t.skipped" :key="`s-${i}`">{{ r.label }} — {{ r.warning }}</li>
            </ul>
          </details>
        </div>

        <div v-if="!totalMissing" class="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 class="size-4" /> The app has every AppSheet record.
        </div>
      </template>
    </div>

    <div v-if="report && totalMissing" class="shrink-0 border-t bg-muted/40 p-4 px-6 flex flex-wrap items-center justify-end gap-3">
      <span class="text-xs text-muted-foreground mr-auto">Rows with a warning are unticked — tick them only if you're sure they aren't already in the app.</span>
      <Button :disabled="adding || checking || !pickedCount" class="gap-2" @click="addPicked">
        <Loader2 v-if="adding" class="size-4 animate-spin" />
        <Plus v-else class="size-4" />
        Add {{ pickedCount }} record{{ pickedCount === 1 ? '' : 's' }}
      </Button>
    </div>
  </div>
</template>
