<script setup lang="ts">
import type { CrmEmail } from '~/composables/useCrmEmail'
import { Loader2, ThumbsUp, ThumbsDown, Minus, ArrowUpRight, Link2, Search, CheckCircle2, Inbox } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format, formatDistanceToNow } from 'date-fns'
import { SENTIMENT_STYLE } from '~/constants/crm'

/** Replies waiting for a rep: classify sentiment, or attach mail we could not match to a dealership. */
const emit = defineEmits<{ changed: [] }>()
const { listEmails, updateEmail } = useCrmEmail()
const { dealerships, fetchDealerships } = useCrmDealerships()

const view = ref<'review' | 'unmatched' | 'all'>('review')
const items = ref<CrmEmail[]>([])
const loading = ref(false)
async function load() {
  loading.value = true
  try {
    const q = view.value === 'review' ? { needsReview: '1' } : view.value === 'unmatched' ? { unmatched: '1' } : { direction: 'inbound', limit: 300 }
    items.value = await listEmails(q)
  } catch { toast.error('Could not load replies') } finally { loading.value = false }
}
watch(view, load, { immediate: true })

const busy = ref<string | null>(null)
const SENT_ICONS = { positive: ThumbsUp, neutral: Minus, negative: ThumbsDown } as const
async function classify(r: CrmEmail, s: 'positive' | 'neutral' | 'negative') {
  busy.value = r.id
  try {
    const updated = await updateEmail(r.id, { sentiment: r.sentiment === s ? null : s })
    if (view.value === 'review' && updated.sentiment) items.value = items.value.filter(x => x.id !== r.id)
    else items.value = items.value.map(x => x.id === r.id ? { ...x, sentiment: updated.sentiment } : x)
    emit('changed')
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not update') } finally { busy.value = null }
}

// ─── Attach unmatched ───
const attachFor = ref<CrmEmail | null>(null)
const attachSearch = ref('')
async function openAttach(r: CrmEmail) {
  attachFor.value = r
  const domain = r.fromEmail.split('@')[1] || ''
  attachSearch.value = domain && !/gmail|yahoo|outlook|hotmail|icloud|aol/i.test(domain) ? domain.split('.')[0]! : ''
  if (!dealerships.value.length) await fetchDealerships().catch(() => {})
}
const matches = computed(() => {
  const n = attachSearch.value.trim().toLowerCase()
  const list = dealerships.value.filter(d => !n || [d.name, d.dealershipId, d.website, d.city, d.contactSummary?.primary?.email].join(' ').toLowerCase().includes(n))
  return list.slice(0, 8)
})
async function attach(dealershipId: string) {
  const r = attachFor.value
  if (!r) return
  busy.value = r.id
  try {
    await updateEmail(r.id, { dealershipId })
    toast.success('Reply attached to the dealership')
    items.value = items.value.filter(x => x.id !== r.id)
    attachFor.value = null
    emit('changed')
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not attach') } finally { busy.value = null }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <div class="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
        <button v-for="v in [{ k: 'review', l: 'To classify' }, { k: 'unmatched', l: 'Unmatched' }, { k: 'all', l: 'All replies' }]" :key="v.k" type="button" class="rounded-md px-2.5 py-1 text-xs font-medium" :class="view === v.k ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'" @click="view = v.k as any">{{ v.l }}</button>
      </div>
      <Loader2 v-if="loading" class="size-4 animate-spin text-muted-foreground" />
      <p class="text-[11px] text-muted-foreground ml-auto">{{ view === 'review' ? 'Mark each reply positive, neutral or negative — that is what the reports count.' : view === 'unmatched' ? 'Replies to the CRM address we could not tie to a dealership.' : '' }}</p>
    </div>

    <div v-if="!loading && !items.length" class="rounded-xl border-2 border-dashed py-12 flex flex-col items-center text-center">
      <CheckCircle2 class="size-8 text-emerald-500/70" />
      <p class="mt-2 font-semibold text-sm">{{ view === 'review' ? 'All replies classified' : view === 'unmatched' ? 'Nothing unmatched' : 'No replies yet' }}</p>
    </div>

    <ul class="space-y-3">
      <li v-for="r in items" :key="r.id" class="rounded-xl border bg-card px-4 py-3">
        <div class="flex flex-wrap items-start gap-2">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold truncate">{{ r.subject }}</p>
            <p class="text-[11px] text-muted-foreground mt-0.5">
              {{ r.contactName || r.fromName || r.fromEmail }} &lt;{{ r.fromEmail }}&gt; · {{ format(new Date(r.receivedAt || r.sentAt), 'MMM d, h:mm a') }} ({{ formatDistanceToNow(new Date(r.receivedAt || r.sentAt), { addSuffix: true }) }})
            </p>
          </div>
          <NuxtLink v-if="r.dealershipId" :to="`/crm/dealership/${r.dealershipId}?tab=emails`" class="text-xs text-primary hover:underline underline-offset-2 inline-flex items-center gap-1 shrink-0">{{ r.dealershipName }} <ArrowUpRight class="size-3" /></NuxtLink>
          <Button v-else size="sm" variant="outline" class="h-7 gap-1.5 text-xs" @click="openAttach(r)"><Link2 class="size-3.5" /> Attach to dealership</Button>
        </div>
        <p class="mt-2 text-sm whitespace-pre-wrap leading-relaxed">{{ r.snippet || r.bodyText }}</p>
        <div v-if="r.dealershipId" class="mt-2.5 flex items-center gap-1.5">
          <button v-for="s in (['positive', 'neutral', 'negative'] as const)" :key="s" type="button" class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors"
            :class="r.sentiment === s ? SENTIMENT_STYLE[s]?.cls + ' font-semibold' : 'text-muted-foreground hover:bg-muted'" :disabled="busy === r.id" @click="classify(r, s)">
            <component :is="SENT_ICONS[s]" class="size-3.5" />{{ SENTIMENT_STYLE[s]?.label }}
          </button>
          <Loader2 v-if="busy === r.id" class="size-4 animate-spin text-muted-foreground" />
          <span v-if="r.matchedBy" class="ml-auto text-[10px] text-muted-foreground">matched by {{ { 'reply-address': 'reply address', headers: 'email thread', sender: 'sender address', contact: 'contact email', manual: 'hand' }[r.matchedBy] || r.matchedBy }}</span>
        </div>
      </li>
    </ul>

    <Dialog :open="!!attachFor" @update:open="(o: boolean) => { if (!o) attachFor = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Attach reply to a dealership</DialogTitle>
          <DialogDescription class="text-xs">From {{ attachFor?.fromEmail }} — “{{ attachFor?.subject }}”. It will appear in that dealership's emails and history.</DialogDescription>
        </DialogHeader>
        <div class="relative"><Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" /><Input v-model="attachSearch" placeholder="Search dealerships…" class="pl-8" /></div>
        <ul class="max-h-72 overflow-y-auto divide-y rounded-lg border">
          <li v-for="d in matches" :key="d.id">
            <button type="button" class="w-full text-left px-3 py-2 hover:bg-muted text-sm flex items-center gap-2" :disabled="busy === attachFor?.id" @click="attach(d.id)">
              <span class="font-medium truncate">{{ d.name }}</span><span class="text-[11px] text-muted-foreground">{{ d.dealershipId }} · {{ d.city }}</span>
            </button>
          </li>
          <li v-if="!matches.length" class="px-3 py-4 text-xs text-muted-foreground text-center"><Inbox class="size-4 inline" /> No dealerships match.</li>
        </ul>
      </DialogContent>
    </Dialog>
  </div>
</template>
