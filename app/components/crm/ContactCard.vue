<script setup lang="ts">
import type { CrmContact } from '~/composables/useCrmDealerships'
import { daysSince, verificationState } from '~/composables/useCrmDealerships'
import { Mail, Phone, Smartphone, Star, ShieldCheck, ShieldAlert, ShieldQuestion, MoreHorizontal, Pencil, UserMinus, RotateCcw, Copy, ArrowRight, ArrowLeft, MessageSquare, Check } from 'lucide-vue-next'
import { format, formatDistanceToNow } from 'date-fns'
import { toast } from 'vue-sonner'

const props = defineProps<{ contact: CrmContact, successor?: CrmContact | null, predecessor?: CrmContact | null, canEdit: boolean, verifying?: boolean }>()
const emit = defineEmits<{ edit: [], handover: [], reactivate: [], verify: [], 'set-primary': [] }>()

const initials = computed(() => `${props.contact.firstName?.[0] || ''}${props.contact.lastName?.[0] || ''}`.toUpperCase() || '?')
const vState = computed(() => verificationState(props.contact.lastVerifiedAt))
const vDays = computed(() => daysSince(props.contact.lastVerifiedAt))
const verification = computed(() => ({
  fresh: { icon: ShieldCheck, cls: 'text-emerald-600 dark:text-emerald-400', label: `Verified ${formatDistanceToNow(new Date(props.contact.lastVerifiedAt!), { addSuffix: true })}` },
  aging: { icon: ShieldCheck, cls: 'text-amber-600 dark:text-amber-400', label: `Verified ${vDays.value}d ago — re-confirm soon` },
  stale: { icon: ShieldAlert, cls: 'text-rose-600 dark:text-rose-400', label: `Unverified for ${vDays.value} days` },
  never: { icon: ShieldQuestion, cls: 'text-muted-foreground', label: 'Never verified' },
}[vState.value]))

const preferred = computed(() => props.contact.preferredContactMethod)
const methodLabel: Record<string, string> = { 'email': 'Email', 'phone': 'Office phone', 'mobile': 'Mobile', 'text': 'Text', 'in-person': 'In person' }

