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
  Trash2,
  User,
  Briefcase,
  Receipt,
  MailCheck,
  WrenchIcon,
} from 'lucide-vue-next'

const route = useRoute()
const dealerId = route.params.id as string

const { setHeader } = usePageHeader()

const { dealers, updateDealer, deleteDealer } = useDealers()

const dealer = computed(() => dealers.value.find(d => d.id === dealerId))

// Active tab label (computed early so header can use it)
const activeTabLabel = computed(() => {
  const pathEnd = route.path.split('/').pop()
  const tabLabels: Record<string, string> = {
    services: 'Services',
    contacts: 'Contacts',
    'work-orders': 'Work Orders',
    invoices: 'Invoices',
    emails: 'Emails',
  }
  return tabLabels[pathEnd || ''] || 'Services'
})

// Set header dynamically
watchEffect(() => {
  if (dealer.value) {
    setHeader({ title: `${dealer.value.dealerName} / ${activeTabLabel.value}`, icon: 'i-lucide-building-2' })
  }
})

const statuses: DealerStatus[] = ['Authorised', 'Pending', 'Rejected', 'In Followup']

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

const showForm = ref(false)
const editingDealer = ref<Dealer | null>(null)

function handleEdit() {
  if (dealer.value) {
    editingDealer.value = dealer.value
    showForm.value = true
  }
}

function handleDelete() {
  if (dealer.value) {
    deleteDealer(dealer.value.id)
    navigateTo('/dealers')
  }
}

function handleStatusChange(status: DealerStatus) {
  if (dealer.value) {
    updateDealer(dealer.value.id, { status })
  }
}

// Tab navigation
const tabs = [
  { id: 'services', label: 'Services', icon: 'i-lucide-briefcase', path: 'services' },
  { id: 'contacts', label: 'Contacts', icon: 'i-lucide-users', path: 'contacts' },
  { id: 'work-orders', label: 'Work Orders', icon: 'i-lucide-wrench', path: 'work-orders' },
  { id: 'invoices', label: 'Invoices', icon: 'i-lucide-receipt', path: 'invoices' },
  { id: 'emails', label: 'Emails', icon: 'i-lucide-mail-check', path: 'emails' },
]

const activeTab = computed(() => {
  const pathEnd = route.path.split('/').pop()
  return tabs.find(t => t.path === pathEnd)?.id || 'services'
})
</script>

<template>
  <div class="absolute inset-0 flex flex-col overflow-hidden">
    <!-- Loading / Not found -->
    <div v-if="!dealer" class="flex-1 flex items-center justify-center">
      <div class="text-center space-y-4">
        <div class="relative w-20 h-20 mx-auto">
          <div class="absolute inset-0 bg-primary/5 rounded-full animate-pulse"></div>
          <div class="relative flex items-center justify-center w-full h-full bg-muted/30 rounded-full border border-border">
            <Building2 class="size-8 text-muted-foreground/40" />
          </div>
        </div>
        <div class="space-y-1">
          <p class="text-lg font-semibold text-foreground">Dealer Not Found</p>
          <p class="text-sm text-muted-foreground max-w-xs mx-auto">This dealer does not exist or has been deleted.</p>
        </div>
        <Button variant="outline" size="sm" @click="navigateTo('/dealers')">
          <ArrowLeft class="size-3.5 mr-1.5" /> Back to Dealers
        </Button>
      </div>
    </div>

    <template v-else>
      <!-- Header Actions (teleported) -->
      <ClientOnly>
        <Teleport to="#page-header-actions">
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" class="h-8" @click="navigateTo('/dealers')">
              <ArrowLeft class="size-3.5 mr-1.5" /> Back
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="outline" size="sm" class="h-8 gap-1.5">
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
                  @click="handleStatusChange(s)"
                  class="flex items-center justify-between cursor-pointer text-xs"
                >
                  <span>{{ s }}</span>
                  <div v-if="s === dealer.status" class="size-1.5 rounded-full bg-primary"></div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="icon" class="h-8 w-8" @click="handleEdit">
              <Edit class="size-3.5" />
            </Button>
            <Button variant="outline" size="icon" class="h-8 w-8 text-destructive hover:bg-destructive/10 border-destructive/20" @click="handleDelete">
              <Trash2 class="size-3.5" />
            </Button>
          </div>
        </Teleport>
      </ClientOnly>

      <!-- Pill Tab Navigation -->
      <div class="px-4 pt-3 pb-0 shrink-0">
        <div class="flex items-center gap-1 border rounded-lg p-1 bg-muted/30 w-fit overflow-x-auto">
          <NuxtLink
            v-for="tab in tabs"
            :key="tab.id"
            :to="`/dealers/${dealerId}/${tab.path}`"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap no-underline"
            :class="[
              activeTab === tab.id ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
            ]"
          >
            <Icon :name="tab.icon" class="size-3.5" />
            {{ tab.label }}
          </NuxtLink>
        </div>
      </div>

      <!-- Nested Page Content -->
      <div class="flex-1 min-h-0 px-4 pt-3 pb-4 overflow-hidden">
        <NuxtPage :dealer="dealer" />
      </div>
    </template>

    <!-- Edit Dialog -->
    <DealersDealerForm v-model:open="showForm" :dealer="editingDealer" />
  </div>
</template>
