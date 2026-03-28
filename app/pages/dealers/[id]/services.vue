<script setup lang="ts">
import type { Dealer, DealerService } from '~/composables/useDealers'
import { Plus, Pencil, Trash2, ShieldCheck, Search, ChevronDown, X, PlusCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { nanoid } from 'nanoid'

// Helper to generate a 24-character hex string (MongoDB ObjectID format) for AppSheet
const generateObjectId = () => [...Array(24)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')

definePageMeta({ layout: 'default' })

const props = defineProps<{ dealer: Dealer }>()
const { patchDealer, dealers } = useDealers()
const { services, fetchServices } = useServices()

const copyFromDealerId = ref('')
const isCopying = ref(false)

async function copyServices() {
  if (!copyFromDealerId.value) return
  const sourceDealer = dealers.value.find(d => d.id === copyFromDealerId.value)
  if (!sourceDealer || !sourceDealer.services) {
    toast.error('Selected dealer has no services or could not be found')
    return
  }
  isCopying.value = true
  try {
    const finalServices = sourceDealer.services.map(s => {
      const tax = props.dealer.isTaxApplied ? (s.amount * props.dealer.taxPercentage / 100) : 0
      return {
        id: generateObjectId(),
        service: s.service,
        amount: s.amount,
        tax,
        total: s.amount + tax
      }
    })
    await patchDealer(props.dealer.id, { services: finalServices })
    toast.success(`Copied ${finalServices.length} services successfully`)
    copyFromDealerId.value = ''
  } catch (err: any) {
    toast.error(`Copy failed: ${err.message || err}`)
  } finally {
    isCopying.value = false
  }
}

// Ensure services are loaded
onMounted(() => { if (!services.value.length) fetchServices() })

// ─── Helpers ─────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)

function getServiceName(serviceId: string) {
  const s = services.value.find(s => s.id === serviceId)
  // If serviceId looks like a custom name (not a known ID), show it directly
  return s ? s.service : serviceId || 'Unknown'
}

function computedTax(amount: number) {
  if (!props.dealer.isTaxApplied) return 0
  return Math.round(amount * (props.dealer.taxPercentage / 100) * 100) / 100
}

// ─── CRUD State ───────────────────────────────────────────────────
const showForm    = ref(false)
const editingIdx  = ref<number | null>(null)
const isSaving    = ref(false)
const deletingIdx = ref<number | null>(null)

// Form fields
const formServiceId   = ref('')   // either a service.id OR a raw custom name
const formServiceName = ref('')   // display name (for UI only)
const formAmount      = ref<number | undefined>(undefined)
const formEnableTax   = ref(props.dealer.isTaxApplied)

const formTax   = computed(() => formEnableTax.value ? computedTax(formAmount.value || 0) : 0)
const formTotal = computed(() => (formAmount.value || 0) + formTax.value)

// ─── Combobox state ───────────────────────────────────────────────
const dropdownOpen    = ref(false)
const serviceSearch   = ref('')
const comboboxRef     = ref<HTMLElement | null>(null)
const searchInputRef  = ref<HTMLInputElement | null>(null)

// Services already used by this dealer (exclude from dropdown in ADD mode)
const usedServiceIds = computed(() => {
  const current = props.dealer.services || []
  return new Set(current.map(s => s.service))
})

// Filtered and excluded list for the combobox
const availableServices = computed(() => {
  const isEditing = editingIdx.value !== null
  const currentEditServiceId = isEditing
    ? props.dealer.services![editingIdx.value!]?.service
    : null

  return services.value.filter(s => {
    // In edit mode: show the current service + any not yet added
    if (isEditing && s.id === currentEditServiceId) return true
    // In add mode: exclude services already associated
    if (usedServiceIds.value.has(s.id)) return false
    return true
  })
})

const filteredServices = computed(() => {
  const q = serviceSearch.value.trim().toLowerCase()
  if (!q) return availableServices.value
  return availableServices.value.filter(s => s.service.toLowerCase().includes(q))
})

// Show "Add new" option if search text doesn't exactly match any existing service name
const showAddNew = computed(() => {
  const q = serviceSearch.value.trim()
  if (!q) return false
  return !services.value.some(s => s.service.toLowerCase() === q.toLowerCase())
})

function openDropdown() {
  dropdownOpen.value = true
  nextTick(() => searchInputRef.value?.focus())
}

function selectService(svc: { id: string; service: string }) {
  formServiceId.value = svc.id
  formServiceName.value = svc.service
  dropdownOpen.value = false
  serviceSearch.value = ''
}

const isCreatingService = ref(false)

async function selectNewService(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return

  isCreatingService.value = true
  try {
    // Create the service in the master /services list
    const result = await $fetch<{ success: boolean; id: string }>('/api/services', {
      method: 'POST',
      body: { service: trimmed, description: '' },
    })

    // Refresh the global services list so it appears everywhere
    await fetchServices()

    // Now use the real MongoDB ID
    formServiceId.value = result.id
    formServiceName.value = trimmed
    dropdownOpen.value = false
    serviceSearch.value = ''
    toast.success(`Service "${trimmed}" created and selected`)
  } catch (err: any) {
    toast.error(`Failed to create service: ${err?.message || err}`)
  } finally {
    isCreatingService.value = false
  }
}

function clearService() {
  formServiceId.value = ''
  formServiceName.value = ''
}

// Close dropdown on outside click
onClickOutside(comboboxRef, () => { dropdownOpen.value = false })

// ─── Open forms ───────────────────────────────────────────────────
function openAdd() {
  editingIdx.value = null
  formServiceId.value = ''
  formServiceName.value = ''
  formAmount.value = undefined
  formEnableTax.value = props.dealer.isTaxApplied
  serviceSearch.value = ''
  dropdownOpen.value = false
  showForm.value = true
}

function openEdit(idx: number) {
  const srv = props.dealer.services![idx]!
  editingIdx.value = idx
  formServiceId.value = srv.service
  formServiceName.value = getServiceName(srv.service)
  formAmount.value = srv.amount || undefined
  formEnableTax.value = srv.tax > 0
  serviceSearch.value = ''
  dropdownOpen.value = false
  showForm.value = true
}

// ─── Save / Delete ────────────────────────────────────────────────
async function saveService() {
  if (!formServiceId.value.trim()) {
    toast.error('Please select or create a service')
    return
  }
  isSaving.value = true
  try {
    const newEntry: DealerService = {
      id: editingIdx.value !== null
        ? props.dealer.services![editingIdx.value]!.id
        : generateObjectId(),
      service: formServiceId.value,
      amount: formAmount.value ?? 0,
      tax: formTax.value,
      total: formTotal.value,
    }

    const updated: DealerService[] = editingIdx.value !== null
      ? props.dealer.services!.map((s, i) => i === editingIdx.value ? newEntry : { ...s })
      : [...(props.dealer.services || []), newEntry]

    await patchDealer(props.dealer.id, { services: updated })
    toast.success(editingIdx.value !== null ? 'Service updated' : 'Service added')
    showForm.value = false
  } catch (err: any) {
    toast.error(`Save failed: ${err?.message || err}`)
  } finally {
    isSaving.value = false
  }
}

async function deleteService(idx: number) {
  deletingIdx.value = idx
  try {
    const updated = props.dealer.services!.filter((_, i) => i !== idx)
    await patchDealer(props.dealer.id, { services: updated })
    toast.success('Service removed')
  } catch (err: any) {
    toast.error(`Delete failed: ${err?.message || err}`)
  } finally {
    deletingIdx.value = null
  }
}

// ─── Per-row tax toggle ───────────────────────────────────────────
const savingTaxIdx = ref<number | null>(null)

async function toggleServiceTax(idx: number, enableTax: boolean) {
  savingTaxIdx.value = idx
  try {
    const updated = props.dealer.services!.map((s, i) => {
      if (i !== idx) return { ...s }
      const tax = enableTax ? computedTax(s.amount) : 0
      return { ...s, tax, total: s.amount + tax }
    })
    await patchDealer(props.dealer.id, { services: updated })
  } catch (err: any) {
    toast.error(`Failed: ${err?.message || err}`)
  } finally {
    savingTaxIdx.value = null
  }
}

// ─── Totals ───────────────────────────────────────────────────────
const grandTotal = computed(() =>
  (props.dealer.services || []).reduce((s, v) => s + (v.total ?? v.amount), 0)
)
const taxTotal = computed(() =>
  (props.dealer.services || []).reduce((s, v) => s + (v.tax || 0), 0)
)
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm">

    <!-- Top bar -->
    <div class="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
      <div v-if="dealer.isTaxApplied" class="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
        <ShieldCheck class="size-3.5" />
        <span>Tax {{ dealer.taxPercentage }}% active — toggle per row</span>
      </div>
      <div v-else class="text-xs text-muted-foreground">Manage dealer services</div>

      <button
        type="button"
        @click="openAdd"
        class="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-sm"
      >
        <Plus class="size-3.5" />
        Add Service
      </button>
    </div>

    <!-- Empty state -->
    <div v-if="!dealer.services?.length" class="flex-1 flex items-center justify-center">
      <div class="text-center py-12 px-4 max-w-2xl mx-auto">
        <Icon name="i-lucide-briefcase" class="size-10 text-muted-foreground/30 mx-auto mb-3" />
        <h4 class="text-sm font-semibold text-foreground">No Services Yet</h4>
        <p class="text-xs text-muted-foreground mt-1 mb-6">Add a service manually or copy from an existing dealer.</p>
        
        <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            type="button"
            @click="openAdd"
            class="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus class="size-4 shrink-0" /> <span class="whitespace-nowrap">Add Service Manually</span>
          </button>
          
          <div class="flex items-center text-[10px] text-muted-foreground uppercase font-bold tracking-wider mx-2">OR</div>
          
          <div class="flex items-center gap-2 bg-muted/40 p-1.5 rounded-lg border shadow-sm w-full sm:w-auto">
            <Select v-model="copyFromDealerId">
              <SelectTrigger class="h-8 w-full sm:w-56 text-xs bg-background">
                <SelectValue placeholder="Copy Services From..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem 
                  v-for="d in dealers.filter(d => d.id !== props.dealer.id && d.services?.length && d.services.length > 0)" 
                  :key="d.id" 
                  :value="d.id"
                >
                  {{ d.dealerName }} ({{ d.services?.length || 0 }})
                </SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" class="h-8 shadow-none gap-1.5" :disabled="!copyFromDealerId || isCopying" @click="copyServices">
              <Icon v-if="isCopying" name="lucide:loader-2" class="size-3.5 animate-spin" />
              <Icon v-else name="lucide:copy" class="size-3.5" />
              Copy
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- Services table -->
    <template v-else>
      <div class="flex-1 overflow-auto">
        <table class="w-full text-sm caption-bottom border-collapse">
          <TableHeader class="sticky top-0 z-10 bg-muted/95 backdrop-blur shadow-sm">
            <TableRow>
              <TableHead class="w-8">#</TableHead>
              <TableHead>Service</TableHead>
              <TableHead class="text-right">Amount</TableHead>
              <TableHead v-if="dealer.isTaxApplied" class="text-center w-36">Tax ({{ dealer.taxPercentage }}%)</TableHead>
              <TableHead class="text-right">Total</TableHead>
              <TableHead class="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="(srv, i) in dealer.services"
              :key="srv.id || i"
              class="hover:bg-muted/40 transition-colors group"
              :class="{ 'opacity-60': savingTaxIdx === i || deletingIdx === i }"
            >
              <TableCell class="text-xs text-muted-foreground tabular-nums">{{ i + 1 }}</TableCell>
              <TableCell class="text-xs font-medium">{{ getServiceName(srv.service) }}</TableCell>
              <TableCell class="text-right text-xs tabular-nums text-muted-foreground">{{ fmt(srv.amount) }}</TableCell>

              <!-- Interactive tax toggle -->
              <TableCell v-if="dealer.isTaxApplied" class="text-center">
                <div class="flex items-center justify-center gap-2">
                  <span class="text-xs tabular-nums min-w-[52px] text-right"
                    :class="srv.tax > 0 ? 'text-emerald-600 font-medium' : 'text-muted-foreground/40'">
                    {{ srv.tax > 0 ? fmt(srv.tax) : '—' }}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="srv.tax > 0"
                    :disabled="savingTaxIdx === i || deletingIdx === i"
                    @click="toggleServiceTax(i, srv.tax === 0)"
                    class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 disabled:opacity-40 disabled:cursor-wait"
                    :class="srv.tax > 0 ? 'bg-emerald-500' : 'bg-input'"
                  >
                    <span
                      class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200"
                      :class="srv.tax > 0 ? 'translate-x-4' : 'translate-x-0'"
                    />
                  </button>
                </div>
              </TableCell>

              <TableCell class="text-right text-xs tabular-nums font-semibold">{{ fmt(srv.total ?? srv.amount) }}</TableCell>

              <!-- Hover actions -->
              <TableCell class="text-right">
                <div class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    @click="openEdit(i)"
                    class="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title="Edit"
                  >
                    <Pencil class="size-3" />
                  </button>
                  <button
                    type="button"
                    :disabled="deletingIdx === i"
                    @click="deleteService(i)"
                    class="h-6 w-6 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                    title="Remove"
                  >
                    <Trash2 class="size-3" />
                  </button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </table>
      </div>

      <!-- Footer -->
      <div class="bg-muted/10 border-t px-4 py-2.5 flex justify-between items-center shrink-0">
        <span class="text-[11px] text-muted-foreground font-medium">{{ dealer.services.length }} services configured</span>
        <div class="flex items-center gap-4 text-xs">
          <span v-if="dealer.isTaxApplied && taxTotal > 0" class="text-muted-foreground">
            Tax: <span class="font-medium text-emerald-600">{{ fmt(taxTotal) }}</span>
          </span>
          <span class="font-semibold text-foreground">Total: {{ fmt(grandTotal) }}</span>
        </div>
      </div>
    </template>

    <!-- ─── Add / Edit Dialog ──────────────────────────────────── -->
    <Dialog v-model:open="showForm">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ editingIdx !== null ? 'Edit Service' : 'Add Service' }}</DialogTitle>
          <DialogDescription>
            Configure the service pricing for {{ dealer.dealerName }}.
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4 py-2">

          <!-- ── Searchable Service Combobox ── -->
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-foreground">Service</label>
            <div ref="comboboxRef" class="relative">

              <!-- Trigger button -->
              <button
                type="button"
                @click="openDropdown"
                class="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-2 focus:ring-ring transition-colors hover:bg-muted/30"
                :class="formServiceId ? 'text-foreground' : 'text-muted-foreground'"
              >
                <span class="truncate">{{ formServiceName || 'Select or type a service…' }}</span>
                <div class="flex items-center gap-1 shrink-0">
                  <button
                    v-if="formServiceId"
                    type="button"
                    @click.stop="clearService"
                    class="text-muted-foreground hover:text-foreground"
                  >
                    <X class="size-3.5" />
                  </button>
                  <ChevronDown class="size-3.5 text-muted-foreground" />
                </div>
              </button>

              <!-- Dropdown panel -->
              <div
                v-if="dropdownOpen"
                class="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border border-border bg-popover shadow-lg overflow-hidden"
              >
                <!-- Search input -->
                <div class="flex items-center gap-2 px-2.5 py-2 border-b border-border">
                  <Search class="size-3.5 text-muted-foreground shrink-0" />
                  <input
                    ref="searchInputRef"
                    v-model="serviceSearch"
                    type="text"
                    placeholder="Search services…"
                    class="flex-1 text-sm bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                <!-- Service options list -->
                <ul class="max-h-52 overflow-y-auto py-1">
                  <li v-if="filteredServices.length === 0 && !showAddNew" class="px-3 py-2 text-xs text-muted-foreground italic">
                    No services available
                  </li>

                  <li
                    v-for="svc in filteredServices"
                    :key="svc.id"
                    @click="selectService(svc)"
                    class="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/60 transition-colors"
                    :class="formServiceId === svc.id ? 'bg-muted text-foreground font-medium' : 'text-foreground'"
                  >
                    <span class="flex-1 truncate">{{ svc.service }}</span>
                    <span v-if="formServiceId === svc.id" class="text-primary text-xs">✓</span>
                  </li>

                  <!-- Add new option -->
                  <li
                    v-if="showAddNew"
                    @click="!isCreatingService && selectNewService(serviceSearch)"
                    class="flex items-center gap-2 px-3 py-2 text-sm border-t border-border/60 mt-1 pt-2 transition-colors"
                    :class="isCreatingService
                      ? 'opacity-60 cursor-wait text-muted-foreground'
                      : 'cursor-pointer hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'"
                  >
                    <Icon v-if="isCreatingService" name="i-lucide-loader-2" class="size-3.5 shrink-0 animate-spin" />
                    <PlusCircle v-else class="size-3.5 shrink-0" />
                    <span v-if="isCreatingService">Creating service…</span>
                    <span v-else>Add "<strong>{{ serviceSearch }}</strong>" as new service</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <!-- Amount -->
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-foreground">Amount ($)</label>
            <input
              v-model.number="formAmount"
              type="number"
              min="0"
              step="0.01"
              class="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring tabular-nums"
            />
          </div>

          <!-- Tax toggle -->
          <div v-if="dealer.isTaxApplied" class="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
            <div>
              <p class="text-xs font-medium text-foreground">Apply Tax ({{ dealer.taxPercentage }}%)</p>
              <p class="text-[11px] text-muted-foreground mt-0.5">
                Tax: <span class="text-emerald-600 font-medium">{{ fmt(formTax) }}</span>
                → Total: <span class="font-semibold text-foreground">{{ fmt(formTotal) }}</span>
              </p>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="formEnableTax"
              @click="formEnableTax = !formEnableTax"
              class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200"
              :class="formEnableTax ? 'bg-emerald-500' : 'bg-input'"
            >
              <span
                class="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200"
                :class="formEnableTax ? 'translate-x-5' : 'translate-x-0'"
              />
            </button>
          </div>
          <div v-else class="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            <span class="text-xs text-muted-foreground">Total</span>
            <span class="text-sm font-semibold">{{ fmt(formAmount ?? 0) }}</span>
          </div>
        </div>

        <DialogFooter class="gap-2">
          <Button variant="outline" size="sm" @click="showForm = false">Cancel</Button>
          <Button size="sm" :disabled="isSaving || !formServiceId" @click="saveService">
            <span v-if="isSaving">Saving…</span>
            <span v-else>{{ editingIdx !== null ? 'Update' : 'Add' }} Service</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

  </div>
</template>
