<script setup lang="ts">
import type { CrmEmail } from '~/composables/useCrmEmail'
import { Loader2, Search, MailOpen, MousePointerClick, CheckCheck, FileDown } from 'lucide-vue-next'
import { format } from 'date-fns'
import { EMAIL_OUTCOMES, EMAIL_STATUS_STYLE, SENTIMENT_STYLE } from '~/constants/crm'

/** Every email sent from the CRM, with its tracking — one row per email. */
const { listEmails, templates, campaigns } = useCrmEmail()
const search = ref('')
const q = refDebounced(search, 300)
const status = ref('all')
const campaignId = ref('all')
const templateId = ref('all')
const rows = ref<CrmEmail[]>([])
const loading = ref(false)
async function load() {
  loading.value = true
  try {
    rows.value = await listEmails({
      direction: 'outbound', limit: 1000, search: q.value || undefined,
      status: status.value === 'all' ? undefined : status.value,
      campaignId: campaignId.value === 'all' ? undefined : campaignId.value,
      templateId: templateId.value === 'all' ? undefined : templateId.value,
    })
  } finally { loading.value = false }
}
watch([q, status, campaignId, templateId], load, { immediate: true })

function exportCsv() {
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['Date', 'Time', 'Dealership', 'Contact', 'Recipient', 'Subject', 'Template', 'Version', 'Subject line', 'Edited', 'Campaign', 'First / follow-up', 'Follow-up #', 'Sent by', 'Status', 'Delivered', 'Bounced', 'Opened (reported)', 'Clicked (reported)', 'Replied', 'Reply sentiment', 'Conversation', 'Meeting', 'Opportunity', 'Proposal', 'Won']
  const lines = rows.value.map(e => [format(new Date(e.sentAt), 'yyyy-MM-dd'), format(new Date(e.sentAt), 'HH:mm'), e.dealershipName, e.contactName, e.toEmail, e.subject, e.templateName, e.templateVersionLabel || e.templateVersion, e.subjectVariant, e.templateEdited ? 'yes' : '', e.campaignName,
    e.followUpNumber ? 'Follow-up' : 'First email', e.followUpNumber, e.sentBy?.name, e.status, e.deliveredAt || '', e.bouncedAt || '', e.openedAt ? 'Yes' : '', e.clickedAt ? 'Yes' : '', e.repliedAt || '', e.replySentiment || '',
    ...EMAIL_OUTCOMES.map(o => e.outcomes?.[o.key] ? 'Yes' : '')].map(esc).join(','))
  const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `crm_emails_${format(new Date(), 'yyyy-MM-dd')}.csv` })
  a.click(); URL.revokeObjectURL(a.href)
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative"><Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" /><Input v-model="search" placeholder="Search subject, recipient, dealership…" class="h-8 w-64 pl-8 text-xs" /></div>
      <Select v-model="status">
        <SelectTrigger class="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem v-for="(s, k) in EMAIL_STATUS_STYLE" :key="k" :value="k">{{ s.label }}</SelectItem></SelectContent>
      </Select>
      <Select v-model="templateId">
        <SelectTrigger class="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent class="max-h-72"><SelectItem value="all">All templates</SelectItem><SelectItem v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</SelectItem></SelectContent>
      </Select>
      <Select v-model="campaignId">
        <SelectTrigger class="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent class="max-h-72"><SelectItem value="all">All campaigns</SelectItem><SelectItem v-for="c in campaigns" :key="c.id" :value="c.id">{{ c.name }}</SelectItem></SelectContent>
      </Select>
      <Loader2 v-if="loading" class="size-4 animate-spin text-muted-foreground" />
      <span class="ml-auto text-xs text-muted-foreground">{{ rows.length }} email{{ rows.length === 1 ? '' : 's' }}</span>
      <Button variant="outline" size="sm" class="h-8 gap-1.5 text-xs" :disabled="!rows.length" @click="exportCsv"><FileDown class="size-3.5" /> CSV</Button>
    </div>

    <div class="rounded-xl border bg-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th class="text-left font-medium px-3 py-2">Sent</th>
            <th class="text-left font-medium px-3 py-2">Dealership / contact</th>
            <th class="text-left font-medium px-3 py-2">Subject</th>
            <th class="text-left font-medium px-3 py-2">Template · campaign</th>
            <th class="text-left font-medium px-3 py-2">Sequence</th>
            <th class="text-left font-medium px-3 py-2">Status</th>
            <th class="text-left font-medium px-3 py-2">Result</th>
          </tr>
        </thead>
        <tbody class="divide-y">
          <tr v-for="e in rows" :key="e.id" class="hover:bg-muted/30 cursor-pointer align-top" @click="navigateTo(`/crm/dealership/${e.dealershipId}?tab=emails`)">
            <td class="px-3 py-2.5 whitespace-nowrap text-xs tabular-nums">{{ format(new Date(e.sentAt), 'MMM d, yyyy') }}<br><span class="text-muted-foreground">{{ format(new Date(e.sentAt), 'h:mm a') }} · {{ e.sentBy?.name }}</span></td>
            <td class="px-3 py-2.5 text-xs"><span class="font-medium text-sm">{{ e.dealershipName }}</span><br><span class="text-muted-foreground">{{ e.contactName || '—' }} · {{ e.toEmail }}</span></td>
            <td class="px-3 py-2.5 max-w-[260px]"><span class="line-clamp-2">{{ e.subject }}</span></td>
            <td class="px-3 py-2.5 text-xs text-muted-foreground">{{ e.templateName ? `${e.templateName} ${e.templateVersionLabel || `V${e.templateVersion}`}${e.subjectVariant ? ` · ${e.subjectVariant}` : ''}${e.templateEdited ? ' (edited)' : ''}` : '—' }}<br>{{ e.campaignName || '' }}</td>
            <td class="px-3 py-2.5 text-xs whitespace-nowrap">{{ e.followUpNumber ? `Follow-up #${e.followUpNumber}` : 'First email' }}</td>
            <td class="px-3 py-2.5 whitespace-nowrap">
              <Badge variant="outline" class="text-[10px]" :class="EMAIL_STATUS_STYLE[e.status || 'sent']?.cls">{{ EMAIL_STATUS_STYLE[e.status || 'sent']?.label }}</Badge>
              <span class="ml-1 inline-flex gap-1 text-muted-foreground align-middle">
                <MailOpen v-if="e.openedAt" class="size-3.5" title="Opened (reported)" /><MousePointerClick v-if="e.clickedAt" class="size-3.5" title="Clicked (reported)" />
              </span>
            </td>
            <td class="px-3 py-2.5">
              <div class="flex flex-wrap gap-1">
                <Badge v-if="e.repliedAt" variant="outline" class="text-[10px] gap-1 bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25"><CheckCheck class="size-3" />Replied</Badge>
                <Badge v-if="e.replySentiment" variant="outline" class="text-[10px]" :class="SENTIMENT_STYLE[e.replySentiment]?.cls">{{ SENTIMENT_STYLE[e.replySentiment]?.label }}</Badge>
                <Badge v-for="o in EMAIL_OUTCOMES.filter(o => e.outcomes?.[o.key])" :key="o.key" variant="outline" class="text-[10px] bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25">{{ o.label }}</Badge>
                <span v-if="!e.repliedAt" class="text-[11px] text-muted-foreground">No reply</span>
              </div>
            </td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="7" class="px-3 py-10 text-center text-sm text-muted-foreground">No emails match.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
