<script setup lang="ts">
import type { Dealer } from '~/composables/useDealers'
import { useDealers } from '~/composables/useDealers'
import { toast } from 'vue-sonner'

definePageMeta({ layout: 'default' })

const props = defineProps<{ dealer: Dealer }>()
const { patchDealer } = useDealers()

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function getStatusColor(status: string) {
  switch (status) {
    case 'Authorised': return 'bg-primary/10 text-primary border-primary/20'
    case 'Pending': return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
    case 'Rejected': return 'bg-red-500/10 text-red-600 border-red-500/20'
    case 'In Followup': return 'bg-blue-500/10 text-blue-600 border-blue-500/20'
    default: return 'bg-muted text-muted-foreground'
  }
}

async function handleToggleTax(val: boolean) {
  const updates: Record<string, any> = { isTaxApplied: val }
  if (!val) updates.taxPercentage = 0
  try {
    await patchDealer(props.dealer.id, updates)
    toast.success(`Tax ${val ? 'enabled' : 'disabled'}`)
  } catch (err: any) {
    toast.error(`Failed to update tax: ${err?.message || err}`)
  }
}

async function handleTaxPercentageChange(e: FocusEvent) {
  const val = (e.target as HTMLInputElement)?.value ?? '0'
  const num = parseFloat(val) || 0
  try {
    await patchDealer(props.dealer.id, { taxPercentage: num })
    toast.success(`Tax percentage updated to ${num}%`)
  } catch (err: any) {
    toast.error(`Failed to update tax %: ${err?.message || err}`)
  }
}

// Computed stats
const totalServices = computed(() => props.dealer.services?.length || 0)
const totalServiceValue = computed(() => props.dealer.services?.reduce((sum, s) => sum + (s.total || 0), 0) || 0)
const contactCount = computed(() => props.dealer.contacts?.length || 0)
const primaryContact = computed(() => props.dealer.contacts?.[0] || null)
</script>

