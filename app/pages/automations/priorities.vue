<script setup lang="ts">
import type { PriorityRow } from '~/composables/useAutomations'
import { TIER_STYLE, ago } from '~/composables/useAutomations'
import { RefreshCw, Loader2, Flame, ArrowRight, Phone, Mail, Search, UserPlus, Send, CalendarCheck, FileText, ClipboardCheck, ListTodo, Moon, Inbox, Info, ChevronDown } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * Priorities — automations 12 & 13. Every open dealership scored 0–100 with the reasons,
 * and the single most useful next step. Click the step to do it.
 */
const { setHeader } = usePageHeader()
setHeader({ title: 'Priorities', description: 'Automations · best opportunities first, with the next step for each', icon: 'i-lucide-flame' })

const route = useRoute()
const { loadPriorities } = useAutomations()
const tier = ref<string>(typeof route.query.tier === 'string' ? route.query.tier : 'all')
const owner = useLocalStorage<string>('automations-priorities-owner', 'all')
const search = ref('')
const rows = ref<PriorityRow[]>([])
const totals = ref<Record<string, number>>({})
const learning = ref<any[]>([])
const loading = ref(false)
async function reload(quiet = true) {
  loading.value = true
  try { const r = await loadPriorities(tier.value, owner.value === 'all' ? '' : owner.value); rows.value = r.rows; totals.value = r.totals; learning.value = r.learning; if (!quiet) toast.success('Recalculated') }
  catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not load priorities') }
  finally { loading.value = false }
}
watch([tier, owner], () => reload(), { immediate: true })

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q ? rows.value.filter(r => `${r.name} ${r.code} ${r.city} ${r.state} ${r.contact?.name || ''}`.toLowerCase().includes(q)) : rows.value
})
const ICON: Record<string, any> = { research: Search, contact: UserPlus, approve: Inbox, email: Mail, call: Phone, meeting: CalendarCheck, proposal: FileText, review: ClipboardCheck, plan: ListTodo, revisit: Moon }
const DUE: Record<string, string> = { now: 'text-rose-600 dark:text-rose-400', today: 'text-amber-600 dark:text-amber-400', soon: 'text-foreground', later: 'text-muted-foreground' }
const DUE_LABEL: Record<string, string> = { now: 'Now', today: 'Today', soon: 'Soon', later: 'Later' }
const openRow = ref<string | null>(null)
const pctTone = (p: number | null) => p == null ? 'text-muted-foreground' : p >= 25 ? 'text-rose-600' : p >= 10 ? 'text-amber-600' : 'text-emerald-600'
</script>

