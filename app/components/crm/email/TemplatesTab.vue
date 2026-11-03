<script setup lang="ts">
import type { EmailTemplate, EmailTemplateVersion, ExperimentRow } from '~/composables/useCrmEmail'
import { Plus, Loader2, Archive, ArchiveRestore, FileText, Code2, Type, Eye, FlaskConical, Pause, Play, Copy, Braces, ChevronRight, Sparkles, Wand2, Store } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format } from 'date-fns'
import { EMAIL_HTML_ONLY_FIELDS, EMAIL_MERGE_FIELDS, EMAIL_TEMPLATE_CATEGORIES } from '~/constants/crm'

/**
 * Template library built for experiments.
 * A template = one message idea. Body versions (V1, V2…) and subject lines (S1, S2…) are tracked
 * separately; several can run at once and the composer rotates between them.
 */
const { templates, loadLibrary, saveTemplate, getExperiments } = useCrmEmail()
const showArchived = ref(false)
const versionStats = ref<ExperimentRow[]>([])
const subjectStats = ref<ExperimentRow[]>([])
const templateStats = ref<ExperimentRow[]>([])
async function loadStats() {
  try {
    const [t, v, s] = await Promise.all([getExperiments({ level: 'template' }), getExperiments({ level: 'version' }), getExperiments({ level: 'subject' })])
    templateStats.value = t.rows; versionStats.value = v.rows; subjectStats.value = s.rows
  } catch {}
}
onMounted(async () => { await loadLibrary(true).catch(() => toast.error('Could not load templates')); loadStats() })
const list = computed(() => templates.value.filter(t => showArchived.value || !t.archivedAt).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)))
const tStat = (id: string) => templateStats.value.find(r => r.templateId === id)
const vStat = (id: string, v: number) => versionStats.value.find(r => r.templateId === id && r.version === v)
const sStat = (id: string, k: string) => subjectStats.value.find(r => r.templateId === id && r.subjectVariant === k)
const fmtRate = (v: number | null | undefined) => v == null ? '—' : `${v}%`

// ─── Previews (rendered exactly like a real send; sample data or a real dealership) ───
const pv = useTemplatePreview()
const tags = (keys: string[]) => keys.map(k => `{` + `{${k}}` + `}`).join(', ')
const activeVersion = (t: EmailTemplate) => t.versions.find(v => v.version === t.currentVersion) || t.versions.find(v => v.status === 'active') || t.versions[t.versions.length - 1] || null
const activeSubject = (t: EmailTemplate) => t.subjects.find(s => s.status === 'active')?.text || t.subjects[0]?.text || ''
const thumbHtml = (t: EmailTemplate) => { const v = activeVersion(t); return v ? pv.render(v, activeSubject(t)).html : '' }

// ─── Template Studio (AI) ───
const showStudio = ref(false)
const studioFor = ref<EmailTemplate | null>(null)
const studioHtml = ref('')
function openStudio(t: EmailTemplate | null = null, v: EmailTemplateVersion | null = null) {
  studioFor.value = t
  studioHtml.value = v?.format === 'html' ? (v.html || '') : ''
  showStudio.value = true
}
function studioSaved(t: EmailTemplate) { loadStats(); openDetail(t) }

