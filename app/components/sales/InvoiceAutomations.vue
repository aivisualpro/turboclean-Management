<script setup lang="ts">
import {
  ArrowRight, Building2, CalendarClock, CalendarDays, CalendarRange, Check, CheckCircle,
  ChevronsUpDown, ClipboardList, Clock, FileSpreadsheet, History,
  Loader2, Mail, Pencil, Play, Plus, Send, Sparkles, Trash2, X, Zap,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'

// ─── Constants ────────────────────────────────────────────────────────────
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const US_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (America/New_York)' },
  { value: 'America/Chicago', label: 'Central (America/Chicago)' },
  { value: 'America/Denver', label: 'Mountain (America/Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (America/Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Pacific (America/Los_Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (America/Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Pacific/Honolulu)' },
  { value: 'America/Puerto_Rico', label: 'Atlantic (America/Puerto_Rico)' },
]

const cleanEmail = (e: string) => e?.trim().replace(/,+$/, '') || ''

const runStatusClasses: Record<string, string> = {
  Success: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  Partial: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  Failed: 'bg-red-500/10 text-red-600 border-red-500/20',
  Running: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
}

// ─── Live clock (drives the next-run countdowns) ─────────────────────────
const nowTick = ref(Date.now())
let tickTimer: any
let refreshTimer: any
onMounted(() => {
  tickTimer = setInterval(() => { nowTick.value = Date.now() }, 30_000)
  // Keep last-run status fresh after the scheduler fires in the background
  refreshTimer = setInterval(() => fetchAutomations(true), 60_000)
})
onUnmounted(() => {
  clearInterval(tickTimer)
  clearInterval(refreshTimer)
})

// ─── Formatting ───────────────────────────────────────────────────────────
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmtDateTime = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

