<script setup lang="ts">
import type { CrmContact, CrmDealership } from '~/composables/useCrmDealerships'
import type { CrmEmail, EmailPreview } from '~/composables/useCrmEmail'
import { Loader2, Send, Mail, Reply, AlertTriangle, Eye, PencilLine, Braces, FileText, Megaphone, Info, FlaskConical, Code2, Shuffle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format } from 'date-fns'
import { EMAIL_MERGE_FIELDS } from '~/constants/crm'

/**
 * Compose an acquisition email from the dealership record. Sent through Resend; delivery, bounces,
 * reported opens/clicks and replies flow back automatically. With a template, the body version and
 * subject line rotate (fewest sends first) so experiments stay balanced — the rep can override.
 */
const isOpen = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  dealership: CrmDealership | null
  contacts: CrmContact[]
  /** All CRM emails for this dealership (used to suggest follow-ups). */
  emails: CrmEmail[]
  followUpOf?: string | null
  contactId?: string | null
}>()
const emit = defineEmits<{ sent: [e: CrmEmail] }>()
const { templates, campaigns, config, loadLibrary, sendEmail, previewEmail } = useCrmEmail()

const OTHER = '__other'
const NONE = '__none'
const blank = () => ({ contactId: NONE as string, to: '', templateId: NONE, templateVersion: 0, subjectVariant: NONE, campaignId: NONE, followUpOf: NONE, subject: '', body: '' })
const form = ref(blank())
/** HTML template versions are sent as designed; switch to plain text to write your own. */
const htmlMode = ref(false)
const mode = ref<'edit' | 'preview'>('edit')
const sending = ref(false)
const errors = ref<Record<string, string>>({})
const bodyEl = ref<any>(null)

const emailable = computed(() => props.contacts.filter(c => c.email))
const contact = computed(() => props.contacts.find(c => c.id === form.value.contactId) || null)
const toEmail = computed(() => form.value.contactId === OTHER ? form.value.to.trim().toLowerCase() : (contact.value?.email || '').toLowerCase())

/** Sequences (first email + follow-ups), newest first. */
const threads = computed(() => {
  const map = new Map<string, CrmEmail[]>()
  for (const e of props.emails.filter(x => x.direction === 'outbound' && x.status !== 'failed')) {
    const k = e.threadId || e.id
    map.set(k, [...(map.get(k) || []), e])
  }
  return [...map.entries()].map(([id, list]) => {
    const sorted = [...list].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    return { id, first: sorted[0]!, last: sorted.at(-1)!, count: sorted.length, replied: sorted.some(x => x.repliedAt), to: sorted[0]!.toEmail }
  }).sort((a, b) => b.last.sentAt.localeCompare(a.last.sentAt))
})
const thread = computed(() => threads.value.find(t => t.id === form.value.followUpOf) || null)
const followUpNumber = computed(() => thread.value ? thread.value.count : 0)
const reSubject = (s: string) => /^re:/i.test(s) ? s : `Re: ${s}`

function suggestThread() {
  const t = threads.value.find(x => x.to === toEmail.value && !x.replied)
  form.value.followUpOf = t ? t.id : NONE
}

watch(isOpen, async (o) => {
  if (!o) return
  errors.value = {}
  mode.value = 'edit'
  htmlMode.value = false
  preview.value = null
  try { await loadLibrary(true) } catch { toast.error('Could not load templates') }
  const primary = props.contacts.find(c => c.isActive && c.isPrimary && c.email) || emailable.value.find(c => c.isActive)
  form.value = { ...blank(), contactId: props.contactId || primary?.id || (emailable.value[0]?.id ?? OTHER) }
  if (props.followUpOf) {
    const t = threads.value.find(x => x.id === props.followUpOf || x.first.id === props.followUpOf || x.last.id === props.followUpOf)
    if (t) {
      form.value.followUpOf = t.id
      const c = props.contacts.find(x => x.email?.toLowerCase() === t.to)
      if (c) form.value.contactId = c.id
      else { form.value.contactId = OTHER; form.value.to = t.to }
      form.value.subject = reSubject(t.first.subject)
      form.value.campaignId = t.first.campaignId || NONE
    }
  } else suggestThread()
})
watch(() => form.value.contactId, () => { if (!props.followUpOf) suggestThread() })
watch(() => form.value.followUpOf, (id) => {
  const t = threads.value.find(x => x.id === id)
  if (t && !form.value.subject) form.value.subject = reSubject(t.first.subject)
  if (t && form.value.campaignId === NONE && t.first.campaignId) form.value.campaignId = t.first.campaignId
})

