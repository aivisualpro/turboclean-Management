<script setup lang="ts">
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { EmailTemplate } from '~/composables/useCrmEmail'
import { EMAIL_TEMPLATE_CATEGORIES } from '~/constants/crm'
import { Sparkles, X, Wand2, Loader2, Square, Send, Eye, Code2, Undo2, Save, AlertTriangle, Brain, Check, RotateCcw, Zap, Gem, CalendarDays, Timer, Lightbulb, CheckCircle2, Circle, Flame, ArrowRight } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * Template Studio — describe an email, the AI designs it in the ZRZ OPS house style (streams live
 * into the preview), then refine it in plain words ("shorter", "add the evidence list") until it is
 * right, and save it as a new template or as a new A/B version of an existing one.
 *
 * While it works you see a build stage: the AI's plan as it thinks, a step tracker, elapsed time and
 * the email assembling top-down. Seasonal briefs (Black Friday, holidays…) switch on campaign art
 * direction. A client-side watchdog ends a silent connection after 45 s instead of spinning forever.
 * Every brief and change request also teaches the brain ('design' area).
 */
const props = defineProps<{ template?: EmailTemplate | null, startHtml?: string, startSubject?: string, startName?: string }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [t: EmailTemplate] }>()

const { templates, saveTemplate, config } = useCrmEmail()
interface Draft { name: string, category: string, subject: string, notes: string, html: string, at: number, unknown: string[], ms?: number, model?: string, campaign?: boolean, repaired?: boolean }
const drafts = ref<Draft[]>([])
const at = ref(-1)
const current = computed(() => at.value >= 0 ? drafts.value[at.value] || null : null)
const turns = ref<{ who: 'you' | 'ai', text: string, draft?: number, meta?: string, error?: boolean }[]>([])

const brief = ref('')
const goal = ref<string>('Follow-up')
const length = ref<'short' | 'standard' | 'rich'>('standard')
const style = ref<'house' | 'fresh'>('house')
const audience = ref<string>('gm')
const quality = ref<'fast' | 'best'>('fast')
/** null = detect from the brief, true / false = forced by the user. */
const campaignOverride = ref<boolean | null>(null)
const instruction = ref('')
const streaming = ref(false)
/** Provider notes while waiting ("gemini-… answered 503 — retrying in 4s"). */
const aiNote = ref('')
const liveText = ref('')
const thoughts = ref('')
const phase = ref<'connecting' | 'thinking' | 'writing' | 'checking'>('connecting')
const elapsed = ref(0)
const view = ref<'preview' | 'html'>('preview')
const device = ref<'desktop' | 'mobile'>('desktop')
let ctrl: AbortController | null = null
let clock: ReturnType<typeof setInterval> | null = null

const AUDIENCES = [
  { value: 'gm', label: 'General Manager' },
  { value: 'ucm', label: 'Used-car manager' },
  { value: 'principal', label: 'Dealer principal' },
  { value: 'marketing', label: 'Marketing manager' },
] as const

const CAMPAIGN_RE = /black\s*friday|cyber\s*monday|thanks\s*giving|holiday|christmas|new\s*year|year[-\s]*end|memorial\s*day|labor\s*day|4th of july|presidents?\s*day|tax\s*(season|refund)|spring\s*(sale|event)|summer\s*(sale|event)/i
const campaignDetected = computed(() => CAMPAIGN_RE.test(brief.value))
const campaign = computed(() => campaignOverride.value ?? campaignDetected.value)

/** Seasonal hero starter — shown at the top in season (Nov–Jan). */
const month = new Date().getMonth()
const SEASONAL = month >= 10 || month === 0
  ? {
      label: month === 0 ? 'New-year inventory reset' : 'Thanksgiving · Black Friday · Cyber Monday',
      title: month === 0 ? 'Start the year with real photos' : 'Holiday weekend missing-photo alert',
      blurb: month === 0 ? 'January traffic is back — show the gaps and offer a fast reset.' : 'Families shop from the couch this weekend. Show the dealer the ad money landing on listings with no photos.',
      goal: 'First touch', length: 'rich' as const, audience: 'gm',
      brief: month === 0
        ? 'New-year inventory reset email for a dealership GM. January shoppers are back online after the holidays and the dealer\'s ads are running again — but many pre-owned listings still have no real photo. Lead with their numbers, show what a shopper sees (example listing card + the spot-check evidence list), explain plainly why a listing without photos wastes the ad click, and offer to photograph the gaps in the first week of January. One clear ask: reply "yes" and we schedule the shoot.'
        : 'Thanksgiving / Black Friday missing-photo alert for a dealership GM. This is the biggest shopping weekend of the year: families are home together, browsing on their phones, and the dealer\'s ad money is sending them straight to vehicle pages — but many pre-owned listings show no real photo, so those shoppers scroll to the next dealer. Lead with their own numbers, show what a shopper actually sees (an example listing card with "Photo coming soon" + the real spot-check evidence list), explain the lost opportunity in plain logic (ads paid → click → no photos → shopper leaves), add a weekend date strip, and offer to photograph those cars before the Cyber Monday traffic and the December rush. One clear ask: reply "yes" and we start this week.',
    }
  : null