// ─── New template ───
const showNew = ref(false)
const newForm = ref({ name: '', category: 'First touch', description: '', subject: '', format: 'text' as 'text' | 'html', body: '', html: '', label: 'V1' })
const saving = ref(false)
const bodyEl = ref<any>(null)
function openNew() {
  newForm.value = { name: '', category: 'First touch', description: '', subject: '', format: 'text', body: 'Hi {{firstName}},\n\n\n\nBest,\n{{senderFirstName}}', html: '', label: 'V1' }
  showNew.value = true
}
async function createNew() {
  const f = newForm.value
  if (!f.name.trim() || !f.subject.trim() || (f.format === 'html' ? !f.html.trim() : !f.body.trim())) return toast.error('Name, subject line and body are required')
  saving.value = true
  try { const t = await saveTemplate(null, f); toast.success('Template created'); showNew.value = false; openDetail(t) } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save') } finally { saving.value = false }
}
function insertInto(target: 'body' | 'html', key: string, form: any, el: any) {
  const tag = `{{${key}}}`
  const raw: any = el?.$el ?? el
  const ta: HTMLTextAreaElement | undefined = raw?.tagName === 'TEXTAREA' ? raw : raw?.querySelector?.('textarea')
  if (ta) { const s = ta.selectionStart, e = ta.selectionEnd; form[target] = form[target].slice(0, s) + tag + form[target].slice(e); nextTick(() => { ta.focus(); ta.setSelectionRange(s + tag.length, s + tag.length) }) }
  else form[target] += tag
}

// ─── Template detail ───
const detailId = ref<string | null>(null)
const detail = computed(() => templates.value.find(t => t.id === detailId.value) || null)
const meta = ref({ name: '', category: '', description: '' })
function openDetail(t: EmailTemplate) { detailId.value = t.id; meta.value = { name: t.name, category: t.category, description: t.description || '' } }
async function patch(body: Record<string, any>, ok?: string) {
  if (!detail.value) return
  try { await saveTemplate(detail.value.id, body); if (ok) toast.success(ok); loadStats() } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not update') }
}
const saveMeta = () => patch({ ...meta.value }, 'Template updated')
// Big preview in the detail sheet
const dpv = useTemplatePreview()
const device = ref<'desktop' | 'mobile'>('desktop')
const shownVersion = ref<number | null>(null)
const shownSubject = ref<string>('')
watch(detailId, () => { shownVersion.value = null; shownSubject.value = '' })
const detailVersion = computed(() => detail.value ? (detail.value.versions.find(v => v.version === shownVersion.value) || activeVersion(detail.value)) : null)
const detailSubject = computed(() => detail.value ? (detail.value.subjects.find(x => x.key === shownSubject.value)?.text || activeSubject(detail.value)) : '')
const detailRendered = computed(() => detailVersion.value ? dpv.render(detailVersion.value, detailSubject.value) : null)