async function copy(text: string, what: string) {
  try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`) } catch { toast.error('Clipboard unavailable') }
}
</script>

<template>
  <article
    class="group relative rounded-xl border bg-card transition-all duration-300"
    :class="contact.isActive ? 'hover:shadow-lg hover:shadow-black/[0.04] dark:hover:shadow-black/20 hover:-translate-y-0.5' : 'opacity-80 bg-muted/20 border-dashed'"
  >
    <div class="p-4">
      <div class="flex items-start gap-3">
        <div class="relative shrink-0">
          <div class="size-11 rounded-xl flex items-center justify-center text-sm font-bold" :class="contact.isActive ? 'bg-gradient-to-br from-primary/20 to-primary/5 text-primary border border-primary/10' : 'bg-muted text-muted-foreground'">{{ initials }}</div>
          <span v-if="contact.isPrimary && contact.isActive" class="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-amber-400 text-amber-950 flex items-center justify-center shadow" title="Primary contact"><Star class="size-3 fill-current" /></span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <h4 class="font-semibold leading-tight" :class="!contact.isActive && 'text-muted-foreground'">{{ contact.fullName }}</h4>
            <Badge v-if="!contact.isActive" variant="outline" class="text-[10px] bg-muted">Inactive</Badge>
          </div>
          <p class="text-xs text-muted-foreground mt-0.5">{{ contact.jobTitle || contact.role }}<span v-if="contact.jobTitle && contact.jobTitle !== contact.role" class="opacity-60"> · {{ contact.role }}</span></p>
        </div>
        <DropdownMenu v-if="canEdit">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" class="size-8 opacity-60 group-hover:opacity-100 transition-opacity -mr-1 -mt-1" aria-label="Contact actions"><MoreHorizontal class="size-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-56">
            <template v-if="contact.isActive">
              <DropdownMenuItem @click="emit('edit')"><Pencil class="size-4" /> Edit details</DropdownMenuItem>
              <DropdownMenuItem @click="emit('verify')"><ShieldCheck class="size-4" /> Mark verified today</DropdownMenuItem>
              <DropdownMenuItem v-if="!contact.isPrimary" @click="emit('set-primary')"><Star class="size-4" /> Make primary contact</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="text-amber-700 dark:text-amber-400 focus:text-amber-700" @click="emit('handover')"><UserMinus class="size-4" /> Mark inactive / hand over</DropdownMenuItem>
            </template>
            <template v-else>
              <DropdownMenuItem @click="emit('reactivate')"><RotateCcw class="size-4" /> Reactivate</DropdownMenuItem>
            </template>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ul class="mt-4 space-y-1.5 text-sm">
        <li v-if="contact.email" class="flex items-center gap-2 group/row">
          <Mail class="size-3.5 shrink-0" :class="preferred === 'email' ? 'text-primary' : 'text-muted-foreground/60'" />
          <a :href="`mailto:${contact.email}`" class="truncate hover:text-primary hover:underline underline-offset-2" @click.stop>{{ contact.email }}</a>
          <button type="button" class="opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-foreground" aria-label="Copy email" @click.stop="copy(contact.email, 'Email')"><Copy class="size-3" /></button>
        </li>
        <li v-if="contact.phone" class="flex items-center gap-2 group/row">
          <Phone class="size-3.5 shrink-0" :class="preferred === 'phone' ? 'text-primary' : 'text-muted-foreground/60'" />
          <a :href="`tel:${contact.phone}`" class="tabular-nums hover:text-primary hover:underline underline-offset-2" @click.stop>{{ contact.phone }}</a>
          <button type="button" class="opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-foreground" aria-label="Copy phone" @click.stop="copy(contact.phone, 'Phone')"><Copy class="size-3" /></button>
        </li>
        <li v-if="contact.mobile" class="flex items-center gap-2 group/row">
          <Smartphone class="size-3.5 shrink-0" :class="['mobile', 'text'].includes(preferred) ? 'text-primary' : 'text-muted-foreground/60'" />
          <a :href="`tel:${contact.mobile}`" class="tabular-nums hover:text-primary hover:underline underline-offset-2" @click.stop>{{ contact.mobile }}</a>
          <button type="button" class="opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-foreground" aria-label="Copy mobile" @click.stop="copy(contact.mobile, 'Mobile')"><Copy class="size-3" /></button>
        </li>
        <li v-if="!contact.email && !contact.phone && !contact.mobile" class="text-xs italic text-muted-foreground/70">No contact details on file</li>
      </ul>

      <p v-if="contact.notes" class="mt-3 text-xs text-muted-foreground line-clamp-2 flex gap-1.5"><MessageSquare class="size-3.5 shrink-0 mt-0.5 opacity-60" /><span>{{ contact.notes }}</span></p>

      <div v-if="!contact.isActive" class="mt-3 rounded-md bg-muted/50 px-2.5 py-2 text-[11px] text-muted-foreground space-y-0.5">
        <p>Inactive since <span class="font-medium text-foreground">{{ contact.inactiveAt ? format(new Date(contact.inactiveAt), 'MMM d, yyyy') : '—' }}</span><span v-if="contact.inactiveReason"> · {{ contact.inactiveReason }}</span></p>
        <p v-if="successor" class="flex items-center gap-1">Succeeded by <ArrowRight class="size-3" /> <span class="font-medium text-foreground">{{ successor.fullName }}</span></p>
      </div>
      <p v-else-if="predecessor" class="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground"><ArrowLeft class="size-3" /> Took over from <span class="font-medium text-foreground">{{ predecessor.fullName }}</span></p>
    </div>

    <footer class="px-4 py-2.5 border-t flex items-center justify-between gap-2 text-[11px]" :class="contact.isActive ? 'bg-muted/20' : 'bg-transparent'">
      <span class="flex items-center gap-1.5" :class="verification.cls" :title="contact.lastVerifiedAt ? format(new Date(contact.lastVerifiedAt), 'PPpp') : ''">
        <component :is="verification.icon" class="size-3.5" />{{ verification.label }}
      </span>
      <span class="text-muted-foreground flex items-center gap-2">
        <Badge variant="outline" class="text-[10px] px-1.5 py-0 font-normal">Prefers {{ methodLabel[preferred] || preferred }}</Badge>
        <span class="hidden sm:inline" :title="`Added ${format(new Date(contact.addedAt), 'PPP')}`">since {{ format(new Date(contact.addedAt), 'MMM yyyy') }}</span>
      </span>
    </footer>
    <Button v-if="canEdit && contact.isActive && vState !== 'fresh'" size="sm" variant="outline" class="absolute right-3 bottom-11 h-7 gap-1.5 text-[11px] opacity-0 group-hover:opacity-100 transition-opacity bg-background" :disabled="verifying" @click.stop="emit('verify')">
      <Check class="size-3" /> Verify now
    </Button>
  </article>
</template>