<template>
  <div class="h-full overflow-auto">
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <!-- General Info Card -->
      <div class="border rounded-xl bg-card shadow-sm overflow-hidden">
        <div class="px-4 py-3 border-b bg-muted/20 flex items-center gap-2">
          <Icon name="i-lucide-building-2" class="size-4 text-primary" />
          <h3 class="text-xs font-semibold tracking-wide uppercase text-foreground">General Information</h3>
        </div>
        <div class="p-4 space-y-3.5">
          <div class="flex items-start gap-3">
            <div class="size-8 rounded-lg bg-primary/5 border flex items-center justify-center shrink-0 mt-0.5">
              <Icon name="i-lucide-building-2" class="size-4 text-primary/70" />
            </div>
            <div class="min-w-0">
              <p class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-0.5">Dealer Name</p>
              <p class="text-sm font-semibold text-foreground truncate">{{ dealer.dealerName || '—' }}</p>
            </div>
          </div>

          <Separator class="opacity-20" />

          <div class="flex items-start gap-3">
            <div class="size-8 rounded-lg bg-muted/50 border flex items-center justify-center shrink-0 mt-0.5">
              <Icon name="i-lucide-map-pin" class="size-4 text-muted-foreground" />
            </div>
            <div class="min-w-0">
              <p class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-0.5">Address</p>
              <p class="text-xs text-foreground/80">{{ dealer.address || '—' }}</p>
            </div>
          </div>

          <Separator class="opacity-20" />

          <div class="flex items-start gap-3">
            <div class="size-8 rounded-lg bg-muted/50 border flex items-center justify-center shrink-0 mt-0.5">
              <Icon name="i-lucide-circle-check" class="size-4 text-muted-foreground" />
            </div>
            <div class="min-w-0">
              <p class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-0.5">Status</p>
              <Badge variant="outline" :class="getStatusColor(dealer.status)" class="text-[10px] px-2 py-0.5 mt-0.5">
                {{ dealer.status }}
              </Badge>
            </div>
          </div>

          <Separator class="opacity-20" />

          <div class="flex items-start gap-3">
            <div class="size-8 rounded-lg bg-muted/50 border flex items-center justify-center shrink-0 mt-0.5">
              <Icon name="i-lucide-sticky-note" class="size-4 text-muted-foreground" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-0.5">Notes</p>
              <p class="text-xs text-foreground/80 whitespace-pre-wrap">{{ (dealer as any).notes || 'No notes' }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Tax & Financials Card -->
      <div class="border rounded-xl bg-card shadow-sm overflow-hidden">
        <div class="px-4 py-3 border-b bg-muted/20 flex items-center gap-2">
          <Icon name="i-lucide-receipt" class="size-4 text-primary" />
          <h3 class="text-xs font-semibold tracking-wide uppercase text-foreground">Tax & Financial Settings</h3>
        </div>
        <div class="p-4 space-y-4">
          <!-- Tax Toggle — matching the card style -->
          <div class="flex items-center justify-between p-3 rounded-lg bg-muted/20 border" @click.stop>
            <div class="flex items-center gap-3">
              <div class="size-9 rounded-lg flex items-center justify-center transition-colors duration-300 shrink-0" :class="dealer.isTaxApplied ? 'bg-primary/10' : 'bg-muted/50'">
                <Icon name="i-lucide-shield-check" class="size-4" :class="dealer.isTaxApplied ? 'text-primary' : 'text-muted-foreground'" />
              </div>
              <div class="flex flex-col">
                <span class="text-xs font-semibold" :class="dealer.isTaxApplied ? 'text-foreground' : 'text-muted-foreground'">Tax Settings</span>
                <span class="text-[10px] text-muted-foreground leading-none mt-0.5">{{ dealer.isTaxApplied ? 'Tax is enabled for this dealer' : 'Tax is disabled' }}</span>
              </div>
            </div>

            <div class="flex items-center gap-3">
              <!-- Inline Tax Rate Input -->
              <div v-if="dealer.isTaxApplied" class="flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
                <label class="text-[11px] text-muted-foreground shrink-0">Rate:</label>
                <div class="relative w-24">
                  <Input
                    type="number"
                    :model-value="dealer.taxPercentage"
                    @blur="handleTaxPercentageChange"
                    class="w-full h-8 px-2 pr-6 text-xs tabular-nums text-right"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="0"
                  />
                  <span class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">%</span>
                </div>
              </div>

              <!-- Toggle Switch -->
              <button
                type="button"
                role="switch"
                :aria-checked="dealer.isTaxApplied"
                @click.stop.prevent="handleToggleTax(!dealer.isTaxApplied)"
                class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                :class="dealer.isTaxApplied ? 'bg-primary' : 'bg-input'"
              >
                <span
                  class="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200 ease-in-out"
                  :class="dealer.isTaxApplied ? 'translate-x-5' : 'translate-x-0'"
                />
              </button>
            </div>
          </div>

          <Separator class="opacity-20" />

          <!-- Quick Stats -->
          <div class="grid grid-cols-2 gap-3">
            <div class="p-3 rounded-lg bg-muted/10 border text-center">
              <p class="text-lg font-bold text-foreground tabular-nums">{{ totalServices }}</p>
              <p class="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mt-0.5">Services</p>
            </div>
            <div class="p-3 rounded-lg bg-muted/10 border text-center">
              <p class="text-lg font-bold text-primary tabular-nums">{{ fmt(totalServiceValue) }}</p>
              <p class="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mt-0.5">Total Value</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Primary Contact Card -->
      <div class="border rounded-xl bg-card shadow-sm overflow-hidden">
        <div class="px-4 py-3 border-b bg-muted/20 flex items-center gap-2">
          <Icon name="i-lucide-user" class="size-4 text-primary" />
          <h3 class="text-xs font-semibold tracking-wide uppercase text-foreground">Primary Contact</h3>
          <Badge v-if="contactCount > 0" variant="secondary" class="ml-auto text-[9px] px-1.5 h-4">{{ contactCount }} total</Badge>
        </div>
        <div v-if="primaryContact" class="p-4 space-y-3">
          <div class="flex items-center gap-3">
            <div class="size-10 rounded-full bg-muted/50 border flex items-center justify-center shrink-0">
              <Icon name="i-lucide-user" class="size-5 text-muted-foreground" />
            </div>
            <div>
              <p class="text-sm font-semibold text-foreground">{{ primaryContact.name }}</p>
              <p class="text-[10px] text-muted-foreground">{{ primaryContact.designation || 'Representative' }}</p>
            </div>
          </div>
          <div class="space-y-2">
            <div v-for="phone in primaryContact.phones" :key="phone.id" class="flex items-center gap-2 text-xs p-2 rounded-md bg-muted/20">
              <Icon name="i-lucide-phone" class="size-3.5 text-muted-foreground" />
              <span class="font-medium tabular-nums">{{ phone.number }}</span>
              <span class="text-[9px] text-muted-foreground capitalize ml-auto">({{ phone.type }})</span>
            </div>
            <div v-for="email in primaryContact.emails" :key="email" class="flex items-center gap-2 text-xs p-2 rounded-md bg-muted/20">
              <Icon name="i-lucide-mail" class="size-3.5 text-muted-foreground" />
              <a :href="`mailto:${email}`" class="text-muted-foreground hover:text-primary transition-colors truncate">{{ email }}</a>
            </div>
          </div>
        </div>
        <div v-else class="p-6 text-center">
          <Icon name="i-lucide-user-x" class="size-8 text-muted-foreground/30 mx-auto mb-2" />
          <p class="text-xs text-muted-foreground">No contact information available</p>
        </div>
      </div>

      <!-- Timestamps Card -->
      <div class="border rounded-xl bg-card shadow-sm overflow-hidden">
        <div class="px-4 py-3 border-b bg-muted/20 flex items-center gap-2">
          <Icon name="i-lucide-clock" class="size-4 text-primary" />
          <h3 class="text-xs font-semibold tracking-wide uppercase text-foreground">Activity</h3>
        </div>
        <div class="p-4 space-y-3.5">
          <div class="flex items-center gap-3">
            <div class="size-8 rounded-lg bg-muted/50 border flex items-center justify-center shrink-0">
              <Icon name="i-lucide-calendar-plus" class="size-4 text-muted-foreground" />
            </div>
            <div class="min-w-0">
              <p class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-0.5">Created</p>
              <p class="text-xs font-medium text-foreground">{{ fmtDate(dealer.createdAt) }}</p>
            </div>
          </div>
          <Separator class="opacity-20" />
          <div class="flex items-center gap-3">
            <div class="size-8 rounded-lg bg-muted/50 border flex items-center justify-center shrink-0">
              <Icon name="i-lucide-calendar-check" class="size-4 text-muted-foreground" />
            </div>
            <div class="min-w-0">
              <p class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-0.5">Last Updated</p>
              <p class="text-xs font-medium text-foreground">{{ fmtDate(dealer.updatedAt) }}</p>
            </div>
          </div>
          <Separator class="opacity-20" />
          <div class="flex items-center gap-3">
            <div class="size-8 rounded-lg bg-muted/50 border flex items-center justify-center shrink-0">
              <Icon name="i-lucide-hash" class="size-4 text-muted-foreground" />
            </div>
            <div class="min-w-0">
              <p class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-0.5">Dealer ID</p>
              <p class="text-[10px] font-mono text-muted-foreground">{{ dealer.id }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