// Version editor
const showVersion = ref(false)
const vForm = ref({ format: 'text' as 'text' | 'html', body: '', html: '', label: '', note: '', retireOthers: false })
const vBodyEl = ref<any>(null)
const vPreview = ref(false)
function newVersionFrom(v: EmailTemplateVersion | null) {
  const next = Math.max(0, ...(detail.value?.versions.map(x => x.version) || [0])) + 1
  vForm.value = { format: v?.format || 'text', body: v?.body || '', html: v?.html || '', label: `V${next}`, note: '', retireOthers: false }
  vPreview.value = false
  showVersion.value = true
}
async function saveVersion() {
  const f = vForm.value
  if (f.format === 'html' ? !f.html.trim() : !f.body.trim()) return toast.error('The body is required')
  saving.value = true
  try {
    await saveTemplate(detail.value!.id, { newVersion: { ...f, body: f.format === 'html' ? '' : f.body } })
    toast.success(f.retireOthers ? `${f.label} is now the only active version` : `${f.label} added — rotating with the other active versions`)
    showVersion.value = false; loadStats()
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save') } finally { saving.value = false }
}
// Subject lines
const newSubject = ref('')
const subjectAB = ref(true)
async function addSubject() {
  if (!newSubject.value.trim()) return
  await patch({ addSubject: { text: newSubject.value.trim(), retireOthers: !subjectAB.value } }, subjectAB.value ? 'Subject line added — rotating with the others' : 'Subject line replaced')
  newSubject.value = ''
}
async function copyHtml(v: EmailTemplateVersion) { try { await navigator.clipboard.writeText(v.html || v.body); toast.success('Copied') } catch {} }
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <p class="text-xs text-muted-foreground max-w-2xl">Body versions and subject lines are tracked separately. Run several at once to A/B test — new emails rotate between active ones, fewest sends first.</p>
      <label class="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer"><Switch v-model="showArchived" /> Show archived</label>
      <Button size="sm" variant="outline" class="gap-2" @click="openNew"><Plus class="size-4" /> New template</Button>
      <Button size="sm" class="gap-2 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white shadow-sm shadow-emerald-600/25" @click="openStudio()"><Sparkles class="size-4" /> Design with AI</Button>
    </div>

    <div v-if="!list.length" class="rounded-xl border-2 border-dashed py-12 flex flex-col items-center text-center">
      <FileText class="size-8 text-muted-foreground/50" />
      <p class="mt-2 font-semibold text-sm">No templates yet</p>
      <div class="mt-4 flex gap-2"><Button size="sm" variant="outline" class="gap-2" @click="openNew"><Plus class="size-4" /> New template</Button><Button size="sm" class="gap-2" @click="openStudio()"><Sparkles class="size-4" /> Design with AI</Button></div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
      <button v-for="t in list" :key="t.id" type="button" class="group text-left rounded-xl border bg-card overflow-hidden flex flex-col hover:border-primary/40 hover:shadow-md transition-all" :class="t.archivedAt && 'opacity-60'" @click="openDetail(t)">
        <div class="relative border-b">
          <CrmEmailTemplateThumb :html="thumbHtml(t)" :format="activeVersion(t)?.format || 'text'" />
          <span class="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-background/90 backdrop-blur px-2 py-0.5 text-[10px] font-medium shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"><Eye class="size-3" /> Open preview</span>
        </div>
        <div class="p-4 flex flex-col gap-2 flex-1">
        <div class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <p class="font-semibold text-sm truncate">{{ t.name }}</p>
            <p class="text-[11px] text-muted-foreground">{{ t.category }}<span v-if="t.archivedAt"> · archived</span></p>
          </div>
          <ChevronRight class="size-4 text-muted-foreground" />
        </div>
        <div class="flex flex-wrap gap-1">
          <Badge v-for="v in t.versions.filter(v => v.status === 'active')" :key="v.version" variant="outline" class="text-[10px] gap-1"><component :is="v.format === 'html' ? Code2 : Type" class="size-3" />{{ v.label || `V${v.version}` }}</Badge>
          <Badge variant="outline" class="text-[10px] text-muted-foreground">{{ t.subjects.filter(s => s.status === 'active').length }} subject line{{ t.subjects.filter(s => s.status === 'active').length === 1 ? '' : 's' }}</Badge>
          <Badge v-if="t.versions.filter(v => v.status === 'active').length > 1 || t.subjects.filter(s => s.status === 'active').length > 1" variant="outline" class="text-[10px] gap-1 bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25"><FlaskConical class="size-3" />A/B running</Badge>
        </div>
        <p class="text-xs text-muted-foreground truncate">{{ t.subjects.find(s => s.status === 'active')?.text }}</p>
        <div class="mt-auto pt-2 border-t grid grid-cols-5 gap-2 text-[11px]">
          <div><p class="text-muted-foreground">Sent</p><p class="font-semibold tabular-nums">{{ tStat(t.id)?.units ?? 0 }}</p></div>
          <div><p class="text-muted-foreground">Reply</p><p class="font-semibold tabular-nums">{{ fmtRate(tStat(t.id)?.replyRate) }}</p></div>
          <div><p class="text-muted-foreground">Positive</p><p class="font-semibold tabular-nums">{{ fmtRate(tStat(t.id)?.positiveRate) }}</p></div>
          <div><p class="text-muted-foreground">Meetings</p><p class="font-semibold tabular-nums">{{ tStat(t.id)?.meetings ?? 0 }}</p></div>
          <div><p class="text-muted-foreground">Won</p><p class="font-semibold tabular-nums">{{ tStat(t.id)?.won ?? 0 }}</p></div>
        </div>
        </div>
      </button>
    </div>

    <!-- ═══ New template ═══ -->
    <Dialog v-model:open="showNew">
      <DialogContent class="sm:max-w-5xl max-h-[94vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New template</DialogTitle><DialogDescription class="text-xs">Create the first body version and subject line. Add more versions or subject lines later to test them.</DialogDescription></DialogHeader>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div class="space-y-4">
            <div class="grid grid-cols-[1fr_150px] gap-3">
              <div class="space-y-1.5"><Label>Name</Label><Input v-model="newForm.name" placeholder="Recon Introduction" /></div>
              <div class="space-y-1.5"><Label>Category</Label><Select v-model="newForm.category"><SelectTrigger class="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="c in EMAIL_TEMPLATE_CATEGORIES" :key="c" :value="c">{{ c }}</SelectItem></SelectContent></Select></div>
            </div>
            <div class="space-y-1.5"><Label>Subject line (S1)</Label><Input v-model="newForm.subject" placeholder="{{usedMissingPhotos}} vehicles at {{dealership}} are missing photos" /></div>
            <div class="flex items-center gap-2">
              <div class="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
                <button type="button" class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium" :class="newForm.format === 'text' ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="newForm.format = 'text'"><Type class="size-3.5" /> Plain text</button>
                <button type="button" class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium" :class="newForm.format === 'html' ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="newForm.format = 'html'"><Code2 class="size-3.5" /> HTML design</button>
              </div>
              <Input v-model="newForm.label" class="h-8 w-24 text-xs" placeholder="V1" aria-label="Version label" />
            </div>
            <div class="space-y-1.5">
              <Textarea v-if="newForm.format === 'text'" ref="bodyEl" v-model="newForm.body" rows="14" class="text-sm leading-relaxed" />
              <Textarea v-else ref="bodyEl" v-model="newForm.html" rows="18" class="text-xs font-mono leading-relaxed" placeholder="Paste email-safe HTML (tables + inline styles). Use {{fields}} for data." />
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="text-[11px] text-muted-foreground inline-flex items-center gap-1 mr-1"><Braces class="size-3" /> Insert:</span>
                <button v-for="f in [...EMAIL_MERGE_FIELDS, ...(newForm.format === 'html' ? EMAIL_HTML_ONLY_FIELDS : [])]" :key="f.key" type="button" class="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted" @click="insertInto(newForm.format === 'html' ? 'html' : 'body', f.key, newForm, bodyEl)">{{ f.label }}</button>
              </div>
            </div>
            <div class="space-y-1.5"><Label>Description <span class="text-muted-foreground font-normal">(optional)</span></Label><Input v-model="newForm.description" placeholder="When to use it" /></div>
          </div>
          <div class="space-y-1.5 min-w-0">
            <div class="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs flex items-center gap-2"><Sparkles class="size-4 text-emerald-600 shrink-0" /><span class="flex-1">Want it designed for you? Describe it and Claude builds the HTML in your house style.</span><Button size="sm" variant="outline" class="h-7 text-xs gap-1" @click="showNew = false; openStudio()"><Wand2 class="size-3.5" /> Template Studio</Button></div>
            <CrmEmailPreview :html="pv.render(newForm, newForm.subject).html" :subject="pv.render(newForm, newForm.subject).subject" :preheader="pv.render(newForm, newForm.subject).preheader" :from="pv.ctx.value?.from" :to="pv.ctx.value?.to" :loading="pv.loading.value" max-height="560px">
              <template #toolbar><CrmEmailInboxCheck :rendered="pv.render(newForm, newForm.subject)" :source="newForm" /></template>
            </CrmEmailPreview>
          </div>
        </div>
        <DialogFooter><Button variant="ghost" @click="showNew = false">Cancel</Button><Button :disabled="saving" class="min-w-28" @click="createNew"><Loader2 v-if="saving" class="size-4 animate-spin" /><span v-else>Create template</span></Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- ═══ Template detail ═══ -->
    <Sheet :open="!!detail" @update:open="(o: boolean) => { if (!o) detailId = null }">
      <SheetContent side="right" class="w-full sm:max-w-[min(1440px,97vw)] p-0 flex flex-col gap-0">
        <template v-if="detail">
          <SheetHeader class="px-6 pt-6 pb-4 border-b">
            <SheetTitle class="text-base flex items-center gap-2">{{ detail.name }} <Badge v-if="detail.archivedAt" variant="outline" class="text-[10px]">Archived</Badge></SheetTitle>
            <SheetDescription class="text-xs">{{ detail.category }} · created {{ format(new Date(detail.createdAt), 'MMM d, yyyy') }}</SheetDescription>
          </SheetHeader>
          <div class="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_540px]">
          <!-- Live preview -->
          <section class="min-h-0 flex flex-col p-4 gap-3 border-r bg-muted/10">
            <div class="flex flex-wrap items-center gap-2">
              <div class="inline-flex flex-wrap rounded-lg border bg-muted/40 p-0.5" role="tablist" aria-label="Body version">
                <button v-for="v in [...detail.versions].filter(x => x.status === 'active' || x.version === detailVersion?.version).reverse()" :key="v.version" type="button" role="tab" :aria-selected="detailVersion?.version === v.version" class="rounded-md px-2.5 py-1 text-xs font-medium inline-flex items-center gap-1" :class="detailVersion?.version === v.version ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'" @click="shownVersion = v.version"><component :is="v.format === 'html' ? Code2 : Type" class="size-3" />{{ v.label || `V${v.version}` }}<span v-if="v.status !== 'active'" class="text-[9px] text-muted-foreground">retired</span></button>
              </div>
              <Select v-if="detail.subjects.length > 1" v-model="shownSubject"><SelectTrigger class="h-8 w-56 text-xs"><SelectValue :placeholder="`Subject: ${activeSubject(detail)}`" /></SelectTrigger><SelectContent><SelectItem v-for="x in detail.subjects" :key="x.key" :value="x.key">{{ x.key }} · {{ x.text }}</SelectItem></SelectContent></Select>
              <div class="w-60"><CrmDealershipPicker v-model="dpv.dealershipId.value" placeholder="Preview with a real dealership…" /></div>
              <span class="text-[11px] text-muted-foreground inline-flex items-center gap-1"><Store class="size-3.5" />{{ dpv.ctx.value?.source === 'dealership' ? `${dpv.ctx.value.dealershipName}${dpv.ctx.value.hasAudit ? '' : ' · no audit yet'}` : 'Sample: Bleakley Kia' }}</span>
              <Button v-if="detailVersion?.format === 'html'" size="sm" class="h-8 gap-1.5 ml-auto bg-gradient-to-r from-emerald-600 to-emerald-700 text-white" @click="openStudio(detail, detailVersion)"><Sparkles class="size-3.5" /> Refine with AI</Button>
            </div>
            <CrmEmailPreview v-if="detailRendered" v-model:device="device" class="flex-1 min-h-[420px]" :html="detailRendered.html" :subject="detailRendered.subject" :preheader="detailRendered.preheader" :from="dpv.ctx.value?.from" :to="dpv.ctx.value?.to" :loading="dpv.loading.value">
              <template #toolbar>
                <CrmEmailInboxCheck :rendered="detailRendered" :source="detailVersion || {}" />
                <Button v-if="detailVersion" variant="ghost" size="sm" class="h-7 text-xs gap-1" @click="copyHtml(detailVersion)"><Copy class="size-3.5" /> Copy {{ detailVersion.format === 'html' ? 'HTML' : 'text' }}</Button>
              </template>
            </CrmEmailPreview>
            <p v-if="detailRendered?.missing.length" class="text-[11px] text-amber-700 dark:text-amber-300">No data for {{ tags(detailRendered.missing) }} — these show blank for this dealership.</p>
          </section>
          <div class="min-h-0 overflow-y-auto px-6 py-5 space-y-7">
            <!-- Body versions -->
            <section class="space-y-3">
              <div class="flex items-center justify-between">
                <h4 class="text-sm font-semibold">Body versions</h4>
                <Button size="sm" variant="outline" class="h-7 gap-1.5 text-xs" @click="newVersionFrom(detail.versions.find(v => v.version === detail!.currentVersion) || null)"><Plus class="size-3.5" /> New version</Button>
              </div>
              <div class="rounded-xl border overflow-x-auto">
                <table class="w-full text-sm">
                  <thead class="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr><th class="text-left font-medium px-3 py-2">Version</th><th class="text-right font-medium px-2 py-2">Sent</th><th class="text-right font-medium px-2 py-2">Delivered</th><th class="text-right font-medium px-2 py-2">Reply</th><th class="text-right font-medium px-2 py-2">Positive</th><th class="text-right font-medium px-2 py-2">Mtgs</th><th class="text-right font-medium px-2 py-2">Won</th><th class="px-2 py-2" /></tr>
                  </thead>
                  <tbody class="divide-y">
                    <tr v-for="v in [...detail.versions].reverse()" :key="v.version" :class="v.status !== 'active' && 'opacity-60'">
                      <td class="px-3 py-2">
                        <p class="font-medium flex items-center gap-1.5"><component :is="v.format === 'html' ? Code2 : Type" class="size-3.5 text-muted-foreground" />{{ v.label || `V${v.version}` }}<Badge variant="outline" class="text-[9px]" :class="v.status === 'active' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25' : ''">{{ v.status }}</Badge></p>
                        <p class="text-[10px] text-muted-foreground line-clamp-2 max-w-56" :title="v.note">{{ format(new Date(v.createdAt), 'MMM d, yyyy') }}<span v-if="v.note"> · {{ v.note }}</span></p>
                      </td>
                      <td class="px-2 py-2 text-right tabular-nums">{{ vStat(detail.id, v.version)?.units ?? detail.usage.versions[v.version] ?? 0 }}</td>
                      <td class="px-2 py-2 text-right tabular-nums text-xs">{{ fmtRate(vStat(detail.id, v.version)?.deliveryRate) }}</td>
                      <td class="px-2 py-2 text-right tabular-nums text-xs font-semibold">{{ fmtRate(vStat(detail.id, v.version)?.replyRate) }}</td>
                      <td class="px-2 py-2 text-right tabular-nums text-xs">{{ fmtRate(vStat(detail.id, v.version)?.positiveRate) }}</td>
                      <td class="px-2 py-2 text-right tabular-nums text-xs">{{ vStat(detail.id, v.version)?.meetings ?? 0 }}</td>
                      <td class="px-2 py-2 text-right tabular-nums text-xs font-semibold">{{ vStat(detail.id, v.version)?.won ?? 0 }}</td>
                      <td class="px-2 py-2 text-right whitespace-nowrap">
                        <Button variant="ghost" size="icon" class="size-7" title="Show in preview" @click="shownVersion = v.version"><Eye class="size-3.5" /></Button>
                        <Button v-if="v.format === 'html'" variant="ghost" size="icon" class="size-7" title="Refine with AI (Template Studio)" @click="openStudio(detail, v)"><Sparkles class="size-3.5" /></Button>
                        <Button variant="ghost" size="icon" class="size-7" title="New version from this" @click="newVersionFrom(v)"><Copy class="size-3.5" /></Button>
                        <Button variant="ghost" size="icon" class="size-7" :title="v.status === 'active' ? 'Retire (stop sending)' : 'Activate (add to rotation)'" @click="patch({ versionStatus: { version: v.version, status: v.status === 'active' ? 'retired' : 'active' } })"><component :is="v.status === 'active' ? Pause : Play" class="size-3.5" /></Button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <!-- Subject lines -->
            <section class="space-y-3">
              <h4 class="text-sm font-semibold">Subject lines</h4>
              <div class="rounded-xl border overflow-x-auto">
                <table class="w-full text-sm">
                  <thead class="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr><th class="text-left font-medium px-3 py-2">Subject</th><th class="text-right font-medium px-2 py-2">Sent</th><th class="text-right font-medium px-2 py-2">Reply</th><th class="text-right font-medium px-2 py-2">Positive</th><th class="text-right font-medium px-2 py-2 text-muted-foreground/70" title="Reported — unreliable">Open*</th><th class="text-right font-medium px-2 py-2">Won</th><th class="px-2 py-2" /></tr>
                  </thead>
                  <tbody class="divide-y">
                    <tr v-for="s in [...detail.subjects].reverse()" :key="s.key" :class="s.status !== 'active' && 'opacity-60'">
                      <td class="px-3 py-2"><p class="text-xs"><span class="font-semibold mr-1.5">{{ s.key }}</span>{{ s.text }}</p><Badge variant="outline" class="text-[9px] mt-0.5" :class="s.status === 'active' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25' : ''">{{ s.status }}</Badge></td>
                      <td class="px-2 py-2 text-right tabular-nums">{{ sStat(detail.id, s.key)?.units ?? detail.usage.subjects[s.key] ?? 0 }}</td>
                      <td class="px-2 py-2 text-right tabular-nums text-xs font-semibold">{{ fmtRate(sStat(detail.id, s.key)?.replyRate) }}</td>
                      <td class="px-2 py-2 text-right tabular-nums text-xs">{{ fmtRate(sStat(detail.id, s.key)?.positiveRate) }}</td>
                      <td class="px-2 py-2 text-right tabular-nums text-xs text-muted-foreground">—</td>
                      <td class="px-2 py-2 text-right tabular-nums text-xs font-semibold">{{ sStat(detail.id, s.key)?.won ?? 0 }}</td>
                      <td class="px-2 py-2 text-right"><Button variant="ghost" size="icon" class="size-7" :title="s.status === 'active' ? 'Retire' : 'Activate'" @click="patch({ subjectStatus: { key: s.key, status: s.status === 'active' ? 'retired' : 'active' } })"><component :is="s.status === 'active' ? Pause : Play" class="size-3.5" /></Button></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <Input v-model="newSubject" placeholder="New subject line to test…" class="h-8 text-sm flex-1 min-w-60" @keydown.enter.prevent="addSubject" />
                <label class="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer"><Switch v-model="subjectAB" /> Run alongside current (A/B)</label>
                <Button size="sm" class="h-8" :disabled="!newSubject.trim()" @click="addSubject">Add</Button>
              </div>
              <p class="text-[11px] text-muted-foreground">Open rates are not used to judge subject lines — they are unreliable. Compare replies and positive replies.</p>
            </section>

            <!-- Details -->
            <section class="space-y-3">
              <h4 class="text-sm font-semibold">Details</h4>
              <div class="grid grid-cols-[1fr_160px] gap-3">
                <div class="space-y-1.5"><Label class="text-xs">Name</Label><Input v-model="meta.name" class="h-8" /></div>
                <div class="space-y-1.5"><Label class="text-xs">Category</Label><Select v-model="meta.category"><SelectTrigger class="w-full h-8"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="c in EMAIL_TEMPLATE_CATEGORIES" :key="c" :value="c">{{ c }}</SelectItem></SelectContent></Select></div>
              </div>
              <div class="space-y-1.5"><Label class="text-xs">Description</Label><Input v-model="meta.description" class="h-8" /></div>
              <div class="flex gap-2">
                <Button size="sm" variant="outline" class="h-8" @click="saveMeta">Save details</Button>
                <Button size="sm" variant="ghost" class="h-8 gap-1.5 ml-auto" @click="patch({ archived: !detail.archivedAt }, detail.archivedAt ? 'Template restored' : 'Template archived')"><component :is="detail.archivedAt ? ArchiveRestore : Archive" class="size-3.5" />{{ detail.archivedAt ? 'Restore' : 'Archive' }}</Button>
              </div>
            </section>
          </div>
          </div>
        </template>
      </SheetContent>
    </Sheet>

    <!-- ═══ New version ═══ -->
    <Dialog v-model:open="showVersion">
      <DialogContent class="sm:max-w-5xl max-h-[94vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New body version — {{ detail?.name }}</DialogTitle><DialogDescription class="text-xs">Versions never change once created, so results stay comparable.</DialogDescription></DialogHeader>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div class="space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <div class="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
                <button type="button" class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium" :class="vForm.format === 'text' ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="vForm.format = 'text'"><Type class="size-3.5" /> Plain text</button>
                <button type="button" class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium" :class="vForm.format === 'html' ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="vForm.format = 'html'"><Code2 class="size-3.5" /> HTML design</button>
              </div>
              <Input v-model="vForm.label" class="h-8 w-24 text-xs" aria-label="Version label" />
              <Input v-model="vForm.note" class="h-8 flex-1 min-w-40 text-xs" placeholder="What's different? e.g. shorter hero, new CTA" />
            </div>
            <Textarea v-if="vForm.format === 'text'" ref="vBodyEl" v-model="vForm.body" rows="16" class="text-sm leading-relaxed" />
            <Textarea v-else ref="vBodyEl" v-model="vForm.html" rows="20" class="text-xs font-mono leading-relaxed" />
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="text-[11px] text-muted-foreground inline-flex items-center gap-1 mr-1"><Braces class="size-3" /> Insert:</span>
              <button v-for="f in [...EMAIL_MERGE_FIELDS, ...(vForm.format === 'html' ? EMAIL_HTML_ONLY_FIELDS : [])]" :key="f.key" type="button" class="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted" @click="insertInto(vForm.format === 'html' ? 'html' : 'body', f.key, vForm, vBodyEl)">{{ f.label }}</button>
            </div>
            <label class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer select-none">
              <div><p class="text-sm font-medium">Replace the current version(s)</p><p class="text-[11px] text-muted-foreground">Off = A/B test: this version rotates with the other active ones.</p></div>
              <Switch v-model="vForm.retireOthers" />
            </label>
          </div>
          <div class="space-y-1.5 min-w-0">
            <CrmEmailPreview :html="pv.render(vForm, detail ? activeSubject(detail) : '').html" :subject="pv.render(vForm, detail ? activeSubject(detail) : '').subject" :preheader="pv.render(vForm, detail ? activeSubject(detail) : '').preheader" :from="pv.ctx.value?.from" :to="pv.ctx.value?.to" :loading="pv.loading.value" max-height="600px">
              <template #toolbar><CrmEmailInboxCheck :rendered="pv.render(vForm, detail ? activeSubject(detail) : '')" :source="vForm" /></template>
            </CrmEmailPreview>
          </div>
        </div>
        <DialogFooter><Button variant="ghost" @click="showVersion = false">Cancel</Button><Button :disabled="saving" class="min-w-28" @click="saveVersion"><Loader2 v-if="saving" class="size-4 animate-spin" /><span v-else>Save {{ vForm.label }}</span></Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <CrmEmailTemplateStudio v-model:open="showStudio" :template="studioFor" :start-html="studioHtml" :start-subject="studioFor ? activeSubject(studioFor) : ''" :start-name="studioFor?.name || ''" @saved="studioSaved" />
  </div>
</template>
