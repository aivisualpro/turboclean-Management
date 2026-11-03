<script setup lang="ts">
import { RefreshCw, Loader2, Copy, ShieldCheck, ChevronDown, Download, Upload, DatabaseBackup, History, Merge, Check, AlertTriangle, FileSpreadsheet } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format, formatDistanceToNow } from 'date-fns'
import { IMPORT_FIELDS, guessMapping, parseCsv } from '~/composables/useCrmCsv'
import { US_STATES } from '~/constants/crm'

/** Data quality: duplicates, missing / non-standard data, CSV import & export, backups, who-changed-what. */
const { setHeader } = usePageHeader()
setHeader({ title: 'Data quality', description: 'CRM · duplicates, gaps, import / export, backups and change history', icon: 'i-lucide-shield-check' })
const { user: me } = useAuth()
const { isActionAllowed } = usePermissions()
const canEdit = computed(() => isActionAllowed('crm_dealership', 'Edit'))

const tab = useLocalStorage<'health' | 'import' | 'backups' | 'history'>('crm-dq-tab', 'health')
const route = useRoute()
const wantedTab = route.query.tab
if (wantedTab === 'health' || wantedTab === 'import' || wantedTab === 'backups' || wantedTab === 'history') tab.value = wantedTab

// ─── Health ───
const report = ref<any>(null)
const loading = ref(false)
async function load(quiet = true) {
  loading.value = true
  try { report.value = await $fetch('/api/crm/data-quality'); if (!quiet) toast.success('Scan refreshed') } catch { toast.error('Could not run the scan') } finally { loading.value = false }
}
onMounted(() => load())
const openCheck = ref<string | null>(null)
const SEV: Record<string, string> = { high: 'bg-rose-500', medium: 'bg-amber-500', low: 'bg-slate-400' }