// ─── Template, version, subject line ───
const activeTemplates = computed(() => templates.value.filter(t => !t.archivedAt))
const template = computed(() => templates.value.find(t => t.id === form.value.templateId) || null)
const version = computed(() => template.value?.versions.find(v => v.version === form.value.templateVersion) || null)
const subjectLine = computed(() => template.value?.subjects.find(s => s.key === form.value.subjectVariant) || null)
const activeVersions = computed(() => template.value?.versions.filter(v => v.status === 'active') || [])
const activeSubjects = computed(() => template.value?.subjects.filter(s => s.status === 'active') || [])
const used = (kind: 'versions' | 'subjects', k: string | number) => template.value?.usage?.[kind]?.[String(k)] || 0
const subjectIsCustom = computed(() => !!template.value && (!subjectLine.value || subjectLine.value.text !== form.value.subject.trim()))

function applyVersion(vn: number) {
  form.value.templateVersion = vn
  const v = template.value?.versions.find(x => x.version === vn)
  if (!v) return
  htmlMode.value = v.format === 'html'
  form.value.body = v.format === 'html' ? '' : v.body
}
function applySubject(key: string) {
  form.value.subjectVariant = key
  const s = template.value?.subjects.find(x => x.key === key)
  if (s && !thread.value) form.value.subject = s.text
}
function applyTemplate(id: string) {
  form.value.templateId = id
  const t = templates.value.find(x => x.id === id)
  if (!t) { form.value.templateVersion = 0; form.value.subjectVariant = NONE; htmlMode.value = false; return }
  // Balanced rotation: the active version / subject line with the fewest sends.
  const v = [...t.versions.filter(x => x.status === 'active')].sort((a, b) => (t.usage.versions[a.version] || 0) - (t.usage.versions[b.version] || 0) || b.version - a.version)[0]!
  const s = [...t.subjects.filter(x => x.status === 'active')].sort((a, b) => (t.usage.subjects[a.key] || 0) - (t.usage.subjects[b.key] || 0))[0]
  applyVersion(v.version)
  if (s) applySubject(s.key)
}
function writePlainText() {
  // Keep the version for credit, but send the rep's own text (flagged "edited").
  htmlMode.value = false
  form.value.body = version.value?.body || ''
}
function insertField(key: string) {
  const tag = `{{${key}}}`
  const el: any = bodyEl.value?.$el ?? bodyEl.value
  const ta: HTMLTextAreaElement | undefined = el?.tagName === 'TEXTAREA' ? el : el?.querySelector?.('textarea')
  if (ta && typeof ta.selectionStart === 'number') {
    const s = ta.selectionStart, e = ta.selectionEnd
    form.value.body = form.value.body.slice(0, s) + tag + form.value.body.slice(e)
    nextTick(() => { ta.focus(); ta.setSelectionRange(s + tag.length, s + tag.length) })
  } else form.value.body += tag
}

// ─── Preview (rendered by the server exactly like the send) ───
const preview = ref<EmailPreview | null>(null)
const previewing = ref(false)
function payload() {
  return {
    contactId: form.value.contactId === OTHER || form.value.contactId === NONE ? null : form.value.contactId,
    to: toEmail.value,
    subject: form.value.subject,
    body: htmlMode.value ? '' : form.value.body,
    templateId: form.value.templateId === NONE ? null : form.value.templateId,
    templateVersion: form.value.templateId === NONE ? null : form.value.templateVersion,
    subjectVariant: form.value.templateId === NONE || subjectIsCustom.value ? null : form.value.subjectVariant,
    campaignId: form.value.campaignId === NONE ? null : form.value.campaignId,
    followUpOf: form.value.followUpOf === NONE ? null : form.value.followUpOf,
  }
}
async function loadPreview() {
  if (!props.dealership) return
  previewing.value = true
  try { preview.value = await previewEmail(props.dealership.id, payload()) } catch (e: any) { toast.error(e?.data?.statusMessage || 'Preview failed') } finally { previewing.value = false }
}
watch(mode, (m) => { if (m === 'preview') loadPreview() })
const previewDoc = computed(() => preview.value ? (preview.value.html.includes('<html') ? preview.value.html : `<!doctype html><html><body style="margin:16px">${preview.value.html}</body></html>`) : '')

