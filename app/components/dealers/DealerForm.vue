<script setup lang="ts">
import type { Dealer, DealerContact, DealerPhone, DealerStatus, PreferredContactMethod } from '~/composables/useDealers'
import { Plus, Trash2, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const { dealers, addDealer, updateDealer, formatPhoneNumber } = useDealers()

const generateObjectId = () => [...Array(24)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')

const isOpen = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  dealer?: Dealer | null
}>()

const emit = defineEmits(['saved'])

const statusOptions: DealerStatus[] = ['Authorised', 'Pending', 'Rejected', 'In Followup']
const phoneTypes: { value: string, label: string }[] = [
  { value: 'mobile', label: 'Mobile' },
  { value: 'landline', label: 'Landline' },
  { value: 'fax', label: 'Fax' },
]
const contactMethods: { value: PreferredContactMethod, label: string }[] = [
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'any', label: 'Any' },
]

// Form state
const dealerName = ref('')
const address = ref('')
const status = ref<DealerStatus>('Pending')
const isTaxApplied = ref(false)
const taxPercentage = ref(0)
const copyFromDealerId = ref('')
const contacts = ref<DealerContact[]>([])

watch(() => props.dealer, (d) => {
  if (d) {
    dealerName.value = d.dealerName
    address.value = d.address
    status.value = d.status
    isTaxApplied.value = d.isTaxApplied
    taxPercentage.value = d.taxPercentage
    contacts.value = JSON.parse(JSON.stringify(d.contacts))
  }
  else {
    resetForm()
  }
}, { immediate: true })

watch(isOpen, (val) => {
  if (!val) resetForm()
})

function resetForm() {
  dealerName.value = ''
  address.value = ''
  status.value = 'Pending'
  copyFromDealerId.value = ''
  contacts.value = [{
    id: Math.random().toString(36).slice(2, 10),
    name: '',
    designation: '',
    phones: [{ id: Math.random().toString(36).slice(2, 8), number: '', type: 'mobile' }],
    emails: [''],
    preferredContactMethod: 'any',
    receiveInvoices: false,
  }]
}

function addContact() {
  contacts.value.push({
    id: Math.random().toString(36).slice(2, 10),
    name: '',
    designation: '',
    phones: [{ id: Math.random().toString(36).slice(2, 8), number: '', type: 'mobile' }],
    emails: [''],
    preferredContactMethod: 'any',
    receiveInvoices: false,
  })
}

function removeContact(idx: number) {
  if (contacts.value.length > 1) {
    contacts.value.splice(idx, 1)
  }
}

function addPhone(contactIdx: number) {
  contacts.value[contactIdx]?.phones.push({
    id: Math.random().toString(36).slice(2, 8),
    number: '',
    type: 'mobile',
  })
}

function removePhone(contactIdx: number, phoneIdx: number) {
  const contact = contacts.value[contactIdx]
  if (contact && contact.phones.length > 1) {
    contact.phones.splice(phoneIdx, 1)
  }
}

function addEmail(contactIdx: number) {
  contacts.value[contactIdx]?.emails.push('')
}

function removeEmail(contactIdx: number, emailIdx: number) {
  const contact = contacts.value[contactIdx]
  if (contact && contact.emails.length > 1) {
    contact.emails.splice(emailIdx, 1)
  }
}

function onPhoneInput(contactIdx: number, phoneIdx: number, event: Event) {
  const input = event.target as HTMLInputElement
  const formatted = formatPhoneNumber(input.value)
  const contact = contacts.value[contactIdx]
  const phone = contact?.phones[phoneIdx]
  if (phone) phone.number = formatted
  nextTick(() => {
    input.value = formatted
  })
}