function timeAgo(iso: string): string {
  if (!iso) return '—'
  const diff = nowTick.value - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function countdown(iso: string): string {
  if (!iso) return ''
  const diff = new Date(iso).getTime() - nowTick.value
  if (diff <= 0) return 'any minute'
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `in ${hours}h ${mins % 60}m`
  const days = Math.floor(hours / 24)
  return `in ${days}d ${hours % 24}h`
}

function nextRunLabel(a: any): string {
  if (!a.nextRun?.at) return ''
  const d = new Date(a.nextRun.at)
  const abs = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return `${abs} · ${countdown(a.nextRun.at)}`
}

// ─── Data ─────────────────────────────────────────────────────────────────
const automations = ref<any[]>([])
const stats = ref<any>({ runs: 0, invoicesGenerated: 0, invoicesEmailed: 0, emailsSent: 0, failures: 0 })
const schedulerActive = ref(false)
const loading = ref(false)
const loadedOnce = ref(false)

async function fetchAutomations(silent = false) {
  if (!silent) loading.value = true
  try {
    const res: any = await $fetch('/api/invoice-automations')
    automations.value = res.automations || []
    stats.value = res.stats || stats.value
    schedulerActive.value = !!res.scheduler?.active
    loadedOnce.value = true
  }
  catch {
    if (!silent) toast.error('Failed to load automations')
  }
  finally {
    loading.value = false
  }
}
fetchAutomations()

const activeCount = computed(() => automations.value.filter(a => a.enabled).length)

// ─── Dealers (for the scope picker) ──────────────────────────────────────
const dealers = ref<any[]>([])
const dealersLoaded = ref(false)
async function loadDealers() {
  if (dealersLoaded.value) return
  try {
    const res: any = await $fetch('/api/dealers')
    dealers.value = res.dealers || []
    dealersLoaded.value = true
  }
  catch {
    toast.error('Failed to load dealers')
  }
}

// ─── Row actions ──────────────────────────────────────────────────────────
const runningId = ref('')

async function toggleAutomation(a: any) {
  const newVal = !a.enabled
  a.enabled = newVal // optimistic
  try {
    await $fetch(`/api/invoice-automations/${a.id}`, { method: 'PUT', body: { enabled: newVal } })
    toast.success(`"${a.name}" ${newVal ? 'resumed' : 'paused'}`)
    fetchAutomations(true) // refresh nextRun
  }
  catch {
    a.enabled = !newVal
    toast.error('Failed to update automation')
  }
}

function deleteAutomation(a: any) {
  toast(`Delete automation "${a.name}"?`, {
    description: 'Invoices it already generated are kept. Run history is kept for audit.',
    action: {
      label: 'Delete',
      onClick: () => {
        toast.promise(
          ($fetch as any)(`/api/invoice-automations/${a.id}`, { method: 'DELETE' }),
          {
            loading: 'Deleting...',
            success: () => {
              automations.value = automations.value.filter(x => x.id !== a.id)
              return 'Automation deleted'
            },
            error: 'Failed to delete automation',
          },
        )
      },
    },
    cancel: { label: 'Cancel', onClick: () => {} },
  })
}

async function runNow(a: any) {
  if (runningId.value) return
  runningId.value = a.id
  try {
    const res: any = await $fetch('/api/invoice-automations/run', { method: 'POST', body: { automationId: a.id } })
    if (res.success) toast.success(res.message || 'Run complete')
    else toast.error(res.message || 'Run failed')
    fetchAutomations(true)
    if (expandedRuns.value.has(a.id)) loadRuns(a.id, true)
  }
  catch (err: any) {
    toast.error(`Run failed: ${err?.data?.statusMessage || err.message || 'Unknown error'}`)
  }
  finally {
    runningId.value = ''
  }
}

// ─── Run history (inline expansion) ──────────────────────────────────────
const expandedRuns = ref(new Set<string>())
const runsByAutomation = ref<Record<string, any[]>>({})
const runsLoading = ref<Record<string, boolean>>({})

async function loadRuns(automationId: string, force = false) {
  if (runsByAutomation.value[automationId] && !force) return
  runsLoading.value = { ...runsLoading.value, [automationId]: true }
  try {
    const res: any = await $fetch('/api/invoice-automations/runs', { query: { automationId, limit: 8 } })
    runsByAutomation.value = { ...runsByAutomation.value, [automationId]: res.runs || [] }
  }
  catch {
    toast.error('Failed to load run history')
  }
  finally {
    runsLoading.value = { ...runsLoading.value, [automationId]: false }
  }
}

function toggleRuns(a: any) {
  if (expandedRuns.value.has(a.id)) {
    expandedRuns.value.delete(a.id)
  }
  else {
    expandedRuns.value.add(a.id)
    loadRuns(a.id)
  }
}

// ─── Editor ───────────────────────────────────────────────────────────────
const showDialog = ref(false)
const isSaving = ref(false)
const editingId = ref('')
const dealerPopoverOpen = ref(false)
const dealerSearch = ref('')
const emailInput = ref('')

function emptyForm() {
  return {
    name: '',
    frequency: 'daily' as 'daily' | 'weekly',
    dealerScope: 'all' as 'all' | 'selected',
    dealerIds: [] as string[],
    runDays: [...WEEKDAYS],
    weekday: 'Monday',
    time: '07:00',
    timezone: 'America/New_York',
    billingDay: 'previous' as 'previous' | 'same',
    autoSend: true,
    useDealerContacts: true,
    emails: [] as string[],
    emailSubject: '',
    emailBody: '',
    endDate: '',
    enabled: true,
  }
}
const form = ref(emptyForm())

function openCreate(frequency: 'daily' | 'weekly' = 'daily') {
  editingId.value = ''
  form.value = emptyForm()
  form.value.frequency = frequency
  emailInput.value = ''
  dealerSearch.value = ''
  showDialog.value = true
  loadDealers()
}

function openEdit(a: any) {
  editingId.value = a.id
  form.value = {
    name: a.name || '',
    frequency: a.frequency === 'weekly' ? 'weekly' : 'daily',
    dealerScope: a.dealerScope === 'selected' ? 'selected' : 'all',
    dealerIds: [...(a.dealerIds || [])],
    runDays: a.runDays?.length ? [...a.runDays] : [...WEEKDAYS],
    weekday: a.weekday || 'Monday',
    time: a.time || '07:00',
    timezone: a.timezone || 'America/New_York',
    billingDay: a.billingDay === 'same' ? 'same' : 'previous',
    autoSend: a.autoSend !== false,
    useDealerContacts: a.useDealerContacts !== false,
    emails: [...(a.emails || [])],
    emailSubject: a.emailSubject || '',
    emailBody: a.emailBody || '',
    endDate: a.endDate || '',
    enabled: !!a.enabled,
  }
  emailInput.value = ''
  dealerSearch.value = ''
  showDialog.value = true
  loadDealers()
}

defineExpose({ openCreate })

const filteredDealers = computed(() => {
  const q = dealerSearch.value.toLowerCase()
  if (!q) return dealers.value
  return dealers.value.filter((d: any) => (d.dealerName || '').toLowerCase().includes(q))
})

function toggleFormDealer(id: string) {
  const idx = form.value.dealerIds.indexOf(id)
  if (idx >= 0) form.value.dealerIds.splice(idx, 1)
  else form.value.dealerIds.push(id)
}

function dealerName(id: string): string {
  return dealers.value.find((d: any) => d.id === id)?.dealerName || 'Unknown dealer'
}

function toggleRunDay(day: string) {
  const idx = form.value.runDays.indexOf(day)
  if (idx >= 0) form.value.runDays.splice(idx, 1)
  else form.value.runDays.push(day)
}

function addCustomEmail() {
  const emails = emailInput.value.split(/[,;\s]+/).map(cleanEmail).filter(Boolean)
  const fresh = emails.filter(e => !form.value.emails.includes(e))
  if (fresh.length > 0) form.value.emails = [...form.value.emails, ...fresh]
  emailInput.value = ''
}

function emailKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    addCustomEmail()
  }
  if (e.key === 'Backspace' && !emailInput.value && form.value.emails.length > 0) {
    form.value.emails = form.value.emails.slice(0, -1)
  }
}

