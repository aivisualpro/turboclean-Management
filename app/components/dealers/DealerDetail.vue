<script setup lang="ts">
import type { Dealer, DealerStatus } from '~/composables/useDealers'
import { format } from 'date-fns'
import { ArrowLeft, Building2, Edit, Mail, MapPin, MoreVertical, Phone, Trash2, User } from 'lucide-vue-next'

interface Props {
  dealer: Dealer | undefined
}

const props = defineProps<Props>()
const emit = defineEmits(['close', 'edit', 'delete', 'statusChange'])

function getStatusColor(status: string) {
  switch (status) {
    case 'Authorised': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
    case 'Pending': return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
    case 'Rejected': return 'bg-red-500/10 text-red-600 border-red-500/20'
    case 'In Followup': return 'bg-blue-500/10 text-blue-600 border-blue-500/20'
    default: return 'bg-muted text-muted-foreground'
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

const statuses: DealerStatus[] = ['Authorised', 'Pending', 'Rejected', 'In Followup']
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Toolbar -->
    <div class="flex items-center p-2">
      <div class="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" @click="emit('close')">
              <ArrowLeft class="size-4" />
              <span class="sr-only">Back</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Back</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" :disabled="!dealer" @click="emit('edit', dealer)">
              <Edit class="size-4" />
              <span class="sr-only">Edit</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit dealer</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" :disabled="!dealer" @click="emit('delete', dealer?.id)">
              <Trash2 class="size-4" />
              <span class="sr-only">Delete</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete dealer</TooltipContent>
        </Tooltip>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" :disabled="!dealer">
              <MoreVertical class="size-4" />
              <span class="sr-only">More</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Change Status</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              v-for="s in statuses"
              :key="s"
              @click="emit('statusChange', dealer?.id, s)"
            >
              <Badge variant="outline" :class="getStatusColor(s)" class="mr-2 text-[10px]">
                {{ s }}
              </Badge>
              {{ s }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    <Separator />

    <!-- Content -->
    <div v-if="dealer" class="flex-1 overflow-auto">
      <!-- Header -->
      <div class="p-6 space-y-4">
        <div class="flex items-start justify-between">
          <div class="space-y-1">
            <div class="flex items-center gap-3">
              <div class="flex items-center justify-center size-10 rounded-lg bg-primary/10">
                <Building2 class="size-5 text-primary" />
              </div>
              <div>
                <h2 class="text-xl font-bold">{{ dealer.dealerName }}</h2>
                <div class="flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin class="size-3.5" />
                  {{ dealer.address }}
                </div>
              </div>
            </div>
          </div>
          <Badge variant="outline" :class="getStatusColor(dealer.status)" class="text-xs px-2 py-0.5">
            {{ dealer.status }}
          </Badge>
        </div>

        <div class="flex gap-4 text-xs text-muted-foreground">
          <span>Created {{ format(new Date(dealer.createdAt), 'PPP') }}</span>
          <span>·</span>
          <span>Updated {{ format(new Date(dealer.updatedAt), 'PPP') }}</span>
        </div>
      </div>

      <Separator />

      <!-- Contacts -->
      <div class="p-6 space-y-6">
        <h3 class="text-sm font-semibold flex items-center gap-2">
          <User class="size-4" />
          Contacts ({{ dealer.contacts.length }})
        </h3>

        <div
          v-for="contact in dealer.contacts"
          :key="contact.id"
          class="rounded-lg border p-4 space-y-3"
        >
          <div class="flex items-center justify-between">
            <div>
              <div class="font-semibold">{{ contact.name }}</div>
              <div class="text-sm text-muted-foreground">{{ contact.designation }}</div>
            </div>
            <Badge variant="secondary" class="text-[10px]">
              Preferred: {{ getPreferredLabel(contact.preferredContactMethod) }}
            </Badge>
          </div>

          <!-- Phones -->
          <div v-if="contact.phones.length" class="space-y-1">
            <div
              v-for="phone in contact.phones"
              :key="phone.id"
              class="flex items-center gap-2 text-sm"
            >
              <Icon :name="getPhoneIcon(phone.type)" class="size-3.5 text-muted-foreground" />
              <span>{{ phone.number }}</span>
              <Badge variant="outline" class="text-[9px] px-1 py-0 capitalize">
                {{ phone.type }}
              </Badge>
            </div>
          </div>

          <!-- Emails -->
          <div v-if="contact.emails.length" class="space-y-1">
            <div
              v-for="email in contact.emails"
              :key="email"
              class="flex items-center gap-2 text-sm"
            >
              <Mail class="size-3.5 text-muted-foreground" />
              <span>{{ email }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="flex-1 flex items-center justify-center">
      <div class="text-center space-y-2">
        <Building2 class="size-12 mx-auto text-muted-foreground/30" />
        <p class="text-muted-foreground">Select a dealer to view details</p>
      </div>
    </div>
  </div>
</template>
