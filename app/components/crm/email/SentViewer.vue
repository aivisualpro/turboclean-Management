<script setup lang="ts">
import type { CrmEmail } from '~/composables/useCrmEmail'
import { FileDown, FileCode2, ShieldCheck, Loader2, Archive, ExternalLink } from 'lucide-vue-next'
import { format } from 'date-fns'

/**
 * The email exactly as it was sent to the dealer — the stored HTML (never re-rendered), in an inbox
 * frame, with its envelope and fingerprint. Download as PDF or as the original HTML file.
 */
const props = defineProps<{ emailId: string | null }>()
const open = defineModel<boolean>('open', { default: false })
const { getEmail } = useCrmEmail()
const email = ref<CrmEmail & { bodyHtml?: string, contentSha256?: string, inlineFiles?: { cid: string, fileId: string }[], envelope?: any } | null>(null)
const loading = ref(false)
const device = ref<'desktop' | 'mobile'>('desktop')
watch([open, () => props.emailId], async ([o, id]) => {
  if (!o || !id) return
  loading.value = true
  email.value = null
  try { email.value = (await getEmail(id)).email as any } finally { loading.value = false }
}, { immediate: true })

const html = computed(() => {
  const e = email.value
  if (!e) return ''
  let h = e.bodyHtml || `<!doctype html><html><body style="margin:0;padding:24px;font:14px/1.6 Arial;color:#111;white-space:pre-wrap">${String(e.bodyText || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</body></html>`
  for (const f of e.inlineFiles || []) h = h.split(`cid:${f.cid}`).join(`/api/crm/files/${f.fileId}`)
  return h
})
const base = computed(() => email.value ? `/api/crm/email/messages/${email.value.id}/archive` : '')
const fromParts = computed(() => {
  const raw = email.value?.envelope?.from || (email.value?.fromName ? `${email.value.fromName} <${email.value.fromEmail}>` : email.value?.fromEmail || '')
  const m = String(raw).match(/^(.*?)\s*<([^>]+)>$/)
  return { name: m?.[1] || raw, email: m?.[2] || '' }
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-5xl max-h-[94vh] p-0 gap-0 flex flex-col overflow-hidden">
      <DialogHeader class="px-5 pt-5 pb-3 border-b">
        <DialogTitle class="text-base flex items-center gap-2"><Archive class="size-4 text-emerald-600" /> {{ email?.direction === 'inbound' ? 'Email as received' : 'Email as sent' }}</DialogTitle>
        <DialogDescription class="text-xs">The exact message, stored when it was {{ email?.direction === 'inbound' ? 'received' : 'sent' }} — it is never re-rendered or changed.</DialogDescription>
      </DialogHeader>
      <div v-if="loading || !email" class="flex-1 flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Loading…</div>
      <div v-else class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px]">
        <CrmEmailPreview v-model:device="device" class="min-h-0 rounded-none border-0 border-r" :html="html" :subject="email.subject" :from="fromParts" :to="{ name: email.contactName || '', email: email.toEmail }" max-height="calc(94vh - 120px)" />
        <aside class="p-4 space-y-4 text-xs overflow-y-auto">
          <div class="grid gap-2">
            <Button as="a" :href="`${base}?format=pdf&download=1`" size="sm" class="h-8 gap-1.5 justify-start"><FileDown class="size-4" /> Download PDF</Button>
            <Button as="a" :href="`${base}?format=pdf`" target="_blank" variant="outline" size="sm" class="h-8 gap-1.5 justify-start"><ExternalLink class="size-4" /> Open PDF</Button>
            <Button as="a" :href="`${base}?format=html&download=1`" variant="outline" size="sm" class="h-8 gap-1.5 justify-start"><FileCode2 class="size-4" /> Download HTML</Button>
          </div>
          <dl class="space-y-2.5">
            <div><dt class="text-muted-foreground">Sent</dt><dd class="font-medium">{{ format(new Date(email.sentAt), 'EEE, MMM d, yyyy · h:mm a') }}</dd></div>
            <div><dt class="text-muted-foreground">From</dt><dd class="break-words">{{ email.envelope?.from || email.fromEmail }}</dd></div>
            <div><dt class="text-muted-foreground">To</dt><dd class="break-words">{{ email.toEmail }}</dd></div>
            <div v-if="email.templateName"><dt class="text-muted-foreground">Template</dt><dd>{{ email.templateName }} {{ email.templateVersionLabel }}<span v-if="email.subjectVariant"> · {{ email.subjectVariant }}</span><span v-if="email.templateEdited" class="text-amber-600"> · edited</span></dd></div>
            <div><dt class="text-muted-foreground">Status</dt><dd class="capitalize">{{ email.status || 'sent' }}<span v-if="email.repliedAt"> · replied</span></dd></div>
            <div v-if="email.contentSha256"><dt class="text-muted-foreground flex items-center gap-1"><ShieldCheck class="size-3.5 text-emerald-600" /> Fingerprint</dt><dd class="font-mono text-[10px] break-all text-muted-foreground" title="SHA-256 of subject + HTML + text, taken at send time">{{ email.contentSha256 }}</dd></div>
          </dl>
        </aside>
      </div>
    </DialogContent>
  </Dialog>
</template>
