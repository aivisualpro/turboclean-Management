<script setup lang="ts">
import type { Dealer, DealerStatus } from '~/composables/useDealers'
import { useServices } from '~/composables/useServices'
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
  DollarSign,
  Receipt,
  MailCheck,
  WrenchIcon,
  Loader2,
  Hash,
  Clock,
  TrendingUp,
  ExternalLink
} from 'lucide-vue-next'

interface Props {
  dealer: Dealer | undefined
}

const props = defineProps<Props>()
const emit = defineEmits(['close', 'edit', 'delete', 'statusChange'])

const { services } = useServices()

// Tab state
const activeTab = ref('services')

// Work orders state
const dealerWorkOrders = ref<any[]>([])
const woLoading = ref(false)
const woTotalCount = ref(0)

async function fetchDealerWorkOrders() {
  if (!props.dealer?.id) return
  woLoading.value = true
  try {
    const res = await $fetch('/api/work-orders', {
      query: { dealerId: props.dealer.id, limit: 200, skip: 0, sortBy: 'date', sortDir: -1 }
    })
    // @ts-ignore
    dealerWorkOrders.value = res.workOrders || []
    // @ts-ignore
    woTotalCount.value = res.totalCount || 0
  } catch (err) {
    console.error('Failed to fetch dealer work orders:', err)
  } finally {
    woLoading.value = false
  }
}

// Computed stats
const woStats = computed(() => {
  const orders = dealerWorkOrders.value
  const totalRevenue = orders.reduce((sum: number, wo: any) => sum + (wo.total || 0), 0)
  const invoicedCount = orders.filter((wo: any) => wo.isInvoiced).length
  return { count: orders.length, totalRevenue, invoicedCount }
})

// Watch for dealer change and fetch work orders
watch(() => props.dealer?.id, (newVal) => {
  if (newVal) {
    dealerWorkOrders.value = []
    woTotalCount.value = 0
    fetchDealerWorkOrders()
  }
}, { immediate: true })

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

