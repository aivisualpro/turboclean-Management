<script setup lang="ts">
import { BarChart3, Inbox, Send, FileText, Megaphone, FlaskConical, Settings2 } from 'lucide-vue-next'

const { setHeader } = usePageHeader()
setHeader({ title: 'Email', description: 'CRM · acquisition emails — replies, conversations, meetings, proposals, wins', icon: 'i-lucide-mail' })

const route = useRoute()
const router = useRouter()
const TABS = [
  { key: 'performance', label: 'Performance', icon: BarChart3 },
  { key: 'experiments', label: 'Template experiments', icon: FlaskConical },
  { key: 'replies', label: 'Replies', icon: Inbox },
  { key: 'sent', label: 'Sent', icon: Send },
  { key: 'templates', label: 'Templates', icon: FileText },
  { key: 'campaigns', label: 'Campaigns', icon: Megaphone },
  { key: 'settings', label: 'Settings', icon: Settings2 },
] as const
const tab = ref<string>(TABS.some(t => t.key === route.query.tab) ? String(route.query.tab) : 'performance')
watch(tab, async (v) => {
  await router.replace({ query: { ...route.query, tab: v === 'performance' ? undefined : v } })
  setHeader({ title: 'Email', description: 'CRM · acquisition emails — replies, conversations, meetings, proposals, wins', icon: 'i-lucide-mail' })
})

const { getStats, loadLibrary } = useCrmEmail()
const reviewCount = ref(0)
async function refreshCounts() {
  try { const s = await getStats({ groupBy: 'none' }); reviewCount.value = s.unclassifiedReplies + s.unmatchedReplies } catch {}
}
onMounted(() => { refreshCounts(); loadLibrary().catch(() => {}) })
</script>

<template>
  <div class="space-y-5">
    <nav class="flex gap-1 border-b -mt-1 overflow-x-auto" aria-label="Email sections">
      <button v-for="t in TABS" :key="t.key" type="button" class="inline-flex items-center gap-2 px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap"
        :class="tab === t.key ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'" :aria-current="tab === t.key ? 'page' : undefined" @click="tab = t.key">
        <component :is="t.icon" class="size-4" />{{ t.label }}
        <span v-if="t.key === 'replies' && reviewCount" class="rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[10px] tabular-nums leading-none font-semibold">{{ reviewCount }}</span>
      </button>
    </nav>
    <ClientOnly>
      <CrmEmailPerformanceTab v-if="tab === 'performance'" @go="tab = $event" />
      <CrmEmailRepliesTab v-else-if="tab === 'replies'" @changed="refreshCounts" />
      <CrmEmailSentTab v-else-if="tab === 'sent'" />
      <CrmEmailTemplatesTab v-else-if="tab === 'templates'" />
      <CrmEmailCampaignsTab v-else-if="tab === 'campaigns'" />
      <CrmEmailExperimentsTab v-else-if="tab === 'experiments'" />
      <CrmEmailSettingsTab v-else-if="tab === 'settings'" />
    </ClientOnly>
  </div>
</template>
