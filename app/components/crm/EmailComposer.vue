<script setup lang="ts">
import type { CrmContact, CrmDealership } from '~/composables/useCrmDealerships'
import type { CrmEmail, EmailPreview } from '~/composables/useCrmEmail'
import { Loader2, Send, Mail, Reply, AlertTriangle, FileText, Megaphone, Info, FlaskConical, Shuffle, ChevronDown, FileDown, RotateCcw, ScanSearch, Sparkles } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format } from 'date-fns'
import { EMAIL_MERGE_FIELDS } from '~/constants/crm'

/**
 * Send an email from the dealership record. The email IS the template: pick one and the subject
 * line and the whole message are filled in from this dealership's latest inventory audit — there is
 * nothing to write and no message box. What is shown is exactly what goes out (rendered by the
 * server, like the send). Wording is changed where it belongs: in the template (Email → Templates).
 *
 * Sent through Resend; delivery, bounces, opens / clicks and replies flow back automatically. With a
 * template, the body version and subject line rotate (fewest sends first) so experiments stay balanced.
 */
const isOpen = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  dealership: CrmDealership | null
  contacts: CrmContact[]
  /** All CRM emails for this dealership (used to suggest follow-ups). */
  emails: CrmEmail[]
  followUpOf?: string | null
  contactId?: string | null
  /** Open on the inventory-audit email as a new conversation (from the audit screens). */
  auditEmail?: boolean
}>()
const emit = defineEmits<{ sent: [e: CrmEmail], crawl: [] }>()
const { templates, campaigns, config, loadLibrary, sendEmail, previewEmail } = useCrmEmail()

const OTHER = '__other'
const NONE = '__none'
const blank = () => ({ contactId: NONE as string, to: '', templateId: NONE, templateVersion: 0, subjectVariant: NONE, campaignId: NONE, followUpOf: NONE, subject: '', body: '' })
const form = ref(blank())
/** The subject was typed over — it is sent as typed and no longer credited to a tracked subject line. */
const subjectEdited = ref(false)
const showVariants = ref(false)
const device = ref<'desktop' | 'mobile'>('desktop')
const sending = ref(false)
const sendError = ref('')
/** Templates have been fetched for this opening (so "no templates" is a fact, not a loading state). */
const libraryLoaded = ref(false)
const errors = ref<Record<string, string>>({})
/** True while the composer fills itself in on open (the watchers below stay quiet). */
let booting = false

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

// ─── Template, version, subject line ───
const usable = (t: { versions: { status: string }[] }) => t.versions.some(v => v.status === 'active')
const activeTemplates = computed(() => templates.value.filter(t => !t.archivedAt && usable(t)))
const template = computed(() => templates.value.find(t => t.id === form.value.templateId) || null)
const version = computed(() => template.value?.versions.find(v => v.version === form.value.templateVersion) || null)
const subjectLine = computed(() => template.value?.subjects.find(s => s.key === form.value.subjectVariant) || null)
const activeVersions = computed(() => template.value?.versions.filter(v => v.status === 'active') || [])
const activeSubjects = computed(() => template.value?.subjects.filter(s => s.status === 'active') || [])
const used = (kind: 'versions' | 'subjects', k: string | number) => template.value?.usage?.[kind]?.[String(k)] || 0
const subjectIsCustom = computed(() => !!template.value && (!subjectLine.value || subjectLine.value.text !== form.value.subject.trim()))
/** The inventory-audit email — what a first email to a dealership is. */
const auditTemplate = computed(() => activeTemplates.value.find(t => /missing photos/i.test(t.name)) || activeTemplates.value.find(t => t.category === 'First touch' && t.versions.some(v => v.status === 'active' && v.format === 'html')) || null)
const followUpTemplate = computed(() => activeTemplates.value.find(t => t.category === 'Follow-up') || null)
/** The message is the template, as designed. */
const designed = computed(() => !!version.value)

