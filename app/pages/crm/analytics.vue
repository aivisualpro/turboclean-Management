<script setup lang="ts">
import { RefreshCw, Loader2, Lightbulb, AlertCircle, Mail, Phone, Footprints } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format, startOfQuarter, startOfYear, subDays } from 'date-fns'
import { money } from '~/composables/useCrmWon'
import { localDay } from '~/composables/useCrmDealerships'

/**
 * Performance analytics — compare what works by template, subject, market, brand, photos, role, channel…
 * Dealership comparisons use dealerships first contacted in the period (and how far each got);
 * email comparisons use emails sent in the period.
 */
const { setHeader } = usePageHeader()
setHeader({ title: 'Performance analytics', description: 'CRM · what actually produces meetings and dealerships', icon: 'i-lucide-chart-column' })
const { user: me } = useAuth()

const RANGES = [{ key: 'all', label: 'All time' }, { key: '90', label: 'Last 90 days' }, { key: 'quarter', label: 'This quarter' }, { key: 'year', label: 'This year' }, { key: 'custom', label: 'Custom' }] as const
const range = useLocalStorage<string>('crm-an-range', 'all')
const customFrom = ref(localDay(subDays(new Date(), 180)))
const customTo = ref(localDay(new Date()))
const scope = useLocalStorage<string>('crm-an-scope', 'all')
const dimension = useLocalStorage<string>('crm-an-dim', 'leadSource')
const emailDimension = useLocalStorage<string>('crm-an-edim', 'template')
const users = ref<{ id: string, name: string }[]>([])
onMounted(async () => { try { const res = await $fetch<any[]>('/api/users'); users.value = (res || []).filter(u => u.status !== 'Inactive').map(u => ({ id: u.id, name: u.name || u.email })).sort((a, b) => a.name.localeCompare(b.name)) } catch {} })
const period = computed(() => {
  const now = new Date()
  switch (range.value) {
    case '90': return { from: localDay(subDays(now, 89)), to: localDay(now) }
    case 'quarter': return { from: localDay(startOfQuarter(now)), to: localDay(now) }
    case 'year': return { from: localDay(startOfYear(now)), to: localDay(now) }
    case 'custom': return { from: customFrom.value, to: customTo.value }
    default: return { from: '', to: '' }
  }
})

