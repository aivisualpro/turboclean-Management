<script setup lang="ts">
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { EmailTemplate } from '~/composables/useCrmEmail'
import { EMAIL_TEMPLATE_CATEGORIES } from '~/constants/crm'
import { Sparkles, X, Wand2, Loader2, Square, Send, Eye, Code2, Undo2, Save, AlertTriangle, Brain, Check, RotateCcw } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * Template Studio — describe an email, the AI designs it in the ZRZ OPS house style (streams live
 * into the preview), then refine it in plain words ("shorter", "add the evidence list") until it is
 * right, and save it as a new template or as a new A/B version of an existing one.
 * Every brief and change request also teaches the brain ('design' area).
 */
const props = defineProps<{ template?: EmailTemplate | null, startHtml?: string, startSubject?: string, startName?: string }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [t: EmailTemplate] }>()

const { templates, saveTemplate, config } = useCrmEmail()
interface Draft { name: string, category: string, subject: string, notes: string, html: string, at: number, unknown: string[] }
const drafts = ref<Draft[]>([])
const at = ref(-1)
const current = computed(() => at.value >= 0 ? drafts.value[at.value] || null : null)
const turns = ref<{ who: 'you' | 'ai', text: string, draft?: number }[]>([])

const brief = ref('')
const goal = ref<string>('Follow-up')
const length = ref<'short' | 'standard' | 'rich'>('standard')
const style = ref<'house' | 'fresh'>('house')
const instruction = ref('')
const streaming = ref(false)
/** Provider notes while waiting ("gemini-… answered 503 — retrying in 4s"). */
const aiNote = ref('')
const liveText = ref('')
const view = ref<'preview' | 'html'>('preview')
const device = ref<'desktop' | 'mobile'>('desktop')
let ctrl: AbortController | null = null