function applyVersion(vn: number) {
  form.value.templateVersion = vn
}
function applySubject(key: string) {
  form.value.subjectVariant = key
  const s = template.value?.subjects.find(x => x.key === key)
  if (s && !thread.value) { form.value.subject = s.text; subjectEdited.value = false }
}
function applyTemplate(id: string) {
  form.value.templateId = id
  const t = templates.value.find(x => x.id === id)
  if (!t) return
  errors.value = { ...errors.value, template: '' }
  // Balanced rotation: the active version / subject line with the fewest sends.
  const v = [...t.versions.filter(x => x.status === 'active')].sort((a, b) => (t.usage.versions[a.version] || 0) - (t.usage.versions[b.version] || 0) || b.version - a.version)[0] || t.versions.at(-1)
  const s = [...t.subjects.filter(x => x.status === 'active')].sort((a, b) => (t.usage.subjects[a.key] || 0) - (t.usage.subjects[b.key] || 0))[0]
  if (v) applyVersion(v.version)
  if (s) applySubject(s.key)
}
function resetSubject() {
  subjectEdited.value = false
  form.value.subject = thread.value ? reSubject(thread.value.first.subject) : (subjectLine.value?.text || '')
}

// ─── The email, rendered by the server exactly like the send ───
const preview = ref<EmailPreview | null>(null)
const previewing = ref(false)
const previewError = ref('')
/** The raw subject the current preview was rendered from (so a stale one is never shown as the subject). */
const previewedSubject = ref<string | null>(null)
function payload() {
  const t = !!template.value
  return {
    contactId: form.value.contactId === OTHER || form.value.contactId === NONE ? null : form.value.contactId,
    to: toEmail.value,
    subject: form.value.subject,
    // The body is never typed here: designed HTML is sent as it is, a text template with its own wording.
    body: version.value?.format === 'html' ? '' : (version.value?.body || ''),
    templateId: t ? form.value.templateId : null,
    templateVersion: t ? form.value.templateVersion : null,
    subjectVariant: !t || subjectIsCustom.value ? null : form.value.subjectVariant,
    campaignId: form.value.campaignId === NONE ? null : form.value.campaignId,
    followUpOf: form.value.followUpOf === NONE ? null : form.value.followUpOf,
  }
}
let seq = 0
let timer: ReturnType<typeof setTimeout> | null = null
async function loadPreview() {
  if (!props.dealership || !isOpen.value) return
  const n = ++seq
  const raw = form.value.subject
  previewing.value = true
  try {
    const p = await previewEmail(props.dealership.id, payload())
    if (n !== seq) return
    preview.value = p; previewedSubject.value = raw; previewError.value = ''
  } catch (e: any) {
    if (n === seq) previewError.value = e?.data?.statusMessage || 'The email could not be loaded — check the connection and try again.'
  } finally { if (n === seq) previewing.value = false }
}
const previewKey = computed(() => JSON.stringify([form.value.contactId, toEmail.value, form.value.templateId, form.value.templateVersion, form.value.subject, form.value.followUpOf]))
watch(previewKey, () => {
  if (booting || !isOpen.value) return
  if (timer) clearTimeout(timer)
  // Typing waits for a pause; a choice (template, contact) refreshes right away.
  timer = setTimeout(loadPreview, subjectEdited.value ? 450 : 40)
})
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })

/** The subject the dealer will read: template fields filled in with this dealership's numbers. */
const hasFields = (s: string) => /\{\{\s*\w+/.test(s)
const subjectResolved = computed(() => {
  if (subjectEdited.value || !hasFields(form.value.subject)) return form.value.subject
  return preview.value && previewedSubject.value === form.value.subject ? preview.value.subject : ''
})
const subjectShown = computed({
  get: () => subjectResolved.value,
  set: (v: string) => { form.value.subject = v; subjectEdited.value = true },
})
const subjectFilling = computed(() => !subjectEdited.value && hasFields(form.value.subject) && !subjectResolved.value && !previewError.value)
const previewHtml = computed(() => {
  const p = preview.value
  if (!p?.html || !template.value) return ''
  return p.format === 'html' ? p.html : `<div style="padding:24px 24px 10px">${p.html}</div>`
})
const fromLine = computed(() => preview.value?.from || { name: config.value?.fromBrand || 'ZRZ OPS', email: config.value?.fromEmail || '' })
const toLine = computed(() => ({ name: form.value.contactId === OTHER ? '' : (contact.value?.fullName || ''), email: toEmail.value }))
const fieldLabel = (k: string) => EMAIL_MERGE_FIELDS.find(f => f.key === k)?.label || k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
const auditDate = computed(() => preview.value?.auditDate ? format(new Date(preview.value.auditDate), 'MMM d, yyyy') : '')
const auditAgeDays = computed(() => preview.value?.auditDate ? Math.floor((Date.now() - new Date(preview.value.auditDate).getTime()) / 86_400_000) : null)
/** The template is built from the inventory audit (numbers, evidence, report link). */
const needsAudit = computed(() => designed.value && /\{\{\s*(audit|used|new[A-Z]|total|missingPhoto|inventory|placeholder|noImage|stock|prev|trend|report)/.test(`${version.value?.html || ''} ${version.value?.body || ''} ${form.value.subject}`))
const noAudit = computed(() => needsAudit.value && !!preview.value && !preview.value.auditDate)
const repliesTo = computed(() => config.value?.replyTracking === 'reply-address' ? 'Replies come back into the CRM.' : preview.value?.replyTo ? `Replies go to ${preview.value.replyTo}.` : '')
const pdfUrl = computed(() => props.dealership && template.value && designed.value
  ? `/api/crm/dealerships/${props.dealership.id}/emails/pdf?templateId=${encodeURIComponent(template.value.id)}${contact.value ? `&contactId=${encodeURIComponent(contact.value.id)}` : ''}&download=1`
  : '')

watch(isOpen, async (o) => {
  if (!o) { if (timer) clearTimeout(timer); return }
  booting = true
  errors.value = {}; sendError.value = ''; previewError.value = ''
  preview.value = null; previewedSubject.value = null
  subjectEdited.value = false; showVariants.value = false
  libraryLoaded.value = false
  try { await loadLibrary(true); libraryLoaded.value = true } catch { toast.error('Could not load the email templates', { description: 'Close this window and open it again.' }) }
  const primary = props.contacts.find(c => c.isActive && c.isPrimary && c.email) || emailable.value.find(c => c.isActive)
  form.value = { ...blank(), contactId: props.contactId || primary?.id || (emailable.value[0]?.id ?? OTHER) }
  if (props.followUpOf && !props.auditEmail) {
    const t = threads.value.find(x => x.id === props.followUpOf || x.first.id === props.followUpOf || x.last.id === props.followUpOf)
    if (t) {
      form.value.followUpOf = t.id
      const c = props.contacts.find(x => x.email?.toLowerCase() === t.to)
      if (c) form.value.contactId = c.id
      else { form.value.contactId = OTHER; form.value.to = t.to }
    }
  } else if (!props.auditEmail) suggestThread()
  // What the email starts as: the audit email for a first contact, the follow-up template inside a sequence.
  const t = thread.value
  if (t) {
    form.value.subject = reSubject(t.first.subject)
    form.value.campaignId = t.first.campaignId || NONE
  }
  const start = (t ? followUpTemplate.value : null) || auditTemplate.value || activeTemplates.value[0] || null
  if (start) applyTemplate(start.id)
  await nextTick()
  booting = false
  loadPreview()
})
watch(() => form.value.contactId, () => { if (!booting && !props.followUpOf && !props.auditEmail) suggestThread() })
watch(() => form.value.followUpOf, () => {
  if (booting) return
  const t = thread.value
  if (t && form.value.campaignId === NONE && t.first.campaignId) form.value.campaignId = t.first.campaignId
  if (subjectEdited.value) return
  form.value.subject = t ? reSubject(t.first.subject) : (subjectLine.value?.text || '')
})

const bounced = computed(() => contact.value && (contact.value as any).emailBouncedAt)
// A complaint disappears as soon as the field it is about is fixed.
watch(() => form.value.subject, (v) => { if (errors.value.subject && v.trim()) errors.value = { ...errors.value, subject: '' } })
watch(toEmail, () => { if (errors.value.to) errors.value = { ...errors.value, to: '' } })

function validate() {
  const e: Record<string, string> = {}
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail.value)) e.to = 'Choose a contact with an email, or enter a valid address'
  if (!form.value.subject.trim()) e.subject = 'The subject line is empty'
  if (!template.value) e.template = 'Choose the email to send'
  errors.value = e
  return !Object.values(e).some(Boolean)
}
const blocked = computed(() => sending.value || !!(config.value && !config.value.canSend) || noAudit.value || (libraryLoaded.value && !activeTemplates.value.length))
async function submit(allowDuplicate = false) {
  if (!props.dealership || noAudit.value || !validate()) return
  sending.value = true
  sendError.value = ''
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
    else {
      // Stays on screen until the next try: a toast is gone before a long reason can be read.
      sendError.value = err?.data?.statusMessage || err?.message || 'Email not sent'
      toast.error('Email not sent')
    }
  } finally { sending.value = false }
}
function goCrawl() { isOpen.value = false; emit('crawl') }
</script>

<template>
  <Sheet v-model:open="isOpen">
    <SheetContent side="right" class="w-full sm:max-w-3xl p-0 flex flex-col gap-0">
      <SheetHeader class="px-6 pt-6 pb-4 border-b">
        <div class="flex items-start gap-3">
          <div class="size-10 rounded-xl bg-sky-500/10 flex items-center justify-center shrink-0"><component :is="thread ? Reply : Mail" class="size-5 text-sky-600 dark:text-sky-400" /></div>
          <div class="min-w-0">
            <SheetTitle class="text-base">{{ thread ? `Follow-up #${followUpNumber}` : 'New email' }}</SheetTitle>
            <SheetDescription class="text-xs">{{ dealership?.name }}<template v-if="config?.fromEmail"> · from {{ config.fromEmail }}</template> — delivery and replies are tracked automatically.</SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <form id="email-composer" class="flex-1 overflow-y-auto px-6 py-5 space-y-5" novalidate @submit.prevent="submit()">
        <div v-if="config && !config.canSend" role="alert" class="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2"><AlertTriangle class="size-4 shrink-0" /> Sending is not configured on the server (RESEND_API_KEY missing).</div>
        <div v-else-if="config?.fromReplaced" class="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
          <Info class="size-4 shrink-0 mt-px" />
          <p>Sent from <span class="font-semibold text-foreground">{{ config.fromEmail }}</span> — {{ config.configuredFrom }} can't be the sender ({{ config.fromReplacedReason }}). <span class="text-foreground">{{ repliesTo }}</span></p>
        </div>

        <!-- Recipient & sequence -->
        <section class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="space-y-1.5 min-w-0">
            <Label>To <span class="text-destructive">*</span></Label>
            <Select v-model="form.contactId">
              <SelectTrigger class="w-full" :aria-invalid="!!errors.to"><SelectValue placeholder="Choose a contact" /></SelectTrigger>
              <SelectContent class="max-h-72">
                <SelectItem v-for="c in emailable" :key="c.id" :value="c.id">{{ c.fullName }}<span class="text-muted-foreground text-xs"> · {{ c.email }}{{ c.isActive ? '' : ' · former' }}</span></SelectItem>
                <SelectItem :value="OTHER">Another address…</SelectItem>
              </SelectContent>
            </Select>
            <Input v-if="form.contactId === OTHER" v-model="form.to" type="email" autocomplete="off" placeholder="name@dealership.com" class="mt-2" :aria-invalid="!!errors.to" />
            <p v-if="errors.to" class="text-xs text-destructive">{{ errors.to }}</p>
            <p v-if="bounced" class="text-[11px] text-rose-600 flex items-center gap-1"><AlertTriangle class="size-3" /> A previous email to this address bounced.</p>
          </div>
          <div class="space-y-1.5 min-w-0">
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
          <div class="space-y-1.5 min-w-0">
            <Label class="flex items-center gap-1.5"><FileText class="size-3.5 text-muted-foreground" /> Email</Label>
            <Select :model-value="form.templateId" @update:model-value="(v: any) => applyTemplate(String(v))">
              <SelectTrigger class="w-full" :aria-invalid="!!errors.template"><SelectValue placeholder="Choose the email" /></SelectTrigger>
              <SelectContent class="max-h-72">
                <SelectItem v-for="t in activeTemplates" :key="t.id" :value="t.id">{{ t.name }}<span class="text-muted-foreground text-xs"> · {{ t.category }}</span></SelectItem>
                <SelectItem v-if="template && !activeTemplates.some(t => t.id === template!.id)" :value="template.id">{{ template.name }}</SelectItem>
              </SelectContent>
            </Select>
            <p v-if="errors.template" class="text-xs text-destructive">{{ errors.template }}</p>
          </div>
          <div class="space-y-1.5 min-w-0">
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

        <!-- Subject -->
        <section class="space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <Label for="em-subject">Subject <span class="text-destructive">*</span></Label>
            <button v-if="subjectEdited && (subjectLine || thread)" type="button" class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" @click="resetSubject"><RotateCcw class="size-3" /> Use the automatic subject</button>
          </div>
          <div class="relative">
            <Input id="em-subject" v-model="subjectShown" autocomplete="off" :placeholder="subjectFilling ? 'Filling in from the latest audit…' : `${dealership?.name || 'Dealership'} | Inventory Audit: …`" class="font-medium" :class="subjectFilling && 'pr-9'" :aria-invalid="!!errors.subject" />
            <Loader2 v-if="subjectFilling" class="absolute right-3 top-1/2 -mt-2 size-4 animate-spin text-muted-foreground" />
          </div>
          <p v-if="errors.subject" class="text-xs text-destructive">{{ errors.subject }}</p>
          <p v-else-if="subjectEdited && template" class="text-[11px] text-amber-600">Typed over — sent as written and counted as a custom subject.</p>
          <p v-else-if="designed && !thread && subjectResolved && !noAudit" class="text-[11px] text-muted-foreground flex items-center gap-1"><Sparkles class="size-3" /> Written automatically{{ auditDate ? ` from the ${auditDate} audit` : '' }}.</p>
        </section>

        <!-- Version / subject-line experiment (only when there is a choice) -->
        <section v-if="template && designed && (template.versions.length > 1 || template.subjects.length > 1)" class="rounded-lg border bg-violet-500/[0.04] border-violet-500/20">
          <button type="button" class="w-full flex items-center gap-2 px-3 py-2 text-left text-xs" :aria-expanded="showVariants" @click="showVariants = !showVariants">
            <FlaskConical class="size-3.5 text-violet-600 dark:text-violet-300 shrink-0" />
            <span class="font-medium">{{ version?.label || `V${version?.version}` }}<template v-if="subjectLine && !subjectIsCustom"> · subject line {{ subjectLine.key }}</template></span>
            <span class="text-muted-foreground truncate">{{ activeVersions.length > 1 || activeSubjects.length > 1 ? 'picked automatically so every variant gets a fair test' : 'the version in use' }}</span>
            <ChevronDown class="size-4 ml-auto text-muted-foreground transition-transform shrink-0" :class="showVariants && 'rotate-180'" />
          </button>
          <div v-if="showVariants" class="grid grid-cols-1 sm:grid-cols-2 gap-3 px-3 pb-3">
            <div class="space-y-1 min-w-0">
              <Label class="text-xs">Design version</Label>
              <Select :model-value="form.templateVersion" @update:model-value="(v: any) => applyVersion(Number(v))">
                <SelectTrigger class="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="v in template.versions" :key="v.version" :value="v.version" :disabled="v.status !== 'active'">
                    {{ v.label || `V${v.version}` }} <span class="text-muted-foreground">· {{ used('versions', v.version) }} sent{{ v.status !== 'active' ? ' · retired' : '' }}</span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p v-if="activeVersions.length > 1" class="text-[10px] text-muted-foreground flex items-center gap-1"><Shuffle class="size-3" /> {{ activeVersions.length }} versions running — this one has the fewest sends.</p>
            </div>
            <div class="space-y-1 min-w-0">
              <Label class="text-xs">Subject line</Label>
              <Select :model-value="form.subjectVariant" @update:model-value="(v: any) => applySubject(String(v))">
                <SelectTrigger class="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent class="max-w-md">
                  <SelectItem v-for="s in template.subjects" :key="s.key" :value="s.key" :disabled="s.status !== 'active'">
                    {{ s.key }} · {{ s.text.slice(0, 50) }} <span class="text-muted-foreground">· {{ used('subjects', s.key) }} sent</span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p v-if="activeSubjects.length > 1" class="text-[10px] text-muted-foreground flex items-center gap-1"><Shuffle class="size-3" /> {{ activeSubjects.length }} subject lines rotating.</p>
            </div>
          </div>
        </section>

        <!-- No template to send -->
        <div v-if="libraryLoaded && !activeTemplates.length" role="alert" class="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-3 text-sm flex items-start gap-3">
          <AlertTriangle class="size-5 text-amber-600 shrink-0" />
          <p><span class="font-semibold">No email template is active.</span> Emails are sent from templates — open Email → Templates and activate one (the inventory-audit email is called “Missing Photos”).</p>
        </div>

        <!-- No audit to build the email from -->
        <div v-if="noAudit" role="alert" class="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-3 text-sm flex flex-wrap items-center gap-3">
          <AlertTriangle class="size-5 text-amber-600 shrink-0" />
          <p class="flex-1 min-w-[220px]"><span class="font-semibold">No inventory audit yet.</span> This email is built from the dealership's audit — the numbers, the flagged listings and their photos. Crawl the inventory first, then send.</p>
          <Button type="button" size="sm" class="gap-1.5" @click="goCrawl"><ScanSearch class="size-4" /> Crawl inventory</Button>
        </div>

        <!-- The email itself -->
        <section class="space-y-1.5">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <p class="text-sm font-medium leading-none">The email</p>
            <p v-if="designed" class="text-[11px] text-muted-foreground">Nothing to write — this is exactly what {{ contact?.firstName || 'the dealer' }} receives.<template v-if="auditDate && auditAgeDays !== null && auditAgeDays > 14"> <span class="text-amber-600">Numbers are {{ auditAgeDays }} days old ({{ auditDate }}).</span></template></p>
          </div>
          <p v-if="preview?.missing.length && !noAudit" class="text-[11px] text-amber-600 flex items-center gap-1"><AlertTriangle class="size-3 shrink-0" /> Nothing on file for: {{ preview.missing.map(fieldLabel).join(', ') }} — those spots stay empty.</p>
          <div v-if="previewError" role="alert" class="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
            <AlertTriangle class="size-4 shrink-0" /><span class="flex-1">{{ previewError }}</span>
            <Button type="button" size="sm" variant="outline" class="h-7 text-xs" @click="loadPreview">Try again</Button>
          </div>
          <CrmEmailPreview v-model:device="device" :html="previewHtml" :subject="subjectResolved || preview?.subject || ''" :from="fromLine" :to="toLine" :loading="previewing" />
        </section>

        <p class="text-[11px] text-muted-foreground flex items-start gap-1.5"><Info class="size-3.5 shrink-0 mt-px" /> Logged to the relationship history as “Email sent”. A first email moves the dealership to Outreach Active; a reply moves it to Replied.</p>
      </form>

      <div v-if="sendError" role="alert" class="mx-6 my-3 rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
        <AlertTriangle class="size-4 shrink-0 mt-px" /><p class="flex-1 leading-relaxed">{{ sendError }}</p>
      </div>
      <SheetFooter class="px-6 py-4 border-t flex-row items-center gap-2">
        <Button v-if="pdfUrl" as="a" :href="pdfUrl" variant="ghost" size="sm" class="gap-1.5 text-xs mr-auto"><FileDown class="size-4" /> Save as PDF</Button>
        <span v-else class="mr-auto" />
        <Button type="button" variant="ghost" :disabled="sending" @click="isOpen = false">Cancel</Button>
        <Button type="submit" form="email-composer" :disabled="blocked" class="min-w-28 gap-2"><Loader2 v-if="sending" class="size-4 animate-spin" /><template v-else><Send class="size-4" /> Send</template></Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