const bounced = computed(() => contact.value && (contact.value as any).emailBouncedAt)

function validate() {
  const e: Record<string, string> = {}
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail.value)) e.to = 'Choose a contact with an email, or enter a valid address'
  if (!form.value.subject.trim()) e.subject = 'Subject is required'
  if (!htmlMode.value && !form.value.body.trim()) e.body = 'Write the message'
  errors.value = e
  return !Object.keys(e).length
}
async function submit(allowDuplicate = false) {
  if (!props.dealership || !validate()) return
  sending.value = true
  try {
    const email = await sendEmail(props.dealership.id, { ...payload(), ...(allowDuplicate ? { allowDuplicate: true } : {}) } as any)
    toast.success('Email sent', { description: `${email.subject} → ${email.toEmail}` })
    emit('sent', email)
    isOpen.value = false
  } catch (err: any) {
    // Duplicate guard: same template / subject to this address recently — ask before sending again.
    if (err?.statusCode === 409 && err?.data?.data?.duplicateEmail) {
      toast.warning(err.data.statusMessage, { duration: 15000, action: { label: 'Send anyway', onClick: () => submit(true) } })
    }
    else toast.error(err?.data?.statusMessage || err?.message || 'Email not sent')
  } finally { sending.value = false }
}
</script>

