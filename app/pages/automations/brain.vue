<script setup lang="ts">
import { ago } from '~/composables/useAutomations'
import { Brain, Sparkles, Loader2, Pin, PinOff, Trash2, Power, PowerOff, GraduationCap, Lightbulb, History, Activity, Eye, Plus, CheckCircle2, AlertTriangle, PenLine, ThumbsUp, ThumbsDown, MessageSquareReply, Palette, Cpu } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * ZRZ Brain — what the AI has been taught and has learned. Every approval, edit, skip, reply
 * correction, Template Studio request and result feeds it; it reflects daily (automation 16) and
 * every AI call reads the playbook for its area.
 */
const { setHeader } = usePageHeader()
setHeader({ title: 'Brain', description: 'Automations · what the AI has learned from your team and your results', icon: 'i-lucide-brain' })

const { loadBrain, teachLesson, updateLesson, reflectBrain, brainContext } = useAutomations()
const data = ref<any>(null)
const loading = ref(true)
const reflecting = ref(false)
async function load() {
  try { data.value = await loadBrain() } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not load the brain') } finally { loading.value = false }
}
onMounted(load)

async function learnNow() {
  reflecting.value = true
  try { const r = await reflectBrain(); toast.success(`Playbook v${r.version}`, { description: r.summary }); await load() }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not learn right now') }
  finally { reflecting.value = false }
}

// Teach
const AREA_ICON: Record<string, any> = { writing: PenLine, design: Palette, replies: MessageSquareReply, research: Lightbulb, strategy: Activity }
const teach = ref({ text: '', area: 'writing', pinned: false })
const teaching = ref(false)
const EXAMPLES = [
  { area: 'writing', text: 'Never mention pricing in a first email.' },
  { area: 'writing', text: 'Always offer to send the full list of vehicles without real photos.' },
  { area: 'writing', text: 'Dealer principals prefer emails under 90 words.' },
  { area: 'replies', text: '“Send me more info” means interested, not a question.' },
  { area: 'design', text: 'Use our green (#16a34a) for every button.' },
]
async function addLesson() {
  if (!teach.value.text.trim()) return
  teaching.value = true
  try { await teachLesson({ ...teach.value, text: teach.value.text.trim() }); teach.value.text = ''; toast.success('The brain will follow this from now on'); await load() }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save') } finally { teaching.value = false }
}
async function patchLesson(l: any, body: Record<string, any>, ok?: string) {
  try { await updateLesson(l.id, body); if (ok) toast.success(ok); await load() } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not update') }
}
const editing = ref<string | null>(null)
const editText = ref('')
function startEdit(l: any) { editing.value = l.id; editText.value = l.text }
async function saveEdit(l: any) { if (editText.value.trim() && editText.value !== l.text) await patchLesson(l, { text: editText.value.trim() }, 'Lesson updated — it is now a team rule'); editing.value = null }

// Lessons by area
const area = ref<string>('all')
const lessons = computed(() => (data.value?.lessons || []).filter((l: any) => l.status !== 'retired' && (area.value === 'all' || l.area === area.value)))
const countFor = (a: string) => (data.value?.lessons || []).filter((l: any) => l.status === 'active' && (a === 'all' || l.area === a)).length
const areaLabel = (k: string) => data.value?.areas?.find((a: any) => a.key === k)?.label || k

// What the AI is told
const ctxArea = ref('writing')
const ctxText = ref<string | null>(null)
const ctxOpen = ref(false)
async function showContext(a: string) {
  ctxArea.value = a; ctxOpen.value = true; ctxText.value = null
  try { ctxText.value = (await brainContext(a)).text || '' } catch { ctxText.value = '' }
}