const STARTERS = [
  { label: 'Follow-up to the inventory report', goal: 'Follow-up', brief: 'A short, friendly follow-up to our inventory photo report. Remind them of the headline number, offer to send the full list of listings without real photos, and ask for a 10-minute call. Include the spot-check evidence list.' },
  { label: 'Recon introduction', goal: 'First touch', brief: 'Introduce ZRZ OPS to a General Manager who has never heard of us: reconditioning, real photos online fast, and listing monitoring. Lead with their own inventory numbers, keep it confident and short, one clear ask for a 10-minute review.' },
  { label: 'Meeting recap & next steps', goal: 'Meeting', brief: 'Recap after a 10-minute review call: what we found on their site, what we proposed (recon, photos, monitoring), the agreed next step and timeline, and a clear button to confirm the start date.' },
  { label: 'Monthly photo report (client)', goal: 'Other', brief: 'Monthly report for an existing client dealership: how many vehicles we photographed, current share of listings with real photos, remaining gaps with the evidence list, and what we will focus on next month. Warm, partner tone.' },
  { label: 'Re-engage a quiet dealership', goal: 'Re-engage', brief: 'Re-engage a dealership that went quiet 60 days ago: new numbers from a fresh review of their site, no guilt-tripping, one easy yes/no question.' },
  { label: 'Proposal summary', goal: 'Proposal', brief: 'Proposal summary email: what is included (recon, merchandising photos, listing monitoring), how onboarding works in the first two weeks, a short FAQ, and a button to approve and schedule kickoff. No prices — say pricing is in the attached proposal.' },
]
const QUICK = ['Make it shorter', 'More personal, less salesy', 'Stronger call to action', 'Add the evidence list of listings', 'Remove the numbers section', 'Make the hero headline punchier', 'Better on mobile']

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
const progressLabel = computed(() => {
  const n = liveText.value.length
  if (!n) return 'Thinking about the layout…'
  if (!liveText.value.includes('---HTML---')) return 'Planning the message…'
  if (n < 6000) return 'Building the hero and structure…'
  if (n < 14000) return 'Designing the sections…'
  return 'Polishing details for Outlook and mobile…'
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
  drafts.value = []; at.value = -1; turns.value = []; liveText.value = ''; liveHtml.value = ''; instruction.value = ''
  brief.value = ''; view.value = 'preview'
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

async function run(body: Record<string, any>, userText: string) {
  if (streaming.value) return
  turns.value.push({ who: 'you', text: userText })
  streaming.value = true
  aiNote.value = ''
  liveText.value = ''
  liveHtml.value = ''
  ctrl = new AbortController()
  try {
    const res = await fetch('/api/crm/email/templates/studio', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body), signal: ctrl.signal, credentials: 'same-origin' })
    if (!res.ok || !res.body) { const e = await res.json().catch(() => null); throw new Error(e?.message || e?.statusMessage || `Template Studio is unavailable (${res.status})`) }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let done: any = null
    let failure: string | null = null
    while (true) {
      const r = await reader.read()
      if (r.done) break
      buf += dec.decode(r.value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2)
        let ev = 'message', data = ''
        for (const line of block.split('\n')) { if (line.startsWith('event:')) ev = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim() }
        if (!data) continue
        let d: any; try { d = JSON.parse(data) } catch { continue }
        if (ev === 'delta') liveText.value += d.text
        else if (ev === 'done') done = d
        else if (ev === 'failure') failure = d.message
        else if (ev === 'note') aiNote.value = d.text
      }
    }
    if (failure) throw new Error(failure)
    if (!done) throw new Error('The connection dropped before the design finished — try again')
    drafts.value = [...drafts.value.slice(0, at.value + 1), { name: done.name, category: done.category, subject: done.subject, notes: done.notes, html: done.html, at: Date.now(), unknown: done.unknownFields || [] }]
    at.value = drafts.value.length - 1
    turns.value.push({ who: 'ai', text: done.notes || 'Here it is.', draft: at.value })
    view.value = 'preview'
  }
  catch (e: any) {
    if (e?.name === 'AbortError' || /Stopped/.test(e?.message)) turns.value.push({ who: 'ai', text: 'Stopped.' })
    else { turns.value.push({ who: 'ai', text: `Something went wrong: ${e?.message || 'unknown error'}` }); toast.error(e?.message || 'Template Studio failed') }
  }
  finally { streaming.value = false; ctrl = null; liveText.value = '' }
}
function design() {
  const b = brief.value.trim()
  if (!b) return toast.error('Describe the email first — or pick a starter')
  run({ brief: b, goal: goal.value, length: length.value, style: style.value }, b)
}
function refine(text?: string) {
  const t = (text ?? instruction.value).trim()
  if (!t || !current.value) return
  instruction.value = ''
  run({ html: current.value.html, instruction: t, name: current.value.name, subject: current.value.subject }, t)
}
function stop() { ctrl?.abort() }
function pickStarter(s: typeof STARTERS[number]) { brief.value = s.brief; goal.value = s.goal }
function goTo(i: number) { if (!streaming.value && drafts.value[i]) at.value = i }

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
          <span class="size-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 text-white flex items-center justify-center shadow-sm"><Sparkles class="size-4" /></span>
          <div class="min-w-0 leading-tight">
            <DialogTitle class="text-sm font-semibold">Template Studio</DialogTitle>
            <DialogDescription class="text-[11px] text-muted-foreground truncate">{{ template ? `Designing a new version of “${template.name}”` : 'Describe an email — AI designs it in your house style' }}</DialogDescription>
          </div>
          <span class="hidden md:inline-flex items-center gap-1.5 ml-3 rounded-full border bg-muted/40 px-2 h-6 text-[11px] text-muted-foreground"><Brain class="size-3.5 text-emerald-600" /> Uses your playbook · {{ config?.aiLabel || config?.aiModel || 'AI' }}</span>
          <Button variant="ghost" size="icon" class="size-8 ml-auto" aria-label="Close" @click="close"><X class="size-4" /></Button>
        </header>

        <div class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[400px_1fr]">
          <!-- Left: conversation -->
          <aside class="min-h-0 flex flex-col border-r bg-muted/20">
            <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              <div v-if="!aiReady" class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200 flex gap-2"><AlertTriangle class="size-4 shrink-0" /> AI is not connected on this server. Add <code>GOOGLE_GEMINI_API_KEY</code> (or <code>ANTHROPIC_API_KEY</code>) to use Template Studio.</div>

              <!-- Brief -->
              <template v-if="!drafts.length && !streaming">
                <div class="space-y-1.5">
                  <p class="text-sm font-semibold">What should this email do?</p>
                  <p class="text-xs text-muted-foreground">Who it’s for, the goal, what to include. Your data fields (dealership, audit numbers, evidence list, signature) are wired in automatically.</p>
                </div>
                <Textarea v-model="brief" rows="6" class="text-sm leading-relaxed bg-background" placeholder="e.g. A short follow-up to the inventory report for a used-car manager. Remind them of the number, offer the full list, ask for 10 minutes this week." @keydown.meta.enter.prevent="design" @keydown.ctrl.enter.prevent="design" />
                <div class="flex flex-wrap gap-1.5">
                  <button v-for="s in STARTERS" :key="s.label" type="button" class="rounded-full border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-primary/40" @click="pickStarter(s)">{{ s.label }}</button>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <div class="space-y-1"><Label class="text-[11px] text-muted-foreground">Type</Label>
                    <Select v-model="goal"><SelectTrigger class="w-full h-8 text-xs bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="c in EMAIL_TEMPLATE_CATEGORIES" :key="c" :value="c">{{ c }}</SelectItem></SelectContent></Select>
                  </div>
                  <div class="space-y-1"><Label class="text-[11px] text-muted-foreground">Length</Label>
                    <div class="inline-flex w-full rounded-lg border bg-muted/40 p-0.5">
                      <button v-for="l in (['short', 'standard', 'rich'] as const)" :key="l" type="button" class="flex-1 rounded-md py-1 text-[11px] font-medium capitalize" :class="length === l ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="length = l">{{ l }}</button>
                    </div>
                  </div>
                </div>
                <div class="inline-flex w-full rounded-lg border bg-muted/40 p-0.5">
                  <button type="button" class="flex-1 rounded-md py-1.5 text-xs font-medium" :class="style === 'house' ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="style = 'house'">House style (like Missing Photos)</button>
                  <button type="button" class="flex-1 rounded-md py-1.5 text-xs font-medium" :class="style === 'fresh' ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="style = 'fresh'">Fresh layout</button>
                </div>
                <Button class="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" :disabled="!aiReady || !brief.trim()" @click="design"><Wand2 class="size-4" /> Design it</Button>
                <p class="text-[11px] text-muted-foreground text-center">Takes about a minute — you’ll watch it being built.</p>
              </template>

              <!-- Conversation -->
              <ol v-else class="space-y-3">
                <li v-for="(t, i) in turns" :key="i" class="flex" :class="t.who === 'you' ? 'justify-end' : ''">
                  <div class="max-w-[90%] rounded-2xl px-3 py-2 text-xs leading-relaxed" :class="t.who === 'you' ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-background border rounded-bl-sm'">
                    <p class="whitespace-pre-wrap">{{ t.text }}</p>
                    <button v-if="t.draft !== undefined" type="button" class="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold" :class="at === t.draft ? 'text-emerald-600' : 'text-muted-foreground hover:text-foreground'" @click="goTo(t.draft!)"><Check v-if="at === t.draft" class="size-3" /><Eye v-else class="size-3" /> Draft {{ (t.draft ?? 0) + 1 }}{{ at === t.draft ? ' · showing' : '' }}</button>
                  </div>
                </li>
                <li v-if="streaming" class="flex">
                  <div class="rounded-2xl rounded-bl-sm bg-background border px-3 py-2.5 text-xs flex items-center gap-2"><Loader2 class="size-3.5 animate-spin text-emerald-600" /> {{ progressLabel }}<span v-if="aiNote && !liveText" class="text-amber-600 dark:text-amber-400">· {{ aiNote }}</span></div>
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
                <button v-if="!template && !startHtml" type="button" class="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-40 ml-auto" :disabled="streaming" @click="reset"><RotateCcw class="size-3" /> Start over</button>
              </div>
            </div>
          </aside>

          <!-- Right: preview / code + save -->
          <section class="min-h-0 flex flex-col">
            <div class="flex-1 min-h-0 p-3 flex flex-col">
              <div v-if="!drafts.length && !streaming" class="flex-1 rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-center p-8 bg-[radial-gradient(ellipse_at_top,theme(colors.emerald.500/0.08),transparent_60%)]">
                <span class="size-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30"><Sparkles class="size-6" /></span>
                <p class="mt-4 text-base font-semibold">Your email appears here as it’s being designed</p>
                <p class="mt-1 text-sm text-muted-foreground max-w-md">Table-based, Outlook-safe, mobile-ready HTML in the ZRZ OPS style, filled with real data from your CRM. Preview it on desktop and phone, with sample data or any dealership.</p>
              </div>
              <CrmEmailPreview v-else-if="view === 'preview'" v-model:device="device" class="flex-1" :html="rendered.html" :subject="rendered.subject" :preheader="rendered.preheader" :from="pv.ctx.value?.from" :to="pv.ctx.value?.to" :loading="pv.loading.value || streaming">
                <template #toolbar>
                  <div role="tablist" class="inline-flex rounded-lg border bg-muted/40 p-0.5">
                    <button type="button" role="tab" :aria-selected="true" class="rounded-md px-2.5 py-1 text-xs font-medium bg-background shadow-sm inline-flex items-center gap-1.5"><Eye class="size-3.5" /> Preview</button>
                    <button type="button" role="tab" :aria-selected="false" class="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 disabled:opacity-40" :disabled="streaming || !current" @click="view = 'html'"><Code2 class="size-3.5" /> HTML</button>
                  </div>
                  <div class="w-56"><CrmDealershipPicker v-model="pv.dealershipId.value" placeholder="Preview with a dealership…" /></div>
                  <CrmEmailInboxCheck v-if="!streaming && current" :rendered="rendered" :source="{ html: current.html, format: 'html' }" />
                  <span v-if="streaming" class="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 h-6 text-[11px] font-semibold"><span class="relative flex size-2"><span class="absolute inline-flex size-full rounded-full bg-emerald-500 opacity-60 animate-ping" /><span class="relative inline-flex size-2 rounded-full bg-emerald-500" /></span> Designing live</span>
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
              <div class="space-y-1 flex-1 min-w-56"><Label class="text-[10px] text-muted-foreground">Subject line</Label><Input v-model="saveSubject" class="h-8 text-xs" /></div>
              <Button class="h-8 gap-1.5" :disabled="saving || (saveMode === 'version' && !targetId)" @click="save"><Loader2 v-if="saving" class="size-4 animate-spin" /><Save v-else class="size-4" /> Save to library</Button>
            </footer>
          </section>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
