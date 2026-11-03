<script setup lang="ts">
import type { AutomationJob, AutomationRun, AutomationSettings } from '~/composables/useAutomations'
import { AUTOMATION_GROUPS, ago, everyLabel } from '~/composables/useAutomations'
import {
  Bot, Inbox, MessageSquareReply, Flame, CalendarClock, Send, RefreshCw, Settings2, Play, Loader2, CheckCircle2, AlertTriangle,
  CircleDashed, Zap, Infinity as InfinityIcon, History, ChevronDown, KeyRound, ArrowRight,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * Automation Center — the 15 automations from the CRM brief, what each one is doing,
 * and the short list of things that need a person (approve drafts, confirm replies).
 */
const { setHeader } = usePageHeader()
setHeader({ title: 'Automation Center', description: 'Automations · the system does the busy work, you approve what goes out', icon: 'i-lucide-bot' })

const { overview: o, loading, loadOverview, setEnabled, runNow, saveSettings, loadRuns } = useAutomations()
const { isActionAllowed } = usePermissions()
const canEdit = computed(() => isActionAllowed('automations', 'Edit'))

const runs = ref<AutomationRun[]>([])
const runsKey = ref<string>('all')
const NuxtLinkComp = resolveComponent('NuxtLink')
async function reload(quiet = true) {
  try {
    await Promise.all([loadOverview(), loadRuns(runsKey.value === 'all' ? undefined : runsKey.value, 30).then(r => (runs.value = r.runs))])
    if (!quiet) toast.success('Refreshed')
  }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not load automations') }
}
onMounted(() => reload())
onMounted(() => { const t = setInterval(() => document.visibilityState === 'visible' && reload(), 60_000); onBeforeUnmount(() => clearInterval(t)) })
watch(runsKey, () => loadRuns(runsKey.value === 'all' ? undefined : runsKey.value, 30).then(r => (runs.value = r.runs)).catch(() => {}))

const groups = computed(() => AUTOMATION_GROUPS.map(g => ({ ...g, items: (o.value?.automations || []).filter(a => a.group === g.key) })))
const busy = ref<string | null>(null)
async function toggle(a: AutomationJob, v: boolean) {
  busy.value = a.key
  try { await setEnabled(a.key, v); toast.success(`${a.title} ${v ? 'on' : 'off'}`); await reload() }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not change it') }
  finally { busy.value = null }
}
async function run(a: AutomationJob) {
  busy.value = a.key
  try {
    const r = await runNow(a.key)
    r?.status === 'error' ? toast.error(r.summary) : toast.success(a.title, { description: r?.summary })
    await reload()
  }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Run failed') }
  finally { busy.value = null }
}

function statusOf(a: AutomationJob) {
  if (a.kind === 'planned') return { label: 'Next phase', cls: 'bg-muted text-muted-foreground', icon: CircleDashed }
  if (a.kind === 'always') return { label: 'Always on', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', icon: InfinityIcon }
  if (!a.enabled) return { label: 'Off', cls: 'bg-muted text-muted-foreground', icon: CircleDashed }
  if (a.runningUntil && new Date(a.runningUntil).getTime() > Date.now()) return { label: 'Running', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', icon: Loader2 }
  if (a.lastStatus === 'error') return { label: 'Error', cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300', icon: AlertTriangle }
  if (a.kind === 'event') return { label: 'On · runs when data arrives', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', icon: Zap }
  return { label: `On · ${everyLabel(a.everyMinutes)}`, cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', icon: CheckCircle2 }
}
/** What a planned / always-on automation needs, in plain words. */
function noteFor(a: AutomationJob) {
  const env = o.value?.env
  switch (a.key) {
    case 'find_dealerships': return env?.places ? 'Google Places key found — the finder is the next build.' : 'Next build. Needs a Google Places API key (GOOGLE_PLACES_API_KEY in .env).'
    case 'scrape_inventory': return `Next build. Collectors will post to /api/automations/inventory${env?.collectorToken ? ' (token set).' : ' — set AUTOMATION_API_TOKEN in .env first.'}`
    case 'find_contacts': return 'Next build. Will read dealership staff pages and add GM / used-car manager contacts for you to verify.'
    case 'count_inventory': return 'Counts every snapshot a collector sends. Manual audits keep working as before.'
    case 'approval_queue': return `${o.value?.needsYou.draftsPending || 0} waiting for you.`
    case 'crm_feed': return 'Emails, replies, stage moves, next actions and scores are written to each dealership’s history as “Automation”.'
    default: return ''
  }
}
const linkFor = (key: string) => ({ approval_queue: '/automations/approvals', send_approved: '/automations/approvals?status=approved', classify_replies: '/automations/approvals?tab=replies', priority: '/automations/priorities', next_action: '/automations/priorities', strategy: '/automations/insights', draft_emails: '/automations/approvals', schedule_followups: '/automations/approvals' } as Record<string, string>)[key]

// ── Settings sheet ──
const settingsOpen = ref(false)
const form = ref<AutomationSettings & { gapsText: string }>({} as any)
function openSettings() {
  if (!o.value) return
  form.value = { ...o.value.settings, gapsText: o.value.settings.followUpGaps.join(', ') }
  settingsOpen.value = true
}
const saving = ref(false)
async function save() {
  saving.value = true
  try {
    const gaps = form.value.gapsText.split(/[,\s]+/).map(Number).filter(n => Number.isFinite(n) && n > 0)
    const { gapsText, ...rest } = form.value
    await saveSettings({ ...rest, dailySendLimit: Number(rest.dailySendLimit), maxDraftsPerRun: Number(rest.maxDraftsPerRun), auditStaleDays: Number(rest.auditStaleDays), followUpGaps: gaps })
    toast.success('Automation settings saved')
    settingsOpen.value = false
    await reload()
  }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save') }
  finally { saving.value = false }
}

const needs = computed(() => {
  const n = o.value?.needsYou
  if (!n) return []
  return [
    { label: 'Drafts to approve', value: n.draftsPending, sub: n.draftsFailed ? `${n.draftsFailed} failed to send` : n.draftsApproved ? `${n.draftsApproved} approved, waiting to send` : 'nothing goes out without you', icon: Inbox, to: '/automations/approvals', hot: n.draftsPending > 0 || n.draftsFailed > 0 },
    { label: 'Replies to confirm', value: n.repliesToConfirm, sub: 'one click each', icon: MessageSquareReply, to: '/automations/approvals?tab=replies', hot: n.repliesToConfirm > 0 },
    { label: 'Hot prospects', value: n.hot, sub: 'score 70+', icon: Flame, to: '/automations/priorities?tier=Hot', hot: false },
    { label: 'Need a step today', value: n.needToday, sub: 'suggested next actions', icon: CalendarClock, to: '/automations/priorities', hot: false },
  ]
})
const showLog = ref(true)
</script>

<template>
  <div class="space-y-5">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <Button v-if="canEdit" variant="outline" size="sm" class="h-8 gap-1.5" :disabled="!o" @click="openSettings"><Settings2 class="size-4" /> Settings</Button>
        <Button variant="outline" size="icon" class="size-8" aria-label="Refresh" :disabled="loading" @click="reload(false)"><RefreshCw class="size-4" :class="loading && 'animate-spin'" /></Button>
      </Teleport>
    </ClientOnly>

    <div v-if="loading && !o" class="flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Loading automations…</div>

    <template v-else-if="o">
      <!-- What needs you -->
      <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <NuxtLink v-for="c in needs" :key="c.label" :to="c.to" class="rounded-xl border bg-card px-4 py-3 hover:bg-muted/40 transition-colors group" :class="c.hot && 'border-primary/40'">
          <div class="flex items-center justify-between">
            <p class="text-[11px] uppercase tracking-wider text-muted-foreground">{{ c.label }}</p>
            <component :is="c.icon" class="size-4" :class="c.hot ? 'text-primary' : 'text-muted-foreground'" />
          </div>
          <p class="text-2xl font-bold tabular-nums mt-1">{{ c.value }}</p>
          <p class="text-[11px] text-muted-foreground flex items-center gap-1">{{ c.sub }} <ArrowRight class="size-3 opacity-0 group-hover:opacity-100 transition-opacity" /></p>
        </NuxtLink>
        <div class="rounded-xl border bg-card px-4 py-3 col-span-2 lg:col-span-1">
          <div class="flex items-center justify-between">
            <p class="text-[11px] uppercase tracking-wider text-muted-foreground">Sent today</p>
            <Send class="size-4 text-muted-foreground" />
          </div>
          <p class="text-2xl font-bold tabular-nums mt-1">{{ o.sending.sentToday }}<span class="text-sm font-medium text-muted-foreground"> / {{ o.sending.limit }}</span></p>
          <p class="text-[11px]" :class="o.sending.inWindow ? 'text-emerald-600' : 'text-muted-foreground'">{{ o.sending.inWindow ? 'Sending hours — approved emails go out now' : `Outside sending hours — next: ${o.sending.nextWindow}` }}</p>
        </div>
      </div>

      <!-- Setup notes -->
      <div v-if="!o.env.ai || !o.env.resend || o.env.schedulerDisabled" class="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs space-y-1">
        <p v-if="o.env.schedulerDisabled" class="flex items-start gap-2"><AlertTriangle class="size-4 text-amber-500 shrink-0" /> The scheduler is switched off on this server (AUTOMATION_SCHEDULER_DISABLED / CRM_AUTOMATIONS_DISABLED) — automations only run when you press “Run now”.</p>
        <p v-if="!o.env.ai" class="flex items-start gap-2"><KeyRound class="size-4 text-amber-500 shrink-0" /> AI is not connected. Add <code class="px-1 rounded bg-muted">GOOGLE_GEMINI_API_KEY</code> (or <code class="px-1 rounded bg-muted">ANTHROPIC_API_KEY</code>) to <code class="px-1 rounded bg-muted">.env</code> for AI-personalized drafts, reply suggestions and summaries. Until then the automations use your templates and keyword rules.</p>
        <p v-if="!o.env.resend" class="flex items-start gap-2"><KeyRound class="size-4 text-amber-500 shrink-0" /> RESEND_API_KEY is missing — approved emails cannot be sent.</p>
      </div>

      <!-- The 15 automations -->
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <section v-for="g in groups" :key="g.key" class="rounded-xl border bg-card overflow-hidden">
          <header class="px-4 py-2.5 border-b flex items-center gap-2">
            <Bot class="size-4 text-muted-foreground" />
            <h3 class="text-sm font-semibold">{{ g.title }}</h3>
            <span class="ml-auto text-[10px] text-muted-foreground truncate">{{ g.hint }}</span>
          </header>
          <ul class="divide-y">
            <li v-for="a in g.items" :key="a.key" class="px-4 py-3 flex gap-3">
              <span class="size-6 shrink-0 rounded-full bg-muted text-[11px] font-semibold tabular-nums flex items-center justify-center mt-0.5">{{ a.n }}</span>
              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <component :is="linkFor(a.key) ? NuxtLinkComp : 'span'" :to="linkFor(a.key)" class="text-sm font-medium" :class="linkFor(a.key) && 'hover:underline'">{{ a.title }}</component>
                  <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium" :class="statusOf(a).cls">
                    <component :is="statusOf(a).icon" class="size-3" :class="statusOf(a).label === 'Running' && 'animate-spin'" /> {{ statusOf(a).label }}
                  </span>
                </div>
                <p class="text-xs text-muted-foreground">{{ a.does }}</p>
                <p v-if="noteFor(a)" class="text-[11px] text-muted-foreground italic">{{ noteFor(a) }}</p>
                <p v-if="a.lastRunAt && a.kind !== 'planned'" class="text-[11px]" :class="a.lastStatus === 'error' ? 'text-rose-600' : 'text-foreground/80'">
                  <span class="text-muted-foreground">{{ ago(a.lastRunAt) }} ·</span> {{ a.lastSummary }}
                </p>
              </div>
              <div class="flex items-start gap-2 shrink-0 pt-0.5">
                <Button v-if="a.kind === 'scheduled'" variant="ghost" size="sm" class="h-7 px-2 text-xs gap-1" :disabled="busy === a.key || !canEdit" title="Run now" @click="run(a)">
                  <Loader2 v-if="busy === a.key" class="size-3.5 animate-spin" /><Play v-else class="size-3.5" /> Run
                </Button>
                <Switch v-if="a.kind === 'scheduled' || a.kind === 'event'" :model-value="a.enabled" :disabled="busy === a.key || !canEdit" :aria-label="`${a.title} on/off`" @update:model-value="(v: boolean) => toggle(a, v)" />
              </div>
            </li>
          </ul>
        </section>
      </div>

      <!-- Run log -->
      <section class="rounded-xl border bg-card overflow-hidden">
        <header class="px-4 py-2.5 border-b flex items-center gap-2">
          <History class="size-4 text-muted-foreground" />
          <button type="button" class="text-sm font-semibold inline-flex items-center gap-1" @click="showLog = !showLog">Run log <ChevronDown class="size-3.5 transition-transform" :class="showLog && 'rotate-180'" /></button>
          <Select v-model="runsKey">
            <SelectTrigger class="ml-auto h-8 w-[220px] text-xs"><SelectValue placeholder="All automations" /></SelectTrigger>
            <SelectContent class="max-h-72">
              <SelectItem value="all">All automations</SelectItem>
              <SelectItem v-for="a in o.automations.filter(x => x.kind === 'scheduled' || x.kind === 'event')" :key="a.key" :value="a.key">{{ a.n }}. {{ a.title }}</SelectItem>
            </SelectContent>
          </Select>
        </header>
        <div v-if="showLog" class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead class="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/30">
              <tr><th class="text-left font-medium px-4 py-2">When</th><th class="text-left font-medium px-2 py-2">Automation</th><th class="text-left font-medium px-2 py-2">Result</th><th class="text-left font-medium px-2 py-2">Trigger</th><th class="text-right font-medium px-4 py-2">Time</th></tr>
            </thead>
            <tbody class="divide-y">
              <tr v-for="r in runs" :key="r.id">
                <td class="px-4 py-2 whitespace-nowrap text-muted-foreground" :title="new Date(r.startedAt).toLocaleString()">{{ ago(r.startedAt) }}</td>
                <td class="px-2 py-2 whitespace-nowrap">{{ r.n }}. {{ r.title }}</td>
                <td class="px-2 py-2" :class="r.status === 'error' && 'text-rose-600'">{{ r.summary }}</td>
                <td class="px-2 py-2 whitespace-nowrap text-muted-foreground">{{ r.trigger === 'manual' ? `Run by ${r.by?.name || 'someone'}` : r.trigger === 'event' ? 'Data arrived' : 'Scheduled' }}</td>
                <td class="px-4 py-2 text-right tabular-nums text-muted-foreground">{{ r.ms < 1000 ? `${r.ms} ms` : `${(r.ms / 1000).toFixed(1)} s` }}</td>
              </tr>
              <tr v-if="!runs.length"><td colspan="5" class="px-4 py-6 text-center text-muted-foreground">No runs yet. Automations start within a minute of the server starting.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <!-- Settings -->
    <Sheet v-model:open="settingsOpen">
      <SheetContent side="right" class="w-full sm:max-w-lg p-0 flex flex-col gap-0">
        <SheetHeader class="px-6 pt-6 pb-4 border-b">
          <SheetTitle class="text-base">Automation settings</SheetTitle>
          <SheetDescription class="text-xs">Times are in the CRM time zone ({{ o?.env.timeZone }}).</SheetDescription>
        </SheetHeader>
        <form class="flex-1 overflow-y-auto px-6 py-5 space-y-6" @submit.prevent="save">
          <section class="space-y-3">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sending</h4>
            <div class="grid grid-cols-3 gap-3">
              <div class="space-y-1.5"><Label for="as-limit">Emails per day</Label><Input id="as-limit" v-model="form.dailySendLimit" type="number" min="0" max="500" /></div>
              <div class="space-y-1.5"><Label for="as-start">From</Label><Input id="as-start" v-model="form.sendStart" type="time" /></div>
              <div class="space-y-1.5"><Label for="as-end">Until</Label><Input id="as-end" v-model="form.sendEnd" type="time" /></div>
            </div>
            <label class="flex items-center justify-between gap-3 text-sm"><span>Weekdays only</span><Switch v-model="form.weekdaysOnly" /></label>
          </section>
          <section class="space-y-3">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Drafts & follow-ups</h4>
            <div class="space-y-1.5">
              <Label>First emails</Label>
              <Select v-model="form.firstTouchStyle">
                <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="template">Your template as designed (with their audit numbers)</SelectItem>
                  <SelectItem value="ai">AI-personalized from your template</SelectItem>
                  <SelectItem value="split">Alternate both — find out which wins</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1.5"><Label for="as-gaps">Follow-up after (days)</Label><Input id="as-gaps" v-model="form.gapsText" placeholder="4, 7, 14" /><p class="text-[11px] text-muted-foreground">One number per follow-up. Empty = no automatic follow-ups.</p></div>
              <div class="space-y-1.5"><Label for="as-max">New drafts per run</Label><Input id="as-max" v-model="form.maxDraftsPerRun" type="number" min="1" max="200" /></div>
            </div>
          </section>
          <section class="space-y-3">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Research & AI</h4>
            <label class="flex items-center justify-between gap-3 text-sm"><span>Move dealerships forward automatically<span class="block text-[11px] text-muted-foreground">Research Needed → Researched → Ready to Contact when the audit and an email contact are on file</span></span><Switch v-model="form.autoAdvanceStages" /></label>
            <label class="flex items-center justify-between gap-3 text-sm"><span>Use AI {{ o?.env.ai ? `(${o?.env.aiLabel || o?.env.aiModel})` : '(not connected)' }}<span class="block text-[11px] text-muted-foreground">AI only suggests — you approve every email and confirm every reply</span></span><Switch v-model="form.useAi" :disabled="!o?.env.ai" /></label>
            <div class="space-y-1.5 w-1/2"><Label for="as-stale">Audit counts as stale after (days)</Label><Input id="as-stale" v-model="form.auditStaleDays" type="number" min="7" max="365" /></div>
          </section>
        </form>
        <div class="border-t px-6 py-4 flex justify-end gap-2">
          <Button variant="outline" @click="settingsOpen = false">Cancel</Button>
          <Button :disabled="saving" @click="save"><Loader2 v-if="saving" class="size-4 animate-spin mr-1" /> Save</Button>
        </div>
      </SheetContent>
    </Sheet>
  </div>
</template>