function getStatusDot(status: string) {
  switch (status) {
    case 'Authorised': return 'bg-emerald-500'
    case 'Pending': return 'bg-amber-500'
    case 'Rejected': return 'bg-red-500'
    case 'In Followup': return 'bg-blue-500'
    default: return 'bg-muted-foreground'
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

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const statuses: DealerStatus[] = ['Authorised', 'Pending', 'Rejected', 'In Followup']
</script>

<template>
  <div class="h-full flex flex-col bg-background/50 relative">
    <!-- Empty state -->
    <div v-if="!dealer" class="flex-1 flex items-center justify-center">
      <div class="text-center space-y-4">
        <div class="relative w-20 h-20 mx-auto">
          <div class="absolute inset-0 bg-primary/5 rounded-full animate-pulse"></div>
          <div class="relative flex items-center justify-center w-full h-full bg-muted/30 rounded-full border border-border">
            <Building2 class="size-8 text-muted-foreground/40" />
          </div>
        </div>
        <div class="space-y-1">
          <p class="text-lg font-semibold text-foreground">No Dealer Selected</p>
          <p class="text-sm text-muted-foreground max-w-xs mx-auto">Choose a dealer from the list to view their full profile.</p>
        </div>
      </div>
    </div>

    <template v-else>
      <!-- Compact Toolbar -->
      <div class="flex items-center px-4 py-2.5 border-b bg-card/80 backdrop-blur-sm shrink-0">
        <div class="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" @click="emit('close')" class="shrink-0 h-7 w-7">
            <ArrowLeft class="size-3.5" />
          </Button>
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="size-8 rounded-lg bg-primary/10 border flex items-center justify-center shrink-0">
              <Building2 class="size-4 text-primary" />
            </div>
            <div class="min-w-0">
              <h2 class="text-sm font-bold truncate leading-tight">{{ dealer.dealerName }}</h2>
              <div class="flex items-center gap-1 text-[11px] text-muted-foreground leading-tight">
                <div class="size-1.5 rounded-full shrink-0" :class="getStatusDot(dealer.status)"></div>
                {{ dealer.status }}
              </div>
            </div>
          </div>
        </div>
        <div class="ml-auto flex items-center gap-1.5 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" size="sm" class="h-7 text-xs px-2 gap-1.5">
                <Badge variant="secondary" :class="getStatusColor(dealer.status)" class="text-[9px] px-1 py-0 shadow-none border-transparent h-3.5 leading-none">
                  {{ dealer.status }}
                </Badge>
                <MoreVertical class="size-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-44">
              <DropdownMenuLabel class="text-xs">Update Status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                v-for="s in statuses"
                :key="s"
                @click="emit('statusChange', dealer?.id, s)"
                class="flex items-center justify-between cursor-pointer text-xs"
              >
                <span>{{ s }}</span>
                <div v-if="s === dealer.status" class="size-1.5 rounded-full bg-primary"></div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground hover:text-foreground" @click="emit('edit', dealer)">
            <Edit class="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground hover:text-destructive" @click="emit('delete', dealer?.id)">
            <Trash2 class="size-3.5" />
          </Button>
        </div>
      </div>

      <!-- Main Scrollable Content -->
      <div class="flex-1 overflow-auto">
        <div class="p-4 md:p-5">
          <div class="w-full">
            <!-- Tab Navigation (same style as /reports/sales) -->
            <div class="flex items-center gap-1 border rounded-lg p-1 bg-muted/30 w-fit mb-5 overflow-x-auto">
              <button
                v-for="tab in [
                  { id: 'services', label: 'Services', icon: 'i-lucide-briefcase', count: dealer.services?.length || 0 },
                  { id: 'contacts', label: 'Contacts', icon: 'i-lucide-users', count: dealer.contacts.length },
                  { id: 'work-orders', label: 'Work Orders', icon: 'i-lucide-wrench', count: woTotalCount },
                  { id: 'invoices', label: 'Invoices', icon: 'i-lucide-receipt' },
                  { id: 'emails', label: 'Emails', icon: 'i-lucide-mail-check' },
                ]"
                :key="tab.id"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap" :class="[
                  activeTab === tab.id ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
                ]"
                @click="activeTab = tab.id"
              >
                <Icon :name="tab.icon" class="size-3.5" />
                {{ tab.label }}
                <Badge v-if="tab.count !== undefined && tab.count > 0" variant="secondary" class="px-1 py-0 h-4 text-[9px] leading-none ml-0.5" :class="activeTab === tab.id ? 'bg-primary/10 text-primary' : 'bg-muted'">{{ tab.count }}</Badge>
              </button>
            </div>

            <!-- Services Tab -->
            <template v-if="activeTab === 'services'">
              <div v-if="!dealer.services?.length" class="text-center py-14 px-4 border rounded-xl border-dashed bg-muted/5">
                <div class="size-11 rounded-xl bg-muted/50 flex items-center justify-center mx-auto mb-3 border">
                  <Briefcase class="size-5 text-muted-foreground/60" />
                </div>
                <h4 class="text-sm font-semibold text-foreground">No Services Configured</h4>
                <p class="text-xs text-muted-foreground max-w-xs mx-auto mt-1.5">Import services to configure pricing rates.</p>
              </div>

              <div v-else class="border rounded-xl shadow-sm overflow-hidden bg-card">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="bg-muted/20 border-b">
                      <th class="h-9 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Service</th>
                      <th class="h-9 px-3 text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-28">Amount</th>
                      <th class="h-9 px-3 text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-20">Tax</th>
                      <th class="h-9 px-3 text-right text-[11px] font-semibold text-foreground uppercase tracking-wider w-28 bg-muted/10">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(srv, i) in dealer.services" :key="i" class="border-b last:border-0 hover:bg-muted/5 transition-colors">
                      <td class="px-3 py-2.5">
                        <div class="flex items-center gap-2.5">
                          <span class="inline-flex items-center justify-center size-5 rounded bg-primary/10 text-primary text-[10px] shrink-0 font-bold">{{ i + 1 }}</span>
                          <span class="text-xs font-semibold text-foreground truncate" :title="getServiceName(srv.service)">{{ getServiceName(srv.service) }}</span>
                        </div>
                      </td>
                      <td class="px-3 py-2.5 text-right tabular-nums text-xs text-muted-foreground">{{ fmt(srv.amount) }}</td>
                      <td class="px-3 py-2.5 text-right tabular-nums text-xs text-muted-foreground">{{ fmt(srv.tax) }}</td>
                      <td class="px-3 py-2.5 text-right tabular-nums text-xs font-semibold text-foreground bg-muted/[0.03]">{{ fmt(srv.total) }}</td>
                    </tr>
                  </tbody>
                </table>
                <div class="bg-muted/10 border-t px-3 py-2 flex justify-between items-center">
                  <span class="text-[11px] text-muted-foreground font-medium">{{ dealer.services.length }} services configured</span>
                  <span class="text-[11px] font-semibold text-foreground">Total: {{ fmt(dealer.services.reduce((s, v) => s + v.total, 0)) }}</span>
                </div>
              </div>
            </template>

            <!-- Contacts Tab -->
            <template v-if="activeTab === 'contacts'">
              <div v-if="!dealer.contacts.length" class="text-center py-14 px-4 border rounded-xl border-dashed bg-muted/5">
                <div class="size-11 rounded-xl bg-muted/50 flex items-center justify-center mx-auto mb-3 border">
                  <User class="size-5 text-muted-foreground/60" />
                </div>
                <h4 class="text-sm font-semibold text-foreground">No Contacts</h4>
                <p class="text-xs text-muted-foreground max-w-xs mx-auto mt-1.5">Edit the dealer to add contacts.</p>
              </div>

              <div v-else class="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <div 
                  v-for="contact in dealer.contacts" 
                  :key="contact.id" 
                  class="border rounded-xl overflow-hidden bg-card shadow-sm hover:shadow-md transition-all"
                >
                  <div class="p-3 bg-muted/5 border-b flex items-center justify-between">
                    <div class="flex items-center gap-2.5">
                      <Avatar class="size-8 border bg-background shadow-sm">
                        <AvatarFallback class="bg-primary/5 text-primary text-xs font-semibold">
                          {{ contact.name.slice(0, 2).toUpperCase() }}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h4 class="text-xs font-bold leading-none text-foreground">{{ contact.name }}</h4>
                        <p class="text-[10px] text-muted-foreground mt-1">{{ contact.designation || 'Representative' }}</p>
                      </div>
                    </div>
                    <Badge variant="outline" class="text-[9px] capitalize bg-background h-5">
                      {{ getPreferredLabel(contact.preferredContactMethod) }}
                    </Badge>
                  </div>
                  <div class="p-3 space-y-2">
                    <div v-for="phone in contact.phones" :key="phone.id" class="flex items-center justify-between group p-1.5 -mx-1.5 rounded-md hover:bg-muted/40 transition-colors">
                      <div class="flex items-center gap-2 text-xs">
                        <div class="size-5 rounded bg-background border flex items-center justify-center shrink-0">
                          <Icon :name="getPhoneIcon(phone.type)" class="size-3 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                        <span class="font-medium text-foreground tabular-nums">{{ phone.number }}</span>
                      </div>
                      <span class="text-[9px] text-muted-foreground capitalize">{{ phone.type }}</span>
                    </div>
                    <Separator v-if="contact.phones.length && contact.emails.length" class="opacity-20" />
                    <div v-for="email in contact.emails" :key="email" class="flex items-center gap-2 text-xs group p-1.5 -mx-1.5 rounded-md hover:bg-muted/40 transition-colors">
                      <div class="size-5 rounded bg-background border flex items-center justify-center shrink-0">
                        <Mail class="size-3 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                      <a :href="`mailto:${email}`" class="text-muted-foreground hover:text-primary transition-colors truncate text-xs">{{ email }}</a>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Work Orders Tab (LIVE DATA) -->
            <template v-if="activeTab === 'work-orders'">
              <!-- Loading -->
              <div v-if="woLoading" class="text-center py-14">
                <Loader2 class="size-6 animate-spin text-muted-foreground mx-auto" />
                <p class="text-xs text-muted-foreground mt-3">Loading work orders...</p>
              </div>

              <!-- Empty -->
              <div v-else-if="dealerWorkOrders.length === 0" class="text-center py-14 px-4 border rounded-xl border-dashed bg-muted/5">
                <div class="size-11 rounded-xl bg-muted/50 flex items-center justify-center mx-auto mb-3 border">
                  <WrenchIcon class="size-5 text-muted-foreground/60" />
                </div>
                <h4 class="text-sm font-semibold text-foreground">No Work Orders</h4>
                <p class="text-xs text-muted-foreground max-w-xs mx-auto mt-1.5">No work orders found for this dealer.</p>
              </div>

              <!-- Work Orders Table -->
              <div v-else>
                <!-- Summary Stats -->
                <div class="grid grid-cols-3 gap-2.5 mb-4">
                  <div class="bg-card border rounded-lg p-3 text-center">
                    <div class="text-lg font-bold text-foreground tabular-nums">{{ woStats.count }}</div>
                    <div class="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mt-0.5">Work Orders</div>
                  </div>
                  <div class="bg-card border rounded-lg p-3 text-center">
                    <div class="text-lg font-bold text-emerald-600 tabular-nums">{{ fmt(woStats.totalRevenue) }}</div>
                    <div class="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mt-0.5">Total Revenue</div>
                  </div>
                  <div class="bg-card border rounded-lg p-3 text-center">
                    <div class="text-lg font-bold text-foreground tabular-nums">{{ woStats.invoicedCount }}<span class="text-muted-foreground font-normal text-xs">/{{ woStats.count }}</span></div>
                    <div class="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mt-0.5">Invoiced</div>
                  </div>
                </div>

                <!-- Table -->
                <div class="border rounded-xl shadow-sm overflow-hidden bg-card">
                  <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                      <thead>
                        <tr class="bg-muted/20 border-b">
                          <th class="h-9 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                          <th class="h-9 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Stock #</th>
                          <th class="h-9 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">VIN</th>
                          <th class="h-9 px-3 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Service</th>
                          <th class="h-9 px-3 text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                          <th class="h-9 px-3 text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Tax</th>
                          <th class="h-9 px-3 text-right text-[11px] font-semibold text-foreground uppercase tracking-wider bg-muted/10">Total</th>
                          <th class="h-9 px-3 text-center text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-20">Invoiced</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="wo in dealerWorkOrders" :key="wo.id" class="border-b last:border-0 hover:bg-muted/5 transition-colors">
                          <td class="px-3 py-2 text-xs font-medium whitespace-nowrap">{{ fmtDate(wo.date) }}</td>
                          <td class="px-3 py-2 text-xs">{{ wo.stockNumber }}</td>
                          <td class="px-3 py-2 text-xs font-mono text-muted-foreground uppercase">{{ wo.vin || '—' }}</td>
                          <td class="px-3 py-2 text-xs truncate max-w-[140px]" :title="wo.dealerServiceId">{{ wo.dealerServiceId }}</td>
                          <td class="px-3 py-2 text-xs text-right tabular-nums text-muted-foreground">{{ fmt(wo.amount) }}</td>
                          <td class="px-3 py-2 text-xs text-right tabular-nums text-muted-foreground">{{ fmt(wo.tax) }}</td>
                          <td class="px-3 py-2 text-xs text-right tabular-nums font-semibold bg-muted/[0.03]">{{ fmt(wo.total) }}</td>
                          <td class="px-3 py-2 text-center">
                            <Badge :variant="wo.isInvoiced ? 'default' : 'outline'" :class="wo.isInvoiced ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'text-muted-foreground'" class="text-[9px] px-1.5">
                              {{ wo.isInvoiced ? 'Yes' : 'No' }}
                            </Badge>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div class="bg-muted/10 border-t px-3 py-2 flex justify-between items-center">
                    <span class="text-[11px] text-muted-foreground font-medium">Showing {{ dealerWorkOrders.length }} of {{ woTotalCount }} work orders</span>
                  </div>
                </div>
              </div>
            </template>

            <!-- Invoices Tab -->
            <template v-if="activeTab === 'invoices'">
              <div class="text-center py-14 px-4 border rounded-xl border-dashed bg-muted/5 relative overflow-hidden group">
                <div class="absolute inset-0 bg-gradient-to-br from-blue-500/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                <div class="size-11 rounded-xl bg-gradient-to-b from-muted to-muted/50 flex items-center justify-center mx-auto mb-3 border relative z-10 transition-transform duration-300 group-hover:scale-105">
                  <Receipt class="size-5 text-muted-foreground/60" />
                </div>
                <h4 class="text-sm font-semibold text-foreground relative z-10">Billing & Invoices</h4>
                <p class="text-xs text-muted-foreground max-w-xs mx-auto mt-1.5 relative z-10">Invoice data for this dealer will be integrated here.</p>
              </div>
            </template>

            <!-- Emails Tab -->
            <template v-if="activeTab === 'emails'">
              <div class="text-center py-14 px-4 border rounded-xl border-dashed bg-muted/5 relative overflow-hidden group">
                <div class="absolute inset-0 bg-gradient-to-br from-indigo-500/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                <div class="size-11 rounded-xl bg-gradient-to-b from-muted to-muted/50 flex items-center justify-center mx-auto mb-3 border relative z-10 transition-transform duration-300 group-hover:scale-105">
                  <MailCheck class="size-5 text-muted-foreground/60" />
                </div>
                <h4 class="text-sm font-semibold text-foreground relative z-10">Communication Log</h4>
                <p class="text-xs text-muted-foreground max-w-xs mx-auto mt-1.5 relative z-10">Track emails, notifications, and dispatches for this dealer.</p>
              </div>
            </template>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
