<script setup lang="ts">
import type { CrmEmail, EmailOutcomeKey } from '~/composables/useCrmEmail'
import { Mail, Send, Reply, Inbox, MousePointerClick, MailOpen, CheckCheck, AlertTriangle, ChevronDown, Loader2, ThumbsUp, ThumbsDown, Minus, Megaphone, FileText, Info, Archive, FileDown } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { format, formatDistanceToNow } from 'date-fns'
import { EMAIL_OUTCOMES, EMAIL_STATUS_STYLE, SENTIMENT_STYLE } from '~/constants/crm'

/** Every acquisition email with this dealership, grouped into sequences (first email + follow-ups + replies). */
const props = defineProps<{ emails: CrmEmail[], canEdit: boolean }>()
const emit = defineEmits<{ compose: [followUpOf?: string], changed: [] }>()
const { updateEmail, getEmail } = useCrmEmail()

const outbound = computed(() => props.emails.filter(e => e.direction === 'outbound'))
const inbound = computed(() => props.emails.filter(e => e.direction === 'inbound'))
const threads = computed(() => {
  const map = new Map<string, CrmEmail[]>()
  for (const e of outbound.value) { const k = e.threadId || e.id; map.set(k, [...(map.get(k) || []), e]) }
  const byParent = new Map<string, CrmEmail[]>()
  for (const r of inbound.value) if (r.inReplyToEmailId) byParent.set(r.inReplyToEmailId, [...(byParent.get(r.inReplyToEmailId) || []), r])
  const list = [...map.entries()].map(([id, msgs]) => {
    const sorted = [...msgs].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    const items = sorted.flatMap(m => [{ kind: 'out' as const, m }, ...(byParent.get(m.id) || []).map(r => ({ kind: 'in' as const, m: r }))])
      .sort((a, b) => a.m.sentAt.localeCompare(b.m.sentAt))
    const outcomes = EMAIL_OUTCOMES.filter(o => sorted.some(m => m.outcomes?.[o.key]))
    return { id, first: sorted[0]!, last: sorted.at(-1)!, items, count: sorted.length, replies: items.filter(i => i.kind === 'in').length, outcomes, sentiment: [...sorted].reverse().find(m => m.replySentiment)?.replySentiment || null }
  })
  return list.sort((a, b) => b.last.sentAt.localeCompare(a.last.sentAt))
})
/** Replies we could not tie to a specific email (matched to the dealership by sender only). */
const looseReplies = computed(() => inbound.value.filter(r => !r.inReplyToEmailId))

const summary = computed(() => {
  const o = outbound.value.filter(e => e.status !== 'failed')
  return {
    sent: o.length, delivered: o.filter(e => e.status === 'delivered' || e.deliveredAt).length, bounced: o.filter(e => e.status === 'bounced').length,
    replied: o.filter(e => e.repliedAt).length, positive: inbound.value.filter(r => r.sentiment === 'positive').length,
    needsReview: inbound.value.filter(r => !r.sentiment).length,
    meeting: o.filter(e => e.outcomes?.meeting).length, won: o.filter(e => e.outcomes?.won).length,
    opened: o.filter(e => e.openedAt).length, clicked: o.filter(e => e.clickedAt).length,
  }
})