const keep = ref<Record<number, string>>({})
const merging = ref(false)
async function mergeGroup(gi: number, group: any[]) {
  const keepId = keep.value[gi] || (group.find(d => d.won) || group[0]).id
  const others = group.filter(d => d.id !== keepId)
  if (others.some(o => o.won)) { toast.error('A won account can only be the one you keep'); return }
  merging.value = true
  try {
    for (const o of others) await $fetch('/api/crm/data-quality/merge', { method: 'POST', body: { kind: 'dealership', keepId, mergeId: o.id } })
    toast.success(`Merged ${others.length} duplicate${others.length === 1 ? '' : 's'} into ${group.find(d => d.id === keepId)?.name}`)
    keep.value = {}
    await load()
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Merge failed') } finally { merging.value = false }
}
const keepContact = ref<Record<number, string>>({})
async function mergeContactGroup(gi: number, g: any) {
  const keepId = keepContact.value[gi] || g.contacts[0].id
  const k = g.contacts.find((c: any) => c.id === keepId)
  const others = g.contacts.filter((c: any) => c.id !== keepId && c.dealershipId === k.dealershipId)
  if (!others.length) { toast.error('These contacts are at different dealerships — merge the dealerships first'); return }
  merging.value = true
  try {
    for (const o of others) await $fetch('/api/crm/data-quality/merge', { method: 'POST', body: { kind: 'contact', keepId, mergeId: o.id } })
    toast.success(`Merged ${others.length} contact${others.length === 1 ? '' : 's'} into ${k.name}`)
    keepContact.value = {}
    await load()
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Merge failed') } finally { merging.value = false }
}

// ─── Import ───
const fileName = ref('')
const headers = ref<string[]>([])
const body = ref<string[][]>([])
const mapping = ref<string[]>([])
const ownerId = ref('')
const users = ref<{ id: string, name: string }[]>([])
onMounted(async () => { try { const res = await $fetch<any[]>('/api/users'); users.value = (res || []).filter(u => u.status !== 'Inactive').map(u => ({ id: u.id, name: u.name || u.email })).sort((a, b) => a.name.localeCompare(b.name)); ownerId.value = (me.value as any)?.id || '' } catch {} })
const check = ref<any>(null)
const importing = ref(false)
async function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const rows = parseCsv(await f.text())
  if (rows.length < 2) { toast.error('The file needs a header row and at least one data row'); return }
  fileName.value = f.name
  headers.value = rows[0]!.map(h => h.trim())
  body.value = rows.slice(1)
  mapping.value = guessMapping(headers.value)
  defaultState.value = ''
  check.value = null
}
/** State used for every row that has no state of its own (files without a State column). */
const defaultState = ref('')
const hasStateColumn = computed(() => mapping.value.includes('state'))
const mappedRows = computed(() => body.value.map((r) => {
  const o: Record<string, string> = {}
  mapping.value.forEach((k, i) => { if (k) o[k] = (o[k] ? `${o[k]}, ` : '') + (r[i] || '').trim() })
  if (!o.state && defaultState.value) o.state = defaultState.value
  return o
}))
const missingRequired = computed(() => IMPORT_FIELDS.filter(f => f.required && !mapping.value.includes(f.key) && !(f.key === 'state' && defaultState.value)).map(f => f.label))
watch([mapping, defaultState], () => { check.value = null }, { deep: true })
async function runImport(dryRun: boolean) {
  importing.value = true
  try {
    const owner = users.value.find(u => u.id === ownerId.value)
    const res: any = await $fetch('/api/crm/import/dealerships', { method: 'POST', body: { rows: mappedRows.value, dryRun, ownerId: owner?.id || '', ownerName: owner?.name || '' } })
    check.value = res
    if (!dryRun) { toast.success(`Imported ${res.created} dealership${res.created === 1 ? '' : 's'}`, { description: `${res.duplicates} duplicates skipped · ${res.invalid} invalid` }); load() }
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Import failed') } finally { importing.value = false }
}

// ─── Backups ───
const backups = ref<any[]>([])
const keepDays = ref(30)
const backingUp = ref(false)
async function loadBackups() { try { const r: any = await $fetch('/api/crm/backups'); backups.value = r.backups; keepDays.value = r.keepDays } catch {} }
async function backupNow() {
  backingUp.value = true
  try { await $fetch('/api/crm/backups', { method: 'POST' }); toast.success('Snapshot saved'); await loadBackups() } catch (e: any) { toast.error(e?.data?.statusMessage || 'Backup failed') } finally { backingUp.value = false }
}
const kb = (b: number) => b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`
const totalRecords = (c: Record<string, number>) => Object.values(c || {}).reduce((a, b) => a + b, 0)

// ─── History ───
const history = ref<any[]>([])
const historyUser = ref('all')
const historyLoading = ref(false)
async function loadHistory(more = false) {
  historyLoading.value = true
  try {
    const r: any = await $fetch('/api/crm/data-quality/history', { query: { userId: historyUser.value === 'all' ? undefined : historyUser.value, before: more ? history.value[history.value.length - 1]?.at : undefined, limit: 100 } })
    history.value = more ? [...history.value, ...r.entries] : r.entries
  } catch {} finally { historyLoading.value = false }
}
watch(tab, (t) => { if (t === 'backups') loadBackups(); if (t === 'history' && !history.value.length) loadHistory() }, { immediate: true })
watch(historyUser, () => loadHistory())
const changeText = (c: any) => c ? Object.entries(c).map(([k, v]: any) => `${k}: ${JSON.stringify(v?.from ?? '')} → ${JSON.stringify(v?.to ?? '')}`).join('\n') : ''
</script>

<template>
  <div class="space-y-5">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <Button variant="outline" size="icon" class="size-9" aria-label="Rescan" :disabled="loading" @click="load(false)"><RefreshCw class="size-4" :class="loading && 'animate-spin'" /></Button>
      </Teleport>
    </ClientOnly>

    <div class="inline-flex rounded-lg border bg-muted/40 p-0.5">
      <button v-for="t in [{ k: 'health', l: 'Health & duplicates' }, { k: 'import', l: 'Import / export' }, { k: 'backups', l: 'Backups' }, { k: 'history', l: 'Change history' }]" :key="t.k" type="button" class="px-3 py-1.5 rounded-md text-xs font-medium" :class="tab === t.k ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'" @click="tab = t.k as any">{{ t.l }}</button>
    </div>

    <!-- HEALTH -->
    <template v-if="tab === 'health'">
      <div v-if="!report" class="flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Scanning…</div>
      <template v-else>
        <div class="grid grid-cols-3 gap-3 max-w-2xl">
          <div class="rounded-xl border bg-card px-4 py-3"><p class="text-[11px] text-muted-foreground">Dealerships</p><p class="text-2xl font-bold tabular-nums">{{ report.totals.dealerships }}</p></div>
          <div class="rounded-xl border bg-card px-4 py-3"><p class="text-[11px] text-muted-foreground">Active contacts</p><p class="text-2xl font-bold tabular-nums">{{ report.totals.contacts }}</p></div>
          <div class="rounded-xl border bg-card px-4 py-3"><p class="text-[11px] text-muted-foreground">Things to fix</p><p class="text-2xl font-bold tabular-nums" :class="report.totals.issues ? 'text-amber-600' : 'text-emerald-600'">{{ report.totals.issues }}</p></div>
        </div>

        <!-- Duplicate dealerships -->
        <section class="rounded-xl border bg-card overflow-hidden">
          <header class="px-4 py-2.5 border-b flex items-center gap-2"><Copy class="size-4 text-muted-foreground" /><h3 class="text-sm font-semibold">Possible duplicate dealerships</h3><span class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-muted">{{ report.duplicates.dealershipGroups.length }}</span></header>
          <p v-if="!report.duplicates.dealershipGroups.length" class="px-4 py-3 text-xs text-muted-foreground flex items-center gap-1.5"><Check class="size-3.5 text-emerald-500" /> No duplicates found (same website, phone, or name in the same state).</p>
          <div v-for="(g, gi) in report.duplicates.dealershipGroups" :key="gi" class="border-b last:border-0 px-4 py-3 space-y-2">
            <table class="w-full text-xs">
              <tbody>
                <tr v-for="d in g" :key="d.id" class="align-top">
                  <td class="w-7 py-1"><input type="radio" :name="`keep-${gi}`" :value="d.id" :checked="(keep[gi] || (g.find((x: any) => x.won) || g[0]).id) === d.id" :aria-label="`Keep ${d.name}`" @change="keep[gi] = d.id"></td>
                  <td class="py-1"><NuxtLink :to="`/crm/dealership/${d.id}`" class="font-medium text-primary hover:underline">{{ d.name }}</NuxtLink> <span class="text-muted-foreground font-mono text-[10px]">{{ d.dealershipId }}</span><span v-if="d.won" class="ml-1 text-emerald-600 text-[10px] font-medium">WON</span></td>
                  <td class="py-1 text-muted-foreground">{{ [d.city, d.state].filter(Boolean).join(', ') }}</td>
                  <td class="py-1 text-muted-foreground">{{ d.stage }}</td>
                  <td class="py-1 text-muted-foreground truncate max-w-[180px]">{{ d.website }}</td>
                  <td class="py-1 text-muted-foreground">{{ d.phone }}</td>
                  <td class="py-1 text-amber-700 dark:text-amber-300">{{ d.reasons.join(' · ') }}</td>
                </tr>
              </tbody>
            </table>
            <div v-if="canEdit" class="flex items-center gap-2">
              <Button size="sm" variant="outline" class="h-7 text-xs gap-1.5" :disabled="merging" @click="mergeGroup(gi, g)"><Merge class="size-3.5" /> Merge the others into the selected one</Button>
              <span class="text-[11px] text-muted-foreground">Contacts, activity, emails, audits and time move over; the duplicate is archived. Not the same dealership? Leave it — nothing changes.</span>
            </div>
          </div>
        </section>

        <!-- Duplicate contacts -->
        <section class="rounded-xl border bg-card overflow-hidden">
          <header class="px-4 py-2.5 border-b flex items-center gap-2"><Copy class="size-4 text-muted-foreground" /><h3 class="text-sm font-semibold">Possible duplicate contacts</h3><span class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-muted">{{ report.duplicates.contactGroups.length }}</span></header>
          <p v-if="!report.duplicates.contactGroups.length" class="px-4 py-3 text-xs text-muted-foreground flex items-center gap-1.5"><Check class="size-3.5 text-emerald-500" /> No duplicate contacts.</p>
          <div v-for="(g, gi) in report.duplicates.contactGroups" :key="gi" class="border-b last:border-0 px-4 py-3 space-y-1.5 text-xs">
            <p class="text-amber-700 dark:text-amber-300">{{ g.reason }}</p>
            <label v-for="c in g.contacts" :key="c.id" class="flex items-center gap-2">
              <input type="radio" :name="`keepc-${gi}`" :checked="(keepContact[gi] || g.contacts[0].id) === c.id" @change="keepContact[gi] = c.id">
              <span class="font-medium">{{ c.name }}</span><span class="text-muted-foreground">{{ c.role }} · {{ c.email || 'no email' }} · <NuxtLink :to="`/crm/dealership/${c.dealershipId}?tab=contacts`" class="text-primary hover:underline">{{ c.dealershipName }}</NuxtLink><span v-if="!c.isActive"> · inactive</span></span>
            </label>
            <Button v-if="canEdit" size="sm" variant="outline" class="h-7 text-xs gap-1.5" :disabled="merging" @click="mergeContactGroup(gi, g)"><Merge class="size-3.5" /> Merge into the selected contact</Button>
          </div>
        </section>

        <!-- Checks -->
        <section class="rounded-xl border bg-card overflow-hidden">
          <header class="px-4 py-2.5 border-b flex items-center gap-2"><ShieldCheck class="size-4 text-muted-foreground" /><h3 class="text-sm font-semibold">Missing and non-standard information</h3></header>
          <div v-for="c in report.checks" :key="c.key" class="border-b last:border-0">
            <button type="button" class="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-muted/30 disabled:cursor-default" :disabled="!c.count" @click="openCheck = openCheck === c.key ? null : c.key">
              <span class="size-2 rounded-full shrink-0" :class="c.count ? SEV[c.severity] : 'bg-emerald-500'" />
              <span class="text-sm flex-1" :class="!c.count && 'text-muted-foreground'">{{ c.label }}<span v-if="c.hint" class="text-[11px] text-muted-foreground"> — {{ c.hint }}</span></span>
              <span class="text-sm font-semibold tabular-nums" :class="!c.count && 'text-muted-foreground font-normal'">{{ c.count }}</span>
              <ChevronDown v-if="c.count" class="size-4 text-muted-foreground transition-transform" :class="openCheck === c.key && 'rotate-180'" />
            </button>
            <div v-if="openCheck === c.key" class="px-4 pb-3 flex flex-wrap gap-1.5">
              <template v-for="it in c.items" :key="it.id">
                <span v-if="c.key === 'unknownBrand'" class="rounded-full border px-2.5 py-0.5 text-xs">{{ it.name }} <span class="text-muted-foreground">× {{ it.count }}</span></span>
                <NuxtLink v-else :to="it.dealershipId ? `/crm/dealership/${it.dealershipId}?tab=contacts` : `/crm/dealership/${it.id}`" class="rounded-full border px-2.5 py-0.5 text-xs hover:border-primary hover:text-primary">
                  {{ it.name || '(no name)' }}<span v-if="it.dealershipName" class="text-muted-foreground"> · {{ it.dealershipName }}</span><span v-if="it.value" class="text-muted-foreground"> · “{{ it.value }}”</span>
                </NuxtLink>
              </template>
              <span v-if="c.count > c.items.length" class="text-xs text-muted-foreground">+{{ c.count - c.items.length }} more</span>
            </div>
          </div>
        </section>
        <p class="text-[11px] text-muted-foreground">Built-in safeguards: duplicate checks when adding dealerships, contacts and emails · standard lists for stages, lead sources, roles, states and lost reasons · states, brands, phone numbers and cities standardized on save · required fields · automatic timestamps, stage history and a change log on every record.</p>
      </template>
    </template>

    <!-- IMPORT / EXPORT -->
    <template v-else-if="tab === 'import'">
      <section class="rounded-xl border bg-card p-4 space-y-3">
        <h3 class="text-sm font-semibold flex items-center gap-2"><Download class="size-4 text-muted-foreground" /> Export to CSV</h3>
        <div class="flex flex-wrap gap-2">
          <Button as="a" href="/api/crm/export/dealerships" variant="outline" size="sm" class="gap-1.5"><FileSpreadsheet class="size-4" /> Dealerships (with activity counts)</Button>
          <Button as="a" href="/api/crm/export/contacts" variant="outline" size="sm" class="gap-1.5"><FileSpreadsheet class="size-4" /> Contacts</Button>
          <Button as="a" href="/api/crm/export/activities" variant="outline" size="sm" class="gap-1.5"><FileSpreadsheet class="size-4" /> Activity history</Button>
        </div>
      </section>

      <section v-if="canEdit" class="rounded-xl border bg-card p-4 space-y-4">
        <div>
          <h3 class="text-sm font-semibold flex items-center gap-2"><Upload class="size-4 text-muted-foreground" /> Import dealerships from CSV</h3>
          <p class="text-[11px] text-muted-foreground mt-0.5">One row per dealership; optional contact columns create a primary contact. Columns are matched automatically — check them below. Duplicates (already in the CRM or repeated in the file) are skipped.</p>
        </div>
        <label class="inline-flex items-center gap-2 rounded-md border border-dashed px-4 py-3 text-sm cursor-pointer hover:bg-muted/40">
          <Upload class="size-4" /> {{ fileName || 'Choose a .csv file' }}
          <input type="file" accept=".csv,text/csv" class="sr-only" @change="onFile">
        </label>
        <template v-if="headers.length">
          <div class="overflow-x-auto rounded-lg border">
            <table class="text-xs w-full">
              <thead>
                <tr class="bg-muted/40">
                  <th v-for="(h, i) in headers" :key="i" class="px-2 py-1.5 text-left font-medium min-w-[150px] align-top">
                    <p class="truncate">{{ h }}</p>
                    <select v-model="mapping[i]" class="mt-1 w-full rounded border bg-background px-1 py-0.5 text-[11px] font-normal">
                      <option value="">— ignore —</option>
                      <option v-for="f in IMPORT_FIELDS" :key="f.key" :value="f.key">{{ f.label }}{{ f.required ? ' *' : '' }}</option>
                    </select>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, ri) in body.slice(0, 5)" :key="ri" class="border-t">
                  <td v-for="(c, ci) in headers" :key="ci" class="px-2 py-1 truncate max-w-[200px]" :class="!mapping[ci] && 'text-muted-foreground/50'">{{ r[ci] }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="text-[11px] text-muted-foreground">{{ body.length }} rows · showing the first 5.</p>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs">Assign to</span>
            <Select v-model="ownerId">
              <SelectTrigger class="h-8 w-[180px] text-xs"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent class="max-h-72"><SelectItem v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</SelectItem></SelectContent>
            </Select>
            <span class="text-xs" :class="!hasStateColumn && !defaultState && 'text-destructive font-medium'">{{ hasStateColumn ? 'State if blank' : 'State' }}</span>
            <Select v-model="defaultState">
              <SelectTrigger class="h-8 w-[110px] text-xs" :class="!hasStateColumn && !defaultState && 'border-destructive'"><SelectValue placeholder="Pick state" /></SelectTrigger>
              <SelectContent class="max-h-72"><SelectItem v-for="st in US_STATES" :key="st" :value="st">{{ st }}</SelectItem></SelectContent>
            </Select>
            <Button size="sm" variant="outline" :disabled="importing || !!missingRequired.length" @click="runImport(true)"><Loader2 v-if="importing" class="size-4 animate-spin" /> Check file</Button>
            <Button size="sm" :disabled="importing || !!missingRequired.length || !check || !check.ready" @click="runImport(false)">Import {{ check?.ready ? `${check.ready} new` : '' }}</Button>
            <span v-if="missingRequired.length" class="text-xs text-destructive">{{ missingRequired.length === 1 && missingRequired[0] === 'State' ? 'No State column — pick the state for these rows' : `Map: ${missingRequired.join(', ')}` }}</span>
          </div>
          <div v-if="check" class="rounded-lg border">
            <p class="px-3 py-2 text-xs border-b bg-muted/30"><b>{{ check.created || check.ready }}</b> {{ check.created ? 'created' : 'ready' }} · <b>{{ check.duplicates }}</b> duplicates · <b>{{ check.invalid }}</b> invalid</p>
            <ul class="max-h-64 overflow-y-auto divide-y text-xs">
              <li v-for="r in check.results.filter((x: any) => x.status !== 'ready' && x.status !== 'created')" :key="r.row" class="px-3 py-1.5 flex gap-2"><span class="text-muted-foreground w-14">Row {{ r.row }}</span><span :class="r.status === 'invalid' ? 'text-destructive' : 'text-amber-700 dark:text-amber-300'">{{ r.message }}</span></li>
            </ul>
          </div>
        </template>
      </section>
    </template>

    <!-- BACKUPS -->
    <template v-else-if="tab === 'backups'">
      <section class="rounded-xl border bg-card p-4 space-y-3">
        <h3 class="text-sm font-semibold flex items-center gap-2"><DatabaseBackup class="size-4 text-muted-foreground" /> Backups</h3>
        <p class="text-xs text-muted-foreground">A full CRM snapshot (dealerships, contacts, activities, stage history, emails, templates, audits, won / lost logs, time) is saved automatically once a day and kept for {{ keepDays }} days. Download one any time and keep a copy somewhere safe — the file is gzipped JSON with IDs and dates preserved, ready to restore with MongoDB tools.</p>
        <div class="flex flex-wrap gap-2">
          <Button as="a" href="/api/crm/backups/now" size="sm" class="gap-1.5"><Download class="size-4" /> Download full backup now</Button>
          <Button size="sm" variant="outline" :disabled="backingUp" @click="backupNow"><Loader2 v-if="backingUp" class="size-4 animate-spin" /> Save a snapshot now</Button>
        </div>
        <div class="rounded-lg border divide-y text-xs">
          <div v-for="b in backups" :key="b.id" class="px-3 py-2 flex items-center gap-3">
            <span class="font-medium tabular-nums">{{ format(new Date(b.createdAt), 'MMM d, yyyy h:mm a') }}</span>
            <span class="rounded bg-muted px-1.5 py-px text-[10px]">{{ b.kind === 'auto' ? 'Daily' : `Manual · ${b.createdBy?.name || ''}` }}</span>
            <span class="text-muted-foreground">{{ totalRecords(b.counts).toLocaleString() }} records · {{ kb(b.bytes) }}</span>
            <Button as="a" :href="`/api/crm/backups/${b.id}`" variant="ghost" size="sm" class="h-7 ml-auto gap-1 text-xs"><Download class="size-3.5" /> Download</Button>
          </div>
          <p v-if="!backups.length" class="px-3 py-4 text-muted-foreground flex items-center gap-1.5"><AlertTriangle class="size-3.5 text-amber-500" /> No snapshots yet — the first daily one runs within a minute of the server starting.</p>
        </div>
      </section>
    </template>

    <!-- HISTORY -->
    <template v-else>
      <section class="rounded-xl border bg-card overflow-hidden">
        <header class="px-4 py-2.5 border-b flex flex-wrap items-center gap-2">
          <History class="size-4 text-muted-foreground" /><h3 class="text-sm font-semibold mr-auto">Who changed what</h3>
          <Select v-model="historyUser">
            <SelectTrigger class="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent class="max-h-72"><SelectItem value="all">Everyone</SelectItem><SelectItem v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</SelectItem></SelectContent>
          </Select>
        </header>
        <ul class="divide-y text-xs">
          <li v-for="h in history" :key="h.id" class="px-4 py-2 flex gap-3" :title="changeText(h.changes)">
            <span class="text-muted-foreground tabular-nums w-32 shrink-0" :title="format(new Date(h.at), 'PPpp')">{{ formatDistanceToNow(new Date(h.at), { addSuffix: true }) }}</span>
            <span class="w-28 shrink-0 font-medium truncate">{{ h.actor?.name || 'System' }}</span>
            <span class="flex-1 min-w-0"><NuxtLink v-if="h.dealershipName" :to="`/crm/dealership/${h.dealershipId}`" class="text-primary hover:underline">{{ h.dealershipName }}</NuxtLink><span v-if="h.dealershipName"> · </span>{{ h.message }}</span>
          </li>
          <li v-if="!history.length && !historyLoading" class="px-4 py-6 text-center text-muted-foreground">No changes recorded.</li>
        </ul>
        <button v-if="history.length && history.length % 100 === 0" type="button" class="w-full border-t py-2 text-xs text-primary hover:bg-muted/40" :disabled="historyLoading" @click="loadHistory(true)">{{ historyLoading ? 'Loading…' : 'Load more' }}</button>
      </section>
    </template>
  </div>
</template>