<template>
  <div class="space-y-4">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <Select v-model="owner">
          <SelectTrigger class="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Everyone</SelectItem><SelectItem value="mine">Mine</SelectItem></SelectContent>
        </Select>
        <Button variant="outline" size="icon" class="size-8" aria-label="Recalculate" :disabled="loading" @click="reload(false)"><RefreshCw class="size-4" :class="loading && 'animate-spin'" /></Button>
      </Teleport>
    </ClientOnly>

    <div class="flex flex-wrap items-center gap-2">
      <button v-for="t in ['all', 'Hot', 'Warm', 'Cool']" :key="t" type="button" class="rounded-full border px-3 py-1 text-xs inline-flex items-center gap-1.5" :class="tier === t ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'" @click="tier = t">
        <Flame v-if="t === 'Hot'" class="size-3.5" />{{ t === 'all' ? 'All open' : t }} <span class="tabular-nums opacity-70">{{ t === 'all' ? totals.all || 0 : totals[t] || 0 }}</span>
      </button>
      <span class="text-xs text-muted-foreground ml-1">{{ totals.needToday || 0 }} need a step today</span>
      <Input v-model="search" placeholder="Search dealership, city, contact…" class="ml-auto h-8 w-64 text-xs" />
    </div>

    <div v-if="loading && !rows.length" class="flex items-center justify-center py-20 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Scoring dealerships…</div>
    <div v-else class="rounded-xl border bg-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/30">
          <tr>
            <th class="text-left font-medium px-4 py-2 w-16">Score</th>
            <th class="text-left font-medium px-2 py-2">Dealership</th>
            <th class="text-right font-medium px-2 py-2">Missing photos</th>
            <th class="text-right font-medium px-2 py-2">Vehicles</th>
            <th class="text-left font-medium px-2 py-2">Last touch</th>
            <th class="text-left font-medium px-2 py-2">Suggested next step</th>
            <th class="w-8" />
          </tr>
        </thead>
        <tbody class="divide-y">
          <template v-for="r in filtered" :key="r.id">
            <tr class="hover:bg-muted/30 cursor-pointer" @click="openRow = openRow === r.id ? null : r.id">
              <td class="px-4 py-2.5">
                <span class="inline-flex items-center justify-center min-w-9 rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ring-1" :class="TIER_STYLE[r.tier]" :title="r.tier">{{ r.score }}</span>
              </td>
              <td class="px-2 py-2.5 min-w-[220px]">
                <NuxtLink :to="`/crm/dealership/${r.id}`" class="font-medium hover:underline" @click.stop>{{ r.name }}</NuxtLink>
                <p class="text-[11px] text-muted-foreground">{{ r.stage }}<span v-if="r.city || r.state"> · {{ [r.city, r.state].filter(Boolean).join(', ') }}</span><span v-if="r.contact"> · {{ r.contact.name }}<span v-if="r.contact.title">, {{ r.contact.title }}</span></span></p>
              </td>
              <td class="px-2 py-2.5 text-right tabular-nums" :class="pctTone(r.missingPhotoPct)">{{ r.missingPhotoPct == null ? '—' : `${r.missingPhotoPct}%` }}</td>
              <td class="px-2 py-2.5 text-right tabular-nums">{{ r.totalVehicles ?? '—' }}</td>
              <td class="px-2 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{{ ago(r.lastActivityAt) }}</td>
              <td class="px-2 py-2.5 min-w-[260px]">
                <NuxtLink :to="r.next.link" class="group inline-flex items-start gap-2" @click.stop>
                  <component :is="ICON[r.next.type] || ListTodo" class="size-4 mt-0.5 shrink-0" :class="DUE[r.next.due]" />
                  <span>
                    <span class="text-sm group-hover:underline">{{ r.next.action }}</span>
                    <span class="block text-[11px] text-muted-foreground"><span :class="DUE[r.next.due]" class="font-medium">{{ DUE_LABEL[r.next.due] }}</span> · {{ r.next.why }}</span>
                  </span>
                </NuxtLink>
              </td>
              <td class="pr-3"><ChevronDown class="size-4 text-muted-foreground transition-transform" :class="openRow === r.id && 'rotate-180'" /></td>
            </tr>
            <tr v-if="openRow === r.id" class="bg-muted/20">
              <td colspan="7" class="px-4 py-3">
                <p class="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Why it scores {{ r.score }}</p>
                <div class="flex flex-wrap gap-1.5">
                  <span v-for="x in r.reasons" :key="x" class="rounded-md px-2 py-0.5 text-[11px]" :class="x.startsWith('-') ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'">{{ x }}</span>
                </div>
                <div v-if="r.contact" class="mt-2 flex flex-wrap gap-3 text-xs">
                  <a v-if="r.contact.phone" :href="`tel:${r.contact.phone}`" class="inline-flex items-center gap-1 text-primary"><Phone class="size-3.5" /> {{ r.contact.phone }}</a>
                  <a v-if="r.contact.email" :href="`mailto:${r.contact.email}`" class="inline-flex items-center gap-1 text-primary"><Mail class="size-3.5" /> {{ r.contact.email }}</a>
                  <NuxtLink :to="`/crm/dealership/${r.id}`" class="inline-flex items-center gap-1 text-primary">Open dealership <ArrowRight class="size-3.5" /></NuxtLink>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="!filtered.length"><td colspan="7" class="px-4 py-10 text-center text-muted-foreground text-sm">No open dealerships match.</td></tr>
        </tbody>
      </table>
    </div>

    <div class="rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">
      <Info class="size-4 shrink-0 mt-0.5" />
      <div class="space-y-1">
        <p>Score = opportunity (missing-photo % and inventory size) + engagement (replies, conversations, meetings, proposals) + recent activity + a reachable contact, plus a bonus when similar dealerships have booked meetings more often. Hot ≥ 70, Warm 45–69.</p>
        <p v-if="learning.length">Learned so far: <span v-for="(l, i) in learning" :key="l.band">{{ i ? ' · ' : '' }}{{ l.band }} missing photos → {{ l.meetingRate }}% meetings vs {{ l.average }}% average ({{ l.bonus > 0 ? '+' : '' }}{{ l.bonus }})</span></p>
        <p v-else>The “what worked before” bonus switches on once 10+ contacted dealerships fall in the same missing-photo band.</p>
      </div>
    </div>
  </div>
</template>