const totals = computed(() => {
  const c = data.value?.signalCounts || {}
  const n = Object.values<any>(c).reduce((a, x) => a + x.n, 0)
  const pending = Object.values<any>(c).reduce((a, x) => a + x.pending, 0)
  return { n, pending }
})
const usage = computed(() => {
  const u = data.value?.usage || []
  const calls = u.reduce((a: number, x: any) => a + x.calls, 0)
  const input = u.reduce((a: number, x: any) => a + x.inputTokens + x.cacheReadTokens, 0)
  const cached = u.reduce((a: number, x: any) => a + x.cacheReadTokens, 0)
  return { calls, cachePct: input ? Math.round((cached / input) * 100) : 0, tokens: u.reduce((a: number, x: any) => a + x.inputTokens + x.outputTokens + x.cacheReadTokens, 0) }
})
const SIGNAL_ICON: Record<string, any> = { 'draft.approved': ThumbsUp, 'draft.edited': PenLine, 'draft.rejected': ThumbsDown, 'reply.confirmed': CheckCircle2, 'reply.corrected': AlertTriangle, 'design.instruction': Palette, 'design.saved': Sparkles, 'lesson.taught': GraduationCap, 'lesson.removed': Trash2 }
const PURPOSE: Record<string, string> = { 'draft.first_touch': 'First-email drafts', 'draft.follow_up': 'Follow-up drafts', 'reply.classify': 'Reading replies', 'research.angle': 'Research summaries', 'insights.summary': 'Strategy insights', 'brain.reflect': 'Brain reflection', 'studio.create': 'Template Studio — new', 'studio.refine': 'Template Studio — changes' }
const fmtTokens = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)
</script>

