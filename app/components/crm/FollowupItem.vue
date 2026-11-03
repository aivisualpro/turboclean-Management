<script setup lang="ts">
import type { FollowupBoardItem } from '~/composables/useCrmFollowups'
import { Check, CalendarClock, Phone, Mail, ChevronRight, Loader2, Clock } from 'lucide-vue-next'
import { format, parseISO } from 'date-fns'
import { NEXT_ACTION_TYPE_MAP, STAGE_STYLE } from '~/constants/crm'
import { INTERACTION_ICONS } from '~/constants/crm-icons'


/** One row on the follow-up board. Clicking the row opens the dealership. */
const props = defineProps<{ item: FollowupBoardItem, tone?: 'default' | 'danger' | 'warn', canEdit?: boolean, busy?: boolean, showAction?: boolean }>()
const emit = defineEmits<{ open: [], done: [], reschedule: [days: number] }>()

const na = computed(() => props.item.nextAction)
const typeDef = computed(() => na.value ? NEXT_ACTION_TYPE_MAP[na.value.type] : null)
const fmtTime = (t: string | null) => t ? format(parseISO(`2000-01-01T${t}:00`), 'h:mm a') : ''
const RESCHEDULE = [{ l: 'Tomorrow', d: 1 }, { l: 'In 3 days', d: 3 }, { l: 'Next week', d: 7 }, { l: 'In 2 weeks', d: 14 }, { l: 'Next month', d: 30 }]
</script>

<template>
  <li class="group flex items-start gap-3 px-4 py-2.5 hover:bg-muted/40 cursor-pointer transition-colors" role="link" tabindex="0" @click="emit('open')" @keydown.enter="emit('open')">
    <span class="mt-0.5 size-7 rounded-lg flex items-center justify-center shrink-0"
      :class="tone === 'danger' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : tone === 'warn' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-primary/10 text-primary'">
      <component :is="INTERACTION_ICONS[typeDef?.icon || 'StickyNote']" v-if="showAction !== false && na" class="size-3.5" />
      <span v-else class="size-1.5 rounded-full" :class="STAGE_STYLE[item.stage]?.dot || 'bg-muted-foreground'" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="text-sm flex flex-wrap items-center gap-x-2">
        <span class="font-semibold group-hover:text-primary transition-colors truncate">{{ item.name }}</span>
        <span class="text-[10px] font-mono text-muted-foreground">{{ item.dealershipCode }}</span>
      </p>
      <p v-if="showAction !== false && na" class="text-xs mt-0.5 line-clamp-1">
        <span v-if="na.time" class="font-medium tabular-nums mr-1"><Clock class="size-3 inline -mt-0.5" /> {{ fmtTime(na.time) }}</span>{{ na.text }}
      </p>
      <p class="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5">
        <span class="inline-flex items-center gap-1"><span class="size-1.5 rounded-full" :class="STAGE_STYLE[item.stage]?.dot" />{{ item.stage }}</span>
        <span :class="tone === 'danger' ? 'text-rose-600 dark:text-rose-400 font-medium' : tone === 'warn' ? 'text-amber-700 dark:text-amber-300 font-medium' : ''">· {{ item.reason }}<template v-if="na?.daysOverdue"> ({{ na.daysOverdue }}d)</template></span>
        <span v-if="item.contact?.name">· {{ item.contact.name }}<span v-if="item.contact.title"> ({{ item.contact.title }})</span></span>
        <span v-if="item.ownerName">· {{ item.ownerName }}</span>
        <span v-else class="text-rose-600">· Unassigned</span>
      </p>
    </div>
    <div class="flex items-center gap-1 shrink-0" @click.stop>
      <a v-if="item.contact?.phone && (na?.type === 'call' || !na)" :href="`tel:${item.contact.phone}`" class="inline-flex items-center justify-center size-7 rounded-md border hover:bg-muted text-muted-foreground hover:text-foreground" :title="`Call ${item.contact.phone}`"><Phone class="size-3.5" /></a>
      <a v-if="item.contact?.email && na?.type === 'email'" :href="`mailto:${item.contact.email}`" class="inline-flex items-center justify-center size-7 rounded-md border hover:bg-muted text-muted-foreground hover:text-foreground" :title="item.contact.email"><Mail class="size-3.5" /></a>
      <template v-if="canEdit && na && showAction !== false && na.date">
        <Button variant="outline" size="icon" class="size-7" title="Mark done" :disabled="busy" @click="emit('done')"><Loader2 v-if="busy" class="size-3.5 animate-spin" /><Check v-else class="size-3.5" /></Button>
        <DropdownMenu>
          <DropdownMenuTrigger as-child><Button variant="outline" size="icon" class="size-7" title="Reschedule" :disabled="busy"><CalendarClock class="size-3.5" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel class="text-[11px] text-muted-foreground">Move to…</DropdownMenuLabel>
            <DropdownMenuItem v-for="r in RESCHEDULE" :key="r.d" @click="emit('reschedule', r.d)">{{ r.l }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </template>
      <ChevronRight class="size-4 text-muted-foreground/60 group-hover:text-primary" />
    </div>
  </li>
</template>
