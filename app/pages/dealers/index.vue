<script setup lang="ts">
import type { Dealer, DealerStatus } from '~/composables/useDealers'
import {
  Plus, Search, Download, Upload, FileDown, FileUp, Trash2,
  Building2, MapPin, Phone, Mail, Users, CheckCircle2, Clock,
  XCircle, PhoneForwarded, ArrowUpRight, Briefcase, TrendingUp,
  LayoutGrid, LayoutList, ShieldCheck,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { formatDistanceToNow } from 'date-fns'

const { setHeader } = usePageHeader()
setHeader({ title: 'Dealers', icon: 'i-lucide-building-2' })

const { dealers, authorised, pending, rejected, inFollowup, updateDealer, patchDealer, deleteDealer, deleteAllDealerServices, fetchDealers, isLoading } = useDealers()
const { isActionAllowed, isAdmin } = usePermissions()
const canAdd = computed(() => isActionAllowed('dealers', 'Add'))
const canEdit = computed(() => isActionAllowed('dealers', 'Edit'))
const canDelete = computed(() => isActionAllowed('dealers', 'Delete'))

// Real-time: auto-refresh when AppSheet changes dealers or their services
useLiveSync(['Dealers', 'DealerServices'], () => fetchDealers())

const selectedDealer = ref<string | undefined>()
const searchValue = ref('')
const debouncedSearch = refDebounced(searchValue, 250)
const activeFilter = ref<string>('all')

const showForm = ref(false)
const showImportServices = ref(false)
const showImportDealers = ref(false)
const editingDealer = ref<Dealer | null>(null)

// Filter by status
const statusFiltered = computed(() => {
  if (activeFilter.value === 'all') return dealers.value
  if (activeFilter.value === 'authorised') return authorised.value
  if (activeFilter.value === 'pending') return pending.value
  if (activeFilter.value === 'rejected') return rejected.value
  if (activeFilter.value === 'inFollowup') return inFollowup.value
  return dealers.value
})

// Search filter
function filterBySearch(list: Dealer[]) {
  const q = debouncedSearch.value?.trim()?.toLowerCase()
  if (!q) return list
  return list.filter(d =>
    d.dealerName.toLowerCase().includes(q)
    || d.address.toLowerCase().includes(q)
    || d.contacts.some(c =>
      c.name.toLowerCase().includes(q)
      || c.emails.some(e => e.toLowerCase().includes(q))
      || c.phones.some(p => p.number.includes(q)),
    ),
  )
}

const filteredList = computed(() => filterBySearch(statusFiltered.value))

const displayLimit = ref(50)
const displayList = computed(() => filteredList.value.slice(0, displayLimit.value))

watch(debouncedSearch, () => {
  displayLimit.value = 50
})

const loadMoreTrigger = ref<HTMLElement | null>(null)
import { useIntersectionObserver } from '@vueuse/core'
useIntersectionObserver(
  loadMoreTrigger,
  ([entry]) => {
    if (entry?.isIntersecting && displayLimit.value < filteredList.value.length) {
      displayLimit.value += 50
    }
  },
  { rootMargin: '100px' }
)

// Stat cards
const stats = computed(() => [
  {
    label: 'Total Dealers',
    count: dealers.value.length,
    icon: Building2,
    gradient: 'from-slate-500/10 to-slate-600/5',
    iconBg: 'bg-slate-500/10',
    iconColor: 'text-slate-600 dark:text-slate-400',
    borderColor: 'border-slate-500/10',
    filter: 'all',
  },
  {
    label: 'Authorised',
    count: authorised.value.length,
    icon: CheckCircle2,
    gradient: 'from-emerald-500/10 to-emerald-600/5',
    iconBg: 'bg-emerald-500/10',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    borderColor: 'border-emerald-500/10',
    filter: 'authorised',
  },
  {
    label: 'Pending',
    count: pending.value.length,
    icon: Clock,
    gradient: 'from-amber-500/10 to-amber-600/5',
    iconBg: 'bg-amber-500/10',
    iconColor: 'text-amber-600 dark:text-amber-400',
    borderColor: 'border-amber-500/10',
    filter: 'pending',
  },
  {
    label: 'In Followup',
    count: inFollowup.value.length,
    icon: PhoneForwarded,
    gradient: 'from-blue-500/10 to-blue-600/5',
    iconBg: 'bg-blue-500/10',
    iconColor: 'text-blue-600 dark:text-blue-400',
    borderColor: 'border-blue-500/10',
    filter: 'inFollowup',
  },
])

// Total services count
const totalServices = computed(() =>
  dealers.value.reduce((acc, d) => acc + (d.services?.length || 0), 0)
)

function getStatusConfig(status: string) {
  switch (status) {
    case 'Authorised': return {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-600 dark:text-emerald-400',
      border: 'border-emerald-500/20',
      dot: 'bg-emerald-500',
      glow: 'shadow-emerald-500/20',
    }
    case 'Pending': return {
      bg: 'bg-amber-500/10',
      text: 'text-amber-600 dark:text-amber-400',
      border: 'border-amber-500/20',
      dot: 'bg-amber-500',
      glow: 'shadow-amber-500/20',
    }
    case 'Rejected': return {
      bg: 'bg-red-500/10',
      text: 'text-red-600 dark:text-red-400',
      border: 'border-red-500/20',
      dot: 'bg-red-500',
      glow: 'shadow-red-500/20',
    }
    case 'In Followup': return {
      bg: 'bg-blue-500/10',
      text: 'text-blue-600 dark:text-blue-400',
      border: 'border-blue-500/20',
      dot: 'bg-blue-500',
      glow: 'shadow-blue-500/20',
    }
    default: return {
      bg: 'bg-muted',
      text: 'text-muted-foreground',
      border: 'border-border',
      dot: 'bg-muted-foreground',
      glow: '',
    }
  }
}

function handleEdit(dealer: Dealer) {
  editingDealer.value = dealer
  showForm.value = true
}

function handleDelete(id: string) {
  deleteDealer(id)
  selectedDealer.value = undefined
  toast.success('Dealer deleted')
}

function handleStatusChange(id: string, status: DealerStatus) {
  updateDealer(id, { status })
  toast.success(`Status updated to ${status}`)
}

async function handleToggleTax(d: Dealer, val?: boolean | any) {
  // Coerce val to a strict boolean, or fallback to flipping current state if event object
  const newVal = typeof val === 'boolean' ? val : !d.isTaxApplied
  console.log(`[handleToggleTax] dealer=${d.id} newVal=${newVal} currentVal=${d.isTaxApplied}`)
  
  toast.success(`Tax ${newVal ? 'enabled' : 'disabled'} for ${d.dealerName}`)
  
  const updates: Record<string, any> = { 
    isTaxApplied: !!newVal,
    // Reset percentage to 0 only if disabling tax
    ...(newVal === false ? { taxPercentage: 0 } : {})
  }
  
  try {
    await patchDealer(d.id, updates)
  } catch (err: any) {
    toast.error(`Failed: ${err?.message || err}`)
  }
}

// Debounced tax percentage save
const taxPercentageTimers = new Map<string, ReturnType<typeof setTimeout>>()
function handleTaxPercentageChange(d: Dealer, value: string) {
  const num = parseFloat(value) || 0
  // Optimistic local update
  const idx = dealers.value.findIndex(x => x.id === d.id)
  if (idx !== -1) {
    dealers.value.splice(idx, 1, { ...dealers.value[idx]!, taxPercentage: num })
  }
  // Clear old timer for this dealer
  if (taxPercentageTimers.has(d.id)) clearTimeout(taxPercentageTimers.get(d.id)!)
  taxPercentageTimers.set(d.id, setTimeout(async () => {
    try {
      await patchDealer(d.id, { taxPercentage: num })
      toast.success(`Tax set to ${num}% for ${d.dealerName}`)
    } catch (err: any) {
      toast.error(`Failed: ${err?.message || err}`)
    }
  }, 800))
}

function openAddForm() {
  editingDealer.value = null
  showForm.value = true
}

function exportToCsv() {
  const data = filteredList.value
  if (!data.length) {
    toast.error('No dealers to export')
    return
  }
  const headers = ['Id', 'Dealer Name', 'Address', 'Primary Contact', 'Phone', 'Email', 'Status']
  const csvContent = [
    headers.join(','),
    ...data.map(d => {
      const contactName = d.contacts.length ? (d.contacts[0]?.name || '') : ''
      const phone = (d.contacts.length && d.contacts[0]?.phones?.length) ? (d.contacts[0]?.phones[0]?.number || '') : ''
      const email = (d.contacts.length && d.contacts[0]?.emails?.length) ? (d.contacts[0]?.emails[0] || '') : ''
      return [
        `"${d.id || ''}"`,
        `"${(d.dealerName || '').replace(/"/g, '""')}"`,
        `"${(d.address || '').replace(/"/g, '""')}"`,
        `"${contactName.replace(/"/g, '""')}"`,
        `"${phone}"`,
        `"${email.replace(/"/g, '""')}"`,
        `"${d.status || ''}"`
      ].join(',')
    })
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', 'dealers_export.csv')
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function exportServicesToCsv() {
  const data = filteredList.value
  const exportData: any[] = []
  for (const d of data) {
    if (d.services && Array.isArray(d.services)) {
      for (const s of d.services) {
        exportData.push({
          dealerId: d.id,
          dealerServiceId: s.id,
          dealerName: d.dealerName,
          service: s.service,
          amount: s.amount,
          tax: s.tax,
          total: s.total
        })
      }
    }
  }
  if (!exportData.length) {
    toast.error('No services to export')
    return
  }
  const headers = ['Dealer ID', 'Dealer Service ID', 'Dealer Name', 'Service', 'Amount', 'Tax', 'Total']
  const csvContent = [
    headers.join(','),
    ...exportData.map(row => {
      return [
        `"${row.dealerId || ''}"`,
        `"${row.dealerServiceId || ''}"`,
        `"${(row.dealerName || '').replace(/"/g, '""')}"`,
        `"${(row.service || '').replace(/"/g, '""')}"`,
        `"${row.amount}"`,
        `"${row.tax}"`,
        `"${row.total}"`
      ].join(',')
    })
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', 'dealer_services_export.csv')
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

async function handleDeleteAllServices() {
  const result = await deleteAllDealerServices()
  if (result > 0) {
    toast.success(`Successfully deleted ${result} dealer services`)
  }
}

function getInitials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
</script>

<template>
  <div class="-m-4 lg:-m-6 h-[calc(100dvh-54px-3rem)]">
    <TooltipProvider :delay-duration="0">
      <div class="h-full flex flex-col overflow-hidden">
        <!-- Header Actions Teleported -->
        <ClientOnly>
          <Teleport to="#page-header-actions">
            <form @submit.prevent class="relative w-48 xl:w-64 max-w-sm">
              <Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input v-model="searchValue" placeholder="Search dealers..." class="pl-9 h-9 bg-background" />
            </form>
            <div class="flex items-center gap-2 shrink-0">
              <Tooltip v-if="isAdmin">
                <TooltipTrigger as-child>
                  <Button variant="outline" size="sm" class="h-9 px-3 gap-2" @click="showImportDealers = true">
                    <FileUp class="size-4" />
                    <span class="hidden lg:inline">Import Dealers</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Import Dealers</TooltipContent>
              </Tooltip>
              <Tooltip v-if="isAdmin">
                <TooltipTrigger as-child>
                  <Button variant="outline" size="sm" class="h-9 px-3 gap-2" @click="showImportServices = true">
                    <Upload class="size-4" />
                    <span class="hidden lg:inline">Import Services</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Import Services</TooltipContent>
              </Tooltip>
              <Tooltip v-if="isAdmin">
                <TooltipTrigger as-child>
                  <Button variant="outline" size="sm" class="h-9 px-3 gap-2" @click="exportServicesToCsv">
                    <FileDown class="size-4" />
                    <span class="hidden lg:inline">Export Services</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export Services</TooltipContent>
              </Tooltip>
              <Tooltip v-if="isAdmin">
                <TooltipTrigger as-child>
                  <Button variant="outline" size="sm" class="h-9 px-3 gap-2" @click="exportToCsv">
                    <Download class="size-4" />
                    <span class="hidden lg:inline">Export</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export to CSV</TooltipContent>
              </Tooltip>
              <Tooltip v-if="isAdmin">
                <TooltipTrigger as-child>
                  <Button variant="outline" size="sm" class="h-9 px-3 gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20" @click="handleDeleteAllServices">
                    <Trash2 class="size-4" />
                    <span class="hidden lg:inline">Delete All Services</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete All Dealer Services</TooltipContent>
              </Tooltip>
              <Button v-if="canAdd" size="sm" class="h-9 px-3 gap-2" @click="openAddForm">
                <Plus class="size-4" />
                <span class="hidden lg:inline">Add</span>
              </Button>
            </div>
          </Teleport>
        </ClientOnly>

        <!-- Main Content Area -->
        <div class="flex-1 overflow-auto">
          <div class="p-4 lg:p-6 space-y-6">

            <!-- ═══════════════ STAT CARDS ═══════════════ -->
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <button
                v-for="stat in stats"
                :key="stat.filter"
                class="group relative overflow-hidden rounded-xl border p-4 text-left transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
                :class="[
                  activeFilter === stat.filter
                    ? `${stat.borderColor} ring-1 ring-current/10 shadow-md bg-gradient-to-br ${stat.gradient}`
                    : 'bg-card hover:bg-accent/40 border-border/60',
                ]"
                @click="activeFilter = activeFilter === stat.filter ? 'all' : stat.filter"
              >
                <!-- Subtle animated gradient overlay -->
                <div class="absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-500" :class="stat.gradient"></div>

                <div class="relative flex items-start justify-between">
                  <div class="space-y-2">
                    <p class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{{ stat.label }}</p>
                    <p class="text-2xl font-bold tabular-nums tracking-tight" :class="activeFilter === stat.filter ? stat.iconColor : 'text-foreground'">
                      {{ stat.count }}
                    </p>
                  </div>
                  <div class="size-10 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-110" :class="stat.iconBg">
                    <component :is="stat.icon" class="size-5" :class="stat.iconColor" />
                  </div>
                </div>

                <!-- Active indicator bar -->
                <div
                  class="absolute bottom-0 left-0 right-0 h-0.5 transition-all duration-300 rounded-b-xl"
                  :class="activeFilter === stat.filter ? `${stat.iconBg} opacity-100` : 'opacity-0'"
                ></div>
              </button>
            </div>

            <!-- ═══════════════ FILTER & COUNT BAR ═══════════════ -->
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <p class="text-sm text-muted-foreground">
                  Showing <span class="font-semibold text-foreground">{{ filteredList.length }}</span>
                  <span v-if="activeFilter !== 'all'"> {{ activeFilter }}</span> dealers
                </p>
                <Badge v-if="debouncedSearch" variant="secondary" class="text-[10px] px-2 py-0.5 gap-1">
                  <Search class="size-3" />
                  "{{ debouncedSearch }}"
                  <button @click="searchValue = ''" class="ml-1 hover:text-foreground">×</button>
                </Badge>
              </div>
              <div class="flex items-center gap-2">
                <Badge v-if="totalServices > 0" variant="outline" class="text-[10px] px-2 py-0.5 gap-1.5">
                  <Briefcase class="size-3 text-muted-foreground" />
                  {{ totalServices }} services configured
                </Badge>
              </div>
            </div>

            <!-- ═══════════════ LOADING SKELETON ═══════════════ -->
            <div v-if="isLoading && dealers.length === 0" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <div v-for="i in 6" :key="i" class="rounded-xl border bg-card p-5 space-y-4 animate-pulse">
                <div class="flex items-center gap-3">
                  <div class="size-11 rounded-xl bg-muted"></div>
                  <div class="flex-1 space-y-2">
                    <div class="h-4 w-32 bg-muted rounded-md"></div>
                    <div class="h-3 w-48 bg-muted/60 rounded-md"></div>
                  </div>
                </div>
                <div class="flex gap-2">
                  <div class="h-5 w-20 bg-muted/60 rounded-full"></div>
                  <div class="h-5 w-16 bg-muted/60 rounded-full"></div>
                </div>
                <div class="h-px bg-muted"></div>
                <div class="flex justify-between">
                  <div class="h-3 w-24 bg-muted/60 rounded-md"></div>
                  <div class="h-3 w-16 bg-muted/60 rounded-md"></div>
                </div>
              </div>
            </div>

            <!-- ═══════════════ EMPTY STATE ═══════════════ -->
            <div v-else-if="filteredList.length === 0" class="flex flex-col items-center justify-center py-20">
              <div class="relative">
                <div class="absolute inset-0 bg-primary/5 rounded-full blur-2xl animate-pulse"></div>
                <div class="relative size-20 rounded-2xl bg-gradient-to-br from-muted to-muted/50 border-2 border-dashed border-border flex items-center justify-center">
                  <Building2 class="size-9 text-muted-foreground/40" />
                </div>
              </div>
              <h3 class="mt-6 text-lg font-semibold text-foreground">No dealers found</h3>
              <p class="mt-2 text-sm text-muted-foreground max-w-sm text-center">
                {{ debouncedSearch ? `No dealers match "${debouncedSearch}". Try a different search.` : 'Get started by adding your first dealer.' }}
              </p>
              <Button v-if="canAdd && !debouncedSearch" size="sm" class="mt-5 gap-2" @click="openAddForm">
                <Plus class="size-4" /> Add Dealer
              </Button>
            </div>

            <!-- ═══════════════ DEALER CARDS GRID ═══════════════ -->
            <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <TransitionGroup name="card" appear>
                <div
                  v-for="(d, idx) in displayList"
                  :key="d.id"
                  class="dealer-card group relative overflow-hidden rounded-xl border bg-card transition-all duration-300 hover:shadow-xl hover:shadow-black/[0.04] dark:hover:shadow-black/20 hover:-translate-y-1 cursor-pointer"
                  :style="{ animationDelay: `${Math.min(idx * 40, 400)}ms` }"
                  @click="navigateTo(`/dealers/${d.id}/details`)"
                >
                  <!-- Top gradient accent bar based on status -->
                  <div class="absolute top-0 left-0 right-0 h-[3px] transition-opacity duration-300"
                    :class="[
                      getStatusConfig(d.status).bg,
                      'opacity-60 group-hover:opacity-100'
                    ]"
                  >
                    <div class="h-full w-full" :class="getStatusConfig(d.status).dot"></div>
                  </div>

                  <!-- Card Body -->
                  <div class="p-5">
                    <!-- Row 1: Dealer (status) (Services) -->
                    <div class="flex flex-wrap items-center gap-2.5">
                      <!-- Avatar -->
                      <div class="relative shrink-0">
                        <div class="size-10 rounded-xl border-2 flex items-center justify-center font-bold text-xs"
                          :class="[getStatusConfig(d.status).bg, getStatusConfig(d.status).text, getStatusConfig(d.status).border]"
                        >
                          {{ getInitials(d.dealerName) }}
                        </div>
                        <div class="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card"
                          :class="getStatusConfig(d.status).dot"
                        ></div>
                      </div>

                      <!-- Name -->
                      <h3 class="text-sm font-bold text-foreground truncate group-hover:text-primary transition-colors pr-1">
                        {{ d.dealerName }}
                        <ArrowUpRight class="inline size-3.5 text-muted-foreground/0 group-hover:text-primary/60 transition-all -translate-y-0.5" />
                      </h3>

                      <!-- Status Badge -->
                      <Badge variant="outline"
                        :class="[getStatusConfig(d.status).bg, getStatusConfig(d.status).text, getStatusConfig(d.status).border]"
                        class="text-[10px] px-2 py-0.5 gap-1.5 font-medium whitespace-nowrap"
                      >
                        <div class="size-1.5 rounded-full" :class="getStatusConfig(d.status).dot"></div>
                        {{ d.status }}
                      </Badge>

                      <!-- Services Badge -->
                      <Badge v-if="d.services?.length" variant="secondary" class="text-[10px] px-2 py-0.5 gap-1 bg-muted/60 whitespace-nowrap">
                        <Briefcase class="size-2.5" />
                        {{ d.services.length }} service{{ d.services.length !== 1 ? 's' : '' }}
                      </Badge>
                    </div>

                    <!-- Row 2: Contacts -->
                    <div class="mt-4 px-2 py-2.5 rounded-lg bg-muted/30 border border-dashed border-border/60">
                      <template v-if="d.contacts.length > 0">
                        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                          <!-- Contact Name -->
                          <div class="flex items-center gap-1.5 min-w-0">
                            <Users class="size-3.5 text-muted-foreground shrink-0" />
                            <span class="font-medium text-foreground truncate max-w-[120px]">{{ d.contacts[0]?.name }}</span>
                            <Badge v-if="d.contacts.length > 1" variant="secondary" class="text-[9px] px-1.5 py-0 bg-muted shrink-0 ml-1">
                              +{{ d.contacts.length - 1 }}
                            </Badge>
                          </div>
                          
                          <!-- Phone -->
                          <div v-if="d.contacts[0]?.phones?.length" class="flex items-center gap-1.5 min-w-0">
                            <Phone class="size-3 text-muted-foreground/60 shrink-0" />
                            <span class="text-muted-foreground tabular-nums truncate">{{ d.contacts[0]?.phones[0]?.number }}</span>
                          </div>

                          <!-- Email -->
                          <div v-if="d.contacts[0]?.emails?.length" class="flex items-center gap-1.5 min-w-0">
                            <Mail class="size-3 text-muted-foreground/60 shrink-0" />
                            <span class="text-muted-foreground truncate max-w-[150px]">{{ d.contacts[0]?.emails[0] }}</span>
                          </div>
                        </div>
                      </template>
                      <template v-else>
                        <div class="flex items-center gap-2">
                          <Users class="size-3.5 text-muted-foreground/40 shrink-0" />
                          <span class="text-[11px] text-muted-foreground/60 italic">No contacts added</span>
                        </div>
                      </template>
                    </div>

                    <!-- Row 3: Tax on/off and % inline -->
                    <div class="mt-4 flex items-center justify-between border-t border-border/40 pt-4" @click.stop>
                      <div class="flex items-center gap-3">
                        <div class="size-7 rounded-lg flex items-center justify-center transition-colors duration-300 shrink-0" :class="d.isTaxApplied ? 'bg-emerald-500/10' : 'bg-muted/50'">
                          <ShieldCheck class="size-3.5" :class="d.isTaxApplied ? 'text-emerald-600' : 'text-muted-foreground/50'" />
                        </div>
                        <div class="flex flex-col">
                          <span class="text-xs font-medium" :class="d.isTaxApplied ? 'text-foreground' : 'text-muted-foreground'">Tax Settings</span>
                          <span class="text-[10px] text-muted-foreground leading-none mt-0.5">{{ d.isTaxApplied ? 'Enabled' : 'Disabled' }}</span>
                        </div>
                      </div>

                      <div class="flex items-center justify-end gap-3 flex-1 ml-4">
                        <div v-if="d.isTaxApplied" class="flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
                          <label class="text-[11px] text-muted-foreground shrink-0">Rate:</label>
                          <div class="relative w-24">
                            <input
                              type="number"
                              :value="d.taxPercentage"
                              @input="(e: Event) => handleTaxPercentageChange(d, (e.target as HTMLInputElement).value)"
                              step="0.1"
                              min="0"
                              max="100"
                              class="w-full h-7 px-2 pr-5 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/50 tabular-nums shadow-sm"
                              placeholder="0"
                            />
                            <span class="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">%</span>
                          </div>
                        </div>

                        <!-- Standardized boolean toggle evaluation to forcefully prevent native objects leaking into params -->
                        <!-- Native checkbox styled as toggle — guaranteed boolean -->
                        <button
                          type="button"
                          role="switch"
                          :aria-checked="d.isTaxApplied"
                          @click.stop.prevent="handleToggleTax(d, !d.isTaxApplied)"
                          class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          :class="d.isTaxApplied ? 'bg-emerald-500' : 'bg-input'"
                        >
                          <span
                            class="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200 ease-in-out"
                            :class="d.isTaxApplied ? 'translate-x-5' : 'translate-x-0'"
                          />
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- Card Footer -->
                  <div class="px-5 py-3 bg-muted/20 border-t border-border/40 flex items-center justify-between">
                    <span class="text-[10px] text-muted-foreground">
                      Updated {{ formatDistanceToNow(new Date(d.updatedAt), { addSuffix: true }) }}
                    </span>
                    <div class="flex items-center gap-1">
                      <span class="text-[10px] text-primary/60 font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        View Details
                      </span>
                      <ArrowUpRight class="size-3 text-primary/60 opacity-0 group-hover:opacity-100 transition-all duration-300" />
                    </div>
                  </div>
                </div>
              </TransitionGroup>

              <!-- Load More Trigger -->
              <div ref="loadMoreTrigger" class="col-span-full h-4"></div>
            </div>

          </div>
        </div>
      </div>
    </TooltipProvider>

    <!-- Dialogs -->
    <DealersDealerForm v-model:open="showForm" :dealer="editingDealer" @saved="selectedDealer = undefined" />
    <DealersDealerImport v-model:open="showImportDealers" />
    <DealersDealerServicesImport v-model:open="showImportServices" />
  </div>
</template>

<style scoped>
/* Card entrance animation */
.card-enter-active {
  animation: cardSlideIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
.card-leave-active {
  transition: all 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
.card-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.96);
}
.card-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.96);
}
.card-move {
  transition: all 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes cardSlideIn {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Card hover subtle shine effect */
.dealer-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    135deg,
    transparent 40%,
    rgba(255, 255, 255, 0.02) 50%,
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.5s;
  pointer-events: none;
  z-index: 1;
}
.dealer-card:hover::before {
  opacity: 1;
}

:deep(.dark) .dealer-card::before {
  background: linear-gradient(
    135deg,
    transparent 40%,
    rgba(255, 255, 255, 0.03) 50%,
    transparent 60%
  );
}
</style>