const STARTERS = [
  { label: 'Follow-up to the inventory report', goal: 'Follow-up', brief: 'A short, friendly follow-up to our inventory photo report. Remind them of the headline number, offer to send the full list of listings without real photos, and ask for a 10-minute call. Include the spot-check evidence list.' },
  { label: 'Recon introduction', goal: 'First touch', brief: 'Introduce ZRZ OPS to a General Manager who has never heard of us: reconditioning, real photos online fast, and listing monitoring. Lead with their own inventory numbers, keep it confident and short, one clear ask for a 10-minute review.' },
  { label: 'Meeting recap & next steps', goal: 'Meeting', brief: 'Recap after a 10-minute review call: what we found on their site, what we proposed (recon, photos, monitoring), the agreed next step and timeline, and a clear button to confirm the start date.' },
  { label: 'Monthly photo report (client)', goal: 'Other', brief: 'Monthly report for an existing client dealership: how many vehicles we photographed, current share of listings with real photos, remaining gaps with the evidence list, and what we will focus on next month. Warm, partner tone.' },
  { label: 'Re-engage a quiet dealership', goal: 'Re-engage', brief: 'Re-engage a dealership that went quiet 60 days ago: new numbers from a fresh review of their site, no guilt-tripping, one easy yes/no question.' },
  { label: 'Proposal summary', goal: 'Proposal', brief: 'Proposal summary email: what is included (recon, merchandising photos, listing monitoring), how onboarding works in the first two weeks, a short FAQ, and a button to approve and schedule kickoff. No prices — say pricing is in the attached proposal.' },
]
const QUICK = ['Make it shorter', 'More personal, less salesy', 'Stronger call to action', 'Add the evidence list of listings', 'Make the hero headline punchier', 'Add a “what a shopper sees” listing card', 'Better on mobile']

