<script setup lang="ts">
import type { ContactInput, CrmContact } from '~/composables/useCrmDealerships'
import { Loader2, UserPlus, UserPen } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const isOpen = defineModel<boolean>('open', { default: false })
const props = defineProps<{ dealershipId: string, contact?: CrmContact | null }>()
const emit = defineEmits<{ saved: [c: CrmContact] }>()
const { addContact, updateContact } = useCrmDealerships()

const blank = (): ContactInput => ({ firstName: '', lastName: '', role: 'General Manager', jobTitle: 'General Manager', email: '', phone: '', mobile: '', preferredContactMethod: 'email', isPrimary: false, notes: '' })
const form = ref<ContactInput>(blank())
const markVerified = ref(true)
const errors = ref<Record<string, string>>({})
const saving = ref(false)
const isEdit = computed(() => !!props.contact)
/** Duplicate guard: same email anywhere, or same name / phone at this dealership → confirm first. */
const duplicates = ref<{ id: string, dealershipId: string, dealershipName: string, name: string, email: string, role: string, reasons: string[] }[]>([])

watch(isOpen, (o) => {
  if (!o) return
  errors.value = {}
  duplicates.value = []
  markVerified.value = true
  form.value = props.contact
    ? { firstName: props.contact.firstName, lastName: props.contact.lastName, role: props.contact.role, jobTitle: props.contact.jobTitle, email: props.contact.email, phone: props.contact.phone, mobile: props.contact.mobile, preferredContactMethod: props.contact.preferredContactMethod, isPrimary: props.contact.isPrimary, notes: props.contact.notes }
    : blank()
})

function validate() {
  const e: Record<string, string> = {}
  if (!form.value.firstName?.trim() && !form.value.lastName?.trim()) e.name = 'A name is required'
  if (form.value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.value.email.trim())) e.email = 'Enter a valid email'
  errors.value = e
  return !Object.keys(e).length
}

async function submit(allowDuplicate = false) {
  if (!validate()) return
  saving.value = true
  const extra = allowDuplicate ? { allowDuplicate: true } : {}
  try {
    const c = isEdit.value
      ? await updateContact(props.dealershipId, props.contact!.id, { ...form.value, verified: markVerified.value, ...extra } as any)
      : await addContact(props.dealershipId, { ...form.value, markVerified: markVerified.value, ...extra } as any)
    toast.success(isEdit.value ? `${c.fullName} updated` : `${c.fullName} added to the roster`)
    emit('saved', c)
    isOpen.value = false
  } catch (err: any) {
    const dups = err?.data?.data?.contactDuplicates
    if (err?.statusCode === 409 && dups?.length) duplicates.value = dups
    else toast.error(err?.data?.statusMessage || err?.message || 'Could not save contact')
  } finally { saving.value = false }
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <div class="flex items-center gap-3">
          <div class="size-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <component :is="isEdit ? UserPen : UserPlus" class="size-5 text-primary" />
          </div>
          <div>
            <DialogTitle>{{ isEdit ? 'Edit contact' : 'Add contact' }}</DialogTitle>
            <DialogDescription class="text-xs">{{ isEdit ? 'Corrections only — if this person left, use "Mark inactive / hand over" instead.' : 'A new person on this dealership\'s roster.' }}</DialogDescription>
          </div>
        </div>
      </DialogHeader>
      <form class="space-y-5 pt-2" @submit.prevent="submit()">
        <CrmContactFields v-model="form" :errors="errors" id-prefix="cf" />
        <label class="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5 cursor-pointer select-none">
          <div>
            <p class="text-sm font-medium">{{ isEdit ? 'Mark details as verified today' : 'Details verified today' }}</p>
            <p class="text-[11px] text-muted-foreground">Turn off if this was copied from an unconfirmed source.</p>
          </div>
          <Switch v-model="markVerified" />
        </label>
        <div v-if="duplicates.length" class="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-xs space-y-1.5">
          <p class="font-medium text-amber-900 dark:text-amber-200 text-sm">Possible duplicate</p>
          <p v-for="d in duplicates" :key="d.id"><span class="font-medium">{{ d.name }}</span><span class="text-muted-foreground"> · {{ d.role }}<template v-if="d.email"> · {{ d.email }}</template><template v-if="d.dealershipName"> · at <NuxtLink :to="`/crm/dealership/${d.dealershipId}`" class="text-primary hover:underline">{{ d.dealershipName }}</NuxtLink></template></span> — <span class="text-amber-700 dark:text-amber-300">{{ d.reasons.join(', ') }}</span></p>
          <Button type="button" size="sm" variant="outline" class="h-7 text-xs" :disabled="saving" @click="submit(true)">Different person — save anyway</Button>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" :disabled="saving" @click="isOpen = false">Cancel</Button>
          <Button type="submit" :disabled="saving" class="min-w-28"><Loader2 v-if="saving" class="size-4 animate-spin" /><span v-else>{{ isEdit ? 'Save changes' : 'Add contact' }}</span></Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
