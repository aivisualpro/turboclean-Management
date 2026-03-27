<script setup lang="ts">
import type { Dealer, DealerContact, PreferredContactMethod } from '~/composables/useDealers'
import { Plus, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const { patchDealer, formatPhoneNumber } = useDealers()

const isOpen = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  dealer: Dealer
  contact?: DealerContact | null
}>()

const emit = defineEmits(['saved'])

const phoneTypes = [
  { value: 'mobile', label: 'Mobile' },
  { value: 'landline', label: 'Landline' },
  { value: 'fax', label: 'Fax' },
]

const contactMethods: { value: PreferredContactMethod, label: string }[] = [
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'any', label: 'Any' },
]

// Current form state
const formContact = ref<DealerContact>({
  id: '',
  name: '',
  designation: '',
  phones: [{ id: '', number: '', type: 'mobile' }],
  emails: [''],
  preferredContactMethod: 'any',
})

watch([() => props.contact, isOpen], ([c, open]) => {
  if (open) {
    if (c) {
      // Editing existing contact
      formContact.value = JSON.parse(JSON.stringify(c))
      if (!formContact.value.phones?.length) formContact.value.phones = [{ id: Math.random().toString(36).slice(2, 8), number: '', type: 'mobile' }]
      if (!formContact.value.emails?.length) formContact.value.emails = ['']
    } else {
      // New contact
      formContact.value = {
        id: Math.random().toString(36).slice(2, 10),
        name: '',
        designation: '',
        phones: [{ id: Math.random().toString(36).slice(2, 8), number: '', type: 'mobile' }],
        emails: [''],
        preferredContactMethod: 'any',
      }
    }
  }
}, { immediate: true })

function addPhone() {
  formContact.value.phones.push({ id: Math.random().toString(36).slice(2, 8), number: '', type: 'mobile' })
}

function removePhone(idx: number) {
  if (formContact.value.phones.length > 1) {
    formContact.value.phones.splice(idx, 1)
  }
}

function addEmail() {
  formContact.value.emails.push('')
}

function removeEmail(idx: number) {
  if (formContact.value.emails.length > 1) {
    formContact.value.emails.splice(idx, 1)
  }
}

function onPhoneInput(idx: number, event: Event) {
  const input = event.target as HTMLInputElement
  const formatted = formatPhoneNumber(input.value)
  if (formContact.value.phones[idx]) {
    formContact.value.phones[idx]!.number = formatted
  }
  nextTick(() => { input.value = formatted })
}

async function onSubmit() {
  if (!formContact.value.name.trim()) {
    toast.error('Contact name is required')
    return
  }

  // Clean form
  const cleanContact: DealerContact = {
    ...formContact.value,
    name: formContact.value.name.trim(),
    designation: formContact.value.designation.trim(),
    phones: formContact.value.phones.filter(p => p.number.trim()),
    emails: formContact.value.emails.filter(e => e.trim()),
  }

  const existingContacts = [...(props.dealer.contacts || [])]

  if (props.contact) {
    // Update
    const i = existingContacts.findIndex(c => c.id === props.contact!.id)
    if (i !== -1) {
      existingContacts.splice(i, 1, cleanContact)
    }
  } else {
    // Add
    existingContacts.push(cleanContact)
  }

  try {
    await patchDealer(props.dealer.id, { contacts: existingContacts })
    toast.success(props.contact ? 'Contact updated successfully' : 'Contact added successfully')
    isOpen.value = false
    emit('saved')
  } catch (err: any) {
    toast.error(`Failed to save contact: ${err?.message || err}`)
  }
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="max-w-md max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ contact ? 'Edit Contact' : 'Add Contact' }}</DialogTitle>
        <DialogDescription>
          {{ contact ? 'Update contact information for this dealer.' : 'Add a new contact person to this dealer.' }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <div class="grid grid-cols-2 gap-3">
          <div class="grid gap-2">
            <Label>Name *</Label>
            <Input v-model="formContact.name" placeholder="Contact name" />
          </div>
          <div class="grid gap-2">
            <Label>Designation</Label>
            <Input v-model="formContact.designation" placeholder="e.g. Manager" />
          </div>
        </div>

        <Separator />

        <!-- Phones -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label class="text-xs text-muted-foreground">Phone Numbers</Label>
            <Button variant="ghost" size="sm" class="h-6 text-xs" @click="addPhone">
              <Plus class="size-3 mr-1" />
              Add
            </Button>
          </div>
          <div v-for="(phone, pi) in formContact.phones" :key="phone.id" class="flex items-center gap-2">
            <Input
              :value="phone.number"
              placeholder="(000) 000-0000"
              class="flex-1"
              @input="onPhoneInput(pi, $event)"
            />
            <Select v-model="phone.type" class="w-28">
              <SelectTrigger class="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="pt in phoneTypes" :key="pt.value" :value="pt.value">
                  {{ pt.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button v-if="formContact.phones.length > 1" variant="ghost" size="icon" class="size-8 shrink-0 text-destructive/70 hover:text-destructive hover:bg-destructive/10" @click="removePhone(pi)">
              <Trash2 class="size-3.5" />
            </Button>
          </div>
        </div>

        <!-- Emails -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label class="text-xs text-muted-foreground">Email Addresses</Label>
            <Button variant="ghost" size="sm" class="h-6 text-xs" @click="addEmail">
              <Plus class="size-3 mr-1" />
              Add
            </Button>
          </div>
          <div v-for="(_, ei) in formContact.emails" :key="ei" class="flex items-center gap-2">
            <Input v-model="formContact.emails[ei]" type="email" placeholder="email@example.com" class="flex-1" />
            <Button v-if="formContact.emails.length > 1" variant="ghost" size="icon" class="size-8 shrink-0 text-destructive/70 hover:text-destructive hover:bg-destructive/10" @click="removeEmail(ei)">
              <Trash2 class="size-3.5" />
            </Button>
          </div>
        </div>

        <!-- Preferred Contact Method -->
        <div class="grid gap-2">
          <Label class="text-xs text-muted-foreground">Preferred Contact Method</Label>
          <Select v-model="formContact.preferredContactMethod">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="cm in contactMethods" :key="cm.value" :value="cm.value">
                {{ cm.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DialogFooter class="pt-2 border-t">
        <Button variant="outline" @click="isOpen = false">Cancel</Button>
        <Button @click="onSubmit">{{ contact ? 'Save Changes' : 'Add Contact' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