const open = ref<Set<string>>(new Set())
const bodies = ref<Record<string, string>>({})
async function toggle(m: CrmEmail) {
  const s = new Set(open.value)
  if (s.has(m.id)) { s.delete(m.id); open.value = s; return }
  s.add(m.id); open.value = s
  if (!bodies.value[m.id] && !m.bodyText) {
    try { const r = await getEmail(m.id); bodies.value = { ...bodies.value, [m.id]: r.email.bodyText } } catch {}
  }
}
const busy = ref<string | null>(null)
async function setSentiment(r: CrmEmail, s: 'positive' | 'neutral' | 'negative' | null) {
  busy.value = r.id
  try { await updateEmail(r.id, { sentiment: r.sentiment === s ? null : s }); emit('changed') } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not update') } finally { busy.value = null }
}
async function toggleOutcome(m: CrmEmail, k: EmailOutcomeKey) {
  busy.value = `${m.id}-${k}`
  try { await updateEmail(m.id, { outcomes: { [k]: !m.outcomes?.[k] } }); emit('changed') } catch (e: any) { toast.error(e?.data?.statusMessage || 'Could not update') } finally { busy.value = null }
}
const SENT_ICONS = { positive: ThumbsUp, neutral: Minus, negative: ThumbsDown } as const
// The exact email as sent (stored HTML) — view, PDF, HTML
const viewId = ref<string | null>(null)
const viewOpen = ref(false)
function viewAsSent(id: string) { viewId.value = id; viewOpen.value = true }
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h3 class="font-semibold">Emails</h3>
        <p class="text-xs text-muted-foreground">Acquisition emails sent from the CRM, their follow-ups and the replies. Success = replies → conversations → meetings → proposals → won.</p>
      </div>
      <Button v-if="canEdit" size="sm" class="gap-2" @click="emit('compose')"><Send class="size-4" /> New email</Button>
    </div>

    <!-- Summary -->
    <div class="rounded-xl border bg-card px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <span><span class="font-bold tabular-nums">{{ summary.sent }}</span> <span class="text-muted-foreground">sent</span></span>
      <span><span class="font-bold tabular-nums">{{ summary.replied }}</span> <span class="text-muted-foreground">replied</span></span>
      <span><span class="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{{ summary.positive }}</span> <span class="text-muted-foreground">positive</span></span>
      <span><span class="font-bold tabular-nums">{{ summary.meeting }}</span> <span class="text-muted-foreground">meeting{{ summary.meeting === 1 ? '' : 's' }}</span></span>
      <span><span class="font-bold tabular-nums">{{ summary.won }}</span> <span class="text-muted-foreground">won</span></span>
      <span v-if="summary.bounced" class="text-rose-600"><span class="font-bold tabular-nums">{{ summary.bounced }}</span> bounced</span>
      <span v-if="summary.needsReview" class="ml-auto inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300 text-xs font-medium"><Inbox class="size-3.5" /> {{ summary.needsReview }} repl{{ summary.needsReview === 1 ? 'y' : 'ies' }} to classify</span>
      <span class="text-[11px] text-muted-foreground w-full">Reported engagement (not a success metric): {{ summary.opened }} opened · {{ summary.clicked }} clicked</span>
    </div>

    <!-- Empty -->
    <div v-if="!threads.length && !looseReplies.length" class="rounded-xl border-2 border-dashed py-12 flex flex-col items-center text-center">
      <div class="size-12 rounded-2xl bg-sky-500/10 flex items-center justify-center"><Mail class="size-5 text-sky-600/70" /></div>
      <h4 class="mt-3 font-semibold text-sm">No emails yet</h4>
      <p class="mt-1 text-xs text-muted-foreground max-w-xs">Send the first email from here — delivery, bounces and replies will attach to this dealership automatically.</p>
      <Button v-if="canEdit" size="sm" class="mt-4 gap-2" @click="emit('compose')"><Send class="size-4" /> New email</Button>
    </div>

    <!-- Threads -->
    <article v-for="t in threads" :key="t.id" class="rounded-xl border bg-card overflow-hidden">
      <header class="px-4 py-3 border-b bg-muted/20 flex flex-wrap items-start gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold truncate">{{ t.first.subject }}</p>
          <p class="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5">
            <span>To {{ t.first.contactName || t.first.toEmail }}</span>
            <span>· {{ t.count }} email{{ t.count === 1 ? '' : 's' }}</span>
            <span>· {{ t.replies }} repl{{ t.replies === 1 ? 'y' : 'ies' }}</span>
            <span v-if="t.first.campaignName" class="inline-flex items-center gap-1">· <Megaphone class="size-3" />{{ t.first.campaignName }}</span>
            <span v-if="t.first.templateName" class="inline-flex items-center gap-1">· <FileText class="size-3" />{{ t.first.templateName }} {{ t.first.templateVersionLabel || `V${t.first.templateVersion}` }}{{ t.first.subjectVariant ? ` · ${t.first.subjectVariant}` : '' }}</span>
          </p>
          <div v-if="t.outcomes.length || t.sentiment" class="mt-1.5 flex flex-wrap gap-1">
            <Badge v-if="t.sentiment" variant="outline" class="text-[10px]" :class="SENTIMENT_STYLE[t.sentiment]?.cls">{{ SENTIMENT_STYLE[t.sentiment]?.label }} reply</Badge>
            <Badge v-for="o in t.outcomes" :key="o.key" variant="outline" class="text-[10px] bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25">{{ o.label }}</Badge>
          </div>
        </div>
        <Button v-if="canEdit" variant="outline" size="sm" class="h-7 gap-1.5 text-xs" @click="emit('compose', t.id)"><Reply class="size-3.5" /> Follow up</Button>
      </header>

      <ol class="divide-y">
        <li v-for="it in t.items" :key="it.m.id" class="px-4 py-2.5" :class="it.kind === 'in' && 'bg-sky-500/[0.03]'">
          <!-- Outbound -->
          <template v-if="it.kind === 'out'">
            <button type="button" class="w-full text-left flex flex-wrap items-center gap-x-2 gap-y-1" @click="toggle(it.m)">
              <Send class="size-3.5 text-muted-foreground shrink-0" />
              <span class="text-xs font-medium">{{ it.m.followUpNumber ? `Follow-up #${it.m.followUpNumber}` : 'First email' }}</span>
              <span class="text-[11px] text-muted-foreground">{{ format(new Date(it.m.sentAt), 'MMM d, yyyy · h:mm a') }} · {{ it.m.sentBy?.name }} → {{ it.m.toEmail }}</span>
              <span class="ml-auto flex flex-wrap items-center gap-1">
                <Badge variant="outline" class="text-[10px]" :class="EMAIL_STATUS_STYLE[it.m.status || 'sent']?.cls">{{ EMAIL_STATUS_STYLE[it.m.status || 'sent']?.label }}</Badge>
                <Badge v-if="it.m.openedAt" variant="outline" class="text-[10px] gap-1 text-muted-foreground" title="Reported by the recipient's mail client — not reliable"><MailOpen class="size-3" />Opened{{ (it.m.openCount || 0) > 1 ? ` ×${it.m.openCount}` : '' }}</Badge>
                <Badge v-if="it.m.clickedAt" variant="outline" class="text-[10px] gap-1 text-muted-foreground" :title="(it.m.clickedLinks || []).join('\n')"><MousePointerClick class="size-3" />Clicked</Badge>
                <Badge v-if="it.m.repliedAt" variant="outline" class="text-[10px] gap-1 bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25"><CheckCheck class="size-3" />Replied</Badge>
                <ChevronDown class="size-3.5 text-muted-foreground transition-transform" :class="open.has(it.m.id) && 'rotate-180'" />
              </span>
            </button>
            <div v-if="open.has(it.m.id)" class="mt-2 space-y-2">
              <p v-if="it.m.status === 'bounced'" class="text-[11px] text-rose-600 flex items-center gap-1"><AlertTriangle class="size-3" /> Bounced {{ it.m.bouncedAt ? format(new Date(it.m.bouncedAt), 'MMM d, h:mm a') : '' }}<span v-if="it.m.bounceReason"> — {{ it.m.bounceReason }}</span></p>
              <p v-if="it.m.status === 'failed'" class="text-[11px] text-rose-600">Not sent — {{ it.m.failedReason }}</p>
              <div class="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" class="h-7 gap-1.5 text-xs" @click="viewAsSent(it.m.id)"><Archive class="size-3.5" /> View as sent</Button>
                <Button as="a" :href="`/api/crm/email/messages/${it.m.id}/archive?format=pdf&download=1`" size="sm" variant="ghost" class="h-7 gap-1.5 text-xs"><FileDown class="size-3.5" /> PDF</Button>
                <span v-if="it.m.bodyFormat === 'html'" class="text-[11px] text-muted-foreground">Designed HTML email — the text below is its plain-text version.</span>
              </div>
              <p class="text-sm whitespace-pre-wrap leading-relaxed rounded-lg bg-muted/30 px-3 py-2">{{ it.m.bodyText || bodies[it.m.id] || 'Loading…' }}</p>
              <div v-if="canEdit && it.m.repliedAt" class="flex flex-wrap items-center gap-1.5">
                <span class="text-[11px] text-muted-foreground mr-1">Credit this email with:</span>
                <button v-for="o in EMAIL_OUTCOMES" :key="o.key" type="button" class="rounded-full border px-2 py-0.5 text-[11px] transition-colors"
                  :class="it.m.outcomes?.[o.key] ? 'bg-violet-600 text-white border-violet-600' : 'text-muted-foreground hover:text-foreground hover:bg-muted'"
                  :disabled="busy === `${it.m.id}-${o.key}`" :title="it.m.outcomes?.[o.key]?.source ? `Credited automatically (${it.m.outcomes[o.key]!.source})` : 'Toggle'" @click="toggleOutcome(it.m, o.key)">{{ o.label }}</button>
              </div>
            </div>
          </template>

          <!-- Reply -->
          <template v-else>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Reply class="size-3.5 text-sky-600 shrink-0 -scale-x-100" />
              <span class="text-xs font-medium">Reply from {{ it.m.contactName || it.m.fromEmail }}</span>
              <span class="text-[11px] text-muted-foreground">{{ format(new Date(it.m.receivedAt || it.m.sentAt), 'MMM d, yyyy · h:mm a') }}</span>
              <span class="ml-auto flex items-center gap-1">
                <template v-if="canEdit">
                  <button v-for="s in (['positive', 'neutral', 'negative'] as const)" :key="s" type="button" class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors"
                    :class="it.m.sentiment === s ? SENTIMENT_STYLE[s]?.cls + ' font-semibold' : 'text-muted-foreground hover:bg-muted'" :disabled="busy === it.m.id" @click="setSentiment(it.m, s)">
                    <component :is="SENT_ICONS[s]" class="size-3" />{{ SENTIMENT_STYLE[s]?.label }}
                  </button>
                </template>
                <Badge v-else-if="it.m.sentiment" variant="outline" class="text-[10px]" :class="SENTIMENT_STYLE[it.m.sentiment]?.cls">{{ SENTIMENT_STYLE[it.m.sentiment]?.label }}</Badge>
                <Loader2 v-if="busy === it.m.id" class="size-3.5 animate-spin text-muted-foreground" />
              </span>
            </div>
            <p class="mt-1.5 text-sm whitespace-pre-wrap leading-relaxed">{{ open.has(it.m.id) ? it.m.bodyText : (it.m.snippet || it.m.bodyText) }}</p>
            <button v-if="it.m.bodyText && it.m.bodyText.length > (it.m.snippet || '').length + 20" type="button" class="text-[11px] text-primary hover:underline underline-offset-2" @click="toggle(it.m)">{{ open.has(it.m.id) ? 'Hide quoted text' : 'Show full email' }}</button>
          </template>
        </li>
      </ol>
    </article>

    <!-- Replies matched by sender only -->
    <section v-if="looseReplies.length" class="rounded-xl border bg-card">
      <header class="px-4 py-3 border-b"><h4 class="text-sm font-semibold flex items-center gap-2"><Inbox class="size-4 text-muted-foreground" /> Other emails from this dealership</h4><p class="text-[11px] text-muted-foreground">Matched by the sender's address, not to a specific email we sent.</p></header>
      <ul class="divide-y">
        <li v-for="r in looseReplies" :key="r.id" class="px-4 py-2.5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-medium">{{ r.subject }}</span>
            <span class="text-[11px] text-muted-foreground">{{ r.contactName || r.fromEmail }} · {{ formatDistanceToNow(new Date(r.receivedAt || r.sentAt), { addSuffix: true }) }}</span>
            <span v-if="canEdit" class="ml-auto flex gap-1">
              <button v-for="s in (['positive', 'neutral', 'negative'] as const)" :key="s" type="button" class="rounded-full border px-2 py-0.5 text-[11px]" :class="r.sentiment === s ? SENTIMENT_STYLE[s]?.cls + ' font-semibold' : 'text-muted-foreground hover:bg-muted'" @click="setSentiment(r, s)">{{ SENTIMENT_STYLE[s]?.label }}</button>
            </span>
          </div>
          <p class="mt-1 text-sm whitespace-pre-wrap">{{ r.snippet || r.bodyText }}</p>
        </li>
      </ul>
    </section>

    <p class="text-[11px] text-muted-foreground flex items-start gap-1.5"><Info class="size-3.5 shrink-0 mt-px" /> Conversations, meetings, proposals and wins are credited automatically to the most recent replied email when the dealership reaches that stage (or you log that activity). You can adjust the credit above.</p>
    <CrmEmailSentViewer v-model:open="viewOpen" :email-id="viewId" />
  </div>
</template>