<template>
  <div class="space-y-5">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <Button size="sm" class="h-8 gap-1.5 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white" :disabled="reflecting" @click="learnNow"><Loader2 v-if="reflecting" class="size-4 animate-spin" /><Brain v-else class="size-4" /> Learn now</Button>
      </Teleport>
    </ClientOnly>

    <div v-if="loading" class="flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Loading…</div>
    <template v-else-if="data">
      <!-- Hero -->
      <section class="relative overflow-hidden rounded-2xl border bg-[#0e1714] text-white p-5 md:p-6">
        <div class="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-emerald-500/20 blur-3xl" />
        <div class="relative flex flex-wrap items-start gap-5">
          <div class="size-12 rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-400/30 flex items-center justify-center"><Brain class="size-6 text-emerald-300" /></div>
          <div class="min-w-0 flex-1">
            <p class="text-[11px] font-semibold tracking-[0.2em] text-emerald-300">ZRZ BRAIN · PLAYBOOK v{{ data.state.playbookVersion }}</p>
            <h2 class="mt-1 text-xl md:text-2xl font-bold tracking-tight">Every approval, edit and result makes the next email smarter.</h2>
            <p class="mt-2 text-sm text-white/70 max-w-3xl">{{ data.state.lastSummary || 'Nothing learned yet — approve, edit or skip drafts, confirm replies and use Template Studio. The brain reflects every day (or press Learn now).' }}</p>
          </div>
        </div>
        <div class="relative mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div class="rounded-xl bg-white/5 ring-1 ring-white/10 p-3"><p class="text-[10px] uppercase tracking-wider text-white/50 flex items-center gap-1"><Cpu class="size-3" /> Model</p><p class="mt-1 text-sm font-semibold truncate">{{ data.ai.model }}</p><p class="text-[11px]" :class="data.ai.configured ? 'text-emerald-300' : 'text-amber-300'">{{ data.ai.configured ? `${data.ai.provider === 'gemini' ? 'Google Gemini' : 'Anthropic Claude'} · connected` : 'No API key — rules only' }}</p></div>
          <div class="rounded-xl bg-white/5 ring-1 ring-white/10 p-3"><p class="text-[10px] uppercase tracking-wider text-white/50">Active lessons</p><p class="mt-1 text-2xl font-bold tabular-nums">{{ countFor('all') }}</p><p class="text-[11px] text-white/50">{{ (data.lessons || []).filter((l: any) => l.source === 'taught' && l.status === 'active').length }} from your team</p></div>
          <div class="rounded-xl bg-white/5 ring-1 ring-white/10 p-3"><p class="text-[10px] uppercase tracking-wider text-white/50">Signals learned from</p><p class="mt-1 text-2xl font-bold tabular-nums">{{ totals.n }}</p><p class="text-[11px] text-white/50">{{ totals.pending }} new since last reflection · {{ ago(data.state.lastReflectAt) }}</p></div>
          <div class="rounded-xl bg-white/5 ring-1 ring-white/10 p-3"><p class="text-[10px] uppercase tracking-wider text-white/50">AI calls · 30 days</p><p class="mt-1 text-2xl font-bold tabular-nums">{{ usage.calls }}</p><p class="text-[11px] text-white/50">{{ fmtTokens(usage.tokens) }} tokens · {{ usage.cachePct }}% from cache</p></div>
        </div>
      </section>

      <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-5">
        <div class="space-y-5 min-w-0">
          <!-- Teach -->
          <section class="rounded-xl border bg-card">
            <header class="px-5 py-3.5 border-b"><h3 class="font-semibold text-sm flex items-center gap-2"><GraduationCap class="size-4 text-emerald-600" /> Teach the brain</h3><p class="text-[11px] text-muted-foreground">Team rules are always followed and never changed by the AI.</p></header>
            <form class="p-5 space-y-3" @submit.prevent="addLesson">
              <div class="flex flex-wrap gap-2">
                <Select v-model="teach.area"><SelectTrigger class="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="a in data.areas" :key="a.key" :value="a.key">{{ a.label }}</SelectItem></SelectContent></Select>
                <Input v-model="teach.text" class="h-9 flex-1 min-w-64" placeholder="e.g. Never mention pricing in a first email." />
                <label class="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer" title="Pinned rules apply to every area"><Switch v-model="teach.pinned" /> Everywhere</label>
                <Button type="submit" class="h-9 gap-1.5" :disabled="teaching || !teach.text.trim()"><Loader2 v-if="teaching" class="size-4 animate-spin" /><Plus v-else class="size-4" /> Add rule</Button>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <button v-for="e in EXAMPLES" :key="e.text" type="button" class="rounded-full border px-2.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/40" @click="teach.area = e.area; teach.text = e.text">{{ e.text }}</button>
              </div>
            </form>
          </section>

          <!-- Lessons -->
          <section class="rounded-xl border bg-card">
            <header class="px-5 py-3 border-b flex flex-wrap items-center gap-2">
              <h3 class="font-semibold text-sm mr-2">Playbook</h3>
              <div role="tablist" class="inline-flex flex-wrap rounded-lg border bg-muted/40 p-0.5">
                <button type="button" role="tab" :aria-selected="area === 'all'" class="rounded-md px-2.5 py-1 text-xs font-medium" :class="area === 'all' ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="area = 'all'">All <span class="tabular-nums text-muted-foreground">{{ countFor('all') }}</span></button>
                <button v-for="a in data.areas" :key="a.key" type="button" role="tab" :aria-selected="area === a.key" class="rounded-md px-2.5 py-1 text-xs font-medium inline-flex items-center gap-1" :class="area === a.key ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="area = a.key"><component :is="AREA_ICON[a.key]" class="size-3" />{{ a.label }} <span class="tabular-nums text-muted-foreground">{{ countFor(a.key) }}</span></button>
              </div>
              <Button v-if="area !== 'all'" variant="ghost" size="sm" class="h-7 ml-auto gap-1 text-xs" @click="showContext(area)"><Eye class="size-3.5" /> What the AI is told</Button>
            </header>
            <div v-if="!lessons.length" class="px-6 py-14 text-center">
              <Lightbulb class="size-7 text-muted-foreground mx-auto" />
              <p class="mt-2 text-sm font-medium">No lessons here yet</p>
              <p class="text-xs text-muted-foreground max-w-md mx-auto">Add a rule above, or keep working — every edit, skip and correction is studied in the next reflection.</p>
            </div>
            <ul v-else class="divide-y">
              <li v-for="l in lessons" :key="l.id" class="px-5 py-3 flex gap-3 group" :class="l.status === 'disabled' && 'opacity-50'">
                <span class="mt-0.5 size-7 shrink-0 rounded-lg flex items-center justify-center" :class="l.source === 'taught' ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : 'bg-violet-500/12 text-violet-700 dark:text-violet-300'"><component :is="l.source === 'taught' ? GraduationCap : Sparkles" class="size-3.5" /></span>
                <div class="min-w-0 flex-1">
                  <form v-if="editing === l.id" class="flex gap-2" @submit.prevent="saveEdit(l)"><Input v-model="editText" class="h-8 text-sm" autofocus @keydown.esc="editing = null" /><Button size="sm" type="submit" class="h-8">Save</Button></form>
                  <button v-else type="button" class="text-left text-sm leading-snug hover:underline decoration-dotted underline-offset-4" title="Click to edit" @click="startEdit(l)">{{ l.text }}</button>
                  <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span class="rounded px-1.5 py-px font-medium" :class="l.source === 'taught' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-violet-500/10 text-violet-700 dark:text-violet-300'">{{ l.source === 'taught' ? 'Team rule' : 'Learned' }}</span>
                    <span class="inline-flex items-center gap-1"><component :is="AREA_ICON[l.area]" class="size-3" />{{ areaLabel(l.area) }}</span>
                    <span v-if="l.pinned" class="inline-flex items-center gap-1"><Pin class="size-3" /> everywhere</span>
                    <span v-if="l.source === 'learned' && l.confidence != null" class="inline-flex items-center gap-1">confidence <span class="inline-block h-1.5 w-12 rounded-full bg-muted overflow-hidden"><span class="block h-full bg-violet-500" :style="{ width: `${Math.round(l.confidence * 100)}%` }" /></span></span>
                    <span v-if="l.evidence" class="truncate max-w-md">· {{ l.evidence }}</span>
                    <span>· {{ ago(l.updatedAt) }}</span>
                  </div>
                </div>
                <div class="flex items-start gap-0.5 opacity-60 group-hover:opacity-100">
                  <Button variant="ghost" size="icon" class="size-7" :title="l.pinned ? 'Only this area' : 'Apply everywhere'" @click="patchLesson(l, { pinned: !l.pinned })"><component :is="l.pinned ? PinOff : Pin" class="size-3.5" /></Button>
                  <Button variant="ghost" size="icon" class="size-7" :title="l.status === 'active' ? 'Turn off (the AI will not re-learn it)' : 'Turn on'" @click="patchLesson(l, { status: l.status === 'active' ? 'disabled' : 'active' })"><component :is="l.status === 'active' ? PowerOff : Power" class="size-3.5" /></Button>
                  <Button variant="ghost" size="icon" class="size-7 text-rose-600" title="Delete" @click="patchLesson(l, { status: 'deleted' }, 'Lesson deleted')"><Trash2 class="size-3.5" /></Button>
                </div>
              </li>
            </ul>
          </section>

          <!-- Usage -->
          <section v-if="data.usage.length" class="rounded-xl border bg-card overflow-hidden">
            <header class="px-5 py-3 border-b"><h3 class="font-semibold text-sm flex items-center gap-2"><Cpu class="size-4 text-muted-foreground" /> AI work · last 30 days</h3></header>
            <table class="w-full text-sm">
              <thead class="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th class="text-left font-medium px-5 py-2">What for</th><th class="text-right font-medium px-3 py-2">Calls</th><th class="text-right font-medium px-3 py-2">Tokens in / out</th><th class="text-right font-medium px-3 py-2">From cache</th><th class="text-right font-medium px-5 py-2">Avg time</th></tr></thead>
              <tbody class="divide-y">
                <tr v-for="u in data.usage" :key="u.purpose"><td class="px-5 py-2">{{ PURPOSE[u.purpose] || u.purpose }}<span v-if="u.failed" class="ml-1 text-[10px] text-rose-600">{{ u.failed }} failed</span></td><td class="px-3 py-2 text-right tabular-nums">{{ u.calls }}</td><td class="px-3 py-2 text-right tabular-nums text-xs">{{ fmtTokens(u.inputTokens) }} / {{ fmtTokens(u.outputTokens) }}</td><td class="px-3 py-2 text-right tabular-nums text-xs">{{ fmtTokens(u.cacheReadTokens) }}</td><td class="px-5 py-2 text-right tabular-nums text-xs">{{ (u.avgMs / 1000).toFixed(1) }}s</td></tr>
              </tbody>
            </table>
          </section>
        </div>

        <!-- Right column -->
        <div class="space-y-5">
          <section class="rounded-xl border bg-card">
            <header class="px-5 py-3 border-b"><h3 class="font-semibold text-sm flex items-center gap-2"><Activity class="size-4 text-muted-foreground" /> Learning feed</h3><p class="text-[11px] text-muted-foreground">Recorded automatically as you work.</p></header>
            <p v-if="!data.signals.length" class="px-5 py-8 text-xs text-muted-foreground text-center">Nothing yet. Approve, edit or skip a draft, confirm a reply, or design a template.</p>
            <ul v-else class="divide-y max-h-[520px] overflow-y-auto">
              <li v-for="sg in data.signals" :key="sg.id" class="px-5 py-2.5 flex gap-2.5 text-xs">
                <component :is="SIGNAL_ICON[sg.kind] || Activity" class="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <div class="min-w-0"><p class="line-clamp-3 whitespace-pre-line">{{ sg.line.replace(/^\[\w+\]\s*/, '') }}</p><p class="text-[10px] text-muted-foreground">{{ sg.actor?.name || 'System' }} · {{ ago(sg.at) }}<span v-if="!sg.reflected" class="ml-1 text-emerald-600 font-medium">· new</span></p></div>
              </li>
            </ul>
          </section>
          <section class="rounded-xl border bg-card">
            <header class="px-5 py-3 border-b"><h3 class="font-semibold text-sm flex items-center gap-2"><History class="size-4 text-muted-foreground" /> Reflections</h3></header>
            <p v-if="!data.playbooks.length" class="px-5 py-8 text-xs text-muted-foreground text-center">The first reflection runs tonight — or press Learn now.</p>
            <ol v-else class="divide-y">
              <li v-for="p in data.playbooks" :key="p.version" class="px-5 py-3 text-xs">
                <p class="font-medium">Playbook v{{ p.version }} <span class="text-muted-foreground font-normal">· {{ ago(p.at) }} · {{ p.model ? 'AI' : 'rules' }}</span></p>
                <p class="mt-0.5 text-muted-foreground">{{ p.summary }}</p>
                <p class="mt-1 text-[10px] text-muted-foreground tabular-nums">{{ p.signals }} signals · +{{ p.added }} · ~{{ p.updated }} · −{{ p.retired }}</p>
              </li>
            </ol>
          </section>
        </div>
      </div>
    </template>

    <Dialog v-model:open="ctxOpen">
      <DialogContent class="sm:max-w-2xl">
        <DialogHeader><DialogTitle>What the AI is told — {{ areaLabel(ctxArea) }}</DialogTitle><DialogDescription class="text-xs">Added to every AI call in this area (prompt-cached, so it costs very little).</DialogDescription></DialogHeader>
        <div v-if="ctxText === null" class="py-10 flex justify-center"><Loader2 class="size-5 animate-spin text-muted-foreground" /></div>
        <pre v-else class="max-h-[60vh] overflow-auto rounded-lg bg-muted/50 p-4 text-xs whitespace-pre-wrap">{{ ctxText || 'Nothing yet for this area.' }}</pre>
      </DialogContent>
    </Dialog>
  </div>
</template>