function onSubmit() {
  if (!dealerName.value.trim()) {
    toast.error('Dealer name is required')
    return
  }

  // Clean up contacts
  const cleanContacts = contacts.value
    .filter(c => c.name.trim())
    .map(c => ({
      ...c,
      phones: c.phones.filter(p => p.number.trim()),
      emails: c.emails.filter(e => e.trim()),
      receiveInvoices: c.receiveInvoices ?? false,
    }))

  if (props.dealer) {
    updateDealer(props.dealer.id, {
      dealerName: dealerName.value.trim(),
      address: address.value.trim(),
      status: status.value,
      isTaxApplied: isTaxApplied.value,
      taxPercentage: taxPercentage.value,
      contacts: cleanContacts,
    })
    toast.success('Dealer updated')
  }
  else {
    let finalServices: any[] = []
    if (copyFromDealerId.value) {
      const sourceDealer = dealers.value.find(d => d.id === copyFromDealerId.value)
      if (sourceDealer && sourceDealer.services) {
        finalServices = sourceDealer.services.map(s => {
          const calculatedTax = isTaxApplied.value ? (s.amount * taxPercentage.value) / 100 : 0
          return {
            id: generateObjectId(),
            service: s.service,
            amount: s.amount,
            tax: calculatedTax,
            total: s.amount + calculatedTax,
          }
        })
      }
    }

    addDealer({
      dealerName: dealerName.value.trim(),
      address: address.value.trim(),
      status: status.value,
      isTaxApplied: isTaxApplied.value,
      taxPercentage: taxPercentage.value,
      contacts: cleanContacts,
      services: finalServices,
    })
    toast.success('Dealer added')
  }
  emit('saved')
  isOpen.value = false
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="max-w-2xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ dealer ? 'Edit Dealer' : 'Add Dealer' }}</DialogTitle>
        <DialogDescription>
          {{ dealer ? 'Update dealer information below.' : 'Fill in the details to add a new dealer.' }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-6 py-2">
        <!-- Basic Info -->
        <div class="grid gap-4">
          <div class="grid gap-2">
            <Label for="dealer-name">Dealer Name *</Label>
            <Input id="dealer-name" v-model="dealerName" placeholder="e.g. AutoPrime Motors" />
          </div>
          <div class="grid gap-2">
            <Label for="dealer-address">Address</Label>
            <Input id="dealer-address" v-model="address" placeholder="Full address" />
          </div>
          <div class="grid gap-2">
            <Label>Status</Label>
            <Select v-model="status">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="s in statusOptions" :key="s" :value="s">
                  {{ s }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex items-center justify-between border rounded-lg p-3 bg-muted/5">
            <div class="space-y-0.5">
              <Label class="text-sm">Apply Tax</Label>
              <p class="text-[11px] text-muted-foreground">Apply dealer-specific tax to all work orders.</p>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="isTaxApplied"
              @click.stop.prevent="isTaxApplied = !isTaxApplied"
              class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              :class="isTaxApplied ? 'bg-primary' : 'bg-input'"
            >
              <span
                class="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200 ease-in-out"
                :class="isTaxApplied ? 'translate-x-5' : 'translate-x-0'"
              />
            </button>
          </div>
          <div v-if="isTaxApplied" class="grid gap-2 animate-in fade-in slide-in-from-top-1">
            <Label>Tax Percentage (%)</Label>
            <Input type="number" step="0.01" v-model.number="taxPercentage" placeholder="0.00" />
          </div>
          <div v-if="!dealer" class="grid gap-2">
            <Label>Copy Services From</Label>
            <p class="text-[11px] text-muted-foreground -mt-1">Optional. Copy all services and base prices from an existing dealer.</p>
            <Select v-model="copyFromDealerId">
              <SelectTrigger>
                <SelectValue placeholder="Select a dealer to copy from..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="d in dealers" :key="d.id" :value="d.id">
                  {{ d.dealerName }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        <!-- Contacts -->
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <Label class="text-base font-semibold">Contacts</Label>
            <Button variant="outline" size="sm" @click="addContact">
              <Plus class="size-3.5 mr-1" />
              Add Contact
            </Button>
          </div>

          <div
            v-for="(contact, ci) in contacts"
            :key="contact.id"
            class="border rounded-lg p-4 space-y-4 relative"
          >
            <Button
              v-if="contacts.length > 1"
              variant="ghost"
              size="icon"
              class="absolute top-2 right-2 size-7"
              @click="removeContact(ci)"
            >
              <X class="size-3.5" />
            </Button>

            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-2">
                <Label>Name</Label>
                <Input v-model="contact.name" placeholder="Contact name" />
              </div>
              <div class="grid gap-2">
                <Label>Designation</Label>
                <Input v-model="contact.designation" placeholder="e.g. Manager" />
              </div>
            </div>

            <!-- Phones -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <Label class="text-xs text-muted-foreground">Phone Numbers</Label>
                <Button variant="ghost" size="sm" class="h-6 text-xs" @click="addPhone(ci)">
                  <Plus class="size-3 mr-1" />
                  Add
                </Button>
              </div>
              <div
                v-for="(phone, pi) in contact.phones"
                :key="phone.id"
                class="flex items-center gap-2"
              >
                <Input
                  :value="phone.number"
                  placeholder="(000) 000-0000"
                  class="flex-1"
                  @input="onPhoneInput(ci, pi, $event)"
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
                <Button
                  v-if="contact.phones.length > 1"
                  variant="ghost"
                  size="icon"
                  class="size-8 shrink-0"
                  @click="removePhone(ci, pi)"
                >
                  <Trash2 class="size-3.5" />
                </Button>
              </div>
            </div>

            <!-- Emails -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <Label class="text-xs text-muted-foreground">Email Addresses</Label>
                <Button variant="ghost" size="sm" class="h-6 text-xs" @click="addEmail(ci)">
                  <Plus class="size-3 mr-1" />
                  Add
                </Button>
              </div>
              <div
                v-for="(_, ei) in contact.emails"
                :key="ei"
                class="flex items-center gap-2"
              >
                <Input
                  v-model="contact.emails[ei]"
                  type="email"
                  placeholder="email@example.com"
                  class="flex-1"
                />
                <Button
                  v-if="contact.emails.length > 1"
                  variant="ghost"
                  size="icon"
                  class="size-8 shrink-0"
                  @click="removeEmail(ci, ei)"
                >
                  <Trash2 class="size-3.5" />
                </Button>
              </div>
            </div>

            <!-- Preferred Contact Method -->
            <div class="grid gap-2">
              <Label class="text-xs text-muted-foreground">Preferred Contact Method</Label>
              <Select v-model="contact.preferredContactMethod">
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

            <!-- Receive Invoices Toggle -->
            <div class="flex items-center justify-between border rounded-lg p-3 bg-muted/5 mt-2">
              <div class="space-y-0.5">
                <Label class="text-sm">Receive Invoices</Label>
                <p class="text-[11px] text-muted-foreground">Automatically send invoices to this contact's email.</p>
              </div>
              <Switch :checked="contact.receiveInvoices" @update:checked="contact.receiveInvoices = $event" />
            </div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="isOpen = false">
          Cancel
        </Button>
        <Button @click="onSubmit">
          {{ dealer ? 'Save Changes' : 'Add Dealer' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