const data = ref<any>(null)
const loading = ref(false)
async function load(quiet = true) {
  loading.value = true
  try {
    data.value = await $fetch('/api/crm/analytics', { query: { ...period.value, scope: scope.value, dimension: dimension.value, emailDimension: emailDimension.value } })
    if (!quiet) toast.success('Analytics refreshed')
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not load analytics') } finally { loading.value = false }
}
watch([period, scope, dimension, emailDimension], () => load(), { immediate: true })
const a = computed(() => data.value)

const best = (rows: any[], k: string) => Math.max(0, ...rows.filter(r => r.enough).map(r => r[k] ?? 0))
const rate = (v: number | null) => v == null ? '—' : `${v}%`
const CH_ICON: Record<string, any> = { email: Mail, call: Phone, visit: Footprints }
const tdMax = computed(() => Math.max(1, ...(a.value?.touchesToMeeting.distribution || []).map((x: any) => x.n)))
</script>

<template>
  <div class="space-y-5">
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <Button variant="outline" size="icon" class="size-9" aria-label="Refresh" :disabled="loading" @click="load(false)"><RefreshCw class="size-4" :class="loading && 'animate-spin'" /></Button>
      </Teleport>
    </ClientOnly>

    <div class="flex flex-wrap items-center gap-2">
      <div class="inline-flex rounded-lg border bg-muted/40 p-0.5">
        <button v-for="r in RANGES" :key="r.key" type="button" class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors" :class="range === r.key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'" @click="range = r.key">{{ r.label }}</button>
      </div>
      <template v-if="range === 'custom'">
        <Input v-model="customFrom" type="date" class="h-9 w-40 text-xs" aria-label="From" /><span class="text-xs text-muted-foreground">to</span><Input v-model="customTo" type="date" class="h-9 w-40 text-xs" aria-label="To" />
      </template>
      <Select v-model="scope">
        <SelectTrigger class="h-9 w-[170px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent class="max-h-72">
          <SelectItem value="all">Everyone</SelectItem>
          <SelectItem value="mine">Mine{{ (me as any)?.name ? ` (${(me as any).name})` : '' }}</SelectItem>
          <SelectItem v-for="u in users.filter(u => u.id !== (me as any)?.id)" :key="u.id" :value="u.id">{{ u.name }}</SelectItem>
        </SelectContent>
      </Select>
      <span v-if="a" class="text-xs text-muted-foreground">{{ a.base.contacted }} dealerships contacted · {{ a.base.emails }} emails · {{ a.base.meetings }} first meetings · {{ a.base.wins }} wins</span>
      <Loader2 v-if="loading && a" class="size-4 animate-spin text-muted-foreground" />
    </div>

    <div v-if="!a" class="flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 class="size-4 animate-spin" /> Crunching the numbers…</div>

    <template v-else>
      <!-- Answers -->
      <section class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <div v-for="i in a.insights" :key="i.question" class="rounded-xl border bg-card px-4 py-3" :class="!i.enough && 'bg-muted/20'">
          <p class="text-[11px] font-semibold text-muted-foreground flex items-start gap-1.5"><Lightbulb class="size-3.5 shrink-0 mt-px" :class="i.enough ? 'text-amber-500' : ''" /> {{ i.question }}</p>
          <p class="text-sm mt-1.5">{{ i.answer }}</p>
          <p v-if="!i.enough" class="text-[10px] text-muted-foreground mt-1 flex items-center gap-1"><AlertCircle class="size-3" /> Small sample — keep logging; this firms up over time.</p>
        </div>
      </section>

      <!-- Dealership comparisons -->
      <section class="rounded-xl border bg-card overflow-hidden">
        <header class="px-4 py-2.5 border-b space-y-2">
          <div>
            <h3 class="text-sm font-semibold">Compare dealerships by {{ a.dimensions[dimension]?.toLowerCase() }}</h3>
            <p class="text-[11px] text-muted-foreground">Dealerships first contacted in the period, and how far each one got. Groups under {{ a.minGroup }} dealerships are greyed out — too small to trust.</p>
          </div>
          <div class="flex flex-wrap gap-1">
            <button v-for="(lbl, k) in a.dimensions" :key="k" type="button" class="rounded-full border px-2.5 py-0.5 text-xs transition-colors" :class="dimension === k ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'" @click="dimension = String(k)">{{ lbl }}</button>
          </div>
        </header>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="border-b text-muted-foreground">
                <th class="text-left font-medium px-4 py-2">{{ a.dimensions[dimension] }}</th>
                <th class="text-right font-medium px-2 py-2">Contacted</th>
                <th class="text-right font-medium px-2 py-2">Replied</th>
                <th class="text-right font-medium px-2 py-2">Conversation</th>
                <th class="text-left font-medium px-2 py-2 w-[18%]">Meeting</th>
                <th class="text-right font-medium px-2 py-2">Proposal</th>
                <th class="text-right font-medium px-2 py-2">Won</th>
                <th class="text-right font-medium px-2 py-2">Annual revenue</th>
                <th class="text-right font-medium px-2 py-2">Revenue / hour</th>
                <th class="text-right font-medium px-4 py-2">Touches to meeting</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in a.byDealership" :key="r.key" class="border-b last:border-0 hover:bg-muted/30" :class="!r.enough && 'text-muted-foreground'">
                <td class="px-4 py-2 font-medium">{{ r.key }}</td>
                <td class="px-2 py-2 text-right tabular-nums">{{ r.n }}</td>
                <td class="px-2 py-2 text-right tabular-nums" :class="r.enough && r.replyRate === best(a.byDealership, 'replyRate') && r.replyRate ? 'font-semibold text-emerald-700 dark:text-emerald-400' : ''">{{ rate(r.replyRate) }}</td>
                <td class="px-2 py-2 text-right tabular-nums">{{ rate(r.conversationRate) }}</td>
                <td class="px-2 py-2">
                  <div class="flex items-center gap-2">
                    <div class="h-1.5 flex-1 rounded-full bg-muted overflow-hidden"><div class="h-full rounded-full" :class="r.enough ? 'bg-primary' : 'bg-muted-foreground/40'" :style="{ width: `${r.meetingRate || 0}%` }" /></div>
                    <span class="tabular-nums w-11 text-right" :class="r.enough && r.meetingRate === best(a.byDealership, 'meetingRate') && r.meetingRate ? 'font-semibold text-emerald-700 dark:text-emerald-400' : ''">{{ rate(r.meetingRate) }}</span>
                  </div>
                </td>
                <td class="px-2 py-2 text-right tabular-nums">{{ rate(r.proposalRate) }}</td>
                <td class="px-2 py-2 text-right tabular-nums" :class="r.enough && r.winRate === best(a.byDealership, 'winRate') && r.winRate ? 'font-semibold text-emerald-700 dark:text-emerald-400' : ''">{{ r.won }} <span class="text-muted-foreground">({{ rate(r.winRate) }})</span></td>
                <td class="px-2 py-2 text-right tabular-nums">{{ money(r.annualRevenue) }}</td>
                <td class="px-2 py-2 text-right tabular-nums">{{ r.revenuePerHour == null ? '—' : money(r.revenuePerHour) }}</td>
                <td class="px-4 py-2 text-right tabular-nums">{{ r.avgTouchesToMeeting ?? '—' }}</td>
              </tr>
              <tr v-if="!a.byDealership.length"><td colspan="10" class="px-4 py-8 text-center text-muted-foreground">No dealerships contacted in this period.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Email comparisons -->
      <section class="rounded-xl border bg-card overflow-hidden">
        <header class="px-4 py-2.5 border-b space-y-2">
          <div>
            <h3 class="text-sm font-semibold">Compare emails by {{ a.emailDimensions[emailDimension]?.toLowerCase() }}</h3>
            <p class="text-[11px] text-muted-foreground">Emails sent in the period and what each produced. Groups under 20 emails are greyed out. Times are in the CRM time zone.</p>
          </div>
          <div class="flex flex-wrap gap-1">
            <button v-for="(lbl, k) in a.emailDimensions" :key="k" type="button" class="rounded-full border px-2.5 py-0.5 text-xs transition-colors" :class="emailDimension === k ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'" @click="emailDimension = String(k)">{{ lbl }}</button>
          </div>
        </header>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="border-b text-muted-foreground">
                <th class="text-left font-medium px-4 py-2">{{ a.emailDimensions[emailDimension] }}</th>
                <th class="text-right font-medium px-2 py-2">Sent</th>
                <th class="text-left font-medium px-2 py-2 w-[18%]">Reply rate</th>
                <th class="text-right font-medium px-2 py-2">Positive</th>
                <th class="text-right font-medium px-2 py-2">Meeting</th>
                <th class="text-right font-medium px-2 py-2">Won</th>
                <th class="text-right font-medium px-4 py-2">Annual revenue</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in a.byEmail" :key="r.key" class="border-b last:border-0 hover:bg-muted/30" :class="!r.enough && 'text-muted-foreground'">
                <td class="px-4 py-2 font-medium max-w-[360px] truncate" :title="r.key">{{ r.key }}</td>
                <td class="px-2 py-2 text-right tabular-nums">{{ r.n }}</td>
                <td class="px-2 py-2">
                  <div class="flex items-center gap-2">
                    <div class="h-1.5 flex-1 rounded-full bg-muted overflow-hidden"><div class="h-full rounded-full" :class="r.enough ? 'bg-primary' : 'bg-muted-foreground/40'" :style="{ width: `${r.replyRate || 0}%` }" /></div>
                    <span class="tabular-nums w-11 text-right">{{ rate(r.replyRate) }}</span>
                  </div>
                </td>
                <td class="px-2 py-2 text-right tabular-nums">{{ rate(r.positiveRate) }}</td>
                <td class="px-2 py-2 text-right tabular-nums" :class="r.enough && r.meetingRate === best(a.byEmail, 'meetingRate') && r.meetingRate ? 'font-semibold text-emerald-700 dark:text-emerald-400' : ''">{{ r.meeting }} <span class="text-muted-foreground">({{ rate(r.meetingRate) }})</span></td>
                <td class="px-2 py-2 text-right tabular-nums">{{ r.won }}</td>
                <td class="px-4 py-2 text-right tabular-nums">{{ money(r.annualRevenue) }}</td>
              </tr>
              <tr v-if="!a.byEmail.length"><td colspan="7" class="px-4 py-8 text-center text-muted-foreground">No emails sent in this period.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        <!-- Channels -->
        <section class="xl:col-span-2 rounded-xl border bg-card overflow-hidden">
          <header class="px-4 py-2.5 border-b">
            <h3 class="text-sm font-semibold">Email vs call vs walk-in</h3>
            <p class="text-[11px] text-muted-foreground">Meetings and wins are credited to the last touch before the first meeting. Hours come from time tracking (walk-ins include driving).</p>
          </header>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b text-muted-foreground">
                  <th class="text-left font-medium px-4 py-2">Channel</th><th class="text-right font-medium px-2 py-2">Touches</th><th class="text-right font-medium px-2 py-2">Dealerships</th>
                  <th class="text-right font-medium px-2 py-2">Hours</th><th class="text-right font-medium px-2 py-2">Meetings</th><th class="text-right font-medium px-2 py-2">Wins</th>
                  <th class="text-right font-medium px-2 py-2">Annual revenue</th><th class="text-right font-medium px-2 py-2">Meetings / 10h</th><th class="text-right font-medium px-4 py-2">Revenue / hour</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in a.channels" :key="c.key" class="border-b last:border-0">
                  <td class="px-4 py-2 font-medium"><span class="inline-flex items-center gap-1.5"><component :is="CH_ICON[c.key]" class="size-3.5 text-muted-foreground" />{{ c.label }}</span></td>
                  <td class="px-2 py-2 text-right tabular-nums">{{ c.touches }}</td><td class="px-2 py-2 text-right tabular-nums">{{ c.dealerships }}</td>
                  <td class="px-2 py-2 text-right tabular-nums">{{ c.hours }}</td><td class="px-2 py-2 text-right tabular-nums">{{ c.meetings }}</td><td class="px-2 py-2 text-right tabular-nums">{{ c.wins }}</td>
                  <td class="px-2 py-2 text-right tabular-nums font-semibold">{{ money(c.annualRevenue) }}</td>
                  <td class="px-2 py-2 text-right tabular-nums">{{ c.meetingsPer10Hours ?? '—' }}</td>
                  <td class="px-4 py-2 text-right tabular-nums">{{ c.revenuePerHour == null ? '—' : money(c.revenuePerHour) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Touches before meeting -->
        <section class="rounded-xl border bg-card overflow-hidden">
          <header class="px-4 py-2.5 border-b">
            <h3 class="text-sm font-semibold">Touches before the first meeting</h3>
            <p class="text-[11px] text-muted-foreground">{{ a.touchesToMeeting.n ? `Median ${a.touchesToMeeting.median} · average ${a.touchesToMeeting.average} · ${a.touchesToMeeting.n} meetings` : 'No first meetings in this period.' }}</p>
          </header>
          <div class="px-4 pt-4 pb-3">
            <div class="flex items-end gap-2 h-28">
              <div v-for="b in a.touchesToMeeting.distribution" :key="b.key" class="flex-1 flex flex-col items-center justify-end h-full" :title="`${b.key} touches: ${b.n} meetings`">
                <span class="text-[10px] tabular-nums text-muted-foreground mb-0.5">{{ b.n || '' }}</span>
                <div class="w-full rounded-t bg-primary/80" :style="{ height: `${Math.max(b.n ? 4 : 1, (b.n / tdMax) * 100)}%` }" />
              </div>
            </div>
            <div class="flex gap-2 border-t mt-0 pt-1">
              <span v-for="b in a.touchesToMeeting.distribution" :key="b.key" class="flex-1 text-center text-[10px] text-muted-foreground">{{ b.key }}</span>
            </div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
