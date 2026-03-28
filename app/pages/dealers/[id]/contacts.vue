<script setup lang="ts">
import type { Dealer, DealerContact } from '~/composables/useDealers'
import { useDealers } from '~/composables/useDealers'
import { Plus, Edit3, Trash2, Zap } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

definePageMeta({ layout: 'default' })
const props = defineProps<{ dealer: Dealer }>()

const { patchDealer } = useDealers()

const showForm = ref(false)
const editingContact = ref<DealerContact | null>(null)

function openAdd() {
  editingContact.value = null
  showForm.value = true
}

function openEdit(contact: DealerContact) {
  editingContact.value = contact
  showForm.value = true
}

async function removeContact(contactId: string) {
  if (!confirm('Are you sure you want to delete this contact?')) return
  const newContacts = props.dealer.contacts.filter(c => c.id !== contactId)
  try {
    await patchDealer(props.dealer.id, { contacts: newContacts })
    toast.success('Contact deleted')
  } catch (err: any) {
    toast.error('Failed to delete contact: ' + err.message)
  }
}

async function toggleReceiveInvoices(contact: DealerContact) {
  const newContacts = props.dealer.contacts.map(c =>
    c.id === contact.id ? { ...c, receiveInvoices: !c.receiveInvoices } : c
  )
  try {
    await patchDealer(props.dealer.id, { contacts: newContacts })
    toast.success(`Auto emails ${!contact.receiveInvoices ? 'enabled' : 'disabled'} for ${contact.name}`)
  } catch (err: any) {
    toast.error('Failed to update: ' + err.message)
  }
}

function getPhoneIcon(type: string) {
  switch (type) {
    case 'mobile': return 'i-lucide-smartphone'
    case 'landline': return 'i-lucide-phone'
    case 'fax': return 'i-lucide-printer'
    default: return 'i-lucide-phone'
  }
}

function getPreferredLabel(method: string) {
  switch (method) {
    case 'phone': return 'Phone'
    case 'email': return 'Email'
    case 'any': return 'Any'
    default: return method
  }
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
    <!-- Header with Add Button -->
    <div class="px-4 py-3 border-b bg-muted/20 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <Icon name="i-lucide-users" class="size-4 text-primary" />
        <h3 class="text-xs font-semibold tracking-wide uppercase text-foreground">Contact Persons</h3>
      </div>
      <Button size="sm" class="h-8 text-xs gap-1.5" @click="openAdd">
        <Plus class="size-3.5" />
        Add Contact
      </Button>
    </div>

    <!-- Empty state -->
    <div v-if="!dealer.contacts.length" class="flex-1 flex items-center justify-center">
      <div class="text-center py-14 px-4">
        <Icon name="i-lucide-users" class="size-10 text-muted-foreground/30 mx-auto mb-3" />
        <h4 class="text-sm font-semibold text-foreground">No Contacts</h4>
        <p class="text-xs text-muted-foreground max-w-xs mx-auto mt-1.5">Click "Add Contact" to add someone to this dealer.</p>
        <Button size="sm" variant="outline" class="mt-4 gap-1.5" @click="openAdd">
          <Plus class="size-3.5" />
          Add Your First Contact
        </Button>
      </div>
    </div>

    <template v-else>
      <div class="h-full overflow-auto">
        <table class="w-full text-sm caption-bottom border-collapse">
          <TableHeader class="sticky top-0 z-10 bg-muted/95 backdrop-blur shadow-sm">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Preferred</TableHead>
              <TableHead class="text-center w-[120px]">Auto Emails</TableHead>
              <TableHead class="text-right w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="contact in dealer.contacts" :key="contact.id" class="hover:bg-muted/50 group/row">
              <TableCell class="font-medium text-xs">
                <div class="flex items-center gap-2.5">
                  <div class="size-1.5 rounded-full bg-primary/60 shrink-0"></div>
                  {{ contact.name }}
                </div>
              </TableCell>
              <TableCell class="text-xs text-muted-foreground">{{ contact.designation || '—' }}</TableCell>
              <TableCell class="text-xs">
                <div class="space-y-1">
                  <div v-for="phone in contact.phones" :key="phone.id" class="flex items-center gap-1.5">
                    <Icon :name="getPhoneIcon(phone.type)" class="size-3 text-muted-foreground" />
                    <span class="tabular-nums">{{ phone.number }}</span>
                    <span class="text-[9px] text-muted-foreground capitalize">({{ phone.type }})</span>
                  </div>
                  <span v-if="!contact.phones.length" class="text-muted-foreground">—</span>
                </div>
              </TableCell>
              <TableCell class="text-xs">
                <div class="space-y-1">
                  <a v-for="email in contact.emails" :key="email" :href="`mailto:${email}`" class="block text-muted-foreground hover:text-primary transition-colors truncate max-w-[200px]">{{ email }}</a>
                  <span v-if="!contact.emails.length" class="text-muted-foreground">—</span>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" class="text-[10px] capitalize">{{ getPreferredLabel(contact.preferredContactMethod) }}</Badge>
              </TableCell>
              <!-- Auto Emails Toggle Cell -->
              <TableCell class="text-center">
                <button
                  type="button"
                  role="switch"
                  :aria-checked="contact.receiveInvoices"
                  @click.stop.prevent="toggleReceiveInvoices(contact)"
                  class="group inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full border transition-all duration-200"
                  :class="contact.receiveInvoices
                    ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20'
                    : 'bg-muted/40 text-muted-foreground border-border/60 hover:bg-muted'"
                >
                  <Zap class="size-3 transition-colors" :class="contact.receiveInvoices ? 'text-primary' : 'text-muted-foreground/50'" />
                  {{ contact.receiveInvoices ? 'On' : 'Off' }}
                </button>
              </TableCell>
              <TableCell class="text-right">
                <div class="flex items-center justify-end gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" class="size-7 hover:bg-primary/10 hover:text-primary transition-colors duration-200" @click="openEdit(contact)">
                    <Edit3 class="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" class="size-7 hover:bg-destructive/10 hover:text-destructive transition-colors duration-200" @click="removeContact(contact.id)">
                    <Trash2 class="size-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </table>
      </div>
      <div class="bg-muted/10 border-t px-4 py-2.5 shrink-0 flex items-center justify-between">
        <span class="text-[11px] text-muted-foreground font-medium">{{ dealer.contacts.length }} contacts</span>
      </div>
    </template>

    <DealersContactForm v-model:open="showForm" :dealer="dealer" :contact="editingContact" @saved="editingContact = null" />
  </div>
</template>