// ── Preview data ──
const pv = useTemplatePreview()
const tags = (keys: string[]) => keys.map(k => `{` + `{${k}}` + `}`).join(', ')
const rendered = computed(() => {
  const html = streaming.value ? liveHtml.value : current.value?.html || ''
  return pv.render({ format: 'html', html }, current.value?.subject || liveMeta.value.subject || '')
})
const liveMeta = computed(() => {
  const head = liveText.value.split('---HTML---')[0] || ''
  const f = (k: string) => (head.match(new RegExp(`^${k}:\\s*(.+)$`, 'mi'))?.[1] || '').trim()
  return { name: f('NAME'), subject: f('SUBJECT'), notes: f('NOTES') }
})
const liveHtml = ref('')
let liveTimer: ReturnType<typeof setTimeout> | null = null
watch(liveText, (t) => {
  if (liveTimer) return
  liveTimer = setTimeout(() => {
    liveTimer = null
    const i = t.indexOf('---HTML---')
    // A partial document still renders — the email appears top-down as it is written.
    liveHtml.value = i === -1 ? '' : t.slice(i + 10).replace(/^\s*```(?:html)?/i, '')
  }, 250)
})

// ── Build progress ──
const htmlChars = computed(() => { const i = liveText.value.indexOf('---HTML---'); return i === -1 ? 0 : liveText.value.length - i })
const STEPS = ['Connecting', 'Art direction & plan', 'Hero & headline', 'Proof & sections', 'Outlook & mobile polish', 'Quality checks']
const stepAt = computed(() => {
  if (phase.value === 'checking') return 5
  if (phase.value === 'connecting') return 0
  if (!htmlChars.value) return 1
  if (htmlChars.value < 5000) return 2
  if (htmlChars.value < 14000) return 3
  return 4
})
const fmtTime = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const expected = computed(() => quality.value === 'best' ? 'Usually 2–3 min on Best' : 'Usually under 90 s on Fast')
const slow = computed(() => elapsed.value > (quality.value === 'best' ? 200_000 : 120_000))
/** Headings of the AI's thought summary ("**Planning the hero**") → a live plan list. */
const plan = computed(() => [...thoughts.value.matchAll(/\*\*(.+?)\*\*/g)].map(m => m[1]!.trim()).filter((v, i, a) => v && a.indexOf(v) === i).slice(-6))
const lastThought = computed(() => {
  const paras = thoughts.value.replace(/\*\*(.+?)\*\*/g, '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  return (paras.at(-1) || '').slice(0, 320)
})

// ── Design QA (after a draft is ready) ──
const qa = computed(() => {
  const h = current.value?.html || ''
  if (!h) return []
  const kb = new Blob([h]).size / 1024
  const fields = new Set([...h.matchAll(/\{\{\s*(\w+)/g)].map(m => m[1]))
  return [
    { label: `${kb.toFixed(0)} KB`, ok: kb < 90, tip: kb < 90 ? 'Well under Gmail’s 102 KB clipping limit' : 'Close to Gmail’s 102 KB clipping limit' },
    { label: 'Outlook buttons', ok: /v:roundrect/i.test(h), tip: /v:roundrect/i.test(h) ? 'Bulletproof VML buttons for Outlook desktop' : 'No VML fallback — ask “make the button Outlook-safe”' },
    { label: 'Mobile layout', ok: /@media[^{]*max-width/i.test(h), tip: /@media[^{]*max-width/i.test(h) ? 'Responsive rules stack cards on phones' : 'No mobile rules — ask “better on mobile”' },
    { label: 'Preheader', ok: /display:\s*none/i.test(h.slice(0, 6000)), tip: 'Inbox preview text after the subject' },
    { label: `${fields.size} live fields`, ok: fields.size >= 3 && !(current.value?.unknown.length), tip: 'Personalised with your CRM and audit data' },
    ...(current.value?.ms ? [{ label: `Designed in ${fmtTime(current.value.ms)}`, ok: true, tip: current.value.model || '' }] : []),
  ]
})

// ── Save form ──
const saveName = ref('')
const saveCategory = ref<string>('Follow-up')
const saveSubject = ref('')
const saveMode = ref<'new' | 'version'>('new')
const targetId = ref<string>('')
const replaceCurrent = ref(false)
const saving = ref(false)
watch(current, (d) => {
  if (!d) return
  if (!saveName.value || saveMode.value === 'new') saveName.value = d.name || saveName.value
  if (d.category && (EMAIL_TEMPLATE_CATEGORIES as readonly string[]).includes(d.category)) saveCategory.value = d.category
  saveSubject.value = d.subject || saveSubject.value
})

function reset() {
  drafts.value = []; at.value = -1; turns.value = []; liveText.value = ''; liveHtml.value = ''; instruction.value = ''; thoughts.value = ''
  brief.value = ''; view.value = 'preview'; campaignOverride.value = null
  saveMode.value = props.template ? 'version' : 'new'
  targetId.value = props.template?.id || ''
  replaceCurrent.value = false
  saveName.value = props.startName || props.template?.name || ''
  saveSubject.value = props.startSubject || props.template?.subjects.find(s => s.status === 'active')?.text || ''
  saveCategory.value = props.template?.category || 'Follow-up'
  if (props.startHtml) {
    drafts.value = [{ name: saveName.value, category: saveCategory.value, subject: saveSubject.value, notes: 'Starting point', html: props.startHtml, at: Date.now(), unknown: [] }]
    at.value = 0
    turns.value = [{ who: 'ai', text: `Loaded ${props.template?.name || 'the template'} — tell me what to change.`, draft: 0 }]
  }
}
watch(open, (v) => { if (v) reset(); else stop() }, { immediate: true })
onBeforeUnmount(() => { stop(); if (clock) clearInterval(clock) })

/** Watchdog: the server sends a status event every 2 s — 45 s of silence means the connection is gone. */
const SILENCE_MS = 45_000

async function run(body: Record<string, any>, userText: string) {
  if (streaming.value) return
  turns.value.push({ who: 'you', text: userText })
  streaming.value = true
  aiNote.value = ''
  liveText.value = ''
  liveHtml.value = ''
  thoughts.value = ''
  phase.value = 'connecting'
  const started = Date.now()
  elapsed.value = 0
  let lastEvent = Date.now()
  let silenced = false
  ctrl = new AbortController()
  const local = ctrl
  clock = setInterval(() => {
    elapsed.value = Date.now() - started
    if (Date.now() - lastEvent > SILENCE_MS) { silenced = true; local.abort() }
  }, 1000)
  try {
    const res = await fetch('/api/crm/email/templates/studio', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' }, body: JSON.stringify(body), signal: ctrl.signal, credentials: 'same-origin' })
    if (!res.ok || !res.body) { const e = await res.json().catch(() => null); throw new Error(e?.message || e?.statusMessage || `Template Studio is unavailable (${res.status})`) }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let done: any = null
    let failure: string | null = null
    while (true) {
      const r = await reader.read()
      if (r.done) break
      lastEvent = Date.now()
      buf += dec.decode(r.value, { stream: true }).replace(/\r\n?/g, '\n')
      let i: number
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2)
        let ev = 'message', data = ''
        for (const line of block.split('\n')) { if (line.startsWith('event:')) ev = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim() }
        if (!data) continue
        let d: any; try { d = JSON.parse(data) } catch { continue }
        if (ev === 'delta') { liveText.value += d.text; phase.value = 'writing' }
        else if (ev === 'thought') { thoughts.value += `${thoughts.value ? '\n\n' : ''}${d.text}`; if (phase.value === 'connecting') phase.value = 'thinking' }
        else if (ev === 'status') { if (d.phase && !(phase.value === 'writing' && d.phase === 'thinking')) phase.value = d.phase }
        else if (ev === 'done') done = d
        else if (ev === 'failure') failure = d.message
        else if (ev === 'note') aiNote.value = d.text
      }
    }
    if (failure) throw new Error(failure)
    if (!done) throw new Error('The connection dropped before the design finished — try again')
    drafts.value = [...drafts.value.slice(0, at.value + 1), { name: done.name, category: done.category, subject: done.subject, notes: done.notes, html: done.html, at: Date.now(), unknown: done.unknownFields || [], ms: done.ms || (Date.now() - started), model: done.model, campaign: done.campaign, repaired: done.repaired }]
    at.value = drafts.value.length - 1
    turns.value.push({ who: 'ai', text: done.notes || 'Here it is.', draft: at.value, meta: `${fmtTime(done.ms || Date.now() - started)} · ${done.model || 'AI'}${done.campaign ? ' · campaign' : ''}` })
    view.value = 'preview'
  }
  catch (e: any) {
    if (silenced) { turns.value.push({ who: 'ai', text: 'Lost the connection to the design server (no response for 45 s). Nothing was charged twice — try again.', error: true }); toast.error('Template Studio lost the connection') }
    else if (e?.name === 'AbortError' || /Stopped/.test(e?.message)) turns.value.push({ who: 'ai', text: 'Stopped.' })
    else { turns.value.push({ who: 'ai', text: `Something went wrong: ${e?.message || 'unknown error'}`, error: true }); toast.error(e?.message || 'Template Studio failed') }
  }
  finally { streaming.value = false; ctrl = null; liveText.value = ''; if (clock) { clearInterval(clock); clock = null } }
}
function design() {
  const b = brief.value.trim()
  if (!b) return toast.error('Describe the email first — or pick a starter')
  run({ brief: b, goal: goal.value, length: length.value, style: style.value, audience: audience.value, quality: quality.value, campaign: campaign.value }, b)
}
function refine(text?: string) {
  const t = (text ?? instruction.value).trim()
  if (!t || !current.value) return
  instruction.value = ''
  run({ html: current.value.html, instruction: t, name: current.value.name, subject: current.value.subject, quality: quality.value, campaign: current.value.campaign ?? campaign.value }, t)
}
function retry() {
  const lastYou = [...turns.value].reverse().find(t => t.who === 'you')
  if (!lastYou) return
  turns.value = turns.value.slice(0, turns.value.lastIndexOf(lastYou))
  if (current.value) refine(lastYou.text)
  else { brief.value = lastYou.text; design() }
}
function stop() { ctrl?.abort() }
/** After a failed first design: back to the brief form, brief kept. */
function editBrief() {
  const lastYou = [...turns.value].reverse().find(t => t.who === 'you')
  turns.value = []
  if (lastYou) brief.value = lastYou.text
}
function pickStarter(s: { brief: string, goal: string, length?: 'short' | 'standard' | 'rich', audience?: string }) {
  brief.value = s.brief; goal.value = s.goal
  if (s.length) length.value = s.length
  if (s.audience) audience.value = s.audience
}
function goTo(i: number) { if (!streaming.value && drafts.value[i]) at.value = i }
const lastFailed = computed(() => !streaming.value && turns.value.at(-1)?.error === true)

// Hand-edits in the HTML tab become a new draft step (so Undo works).
const codeEdit = ref('')
watch([view, current], () => { if (view.value === 'html') codeEdit.value = current.value?.html || '' })
function applyCode() {
  if (!current.value || codeEdit.value === current.value.html) return
  drafts.value = [...drafts.value.slice(0, at.value + 1), { ...current.value, html: codeEdit.value, notes: 'Edited by hand', at: Date.now() }]
  at.value = drafts.value.length - 1
  toast.success('HTML updated')
}

async function save() {
  const d = current.value
  if (!d) return
  if (!saveSubject.value.trim()) return toast.error('Add a subject line')
  saving.value = true
  try {
    const studio = { brief: turns.value.filter(t => t.who === 'you').map(t => t.text).join(' → ').slice(0, 1500), turns: turns.value.length }
    let t: EmailTemplate
    if (saveMode.value === 'version' && targetId.value) {
      const target = templates.value.find(x => x.id === targetId.value)
      const next = Math.max(0, ...(target?.versions.map(v => v.version) || [0])) + 1
      t = await saveTemplate(targetId.value, { newVersion: { format: 'html', html: d.html, label: `V${next}`, note: `Template Studio: ${d.notes || 'AI design'}`.slice(0, 300), retireOthers: replaceCurrent.value }, studio, ...(target?.subjects.some(s => s.text === saveSubject.value.trim()) ? {} : { addSubject: { text: saveSubject.value.trim(), retireOthers: false } }) })
      toast.success(replaceCurrent.value ? `Saved as V${next} — now the only active version` : `Saved as V${next} — A/B testing against the current version`)
    }
    else {
      if (!saveName.value.trim()) { saving.value = false; return toast.error('Name the template') }
      t = await saveTemplate(null, { name: saveName.value.trim(), category: saveCategory.value, subject: saveSubject.value.trim(), format: 'html', html: d.html, label: 'V1', note: `Template Studio: ${d.notes || 'AI design'}`.slice(0, 300), description: (turns.value.find(x => x.who === 'you')?.text || '').slice(0, 300), studio })
      toast.success('Template created — it’s in your library')
    }
    emit('saved', t)
    open.value = false
  }
  catch (e: any) { toast.error(e?.data?.statusMessage || e?.data?.message || 'Could not save') }
  finally { saving.value = false }
}
function close() {
  if (streaming.value) stop()
  if (drafts.value.length && !props.startHtml && !confirm('Close Template Studio? The design is not saved yet.')) return
  open.value = false
}
const aiReady = computed(() => config.value?.aiConfigured !== false)
const libraryTemplates = computed(() => templates.value.filter(t => !t.archivedAt))
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogContent class="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95" @escape-key-down="(e: Event) => { e.preventDefault(); close() }" @interact-outside="(e: Event) => e.preventDefault()" @open-auto-focus="(e: Event) => e.preventDefault()">
        <!-- Title bar -->
        <header class="shrink-0 h-12 flex items-center gap-3 px-3 border-b bg-card">
          <span class="size-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 text-white flex items-center justify-center shadow-sm shadow-emerald-700/30"><Sparkles class="size-4" /></span>
          <div class="min-w-0 leading-tight">
            <DialogTitle class="text-sm font-semibold tracking-tight">Template Studio</DialogTitle>
            <DialogDescription class="text-[11px] text-muted-foreground truncate">{{ template ? `Designing a new version of “${template.name}”` : 'Describe an email — AI designs it in your house style' }}</DialogDescription>
          </div>
          <span class="hidden md:inline-flex items-center gap-1.5 ml-3 rounded-full border bg-muted/40 px-2 h-6 text-[11px] text-muted-foreground"><Brain class="size-3.5 text-emerald-600" /> Uses your playbook · {{ config?.aiLabel || config?.aiModel || 'AI' }}</span>
          <span v-if="streaming" class="hidden md:inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 h-6 text-[11px] font-semibold tabular-nums"><Timer class="size-3.5" /> {{ fmtTime(elapsed) }}</span>
          <Button variant="ghost" size="icon" class="size-8 ml-auto" aria-label="Close" @click="close"><X class="size-4" /></Button>
        </header>

        <div class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[420px_1fr]">
          <!-- Left: brief / conversation -->
          <aside class="min-h-0 flex flex-col border-r bg-muted/20">
            <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              <div v-if="!aiReady" class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200 flex gap-2"><AlertTriangle class="size-4 shrink-0" /> AI is not connected on this server. Add <code>GOOGLE_GEMINI_API_KEY</code> (or <code>ANTHROPIC_API_KEY</code>) to use Template Studio.</div>

              <!-- Brief -->
              <template v-if="!drafts.length && !streaming && !turns.length">
                <!-- Seasonal hero starter -->
                <button v-if="SEASONAL" type="button" class="group relative w-full overflow-hidden rounded-xl border border-amber-500/30 bg-[#0b0f0d] p-4 text-left text-white shadow-sm transition hover:border-amber-400/60 hover:shadow-lg hover:shadow-amber-500/10" @click="pickStarter(SEASONAL)">
                  <span class="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-amber-400/20 blur-3xl transition group-hover:bg-amber-400/30" />
                  <span class="inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300"><CalendarDays class="size-3" /> {{ SEASONAL.label }}</span>
                  <p class="mt-2.5 text-[15px] font-semibold tracking-tight">{{ SEASONAL.title }}</p>
                  <p class="mt-1 text-xs leading-relaxed text-zinc-400">{{ SEASONAL.blurb }}</p>
                  <span class="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300">Use this brief <ArrowRight class="size-3 transition group-hover:translate-x-0.5" /></span>
                </button>

                <div class="space-y-1.5">
                  <p class="text-sm font-semibold">What should this email do?</p>
                  <p class="text-xs text-muted-foreground">Who it’s for, the goal, what to include. Your data fields (dealership, audit numbers, evidence list, signature) are wired in automatically.</p>
                </div>
                <div class="relative">
                  <Textarea v-model="brief" rows="7" class="text-sm leading-relaxed bg-background pb-7" placeholder="e.g. A short follow-up to the inventory report for a used-car manager. Remind them of the number, offer the full list, ask for 10 minutes this week." @keydown.meta.enter.prevent="design" @keydown.ctrl.enter.prevent="design" />
                  <span class="pointer-events-none absolute bottom-2 right-3 text-[10px] text-muted-foreground tabular-nums">{{ brief.length }} / 4000</span>
                </div>
                <div v-if="brief.trim()" class="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px]" :class="campaign ? 'border-amber-500/30 bg-amber-500/5' : 'bg-background'">
                  <Flame class="size-3.5 shrink-0" :class="campaign ? 'text-amber-500' : 'text-muted-foreground'" />
                  <span class="min-w-0 flex-1" :class="campaign ? 'text-amber-800 dark:text-amber-200' : 'text-muted-foreground'">{{ campaign ? 'Campaign mode — seasonal art direction and real dates' : 'Standard sales email' }}<span v-if="campaignOverride === null && campaignDetected" class="opacity-70"> · detected</span></span>
                  <Switch :model-value="campaign" aria-label="Campaign mode" @update:model-value="(v: boolean) => campaignOverride = v" />
                </div>
                <div class="flex flex-wrap gap-1.5">
                  <button v-for="s in STARTERS" :key="s.label" type="button" class="rounded-full border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-primary/40" @click="pickStarter(s)">{{ s.label }}</button>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <div class="space-y-1"><Label class="text-[11px] text-muted-foreground">Type</Label>
                    <Select v-model="goal"><SelectTrigger class="w-full h-8 text-xs bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="c in EMAIL_TEMPLATE_CATEGORIES" :key="c" :value="c">{{ c }}</SelectItem></SelectContent></Select>
                  </div>
                  <div class="space-y-1"><Label class="text-[11px] text-muted-foreground">Reader</Label>
                    <Select v-model="audience"><SelectTrigger class="w-full h-8 text-xs bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="a in AUDIENCES" :key="a.value" :value="a.value">{{ a.label }}</SelectItem></SelectContent></Select>
                  </div>
                </div>
                <div class="space-y-1"><Label class="text-[11px] text-muted-foreground">Length</Label>
                  <div class="inline-flex w-full rounded-lg border bg-muted/40 p-0.5">
                    <button v-for="l in (['short', 'standard', 'rich'] as const)" :key="l" type="button" class="flex-1 rounded-md py-1 text-[11px] font-medium capitalize" :class="length === l ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="length = l">{{ l }}</button>
                  </div>
                </div>
                <div class="inline-flex w-full rounded-lg border bg-muted/40 p-0.5">
                  <button type="button" class="flex-1 rounded-md py-1.5 text-xs font-medium" :class="style === 'house' ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="style = 'house'">House style</button>
                  <button type="button" class="flex-1 rounded-md py-1.5 text-xs font-medium" :class="style === 'fresh' ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="style = 'fresh'">Fresh layout</button>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <button type="button" class="rounded-lg border p-2.5 text-left transition" :class="quality === 'fast' ? 'border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/30' : 'bg-background hover:border-primary/30'" @click="quality = 'fast'">
                    <span class="flex items-center gap-1.5 text-xs font-semibold"><Zap class="size-3.5 text-emerald-600" /> Fast</span>
                    <span class="mt-0.5 block text-[10px] text-muted-foreground">About a minute · great for drafts</span>
                  </button>
                  <button type="button" class="rounded-lg border p-2.5 text-left transition" :class="quality === 'best' ? 'border-violet-500/50 bg-violet-500/5 ring-1 ring-violet-500/30' : 'bg-background hover:border-primary/30'" @click="quality = 'best'">
                    <span class="flex items-center gap-1.5 text-xs font-semibold"><Gem class="size-3.5 text-violet-600" /> Best</span>
                    <span class="mt-0.5 block text-[10px] text-muted-foreground">Deeper thinking · 2–3 min</span>
                  </button>
                </div>
                <Button class="w-full h-10 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-700/20" :disabled="!aiReady || !brief.trim()" @click="design"><Wand2 class="size-4" /> Design it <kbd class="ml-1 hidden sm:inline rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium">⌘↵</kbd></Button>
              </template>

              <!-- Conversation -->
              <ol v-else class="space-y-3">
                <li v-for="(t, i) in turns" :key="i" class="flex" :class="t.who === 'you' ? 'justify-end' : ''">
                  <div class="max-w-[90%] rounded-2xl px-3 py-2 text-xs leading-relaxed" :class="t.who === 'you' ? 'bg-primary text-primary-foreground rounded-br-sm' : t.error ? 'bg-rose-500/5 border border-rose-500/30 text-rose-800 dark:text-rose-200 rounded-bl-sm' : 'bg-background border rounded-bl-sm'">
                    <p class="whitespace-pre-wrap" :class="t.who === 'you' ? 'line-clamp-6' : ''">{{ t.text }}</p>
                    <p v-if="t.meta" class="mt-1 text-[10px] text-muted-foreground tabular-nums">{{ t.meta }}</p>
                    <button v-if="t.draft !== undefined" type="button" class="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold" :class="at === t.draft ? 'text-emerald-600' : 'text-muted-foreground hover:text-foreground'" @click="goTo(t.draft!)"><Check v-if="at === t.draft" class="size-3" /><Eye v-else class="size-3" /> Draft {{ (t.draft ?? 0) + 1 }}{{ at === t.draft ? ' · showing' : '' }}</button>
                  </div>
                </li>
                <li v-if="lastFailed" class="flex gap-2">
                  <Button size="sm" variant="outline" class="h-7 gap-1.5 text-xs" @click="retry"><RotateCcw class="size-3.5" /> Try again</Button>
                  <Button v-if="!drafts.length" size="sm" variant="ghost" class="h-7 text-xs" @click="editBrief">Edit the brief</Button>
                </li>

                <!-- Live progress -->
                <li v-if="streaming" class="rounded-2xl rounded-bl-sm border bg-background p-3 space-y-3">
                  <div class="flex items-center gap-2 text-xs font-medium">
                    <Loader2 class="size-3.5 animate-spin text-emerald-600" /> {{ STEPS[stepAt] }}…
                    <span class="ml-auto tabular-nums text-muted-foreground">{{ fmtTime(elapsed) }}</span>
                  </div>
                  <ol class="space-y-1.5">
                    <li v-for="(s, i) in STEPS" :key="s" class="flex items-center gap-2 text-[11px]" :class="i < stepAt ? 'text-foreground' : i === stepAt ? 'text-emerald-700 dark:text-emerald-300 font-medium' : 'text-muted-foreground/60'">
                      <CheckCircle2 v-if="i < stepAt" class="size-3.5 text-emerald-600" />
                      <span v-else-if="i === stepAt" class="relative flex size-3.5 items-center justify-center"><span class="absolute size-3 rounded-full bg-emerald-500/30 animate-ping" /><span class="size-2 rounded-full bg-emerald-500" /></span>
                      <Circle v-else class="size-3.5" />
                      {{ s }}
                      <span v-if="i === 3 && i === stepAt" class="ml-auto tabular-nums text-muted-foreground">{{ (htmlChars / 1024).toFixed(1) }} KB</span>
                    </li>
                  </ol>
                  <p v-if="aiNote" class="text-[11px] text-amber-700 dark:text-amber-300">{{ aiNote }}</p>
                  <p v-if="slow" class="text-[11px] text-muted-foreground">Taking longer than usual — the AI provider is busy. It will finish or stop on its own within 5 minutes.</p>
                  <p v-else class="text-[10px] text-muted-foreground">{{ expected }}</p>
                </li>
              </ol>
            </div>

            <!-- Refine bar -->
            <div v-if="drafts.length || streaming" class="shrink-0 border-t bg-background p-3 space-y-2">
              <div class="flex flex-wrap gap-1">
                <button v-for="q in QUICK" :key="q" type="button" class="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-50" :disabled="streaming || !current" @click="refine(q)">{{ q }}</button>
              </div>
              <form class="flex items-end gap-2" @submit.prevent="refine()">
                <Textarea v-model="instruction" rows="2" class="text-sm min-h-0 resize-none" placeholder="Ask for changes… e.g. “add a short FAQ”, “use our green for the button”" :disabled="streaming" @keydown.enter.exact.prevent="refine()" />
                <Button v-if="!streaming" type="submit" size="icon" class="size-9 shrink-0" :disabled="!instruction.trim() || !current" aria-label="Send change request"><Send class="size-4" /></Button>
                <Button v-else type="button" variant="outline" size="icon" class="size-9 shrink-0" aria-label="Stop" @click="stop"><Square class="size-3.5 fill-current" /></Button>
              </form>
              <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
                <button type="button" class="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-40" :disabled="streaming || at <= 0" @click="goTo(at - 1)"><Undo2 class="size-3" /> Undo</button>
                <span class="inline-flex items-center gap-1">· <Zap v-if="quality === 'fast'" class="size-3" /><Gem v-else class="size-3" />
                  <button type="button" class="hover:text-foreground disabled:opacity-40" :disabled="streaming" @click="quality = quality === 'fast' ? 'best' : 'fast'">{{ quality === 'fast' ? 'Fast' : 'Best' }} quality</button>
                </span>
                <button v-if="!template && !startHtml" type="button" class="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-40 ml-auto" :disabled="streaming" @click="reset"><RotateCcw class="size-3" /> Start over</button>
              </div>
            </div>
          </aside>

          <!-- Right: preview / code + save -->
          <section class="min-h-0 flex flex-col">
            <div class="flex-1 min-h-0 p-3 flex flex-col">
              <!-- Empty state -->
              <div v-if="!drafts.length && !streaming" class="flex-1 rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-center p-8 bg-[radial-gradient(ellipse_at_top,theme(colors.emerald.500/0.08),transparent_60%)]">
                <span class="size-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30"><Sparkles class="size-6" /></span>
                <p class="mt-4 text-base font-semibold tracking-tight">Your email appears here as it’s being designed</p>
                <p class="mt-1 text-sm text-muted-foreground max-w-md">Table-based, Outlook-safe, mobile-ready HTML in the ZRZ OPS style, filled with real data from your CRM. Preview it on desktop and phone, with sample data or any dealership.</p>
                <div class="mt-6 grid grid-cols-3 gap-3 max-w-lg w-full text-left">
                  <div class="rounded-lg border bg-background p-3"><p class="text-[11px] font-semibold">Outlook-safe</p><p class="mt-0.5 text-[10px] text-muted-foreground">Tables, VML buttons, inline CSS</p></div>
                  <div class="rounded-lg border bg-background p-3"><p class="text-[11px] font-semibold">Your real data</p><p class="mt-0.5 text-[10px] text-muted-foreground">Audit numbers & evidence</p></div>
                  <div class="rounded-lg border bg-background p-3"><p class="text-[11px] font-semibold">Learns</p><p class="mt-0.5 text-[10px] text-muted-foreground">Every edit trains the brain</p></div>
                </div>
              </div>

              <!-- Build stage: before the first line of HTML arrives -->
              <div v-else-if="streaming && !liveHtml" class="flex-1 min-h-0 rounded-xl border overflow-hidden grid grid-cols-1 xl:grid-cols-[1fr_340px] bg-[#eef1ef] dark:bg-zinc-900">
                <div class="min-h-0 overflow-hidden flex items-start justify-center p-6">
                  <!-- Email skeleton assembling -->
                  <div class="w-full max-w-[600px] rounded-2xl bg-white shadow-[0_24px_60px_-28px_rgba(0,0,0,0.35)] overflow-hidden" aria-hidden="true">
                    <div class="h-11 flex items-center gap-2 px-6" :class="campaign ? 'bg-[#0b0f0d]' : 'bg-[#0e1714]'"><span class="size-5 rounded bg-emerald-500/80" /><span class="h-2.5 w-20 rounded bg-white/25" /></div>
                    <div class="px-8 py-9 space-y-3" :class="campaign ? 'bg-[#111827]' : 'bg-[#0e1714]'">
                      <span class="block h-4 w-28 rounded-full animate-pulse" :class="campaign ? 'bg-amber-400/40' : 'bg-emerald-400/40'" />
                      <span class="block h-7 w-11/12 rounded bg-white/20 animate-pulse" />
                      <span class="block h-7 w-3/4 rounded bg-white/20 animate-pulse [animation-delay:150ms]" />
                      <span class="block h-3 w-full rounded bg-white/10 animate-pulse [animation-delay:300ms]" />
                      <span class="block h-3 w-5/6 rounded bg-white/10 animate-pulse [animation-delay:450ms]" />
                    </div>
                    <div class="px-8 py-7 grid grid-cols-3 gap-3">
                      <div v-for="n in 3" :key="n" class="rounded-xl border border-zinc-200 p-3 space-y-2"><span class="block h-6 w-12 rounded bg-zinc-200 animate-pulse" :style="{ animationDelay: `${n * 120}ms` }" /><span class="block h-2 w-16 rounded bg-zinc-100" /></div>
                    </div>
                    <div class="px-8 pb-7 space-y-2"><span class="block h-3 w-full rounded bg-zinc-100 animate-pulse" /><span class="block h-3 w-4/5 rounded bg-zinc-100 animate-pulse [animation-delay:200ms]" /><span class="block h-3 w-2/3 rounded bg-zinc-100 animate-pulse [animation-delay:400ms]" /></div>
                    <div class="px-8 pb-9"><span class="block h-11 w-48 rounded-lg bg-emerald-600/70 animate-pulse" /></div>
                  </div>
                </div>
                <!-- AI's plan -->
                <aside class="min-h-0 overflow-y-auto border-t xl:border-t-0 xl:border-l bg-background/80 backdrop-blur p-4 space-y-3">
                  <p class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"><Lightbulb class="size-3.5 text-amber-500" /> The AI’s plan</p>
                  <ul v-if="plan.length" class="space-y-1.5">
                    <li v-for="(p, i) in plan" :key="p" class="flex items-start gap-2 text-xs"><CheckCircle2 v-if="i < plan.length - 1" class="size-3.5 mt-px shrink-0 text-emerald-600" /><Loader2 v-else class="size-3.5 mt-px shrink-0 animate-spin text-emerald-600" /><span>{{ p }}</span></li>
                  </ul>
                  <p v-if="lastThought" class="text-[11px] leading-relaxed text-muted-foreground border-l-2 border-amber-400/60 pl-2.5">{{ lastThought }}</p>
                  <p v-if="!plan.length && !lastThought" class="text-xs text-muted-foreground">{{ phase === 'connecting' ? `Connecting to ${config?.aiLabel || 'the AI'}…` : 'Reading your brief, the house style and your playbook…' }}</p>
                  <div v-if="campaign" class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-800 dark:text-amber-200 flex gap-2"><CalendarDays class="size-3.5 shrink-0 mt-px" /> Campaign art direction with this season’s real dates.</div>
                </aside>
              </div>

              <CrmEmailPreview v-else-if="view === 'preview'" v-model:device="device" class="flex-1" :html="rendered.html" :subject="rendered.subject" :preheader="rendered.preheader" :from="pv.ctx.value?.from" :to="pv.ctx.value?.to" :loading="pv.loading.value">
                <template #toolbar>
                  <div role="tablist" class="inline-flex rounded-lg border bg-muted/40 p-0.5">
                    <button type="button" role="tab" :aria-selected="true" class="rounded-md px-2.5 py-1 text-xs font-medium bg-background shadow-sm inline-flex items-center gap-1.5"><Eye class="size-3.5" /> Preview</button>
                    <button type="button" role="tab" :aria-selected="false" class="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 disabled:opacity-40" :disabled="streaming || !current" @click="view = 'html'"><Code2 class="size-3.5" /> HTML</button>
                  </div>
                  <div class="w-56"><CrmDealershipPicker v-model="pv.dealershipId.value" placeholder="Preview with a dealership…" /></div>
                  <CrmEmailInboxCheck v-if="!streaming && current" :rendered="rendered" :source="{ html: current.html, format: 'html' }" />
                  <span v-if="streaming" class="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 h-6 text-[11px] font-semibold tabular-nums"><span class="relative flex size-2"><span class="absolute inline-flex size-full rounded-full bg-emerald-500 opacity-60 animate-ping" /><span class="relative inline-flex size-2 rounded-full bg-emerald-500" /></span> {{ STEPS[stepAt] }} · {{ (htmlChars / 1024).toFixed(1) }} KB</span>
                </template>
              </CrmEmailPreview>
              <div v-else class="flex-1 min-h-0 flex flex-col rounded-xl border overflow-hidden">
                <div class="shrink-0 flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
                  <div role="tablist" class="inline-flex rounded-lg border bg-muted/40 p-0.5">
                    <button type="button" role="tab" :aria-selected="false" class="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5" @click="view = 'preview'"><Eye class="size-3.5" /> Preview</button>
                    <button type="button" role="tab" :aria-selected="true" class="rounded-md px-2.5 py-1 text-xs font-medium bg-background shadow-sm inline-flex items-center gap-1.5"><Code2 class="size-3.5" /> HTML</button>
                  </div>
                  <span class="text-[11px] text-muted-foreground">{{ Math.round((codeEdit.length || 0) / 1024) }} KB</span>
                  <Button size="sm" variant="outline" class="h-7 text-xs ml-auto" :disabled="codeEdit === current?.html" @click="applyCode">Apply edits</Button>
                </div>
                <textarea v-model="codeEdit" spellcheck="false" class="flex-1 min-h-0 w-full resize-none bg-zinc-950 text-zinc-100 font-mono text-[11px] leading-relaxed p-3 outline-none" aria-label="Email HTML" />
              </div>

              <!-- Design QA -->
              <div v-if="current && !streaming && qa.length" class="shrink-0 mt-2 flex flex-wrap items-center gap-1.5">
                <span class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mr-1">Design QA</span>
                <span v-for="q in qa" :key="q.label" :title="q.tip" class="inline-flex items-center gap-1 rounded-full border px-2 h-6 text-[11px] font-medium tabular-nums" :class="q.ok ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'">
                  <CheckCircle2 v-if="q.ok" class="size-3" /><AlertTriangle v-else class="size-3" /> {{ q.label }}
                </span>
                <span v-if="current.campaign" class="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/5 px-2 h-6 text-[11px] font-medium text-amber-700 dark:text-amber-300"><Flame class="size-3" /> Campaign</span>
              </div>
            </div>

            <!-- Save -->
            <footer v-if="current && !streaming" class="shrink-0 border-t bg-card px-3 py-2.5 flex flex-wrap items-end gap-2">
              <div v-if="current.unknown.length" class="w-full text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1.5"><AlertTriangle class="size-3.5" /> Unknown fields will be blank: {{ tags(current.unknown) }} — ask Studio to remove them.</div>
              <div class="inline-flex rounded-lg border bg-muted/40 p-0.5 self-center">
                <button type="button" class="rounded-md px-2.5 py-1 text-xs font-medium" :class="saveMode === 'new' ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="saveMode = 'new'">New template</button>
                <button type="button" class="rounded-md px-2.5 py-1 text-xs font-medium" :class="saveMode === 'version' ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="saveMode = 'version'">New version of…</button>
              </div>
              <template v-if="saveMode === 'new'">
                <div class="space-y-1 w-48"><Label class="text-[10px] text-muted-foreground">Name</Label><Input v-model="saveName" class="h-8 text-xs" placeholder="Template name" /></div>
                <div class="space-y-1 w-36"><Label class="text-[10px] text-muted-foreground">Category</Label><Select v-model="saveCategory"><SelectTrigger class="w-full h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="c in EMAIL_TEMPLATE_CATEGORIES" :key="c" :value="c">{{ c }}</SelectItem></SelectContent></Select></div>
              </template>
              <template v-else>
                <div class="space-y-1 w-56"><Label class="text-[10px] text-muted-foreground">Template</Label><Select v-model="targetId"><SelectTrigger class="w-full h-8 text-xs"><SelectValue placeholder="Pick a template" /></SelectTrigger><SelectContent><SelectItem v-for="t in libraryTemplates" :key="t.id" :value="t.id">{{ t.name }}</SelectItem></SelectContent></Select></div>
                <label class="flex items-center gap-1.5 text-[11px] text-muted-foreground h-8 cursor-pointer"><Switch v-model="replaceCurrent" /> Replace current</label>
              </template>
              <div class="space-y-1 flex-1 min-w-56"><Label class="text-[10px] text-muted-foreground">Subject line <span class="tabular-nums" :class="saveSubject.length > 60 ? 'text-amber-600' : ''">· {{ saveSubject.length }}</span></Label><Input v-model="saveSubject" class="h-8 text-xs" /></div>
              <Button class="h-8 gap-1.5" :disabled="saving || (saveMode === 'version' && !targetId)" @click="save"><Loader2 v-if="saving" class="size-4 animate-spin" /><Save v-else class="size-4" /> Save to library</Button>
            </footer>
          </section>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
