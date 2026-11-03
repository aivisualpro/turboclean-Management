<script setup lang="ts">
import type { CrmActivity } from '~/composables/useCrmDealerships'
import { Building2, Pencil, Archive, ArchiveRestore, UserPlus, UserPen, UserMinus, RotateCcw, ArrowLeftRight, ShieldCheck, MessageSquare, Send, Loader2, Trophy, Undo2, ClipboardCheck } from 'lucide-vue-next'
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns'

const props = defineProps<{ items: CrmActivity[], canNote?: boolean, posting?: boolean }>()
const emit = defineEmits<{ note: [text: string] }>()

const META: Record<string, { icon: any, cls: string, bg: string }> = {
  'dealership.created': { icon: Building2, cls: 'text-primary', bg: 'bg-primary/10' },
  'dealership.updated': { icon: Pencil, cls: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-500/10' },
  'dealership.archived': { icon: Archive, cls: 'text-zinc-600 dark:text-zinc-400', bg: 'bg-zinc-500/10' },
  'dealership.restored': { icon: ArchiveRestore, cls: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
  'contact.added': { icon: UserPlus, cls: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
  'contact.updated': { icon: UserPen, cls: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-500/10' },
  'contact.deactivated': { icon: UserMinus, cls: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
  'contact.reactivated': { icon: RotateCcw, cls: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
  'contact.handover': { icon: ArrowLeftRight, cls: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10' },
  'contact.verified': { icon: ShieldCheck, cls: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
  'dealership.converted': { icon: Trophy, cls: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/15' },
  'dealership.reverted': { icon: Undo2, cls: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
  'audit.recorded': { icon: ClipboardCheck, cls: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10' },
  'note': { icon: MessageSquare, cls: 'text-foreground', bg: 'bg-muted' },
}
const LABEL: Record<string, string> = { name: 'Name', dealerGroup: 'Dealer group', brands: 'Brands', website: 'Website', address: 'Address', city: 'City', state: 'State', zip: 'ZIP', phone: 'Phone', territory: 'Territory', assignedUserId: 'Assignee', assignedUserName: 'Assigned to', leadSource: 'Lead source', leadSourceDetail: 'Source detail', stage: 'Stage', notes: 'Notes', tags: 'Tags', firstName: 'First name', lastName: 'Last name', role: 'Role', jobTitle: 'Job title', email: 'Email', mobile: 'Mobile', preferredContactMethod: 'Preferred method', isPrimary: 'Primary', successor: 'Successor', reason: 'Reason', dealer: 'Dealer' }

function dayLabel(iso: string) {
  const d = new Date(iso)
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'EEEE, MMM d, yyyy')
}
const grouped = computed(() => {
  const map = new Map<string, CrmActivity[]>()
  for (const a of props.items) {
    const k = a.at.slice(0, 10)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(a)
  }
  return [...map.entries()].map(([k, list]) => ({ key: k, label: dayLabel(list[0]!.at), list }))
})
function fmtVal(v: any) {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}
function visibleChanges(a: CrmActivity) {
  if (!a.changes) return []
  return Object.entries(a.changes).filter(([k]) => k !== 'assignedUserId' && k !== 'notes').map(([k, v]) => ({ key: k, label: LABEL[k] || k, ...v }))
}

const draft = ref('')
function post() {
  const t = draft.value.trim()
  if (!t) return
  emit('note', t)
  draft.value = ''
}
</script>

<template>
  <div class="space-y-6">
    <form v-if="canNote" class="flex gap-2 items-start" @submit.prevent="post">
      <div class="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5"><MessageSquare class="size-4 text-primary" /></div>
      <div class="flex-1">
        <Textarea v-model="draft" rows="2" class="resize-none text-sm" placeholder="Log a call, meeting or note… (⌘/Ctrl + Enter to post)" @keydown.meta.enter.prevent="post" @keydown.ctrl.enter.prevent="post" />
        <div class="mt-2 flex justify-end"><Button type="submit" size="sm" class="h-8 gap-1.5" :disabled="!draft.trim() || posting"><Loader2 v-if="posting" class="size-3.5 animate-spin" /><Send v-else class="size-3.5" /> Post note</Button></div>
      </div>
    </form>

    <div v-if="!items.length" class="text-center py-10 text-sm text-muted-foreground">No activity yet.</div>

    <section v-for="g in grouped" :key="g.key">
      <div class="sticky top-0 z-[1] bg-background/90 backdrop-blur py-1.5 flex items-center gap-3">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{{ g.label }}</span>
        <span class="h-px flex-1 bg-border" />
      </div>
      <ol class="relative ml-4 border-l border-border/70 space-y-1 pt-2">
        <li v-for="a in g.list" :key="a.id" class="relative pl-6 pb-4">
          <span class="absolute -left-[13px] top-0.5 size-6 rounded-full border-2 border-background flex items-center justify-center" :class="(META[a.type] || META.note)!.bg">
            <component :is="(META[a.type] || META.note)!.icon" class="size-3" :class="(META[a.type] || META.note)!.cls" />
          </span>
          <div class="flex items-baseline justify-between gap-3">
            <p class="text-sm" :class="a.type === 'note' ? 'whitespace-pre-wrap' : ''">{{ a.message }}</p>
            <time class="text-[11px] text-muted-foreground tabular-nums shrink-0" :title="format(new Date(a.at), 'PPpp')">{{ format(new Date(a.at), 'h:mm a') }}</time>
          </div>
          <p class="text-[11px] text-muted-foreground mt-0.5">{{ a.actor?.name || 'System' }} · {{ formatDistanceToNow(new Date(a.at), { addSuffix: true }) }}</p>
          <ul v-if="visibleChanges(a).length" class="mt-2 rounded-md border bg-muted/30 divide-y text-xs">
            <li v-for="c in visibleChanges(a)" :key="c.key" class="grid grid-cols-[110px_1fr] gap-2 px-2.5 py-1.5">
              <span class="text-muted-foreground">{{ c.label }}</span>
              <span class="min-w-0 truncate"><span class="line-through text-muted-foreground/70">{{ fmtVal(c.from) }}</span> <span class="mx-1 text-muted-foreground">→</span> <span class="font-medium">{{ fmtVal(c.to) }}</span></span>
            </li>
          </ul>
        </li>
      </ol>
    </section>
  </div>
</template>
