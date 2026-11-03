<script setup lang="ts">
import type { SenderProfile } from '~/composables/useCrmEmail'
import { Loader2, UserRound, Server, CheckCircle2, AlertTriangle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/** Your sender profile (the signature block templates use) + a read-only view of the sending setup. */
const { getSenderProfile, saveSenderProfile, config, loadLibrary } = useCrmEmail()
const form = ref<SenderProfile>({ displayName: '', title: '', company: '', phone: '', email: '', tagline: '', region: '' })
const loading = ref(true)
const saving = ref(false)
onMounted(async () => {
  try { form.value = await getSenderProfile(); await loadLibrary() } catch { toast.error('Could not load your profile') } finally { loading.value = false }
})
async function save() {
  saving.value = true
  try { form.value = await saveSenderProfile(form.value); toast.success('Sender profile saved') } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not save') } finally { saving.value = false }
}
const FIELDS: { key: keyof SenderProfile, label: string, ph: string, merge: string }[] = [
  { key: 'displayName', label: 'Name', ph: 'Shams Zia', merge: 'senderName' },
  { key: 'title', label: 'Title', ph: 'Owner', merge: 'senderTitle' },
  { key: 'company', label: 'Company', ph: 'ZRZ OPS LLC', merge: 'senderCompany' },
  { key: 'phone', label: 'Direct phone', ph: '(203) 535-7655', merge: 'senderPhone' },
  { key: 'email', label: 'Email shown in signature', ph: 'szia@turbocleanusa.com', merge: 'senderEmail' },
  { key: 'tagline', label: 'Tagline', ph: 'DEALERSHIP RECONDITIONING · INVENTORY MERCHANDISING · MONITORING', merge: 'senderTagline' },
  { key: 'region', label: 'Region', ph: 'Connecticut & Massachusetts', merge: 'senderRegion' },
]
</script>

<template>
  <div class="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5 max-w-5xl">
    <section class="rounded-xl border bg-card">
      <header class="px-5 py-3.5 border-b"><h3 class="font-semibold text-sm flex items-center gap-2"><UserRound class="size-4 text-muted-foreground" /> My sender profile</h3><p class="text-[11px] text-muted-foreground">Used in your emails' “From” name and in templates' contact block.</p></header>
      <div v-if="loading" class="p-8 flex justify-center"><Loader2 class="size-5 animate-spin text-muted-foreground" /></div>
      <form v-else class="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4" @submit.prevent="save">
        <div v-for="f in FIELDS" :key="f.key" class="space-y-1.5" :class="(f.key === 'tagline') && 'sm:col-span-2'">
          <Label class="text-xs">{{ f.label }} <code class="text-[10px] text-muted-foreground font-normal ml-1">{{ '{' + '{' + f.merge + '}' + '}' }}</code></Label>
          <Input v-model="form[f.key]" :placeholder="f.ph" />
        </div>
        <div class="sm:col-span-2 flex justify-end"><Button type="submit" :disabled="saving" class="min-w-28"><Loader2 v-if="saving" class="size-4 animate-spin" /><span v-else>Save profile</span></Button></div>
      </form>
    </section>

    <section class="rounded-xl border bg-card h-fit">
      <header class="px-5 py-3.5 border-b"><h3 class="font-semibold text-sm flex items-center gap-2"><Server class="size-4 text-muted-foreground" /> Sending setup</h3></header>
      <ul v-if="config" class="p-5 space-y-3 text-sm">
        <li class="flex items-start gap-2"><component :is="config.canSend ? CheckCircle2 : AlertTriangle" class="size-4 mt-0.5 shrink-0" :class="config.canSend ? 'text-emerald-600' : 'text-rose-600'" /><span>Resend API key {{ config.canSend ? 'configured' : 'missing (RESEND_API_KEY)' }}</span></li>
        <li class="flex items-start gap-2"><CheckCircle2 class="size-4 mt-0.5 shrink-0 text-emerald-600" /><span>Sending from <b>{{ config.fromEmail }}</b></span></li>
        <li class="flex items-start gap-2"><component :is="config.replyTracking === 'reply-address' ? CheckCircle2 : AlertTriangle" class="size-4 mt-0.5 shrink-0" :class="config.replyTracking === 'reply-address' ? 'text-emerald-600' : 'text-amber-600'" /><span>{{ config.replyTracking === 'reply-address' ? 'Replies matched exactly (per-email reply address)' : 'Replies matched by thread / sender — set CRM_REPLY_DOMAIN for exact matching' }}</span></li>
        <li class="flex items-start gap-2"><component :is="config.webhookSigned ? CheckCircle2 : AlertTriangle" class="size-4 mt-0.5 shrink-0" :class="config.webhookSigned ? 'text-emerald-600' : 'text-amber-600'" /><span>{{ config.webhookSigned ? 'Webhook signatures verified' : 'Webhook not verified — set RESEND_WEBHOOK_SECRET' }}</span></li>
      </ul>
    </section>
  </div>
</template>