// ─── Live execution plan (right panel) ────────────────────────────────────
const tzShort = computed(() => (form.value.timezone || '').split('/')[1]?.replace(/_/g, ' ') || form.value.timezone)

const planSchedule = computed(() => {
  if (form.value.frequency === 'weekly') {
    return `Every ${form.value.weekday} at ${form.value.time} (${tzShort.value})`
  }
  const days = form.value.runDays
  const label = days.length === 7
    ? 'Every day'
    : days.length === 5 && !days.includes('Saturday') && !days.includes('Sunday')
      ? 'Weekdays'
      : days.length === 0 ? 'Never (pick run days)' : days.map(d => d.slice(0, 3)).join(', ')
  return `${label} at ${form.value.time} (${tzShort.value})`
})

const planScope = computed(() =>
  form.value.dealerScope === 'all'
    ? 'all dealers'
    : `${form.value.dealerIds.length} selected dealer${form.value.dealerIds.length === 1 ? '' : 's'}`,
)

const planDelivery = computed(() => {
  if (!form.value.autoSend) return 'Creates draft invoices only — nothing is emailed until you send it yourself.'
  const parts: string[] = []
  if (form.value.useDealerContacts) parts.push('each dealer’s invoice contacts')
  if (form.value.emails.length > 0) parts.push(`${form.value.emails.length} custom recipient${form.value.emails.length === 1 ? '' : 's'}`)
  if (parts.length === 0) return '⚠ No recipients configured — enable dealer contacts or add emails.'
  return `Emails each invoice (PDF attached) to ${parts.join(' + ')}.`
})

