<script setup lang="ts">
import type { Dealer, DealerStatus } from '~/composables/useDealers'
import { useServices } from '~/composables/useServices'
import { format } from 'date-fns'
import {
  ArrowLeft,
  Building2,
  Edit,
  Mail,
  MapPin,
  MoreVertical,
  Phone,
  Trash2,
  User,
  Briefcase,
  Calendar,
  DollarSign
} from 'lucide-vue-next'

interface Props {
  dealer: Dealer | undefined
}

const props = defineProps<Props>()
const emit = defineEmits(['close', 'edit', 'delete', 'statusChange'])

const { services } = useServices()

function getServiceName(serviceId: string) {
  const s = services.value.find(s => s.id === serviceId)
  return s ? s.service : 'Unknown Service'
}

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

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

const statuses: DealerStatus[] = ['Authorised', 'Pending', 'Rejected', 'In Followup']
</script>

<template>
  <div class="h-full flex flex-col bg-background relative">
    <!-- Empty state -->
    <div v-if="!dealer" class="flex-1 flex items-center justify-center">
      <div class="text-center space-y-3">
        <div class="relative w-20 h-20 mx-auto">
          <div class="absolute inset-0 bg-muted/20 rounded-full animate-ping"></div>
          <div class="relative flex items-center justify-center w-full h-full bg-muted/30 rounded-full border border-border">
            <Building2 class="size-8 text-muted-foreground/50" />
          </div>
        </div>
        <div class="space-y-1">
          <p class="text-lg font-medium text-foreground">No Dealer Selected</p>
          <p class="text-sm text-muted-foreground">Choose a dealer from the list to view their details.</p>
        </div>
      </div>
    </div>

    <template v-else>
      <!-- Toolbar -->
      <div class="flex items-center p-3 border-b bg-card">
        <div class="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" @click="emit('close')" class="shrink-0 h-8 w-8">
                <ArrowLeft class="size-4" />
                <span class="sr-only">Back</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back to list</TooltipContent>
          </Tooltip>
        </div>
        
        <div class="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" size="sm" class="h-8 gap-2 bg-background">
                <Badge variant="secondary" :class="getStatusColor(dealer.status)" class="text-[10px] px-1 py-0 shadow-none border-transparent h-4 leading-none">
                  {{ dealer.status }}
                </Badge>
                <MoreVertical class="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-48">
              <DropdownMenuLabel>Update Status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                v-for="s in statuses"
                :key="s"
                @click="emit('statusChange', dealer?.id, s)"
                class="flex items-center justify-between cursor-pointer"
              >
                <span>{{ s }}</span>
                <div v-if="s === dealer.status" class="size-2 rounded-full bg-primary"></div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="outline" size="icon" class="h-8 w-8 text-muted-foreground" @click="emit('edit', dealer)">
                <Edit class="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit details</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="outline" size="icon" class="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20" @click="emit('delete', dealer?.id)">
                <Trash2 class="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent class="text-destructive">Delete record</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div class="flex-1 overflow-auto">
        <!-- Hero Header -->
        <div class="p-6 md:p-8 bg-gradient-to-b from-muted/30 to-background border-b relative overflow-hidden">
          <div class="absolute right-0 top-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
          
          <div class="max-w-4xl mx-auto space-y-6 relative z-10">
            <div class="flex items-start gap-5">
              <div class="flex items-center justify-center size-16 shrink-0 rounded-2xl bg-card border shadow-sm ring-1 ring-black/5">
                <Building2 class="size-8 text-primary/70" />
              </div>
              <div class="space-y-1.5 flex-1 pt-1">
                <h2 class="text-2xl md:text-3xl font-bold tracking-tight text-foreground">{{ dealer.dealerName }}</h2>
                <div class="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin class="size-4 shrink-0 text-primary/60" />
                  <span class="truncate">{{ dealer.address || 'No address provided' }}</span>
                </div>
              </div>
            </div>

          </div>
        </div>

        <div class="p-4 md:p-6 max-w-4xl mx-auto">
          <Tabs defaultValue="contacts" class="w-full">
            <TabsList class="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent space-x-6 mb-6">
              <TabsTrigger 
                value="contacts" 
                class="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium transition-none text-muted-foreground data-[state=active]:text-foreground"
              >
                <div class="flex items-center gap-2">
                  <User class="size-4" />
                  Contacts 
                  <Badge variant="secondary" class="ml-1 px-1.5 py-0 h-5 text-[10px]">{{ dealer.contacts.length }}</Badge>
                </div>
              </TabsTrigger>
              <TabsTrigger 
                value="services" 
                class="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 font-medium transition-none text-muted-foreground data-[state=active]:text-foreground"
              >
                <div class="flex items-center gap-2">
                  <Briefcase class="size-4" />
                  Services Configured
                  <Badge variant="secondary" class="ml-1 px-1.5 py-0 h-5 text-[10px]">{{ dealer.services?.length || 0 }}</Badge>
                </div>
              </TabsTrigger>
            </TabsList>

            <!-- Contacts Tab -->
            <TabsContent value="contacts" class="m-0 mt-4 outline-none">
              <div v-if="!dealer.contacts.length" class="text-center py-12 px-4 border rounded-xl border-dashed bg-muted/10">
                <User class="size-10 mx-auto text-muted-foreground/30 mb-3" />
                <h4 class="text-base font-medium">No Contacts</h4>
                <p class="text-sm text-muted-foreground max-w-sm mx-auto mt-1">This dealer doesn't have any associated contacts yet. Edit the dealer to add primary personnel.</p>
              </div>

              <div v-else class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Card 
                  v-for="contact in dealer.contacts" 
                  :key="contact.id" 
                  class="overflow-hidden border shadow-sm transition-all hover:shadow-md"
                >
                  <div class="p-4 bg-muted/20 border-b flex items-center justify-between">
                    <div class="flex items-center gap-3">
                      <Avatar class="size-10 border border-border bg-background shadow-sm">
                        <AvatarFallback class="bg-primary/5 text-primary font-medium">
                          {{ contact.name.slice(0, 2).toUpperCase() }}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h4 class="font-semibold text-sm leading-none">{{ contact.name }}</h4>
                        <p class="text-xs text-muted-foreground mt-1.5">{{ contact.designation || 'Representative' }}</p>
                      </div>
                    </div>
                    <Badge variant="outline" class="text-[10px] capitalize bg-background shadow-sm">
                      Prefers {{ getPreferredLabel(contact.preferredContactMethod) }}
                    </Badge>
                  </div>
                  
                  <div class="p-4 space-y-3 bg-card">
                    <div v-if="contact.phones.length" class="space-y-2">
                      <div v-for="phone in contact.phones" :key="phone.id" class="flex items-center justify-between group">
                        <div class="flex items-center gap-2.5 text-sm">
                          <div class="size-6 rounded bg-muted flex items-center justify-center shrink-0">
                            <Icon :name="getPhoneIcon(phone.type)" class="size-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                          </div>
                          <span class="font-medium tracking-tight text-card-foreground">{{ phone.number }}</span>
                        </div>
                        <Badge variant="secondary" class="text-[9px] px-1.5 py-0 h-4.5 capitalize opacity-70 group-hover:opacity-100 transition-opacity">
                          {{ phone.type }}
                        </Badge>
                      </div>
                    </div>
                    
                    <Separator v-if="contact.phones.length && contact.emails.length" class="opacity-50" />

                    <div v-if="contact.emails.length" class="space-y-2">
                      <div v-for="email in contact.emails" :key="email" class="flex items-center gap-2.5 text-sm group">
                        <div class="size-6 rounded bg-muted flex items-center justify-center shrink-0">
                          <Mail class="size-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                        <a :href="`mailto:${email}`" class="text-muted-foreground hover:text-primary hover:underline transition-colors truncate">
                          {{ email }}
                        </a>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </TabsContent>

            <!-- Services Tab -->
            <TabsContent value="services" class="m-0 mt-4 outline-none">
              <div v-if="!dealer.services?.length" class="text-center py-12 px-4 border rounded-xl border-dashed bg-muted/10">
                <Briefcase class="size-10 mx-auto text-muted-foreground/30 mb-3" />
                <h4 class="text-base font-medium">No Services Configured</h4>
                <p class="text-sm text-muted-foreground max-w-sm mx-auto mt-1">There are no individual service rules defined for this dealer. Use the blanket import tool to map services.</p>
              </div>

              <div v-else class="border rounded-xl shadow-sm overflow-hidden bg-card">
                <div class="overflow-x-auto">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="bg-muted/50 border-b">
                        <th class="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Service</th>
                        <th class="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider w-32">Amount</th>
                        <th class="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider w-24">Tax</th>
                        <th class="h-10 px-4 text-right font-bold text-foreground text-xs uppercase tracking-wider w-32 bg-muted/30">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(srv, i) in dealer.services" :key="i" class="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td class="px-4 py-3 font-medium text-foreground">
                          <div class="flex items-center gap-3">
                            <span class="inline-flex items-center justify-center size-5 rounded-full bg-primary/10 text-primary text-[10px] shrink-0 font-bold">
                              {{ i + 1 }}
                            </span>
                            <div class="flex flex-col gap-0.5 min-w-0">
                              <span class="truncate font-semibold text-sm" :title="getServiceName(srv.service)">{{ getServiceName(srv.service) }}</span>
                            </div>
                          </div>
                        </td>
                        <td class="px-4 py-3 text-right tabular-nums text-muted-foreground text-xs">{{ formatCurrency(srv.amount) }}</td>
                        <td class="px-4 py-3 text-right tabular-nums text-muted-foreground text-xs">{{ formatCurrency(srv.tax) }}</td>
                        <td class="px-4 py-3 text-right tabular-nums font-semibold text-foreground bg-muted/5">{{ formatCurrency(srv.total) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div class="bg-muted/30 border-t p-4 flex justify-between items-center">
                  <span class="text-xs text-muted-foreground">Showing {{ dealer.services.length }} assigned services</span>
                  <div class="hidden">
                    <!-- Can add total calculation if needed in future -->
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </template>
  </div>
</template>
