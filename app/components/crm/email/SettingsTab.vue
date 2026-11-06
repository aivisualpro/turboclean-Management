<script setup lang="ts">
import type { SenderProfile } from '~/composables/useCrmEmail'
import { Loader2, UserRound, Server, CheckCircle2, AlertTriangle, XCircle, MailCheck, RefreshCw, LineChart } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/** Your sender profile (the signature block templates use) + a read-only view of the sending setup. */
const { getSenderProfile, saveSenderProfile, config, loadLibrary, getDeliverability } = useCrmEmail()
// Inbox placement: SPF / DKIM / DMARC / bounces / complaints / volume
const dl = ref<Awaited<ReturnType<typeof getDeliverability>> | null>(null)
const checking = ref(false)
async function check() {
  checking.value = true
  try { dl.value = await getDeliverability() } catch { toast.error('Could not check the sending domain') } finally { checking.value = false }
}
onMounted(check)
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
// Reports & emails: where the "over time" chart appears (team-wide, saved on change).
type ReportSettings = { historyChartInReport: boolean, historyChartInEmail: boolean, onePointPerDay: boolean }
const rs = ref<ReportSettings | null>(null)
const rsSaving = ref(false)
onMounted(async () => { try { rs.value = (await $fetch<{ settings: ReportSettings }>('/api/crm/email/report-settings')).settings } catch {} })
async function setRs(k: keyof ReportSettings, v: boolean) {
  if (!rs.value) return
  const before = rs.value[k]
  rs.value = { ...rs.value, [k]: v }
  rsSaving.value = true
  try { rs.value = (await $fetch<{ settings: ReportSettings }>('/api/crm/email/report-settings', { method: 'PUT', body: { [k]: v } })).settings; toast.success('Saved', { description: 'Applies to every report and email from now on — including reports already stored.' }) }
  catch (e: any) { rs.value = { ...rs.value!, [k]: before }; toast.error(e?.data?.statusMessage || 'Could not save') } finally { rsSaving.value = false }
}
const RS_ROWS: { k: keyof ReportSettings, label: string, hint: string }[] = [
  { k: 'historyChartInReport', label: 'Show the over-time chart in the PDF / dealer report', hint: '“Pre-owned listings without a real photo, over time” line chart.' },
  { k: 'historyChartInEmail', label: 'Show the over-time chart in emails', hint: 'The bars inside {{auditTrend}} and the {{auditHistoryChart}} block. Off → both are left out.' },
  { k: 'onePointPerDay', label: 'One point per day', hint: 'Several crawls on the same day count once (the last one) — no “Nov 6, Nov 6, Nov 6”.' },
]
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

    <div class="space-y-5">
    <section class="rounded-xl border bg-card h-fit">
      <header class="px-5 py-3.5 border-b"><h3 class="font-semibold text-sm flex items-center gap-2"><LineChart class="size-4 text-muted-foreground" /> Reports &amp; emails</h3><p class="text-[11px] text-muted-foreground">Where the “over time” chart appears. For the whole team.</p></header>
      <div v-if="!rs" class="p-6 flex justify-center"><Loader2 class="size-5 animate-spin text-muted-foreground" /></div>
      <ul v-else class="p-5 space-y-4">
        <li v-for="row in RS_ROWS" :key="row.k" class="flex items-start gap-3">
          <div class="min-w-0 flex-1"><p class="text-sm font-medium leading-snug">{{ row.label }}</p><p class="text-[11px] text-muted-foreground mt-0.5">{{ row.hint }}</p></div>
          <Switch :model-value="rs[row.k]" :disabled="rsSaving" @update:model-value="(v: boolean) => setRs(row.k, v)" />
        </li>
      </ul>
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

    <section class="rounded-xl border bg-card h-fit">
      <header class="px-5 py-3.5 border-b flex items-center gap-2">
        <h3 class="font-semibold text-sm flex items-center gap-2"><MailCheck class="size-4 text-muted-foreground" /> Inbox placement</h3>
        <Button variant="ghost" size="sm" class="h-7 ml-auto gap-1 text-xs" :disabled="checking" @click="check"><RefreshCw class="size-3.5" :class="checking && 'animate-spin'" /> Check</Button>
      </header>
      <div v-if="!dl" class="p-8 flex justify-center"><Loader2 class="size-5 animate-spin text-muted-foreground" /></div>
      <div v-else class="p-5 space-y-4">
        <div class="flex items-center gap-3">
          <div class="relative size-14 shrink-0">
            <svg viewBox="0 0 36 36" class="size-14 -rotate-90"><circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" class="text-muted" stroke-width="3" /><circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" :class="dl.score >= 85 ? 'text-emerald-500' : dl.score >= 65 ? 'text-amber-500' : 'text-rose-500'" stroke-width="3" stroke-linecap="round" :stroke-dasharray="`${(dl.score / 100) * 97.4} 97.4`" /></svg>
            <span class="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums">{{ dl.score }}</span>
          </div>
          <div class="min-w-0"><p class="text-sm font-semibold">{{ dl.score >= 85 ? 'Ready for the inbox' : dl.score >= 65 ? 'Almost there' : 'Fix these before sending' }}</p><p class="text-[11px] text-muted-foreground truncate">{{ dl.domain }} · checked just now</p></div>
        </div>
        <ul class="space-y-2.5">
          <li v-for="i in dl.items" :key="i.key" class="flex gap-2 text-xs">
            <CheckCircle2 v-if="i.status === 'ok'" class="size-4 shrink-0 text-emerald-600" /><AlertTriangle v-else-if="i.status === 'warn'" class="size-4 shrink-0 text-amber-600" /><XCircle v-else class="size-4 shrink-0 text-rose-600" />
            <div class="min-w-0"><p class="font-medium">{{ i.label }}</p><p class="text-muted-foreground break-words">{{ i.detail }}</p><p v-if="i.fix" class="mt-0.5 text-foreground/80">→ {{ i.fix }}</p></div>
          </li>
        </ul>
      </div>
    </section>
    </div>
  </div>
</template>