// ─── Save ─────────────────────────────────────────────────────────────────
async function saveAutomation() {
  addCustomEmail() // flush pending input

  if (form.value.dealerScope === 'selected' && form.value.dealerIds.length === 0) {
    return toast.error('Select at least one dealer, or switch scope to All dealers')
  }
  if (form.value.frequency === 'daily' && form.value.runDays.length === 0) {
    return toast.error('Pick at least one run day')
  }
  if (form.value.autoSend && !form.value.useDealerContacts && form.value.emails.length === 0) {
    return toast.error('Auto-send is on but there are no recipients — enable dealer contacts or add emails')
  }

  isSaving.value = true
  try {
    const res: any = await $fetch('/api/invoice-automations', {
      method: 'POST',
      body: { id: editingId.value || undefined, ...form.value },
    })
    if (res.success) {
      toast.success(res.message)
      if (res.warning) toast.warning(res.warning, { duration: 10000 })
      showDialog.value = false
      fetchAutomations()
    }
    else {
      toast.error(res.message || 'Failed to save automation')
    }
  }
  catch (err: any) {
    toast.error(`Save failed: ${err?.data?.statusMessage || err.message || 'Unknown error'}`)
  }
  finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="flex-1 min-h-0 flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-[rgba(0,0,0,0.05)_0px_2px_10px]">
    <!-- ── Header ── -->
    <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b bg-muted/10 shrink-0">
      <div class="flex items-center gap-3 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-semibold text-sm">Invoice Automations</span>
          <Badge variant="secondary" class="font-mono text-[10px] tabular-nums">
            {{ activeCount }} active / {{ automations.length }}
          </Badge>
        </div>
        <div class="hidden md:flex items-center gap-1.5 text-[11px] text-muted-foreground border-l pl-3">
          <span class="relative flex size-2">
            <span v-if="schedulerActive" class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
            <span class="relative inline-flex rounded-full size-2" :class="schedulerActive ? 'bg-emerald-500' : 'bg-muted-foreground/40'" />
          </span>
          <span v-if="schedulerActive">Scheduler online — checks every minute</span>
          <span v-else>Scheduler starting…</span>
        </div>
      </div>

      <div class="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span class="hidden lg:flex items-center gap-1.5">
          <FileSpreadsheet class="size-3" />
          <span class="tabular-nums font-medium text-foreground/80">{{ stats.invoicesGenerated }}</span> generated
          <span class="mx-0.5 opacity-40">·</span>
          <Send class="size-3" />
          <span class="tabular-nums font-medium text-foreground/80">{{ stats.emailsSent }}</span> emails
          <span class="mx-0.5 opacity-40">·</span>
          <span :class="stats.failures > 0 ? 'text-red-500 font-medium' : ''" class="tabular-nums">{{ stats.failures }}</span> failed
          <span class="opacity-60">(30d)</span>
        </span>
      </div>
    </div>

    <!-- ── Body ── -->
    <div class="flex-1 overflow-auto p-4">
      <!-- Loading -->
      <div v-if="loading && !loadedOnce" class="space-y-3">
        <Skeleton v-for="i in 3" :key="i" class="h-28 w-full rounded-xl" />
      </div>

      <!-- Empty state: teach the pipeline -->
      <div v-else-if="automations.length === 0" class="h-full flex items-center justify-center">
        <div class="text-center max-w-xl px-4 py-10">
          <Sparkles class="size-10 text-muted-foreground/20 mx-auto mb-4" />
          <p class="text-sm font-semibold text-foreground">
            Put daily & weekly invoicing on autopilot
          </p>
          <p class="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            An automation runs on your schedule, turns finished work orders into invoices,
            and emails them to each dealer's billing contacts — with the PDF and job photos attached.
          </p>

          <!-- Pipeline -->
          <div class="mt-6 flex items-center justify-center gap-2 text-[11px] font-medium">
            <div class="flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-muted/30 text-foreground/80">
              <ClipboardList class="size-3.5 text-muted-foreground" /> Work Orders
            </div>
            <ArrowRight class="size-3.5 text-muted-foreground/50 shrink-0" />
            <div class="flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-emerald-500/5 border-emerald-500/20 text-emerald-600">
              <FileSpreadsheet class="size-3.5" /> Daily Invoices
            </div>
            <ArrowRight class="size-3.5 text-muted-foreground/50 shrink-0" />
            <div class="flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-amber-500/5 border-amber-500/20 text-amber-600">
              <CalendarRange class="size-3.5" /> Weekly Rollup
            </div>
            <ArrowRight class="size-3.5 text-muted-foreground/50 shrink-0" />
            <div class="flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-blue-500/5 border-blue-500/20 text-blue-600">
              <Mail class="size-3.5" /> Delivered
            </div>
          </div>

          <div class="mt-7 flex items-center justify-center gap-2">
            <Button size="sm" class="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" @click="openCreate('daily')">
              <CalendarDays class="size-3.5" /> New Daily Automation
            </Button>
            <Button size="sm" variant="outline" class="gap-1.5 text-amber-600 border-amber-500/30 hover:bg-amber-500/10" @click="openCreate('weekly')">
              <CalendarRange class="size-3.5" /> New Weekly Automation
            </Button>
          </div>
        </div>
      </div>

      <!-- Automation rows -->
      <div v-else class="grid gap-3">
        <div
          v-for="a in automations" :key="a.id"
          class="rounded-xl border bg-card shadow-sm transition-all hover:shadow-md"
          :class="!a.enabled ? 'opacity-70' : ''"
        >
          <div class="p-4 flex flex-col lg:flex-row lg:items-center gap-4">
            <!-- Identity -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <div class="p-1.5 rounded-lg" :class="!a.enabled ? 'bg-muted text-muted-foreground' : a.frequency === 'weekly' ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'">
                  <CalendarRange v-if="a.frequency === 'weekly'" class="size-4" />
                  <CalendarDays v-else class="size-4" />
                </div>
                <span class="font-semibold text-sm truncate">{{ a.name }}</span>
                <Badge variant="outline" class="text-[9px] uppercase tracking-wide" :class="a.frequency === 'weekly' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'">
                  {{ a.frequency }}
                </Badge>
                <Badge variant="outline" :class="a.enabled ? 'bg-blue-500/10 text-blue-600 border-blue-500/20' : 'bg-gray-500/10 text-gray-500 border-gray-500/20'" class="text-[9px] uppercase">
                  {{ a.enabled ? 'Active' : 'Paused' }}
                </Badge>
                <Badge v-if="!a.autoSend" variant="outline" class="text-[9px] bg-gray-500/10 text-gray-500 border-gray-500/20">
                  Drafts only
                </Badge>
                <Badge v-if="a.endDate" variant="outline" class="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[9px]">
                  Until {{ fmtDate(a.endDate) }}
                </Badge>
              </div>

              <div class="mt-1.5 flex items-center gap-x-3 gap-y-1 text-xs text-muted-foreground flex-wrap">
                <span class="flex items-center gap-1">
                  <Building2 class="size-3" />
                  <template v-if="a.dealerScope === 'all'">All dealers</template>
                  <template v-else>{{ a.dealerIds.length }} dealer{{ a.dealerIds.length === 1 ? '' : 's' }}</template>
                </span>
                <span class="flex items-center gap-1"><CalendarClock class="size-3" /> {{ a.scheduleLabel }}</span>
                <span v-if="a.autoSend" class="flex items-center gap-1">
                  <Mail class="size-3" />
                  <template v-if="a.useDealerContacts && a.emails.length > 0">dealer contacts +{{ a.emails.length }}</template>
                  <template v-else-if="a.useDealerContacts">dealer contacts</template>
                  <template v-else>{{ a.emails.length }} custom recipient{{ a.emails.length === 1 ? '' : 's' }}</template>
                </span>
              </div>

              <!-- Selected dealer chips (scoped automations) -->
              <div v-if="a.dealerScope === 'selected' && a.dealerNames?.length" class="mt-1.5 flex flex-wrap gap-1">
                <Badge v-for="(n, i) in a.dealerNames.slice(0, 4)" :key="i" variant="secondary" class="text-[9px] px-1.5 py-0 font-normal">
                  {{ n }}
                </Badge>
                <Badge v-if="a.dealerNames.length > 4" variant="secondary" class="text-[9px] px-1.5 py-0 font-normal">
                  +{{ a.dealerNames.length - 4 }} more
                </Badge>
              </div>

              <!-- Run status line -->
              <div class="mt-1.5 text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                <template v-if="a.lastRunAt">
                  <Badge variant="outline" class="text-[9px]" :class="runStatusClasses[a.lastRunStatus] || 'bg-gray-500/10 text-gray-500 border-gray-500/20'">
                    {{ a.lastRunStatus || '—' }}
                  </Badge>
                  <span>{{ a.lastRunSummary || 'Ran' }} · {{ timeAgo(a.lastRunAt) }}</span>
                  <span class="opacity-50">·</span>
                  <span class="tabular-nums">{{ a.runsCount }} run{{ a.runsCount === 1 ? '' : 's' }}</span>
                </template>
                <span v-else class="italic">Never run yet</span>
                <template v-if="a.enabled && a.nextRun">
                  <span class="opacity-50">·</span>
                  <span class="flex items-center gap-1 text-foreground/70 font-medium">
                    <Clock class="size-3" /> Next: {{ nextRunLabel(a) }}
                  </span>
                </template>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button" role="switch" :aria-checked="a.enabled" :title="a.enabled ? 'Pause automation' : 'Resume automation'"
                class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :class="a.enabled ? (a.frequency === 'weekly' ? 'bg-amber-500' : 'bg-emerald-600') : 'bg-input'"
                @click="toggleAutomation(a)"
              >
                <span class="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform duration-200" :class="a.enabled ? 'translate-x-5' : 'translate-x-0'" />
              </button>
              <Button variant="outline" size="sm" class="h-8 gap-1.5 text-xs" :disabled="runningId === a.id" title="Generate & deliver now" @click="runNow(a)">
                <Loader2 v-if="runningId === a.id" class="size-3.5 animate-spin" />
                <Play v-else class="size-3.5 text-emerald-600" />
                Run Now
              </Button>
              <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground" :title="expandedRuns.has(a.id) ? 'Hide activity' : 'Show activity'" @click="toggleRuns(a)">
                <History class="size-4" />
              </Button>
              <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-blue-600 hover:bg-blue-500/10" title="Edit" @click="openEdit(a)">
                <Pencil class="size-4" />
              </Button>
              <Button variant="ghost" size="icon" class="h-8 w-8 text-red-500 hover:bg-red-500/10" title="Delete" @click="deleteAutomation(a)">
                <Trash2 class="size-4" />
              </Button>
            </div>
          </div>

          <!-- ── Activity (recent runs) ── -->
          <div v-if="expandedRuns.has(a.id)" class="border-t bg-muted/20 rounded-b-xl px-4 py-3">
            <div v-if="runsLoading[a.id]" class="space-y-2">
              <Skeleton v-for="i in 3" :key="i" class="h-6 w-full rounded" />
            </div>
            <div v-else-if="!runsByAutomation[a.id]?.length" class="text-[11px] text-muted-foreground italic py-1">
              No runs recorded yet — it will appear here after the first scheduled or manual run.
            </div>
            <div v-else class="space-y-1">
              <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">
                Recent activity
              </div>
              <div v-for="run in runsByAutomation[a.id]" :key="run.id" class="flex items-start gap-2.5 text-[11px] py-1 border-b border-border/40 last:border-0">
                <Badge variant="outline" class="text-[9px] shrink-0 mt-px" :class="runStatusClasses[run.status] || 'bg-gray-500/10 text-gray-500 border-gray-500/20'">
                  {{ run.status }}
                </Badge>
                <div class="min-w-0 flex-1">
                  <span class="text-foreground/80">{{ run.summary }}</span>
                  <span v-if="run.invoiceNumbers?.length" class="ml-1.5 font-mono text-blue-600">
                    {{ run.invoiceNumbers.slice(0, 3).join(', ') }}<template v-if="run.invoiceNumbers.length > 3"> +{{ run.invoiceNumbers.length - 3 }}</template>
                  </span>
                  <div v-if="run.errors?.length" class="text-red-500/90 mt-0.5 truncate">
                    {{ run.errors[0].invoice ? `${run.errors[0].invoice}: ` : '' }}{{ run.errors[0].error }}
                    <template v-if="run.errors.length > 1"> (+{{ run.errors.length - 1 }} more)</template>
                  </div>
                </div>
                <div class="shrink-0 text-muted-foreground text-right">
                  <div>{{ fmtDateTime(run.startedAt) }}</div>
                  <div class="text-[9px] uppercase tracking-wide opacity-70">{{ run.trigger === 'manual' ? 'Manual' : 'Scheduled' }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Add another -->
        <button
          type="button"
          class="rounded-xl border border-dashed text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/30 transition-colors py-3.5 text-xs font-medium flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="openCreate('daily')"
        >
          <Plus class="size-3.5" /> New Automation
        </button>
      </div>
    </div>

    <!-- ═══════════════ EDITOR ═══════════════ -->
    <Dialog v-model:open="showDialog">
      <DialogContent class="sm:max-w-[1060px] max-h-[94vh] overflow-hidden p-0 gap-0 flex flex-col">
        <div class="px-6 pt-5 pb-4 border-b shrink-0" :class="form.frequency === 'weekly' ? 'bg-gradient-to-b from-amber-500/5 to-transparent' : 'bg-gradient-to-b from-emerald-500/5 to-transparent'">
          <DialogTitle class="flex items-center gap-2.5 text-lg">
            <div class="p-2 rounded-lg" :class="form.frequency === 'weekly' ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'">
              <CalendarRange v-if="form.frequency === 'weekly'" class="size-4" />
              <CalendarDays v-else class="size-4" />
            </div>
            {{ editingId ? 'Edit Automation' : `New ${form.frequency === 'weekly' ? 'Weekly' : 'Daily'} Automation` }}
          </DialogTitle>
          <DialogDescription class="mt-1.5 text-muted-foreground text-sm">
            Turns finished work orders into {{ form.frequency }} invoices and delivers them on your schedule.
          </DialogDescription>
        </div>

        <div class="flex-1 min-h-0 grid lg:grid-cols-[1fr_340px] overflow-hidden">
          <!-- ── LEFT: Form ── -->
          <div class="overflow-y-auto px-6 py-5 space-y-6 lg:border-r">
            <!-- Frequency -->
            <div class="grid gap-2">
              <Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cadence</Label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  class="rounded-lg border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :class="form.frequency === 'daily' ? 'border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/30' : 'hover:bg-muted/40'"
                  @click="form.frequency = 'daily'"
                >
                  <div class="flex items-center gap-2 text-sm font-semibold" :class="form.frequency === 'daily' ? 'text-emerald-600' : ''">
                    <CalendarDays class="size-4" /> Daily
                  </div>
                  <p class="text-[11px] text-muted-foreground mt-1">One invoice per dealer per day of work orders</p>
                </button>
                <button
                  type="button"
                  class="rounded-lg border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :class="form.frequency === 'weekly' ? 'border-amber-500/50 bg-amber-500/5 ring-1 ring-amber-500/30' : 'hover:bg-muted/40'"
                  @click="form.frequency = 'weekly'"
                >
                  <div class="flex items-center gap-2 text-sm font-semibold" :class="form.frequency === 'weekly' ? 'text-amber-600' : ''">
                    <CalendarRange class="size-4" /> Weekly
                  </div>
                  <p class="text-[11px] text-muted-foreground mt-1">Rolls each completed week into one invoice per dealer</p>
                </button>
              </div>
            </div>

            <!-- Name -->
            <div class="grid gap-2">
              <Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Automation Name</Label>
              <Input v-model="form.name" :placeholder="form.frequency === 'weekly' ? 'e.g. Weekly billing – all dealers' : 'e.g. Daily billing – all dealers'" class="h-9 text-sm bg-background shadow-sm" />
            </div>

            <!-- Dealer scope -->
            <div class="grid gap-2">
              <Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dealers</Label>
              <div class="flex bg-muted/60 p-1 rounded-lg border border-border/50 w-fit">
                <button type="button" class="px-3 py-1.5 text-xs font-medium rounded-md transition-all" :class="form.dealerScope === 'all' ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground'" @click="form.dealerScope = 'all'">
                  All dealers
                </button>
                <button type="button" class="px-3 py-1.5 text-xs font-medium rounded-md transition-all" :class="form.dealerScope === 'selected' ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground'" @click="form.dealerScope = 'selected'; loadDealers()">
                  Specific dealers
                </button>
              </div>

              <div v-if="form.dealerScope === 'selected'" class="p-3 border rounded-lg bg-card/50 space-y-2.5">
                <Popover v-model:open="dealerPopoverOpen">
                  <PopoverTrigger as-child>
                    <Button variant="outline" role="combobox" :aria-expanded="dealerPopoverOpen" class="w-full justify-between h-9 font-normal text-sm">
                      <span class="text-muted-foreground">Add dealers…</span>
                      <ChevronsUpDown class="ml-2 size-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent class="w-[--reka-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput v-model="dealerSearch" placeholder="Search dealers…" />
                      <CommandEmpty>No dealers found.</CommandEmpty>
                      <CommandList class="max-h-48">
                        <CommandGroup>
                          <CommandItem
                            v-for="d in filteredDealers" :key="d.id" :value="d.dealerName"
                            class="cursor-pointer"
                            @select.prevent="toggleFormDealer(d.id)"
                          >
                            <div class="flex items-center gap-2 w-full">
                              <div class="size-4 shrink-0 rounded border flex items-center justify-center" :class="form.dealerIds.includes(d.id) ? 'bg-primary border-primary' : 'border-muted-foreground/30'">
                                <Check v-if="form.dealerIds.includes(d.id)" class="size-3 text-primary-foreground" />
                              </div>
                              <span class="truncate">{{ d.dealerName }}</span>
                            </div>
                          </CommandItem>
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                <div v-if="form.dealerIds.length" class="flex flex-wrap gap-1.5">
                  <Badge v-for="id in form.dealerIds" :key="id" variant="secondary" class="text-xs px-2 py-0.5 gap-1 bg-blue-500/10 text-blue-600 border-blue-500/20">
                    {{ dealerName(id) }}
                    <X class="size-3 cursor-pointer opacity-60 hover:opacity-100" @click.stop="toggleFormDealer(id)" />
                  </Badge>
                </div>
                <p v-else class="text-[11px] text-muted-foreground italic">
                  No dealers selected yet.
                </p>
              </div>
            </div>

            <!-- Schedule -->
            <div class="grid gap-3">
              <Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schedule</Label>

              <div v-if="form.frequency === 'daily'" class="grid gap-2">
                <span class="text-[11px] text-muted-foreground">Run on</span>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="day in WEEKDAYS" :key="day" type="button"
                    class="px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    :class="form.runDays.includes(day) ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600' : 'text-muted-foreground hover:bg-muted/50'"
                    @click="toggleRunDay(day)"
                  >
                    {{ day.slice(0, 3) }}
                  </button>
                </div>
              </div>

              <div class="grid sm:grid-cols-3 gap-3">
                <div v-if="form.frequency === 'weekly'" class="grid gap-1.5">
                  <span class="text-[11px] text-muted-foreground">Day</span>
                  <Select v-model="form.weekday">
                    <SelectTrigger class="h-9 text-sm bg-background shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="d in WEEKDAYS" :key="d" :value="d">
                        Every {{ d }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div v-else class="grid gap-1.5">
                  <span class="text-[11px] text-muted-foreground">Bills</span>
                  <Select v-model="form.billingDay">
                    <SelectTrigger class="h-9 text-sm bg-background shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="previous">Previous day</SelectItem>
                      <SelectItem value="same">Same day</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div class="grid gap-1.5">
                  <span class="text-[11px] text-muted-foreground">Time</span>
                  <Input v-model="form.time" type="time" class="h-9 text-sm bg-background shadow-sm tabular-nums" />
                </div>
                <div class="grid gap-1.5">
                  <span class="text-[11px] text-muted-foreground">Timezone</span>
                  <Select v-model="form.timezone">
                    <SelectTrigger class="h-9 text-sm bg-background shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="tz in US_TIMEZONES" :key="tz.value" :value="tz.value">
                        {{ tz.label }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <p v-if="form.frequency === 'weekly'" class="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <CheckCircle class="size-3 text-amber-500 shrink-0" />
                Bills the completed prior week — the week in progress is never invoiced early.
              </p>

              <div class="grid gap-1.5 max-w-[200px]">
                <span class="text-[11px] text-muted-foreground">End date (optional)</span>
                <Input v-model="form.endDate" type="date" class="h-9 text-sm bg-background shadow-sm" />
              </div>
            </div>

            <!-- Delivery -->
            <div class="grid gap-3">
              <Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Delivery</Label>

              <div class="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2.5">
                <div>
                  <p class="text-xs font-medium">Email invoices automatically</p>
                  <p class="text-[11px] text-muted-foreground mt-0.5">Off = invoices are created as drafts for you to review & send</p>
                </div>
                <button
                  type="button" role="switch" :aria-checked="form.autoSend"
                  class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :class="form.autoSend ? 'bg-blue-600' : 'bg-input'"
                  @click="form.autoSend = !form.autoSend"
                >
                  <span class="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform duration-200" :class="form.autoSend ? 'translate-x-5' : 'translate-x-0'" />
                </button>
              </div>

              <template v-if="form.autoSend">
                <div class="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2.5">
                  <div>
                    <p class="text-xs font-medium">Send to each dealer's invoice contacts</p>
                    <p class="text-[11px] text-muted-foreground mt-0.5">Contacts flagged "receive invoices" on the dealer</p>
                  </div>
                  <button
                    type="button" role="switch" :aria-checked="form.useDealerContacts"
                    class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    :class="form.useDealerContacts ? 'bg-blue-600' : 'bg-input'"
                    @click="form.useDealerContacts = !form.useDealerContacts"
                  >
                    <span class="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform duration-200" :class="form.useDealerContacts ? 'translate-x-5' : 'translate-x-0'" />
                  </button>
                </div>

                <div class="grid gap-1.5">
                  <span class="text-[11px] text-muted-foreground">Also send to (CC every invoice)</span>
                  <div class="flex flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5 min-h-9 shadow-sm">
                    <Badge v-for="e in form.emails" :key="e" variant="secondary" class="text-xs gap-1 px-2 py-0.5">
                      {{ e }}
                      <X class="size-3 cursor-pointer opacity-60 hover:opacity-100" @click="form.emails = form.emails.filter(x => x !== e)" />
                    </Badge>
                    <input
                      v-model="emailInput"
                      placeholder="billing@dealer.com"
                      class="flex-1 min-w-[160px] bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground"
                      @keydown="emailKeydown"
                      @blur="addCustomEmail"
                    >
                  </div>
                </div>

                <div class="grid sm:grid-cols-1 gap-3">
                  <div class="grid gap-1.5">
                    <span class="text-[11px] text-muted-foreground">Email subject (optional — supports <code class="font-mono text-[10px] bg-muted px-1 rounded">{number}</code> <code class="font-mono text-[10px] bg-muted px-1 rounded">{dealer}</code> <code class="font-mono text-[10px] bg-muted px-1 rounded">{date}</code> <code class="font-mono text-[10px] bg-muted px-1 rounded">{total}</code> <code class="font-mono text-[10px] bg-muted px-1 rounded">{type}</code>)</span>
                    <Input v-model="form.emailSubject" placeholder="Invoice {number} – {dealer}" class="h-9 text-sm bg-background shadow-sm" />
                  </div>
                  <div class="grid gap-1.5">
                    <span class="text-[11px] text-muted-foreground">Message above the invoice (optional)</span>
                    <Textarea v-model="form.emailBody" rows="3" placeholder="Hi — please find attached the latest invoice. Reply to this email with any questions." class="text-sm bg-background shadow-sm resize-none" />
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- ── RIGHT: Execution plan ── -->
          <div class="hidden lg:flex flex-col overflow-y-auto bg-muted/20 px-5 py-5">
            <p class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4">
              What this automation will do
            </p>

            <ol class="relative space-y-5 pl-6 before:absolute before:left-[9px] before:top-2 before:bottom-2 before:w-px before:bg-border">
              <li class="relative">
                <span class="absolute -left-6 top-0.5 flex size-[19px] items-center justify-center rounded-full border bg-background">
                  <Clock class="size-3 text-muted-foreground" />
                </span>
                <p class="text-xs font-semibold text-foreground">{{ planSchedule }}</p>
                <p class="text-[11px] text-muted-foreground mt-0.5">
                  Runs once per day at most — never duplicates, even after restarts.
                </p>
              </li>

              <li class="relative">
                <span class="absolute -left-6 top-0.5 flex size-[19px] items-center justify-center rounded-full border bg-background">
                  <ClipboardList class="size-3 text-muted-foreground" />
                </span>
                <p class="text-xs font-semibold text-foreground">Collects uninvoiced work orders</p>
                <p class="text-[11px] text-muted-foreground mt-0.5">
                  From {{ planScope }}, and marks them invoiced (synced back to AppSheet).
                </p>
              </li>

              <li class="relative">
                <span class="absolute -left-6 top-0.5 flex size-[19px] items-center justify-center rounded-full border bg-background">
                  <FileSpreadsheet class="size-3" :class="form.frequency === 'weekly' ? 'text-amber-600' : 'text-emerald-600'" />
                </span>
                <p class="text-xs font-semibold text-foreground">
                  {{ form.frequency === 'weekly' ? 'Builds daily invoices, then one weekly rollup per dealer' : 'Builds one daily invoice per dealer per day' }}
                </p>
                <p class="text-[11px] text-muted-foreground mt-0.5">
                  <template v-if="form.frequency === 'weekly'">
                    Only fully completed weeks are rolled up and billed.
                  </template>
                  <template v-else>
                    Bills the {{ form.billingDay === 'same' ? 'same day' : 'previous day' }}, and catches late work orders from recent days.
                  </template>
                </p>
              </li>

              <li class="relative">
                <span class="absolute -left-6 top-0.5 flex size-[19px] items-center justify-center rounded-full border bg-background">
                  <Mail class="size-3" :class="form.autoSend ? 'text-blue-600' : 'text-muted-foreground'" />
                </span>
                <p class="text-xs font-semibold text-foreground">
                  {{ form.autoSend ? 'Delivers automatically' : 'Saves as drafts' }}
                </p>
                <p class="text-[11px] mt-0.5" :class="form.autoSend && !form.useDealerContacts && form.emails.length === 0 ? 'text-red-500' : 'text-muted-foreground'">
                  {{ planDelivery }}
                </p>
                <p v-if="form.autoSend" class="text-[11px] text-muted-foreground mt-0.5">
                  PDF attached{{ form.frequency === 'daily' ? ', plus the work-order photos' : '' }}. Every send is logged in Emails.
                </p>
              </li>
            </ol>

            <div class="mt-auto pt-6">
              <div class="rounded-lg border bg-background/60 px-3 py-2.5 text-[11px] text-muted-foreground leading-relaxed">
                <span class="font-semibold text-foreground/80">Safe by design:</span>
                already-emailed invoices are never re-sent, and you can pause or run any automation manually at any time.
              </div>
            </div>
          </div>
        </div>

        <DialogFooter class="px-6 py-4 border-t bg-muted/10 shrink-0 gap-2">
          <Button variant="outline" size="sm" @click="showDialog = false">
            Cancel
          </Button>
          <Button
            size="sm" class="gap-1.5 text-white"
            :class="form.frequency === 'weekly' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'"
            :disabled="isSaving"
            @click="saveAutomation"
          >
            <Loader2 v-if="isSaving" class="size-3.5 animate-spin" />
            <Zap v-else class="size-3.5" />
            {{ editingId ? 'Save Changes' : 'Create Automation' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
