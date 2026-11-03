<script setup lang="ts">
import type { ContactInput, CrmContact } from '~/composables/useCrmDealerships'
import { ArrowRight, Loader2, UserMinus, UserPlus, History } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * "This manager left" — the one flow that must never lose history.
 * Step 1: why they're leaving. Step 2 (optional): who replaces them.
 */
const isOpen = defineModel<boolean>('open', { default: false })
const props = defineProps<{ dealershipId: string, contact: CrmContact | null }>()
const emit = defineEmits<{ done: [] }>()
const { updateContact, handoverContact } = useCrmDealerships()

const REASONS = ['Left the dealership', 'Moved to another role', 'Retired', 'Promoted within group', 'Terminated', 'No longer responsive', 'Other']
const reason = ref(REASONS[0]!)
const reasonOther = ref('')
const withSuccessor = ref(true)
const successor = ref<ContactInput>({})
const errors = ref<Record<string, string>>({})
const saving = ref(false)

watch(isOpen, (o) => {
  if (!o || !props.contact) return
  reason.value = REASONS[0]!; reasonOther.value = ''; withSuccessor.value = true; errors.value = {}
  successor.value = { firstName: '', lastName: '', role: props.contact.role, jobTitle: props.contact.jobTitle, email: '', phone: props.contact.phone, mobile: '', preferredContactMethod: 'email', isPrimary: props.contact.isPrimary, notes: '' }
})

const finalReason = computed(() => reason.value === 'Other' ? (reasonOther.value.trim() || 'Other') : reason.value)

async function submit() {
  if (!props.contact) return
  if (withSuccessor.value) {
    const e: Record<string, string> = {}
    if (!successor.value.firstName?.trim() && !successor.value.lastName?.trim()) e.name = 'Successor name is required'
    if (successor.value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(successor.value.email.trim())) e.email = 'Enter a valid email'
    errors.value = e
    if (Object.keys(e).length) return
  }
  saving.value = true
  try {
    if (withSuccessor.value) {
      const r = await handoverContact(props.dealershipId, props.contact.id, successor.value, finalReason.value)
      toast.success(`${r.outgoing.fullName} archived · ${r.successor.fullName} is now ${r.successor.jobTitle || r.successor.role}`)
    } else {
      await updateContact(props.dealershipId, props.contact.id, { isActive: false, inactiveReason: finalReason.value })
      toast.success(`${props.contact.fullName} marked inactive — history kept`)
    }
    emit('done'); isOpen.value = false
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || err?.message || 'Could not complete handover')
  } finally { saving.value = false }
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <div class="flex items-center gap-3">
          <div class="size-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0"><UserMinus class="size-5 text-amber-600 dark:text-amber-400" /></div>
          <div>
            <DialogTitle>Mark inactive{{ withSuccessor ? ' & hand over' : '' }}</DialogTitle>
            <DialogDescription class="text-xs">{{ contact?.fullName }} stays on record forever — nothing is deleted or overwritten.</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <form v-if="contact" class="space-y-5 pt-1" @submit.prevent="submit">
        <div class="rounded-lg border bg-muted/30 p-3 flex items-center gap-3 text-sm">
          <History class="size-4 text-muted-foreground shrink-0" />
          <p class="text-muted-foreground">Their contact details, notes and timeline remain visible under <span class="font-medium text-foreground">Former contacts</span>.</p>
        </div>

        <div class="space-y-1.5">
          <Label>Reason</Label>
          <Select v-model="reason">
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem v-for="r in REASONS" :key="r" :value="r">{{ r }}</SelectItem></SelectContent>
          </Select>
          <Input v-if="reason === 'Other'" v-model="reasonOther" placeholder="Briefly, what happened?" class="mt-2" />
        </div>

        <label class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer select-none hover:bg-accent/40 transition-colors">
          <div class="flex items-center gap-2.5">
            <UserPlus class="size-4 text-primary" />
            <div><p class="text-sm font-medium">Add their replacement now</p><p class="text-[11px] text-muted-foreground">Creates the new {{ contact.jobTitle || contact.role }} and links the two records.</p></div>
          </div>
          <Switch v-model="withSuccessor" />
        </label>

        <Transition name="fade">
          <div v-if="withSuccessor" class="rounded-xl border p-4 space-y-4">
            <div class="flex items-center gap-2 text-xs text-muted-foreground">
              <span class="font-medium text-foreground line-through decoration-muted-foreground/60">{{ contact.fullName }}</span>
              <ArrowRight class="size-3.5" />
              <span class="font-medium text-primary">{{ [successor.firstName, successor.lastName].filter(Boolean).join(' ') || 'New contact' }}</span>
              <Badge variant="secondary" class="ml-auto text-[10px]">{{ contact.jobTitle || contact.role }}</Badge>
            </div>
            <CrmContactFields v-model="successor" :errors="errors" id-prefix="hs" />
          </div>
        </Transition>

        <DialogFooter>
          <Button type="button" variant="ghost" :disabled="saving" @click="isOpen = false">Cancel</Button>
          <Button type="submit" :disabled="saving" class="min-w-36" :variant="withSuccessor ? 'default' : 'destructive'">
            <Loader2 v-if="saving" class="size-4 animate-spin" />
            <span v-else>{{ withSuccessor ? 'Complete handover' : 'Mark inactive' }}</span>
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity .2s ease, transform .2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
