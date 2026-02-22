<script setup lang="ts">
import type { Dealer } from '~/composables/useDealers'

definePageMeta({ layout: 'default' })
const props = defineProps<{ dealer: Dealer }>()

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
    <div v-if="!dealer.contacts.length" class="flex-1 flex items-center justify-center">
      <div class="text-center py-14 px-4">
        <Icon name="i-lucide-users" class="size-10 text-muted-foreground/30 mx-auto mb-3" />
        <h4 class="text-sm font-semibold text-foreground">No Contacts</h4>
        <p class="text-xs text-muted-foreground max-w-xs mx-auto mt-1.5">Edit the dealer to add contacts.</p>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="contact in dealer.contacts" :key="contact.id" class="hover:bg-muted/50">
              <TableCell class="font-medium text-xs">
                <div class="flex items-center gap-2.5">
                  <Avatar class="size-7 border bg-background">
                    <AvatarFallback class="bg-primary/5 text-primary text-[10px] font-semibold">
                      {{ contact.name.slice(0, 2).toUpperCase() }}
                    </AvatarFallback>
                  </Avatar>
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
            </TableRow>
          </TableBody>
        </table>
      </div>
      <div class="bg-muted/10 border-t px-4 py-2.5 shrink-0">
        <span class="text-[11px] text-muted-foreground font-medium">{{ dealer.contacts.length }} contacts</span>
      </div>
    </template>
  </div>
</template>