<template>
  <Sheet v-model:open="isOpen">
    <SheetContent side="right" class="w-full sm:max-w-3xl p-0 flex flex-col gap-0">
      <SheetHeader class="px-6 pt-6 pb-4 border-b">
        <div class="flex items-start gap-3">
          <div class="size-10 rounded-xl bg-sky-500/10 flex items-center justify-center shrink-0"><component :is="thread ? Reply : Mail" class="size-5 text-sky-600 dark:text-sky-400" /></div>
          <div class="min-w-0">
            <SheetTitle class="text-base">{{ thread ? `Follow-up #${followUpNumber}` : 'New email' }}</SheetTitle>
            <SheetDescription class="text-xs">{{ dealership?.name }} · sent from {{ config?.fromEmail }} — delivery and replies are tracked automatically.</SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <form id="email-composer" class="flex-1 overflow-y-auto px-6 py-5 space-y-5" @submit.prevent="submit()">
        <div v-if="config && !config.canSend" class="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2"><AlertTriangle class="size-4" /> Sending is not configured on the server (RESEND_API_KEY missing).</div>

        <!-- Recipient & sequence -->
        <section class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="space-y-1.5">
            <Label>To <span class="text-destructive">*</span></Label>
            <Select v-model="form.contactId">
              <SelectTrigger class="w-full" :aria-invalid="!!errors.to"><SelectValue placeholder="Choose a contact" /></SelectTrigger>
              <SelectContent class="max-h-72">
                <SelectItem v-for="c in emailable" :key="c.id" :value="c.id">{{ c.fullName }}<span class="text-muted-foreground text-xs"> · {{ c.email }}{{ c.isActive ? '' : ' · former' }}</span></SelectItem>
                <SelectItem :value="OTHER">Another address…</SelectItem>
              </SelectContent>
            </Select>
            <Input v-if="form.contactId === OTHER" v-model="form.to" type="email" placeholder="name@dealership.com" class="mt-2" />
            <p v-if="errors.to" class="text-xs text-destructive">{{ errors.to }}</p>
            <p v-if="bounced" class="text-[11px] text-rose-600 flex items-center gap-1"><AlertTriangle class="size-3" /> A previous email to this address bounced.</p>
          </div>
          <div class="space-y-1.5">
            <Label>Sequence</Label>
            <Select v-model="form.followUpOf">
              <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent class="max-h-72">
                <SelectItem :value="NONE">First email — new conversation</SelectItem>
                <SelectItem v-for="t in threads" :key="t.id" :value="t.id">Follow-up #{{ t.count }} to “{{ t.first.subject.slice(0, 40) }}”<span class="text-muted-foreground text-xs"> · {{ format(new Date(t.last.sentAt), 'MMM d') }}{{ t.replied ? ' · replied' : '' }}</span></SelectItem>
              </SelectContent>
            </Select>
            <p class="text-[11px] text-muted-foreground">{{ thread ? `Sent ${thread.count} time${thread.count > 1 ? 's' : ''} already to ${thread.to}${thread.replied ? ' — they replied' : ' — no reply yet'}.` : 'Starts a new sequence (counted as a first email).' }}</p>
          </div>
        </section>

        <!-- Template / campaign -->
        <section class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="space-y-1.5">
            <Label class="flex items-center gap-1.5"><FileText class="size-3.5 text-muted-foreground" /> Template</Label>
            <Select :model-value="form.templateId" @update:model-value="(v: any) => applyTemplate(String(v))">
              <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent class="max-h-72">
                <SelectItem :value="NONE">No template</SelectItem>
                <SelectItem v-for="t in activeTemplates" :key="t.id" :value="t.id">{{ t.name }}<span class="text-muted-foreground text-xs"> · {{ t.category }}</span></SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <Label class="flex items-center gap-1.5"><Megaphone class="size-3.5 text-muted-foreground" /> Campaign</Label>
            <Select v-model="form.campaignId">
              <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent class="max-h-72">
                <SelectItem :value="NONE">No campaign</SelectItem>
                <SelectItem v-for="c in campaigns.filter(c => !c.archivedAt && c.status !== 'completed')" :key="c.id" :value="c.id">{{ c.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <!-- Experiment variants -->
        <section v-if="template" class="rounded-xl border bg-violet-500/[0.04] border-violet-500/20 p-3 space-y-3">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300 flex items-center gap-1.5"><FlaskConical class="size-3.5" /> Experiment — credited to the version and subject line below</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="space-y-1">
              <Label class="text-xs">Body version</Label>
              <Select :model-value="form.templateVersion" @update:model-value="(v: any) => applyVersion(Number(v))">
                <SelectTrigger class="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="v in template.versions" :key="v.version" :value="v.version" :disabled="v.status !== 'active'">
                    {{ v.label || `V${v.version}` }} <span class="text-muted-foreground">· {{ v.format === 'html' ? 'HTML' : 'text' }} · {{ used('versions', v.version) }} sent{{ v.status !== 'active' ? ' · retired' : '' }}</span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p v-if="activeVersions.length > 1" class="text-[10px] text-muted-foreground flex items-center gap-1"><Shuffle class="size-3" /> {{ activeVersions.length }} versions running — picked the one with the fewest sends.</p>
            </div>
            <div class="space-y-1">
              <Label class="text-xs">Subject line</Label>
              <Select :model-value="form.subjectVariant" @update:model-value="(v: any) => applySubject(String(v))">
                <SelectTrigger class="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent class="max-w-md">
                  <SelectItem v-for="s in template.subjects" :key="s.key" :value="s.key" :disabled="s.status !== 'active'">
                    {{ s.key }} · {{ s.text.slice(0, 50) }} <span class="text-muted-foreground">· {{ used('subjects', s.key) }} sent</span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p v-if="subjectIsCustom" class="text-[10px] text-amber-600">Subject edited — tracked as a custom subject, not {{ form.subjectVariant }}.</p>
              <p v-else-if="activeSubjects.length > 1" class="text-[10px] text-muted-foreground flex items-center gap-1"><Shuffle class="size-3" /> {{ activeSubjects.length }} subject lines rotating.</p>
            </div>
          </div>
        </section>

        <!-- Content -->
        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <div class="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
              <button type="button" class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium" :class="mode === 'edit' ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="mode = 'edit'"><PencilLine class="size-3.5" /> Write</button>
              <button type="button" class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium" :class="mode === 'preview' ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="mode = 'preview'"><Eye class="size-3.5" /> Preview</button>
            </div>
            <span v-if="mode === 'preview' && preview?.missing.length" class="text-[11px] text-amber-600 flex items-center gap-1"><AlertTriangle class="size-3" /> Empty for this dealership: {{ preview.missing.join(', ') }}</span>
          </div>

          <template v-if="mode === 'edit'">
            <div class="space-y-1.5">
              <Label for="em-subject">Subject <span class="text-destructive">*</span></Label>
              <Input id="em-subject" v-model="form.subject" placeholder="Quick question about {{dealership}}'s inventory photos" :aria-invalid="!!errors.subject" />
              <p v-if="errors.subject" class="text-xs text-destructive">{{ errors.subject }}</p>
            </div>
            <div v-if="htmlMode" class="rounded-xl border border-dashed bg-muted/30 px-4 py-5 text-sm flex flex-col items-center text-center gap-2">
              <Code2 class="size-6 text-muted-foreground" />
              <p><span class="font-medium">{{ template?.name }} {{ version?.label || `V${version?.version}` }}</span> is a designed HTML email. It's filled in with this dealership's latest audit and your sender profile.</p>
              <div class="flex gap-2">
                <Button type="button" size="sm" variant="outline" class="gap-1.5" @click="mode = 'preview'"><Eye class="size-3.5" /> Preview it</Button>
                <Button type="button" size="sm" variant="ghost" class="text-xs" @click="writePlainText">Write plain text instead</Button>
              </div>
            </div>
            <div v-else class="space-y-1.5">
              <Label for="em-body">Message <span class="text-destructive">*</span></Label>
              <Textarea id="em-body" ref="bodyEl" v-model="form.body" rows="12" class="text-sm leading-relaxed" placeholder="Hi {{firstName}}, …" :aria-invalid="!!errors.body" />
              <p v-if="errors.body" class="text-xs text-destructive">{{ errors.body }}</p>
              <p v-if="version && form.body.trim() !== version.body.trim()" class="text-[11px] text-amber-600">Edited for this send — still credited to {{ version.label || `V${version.version}` }}, flagged as edited.</p>
              <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span class="text-[11px] text-muted-foreground inline-flex items-center gap-1 mr-1"><Braces class="size-3" /> Insert:</span>
                <button v-for="f in EMAIL_MERGE_FIELDS" :key="f.key" type="button" class="rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted" @click="insertField(f.key)">{{ f.label }}</button>
              </div>
            </div>
          </template>
          <div v-else class="rounded-xl border bg-card overflow-hidden">
            <div class="px-4 py-2.5 border-b text-xs space-y-0.5">
              <p><span class="text-muted-foreground w-14 inline-block">To</span>{{ toEmail || '—' }}</p>
              <p><span class="text-muted-foreground w-14 inline-block">Subject</span><span class="font-semibold">{{ preview?.subject || '—' }}</span></p>
            </div>
            <div v-if="previewing" class="h-64 flex items-center justify-center text-muted-foreground gap-2 text-sm"><Loader2 class="size-4 animate-spin" /> Rendering…</div>
            <iframe v-else-if="preview" :srcdoc="previewDoc" sandbox="" title="Email preview" class="w-full h-[560px] bg-white" />
          </div>
        </section>

        <p class="text-[11px] text-muted-foreground flex items-start gap-1.5"><Info class="size-3.5 shrink-0 mt-px" /> Logged to the relationship history as “Email sent”. Sending a first email moves the dealership to Outreach Active; a reply moves it to Replied.</p>
      </form>

      <SheetFooter class="px-6 py-4 border-t flex-row justify-end gap-2">
        <Button type="button" variant="ghost" :disabled="sending" @click="isOpen = false">Cancel</Button>
        <Button type="submit" form="email-composer" :disabled="sending || (config && !config.canSend)" class="min-w-28 gap-2"><Loader2 v-if="sending" class="size-4 animate-spin" /><template v-else><Send class="size-4" /> Send</template></Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
