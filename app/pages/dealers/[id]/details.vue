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
    case 'Authorised': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
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
            <div class="size-8 rounded-lg bg-orange-500/5 border flex items-center justify-center shrink-0 mt-0.5">
              <Icon name="i-lucide-map-pin" class="size-4 text-orange-500/70" />
            </div>
            <div class="min-w-0">
              <p class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-0.5">Address</p>
              <p class="text-xs text-foreground/80">{{ dealer.address || '—' }}</p>
            </div>
          </div>

          <Separator class="opacity-20" />

          <div class="flex items-start gap-3">
            <div class="size-8 rounded-lg bg-emerald-500/5 border flex items-center justify-center shrink-0 mt-0.5">
              <Icon name="i-lucide-circle-check" class="size-4 text-emerald-500/70" />
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
            <div class="size-8 rounded-lg bg-blue-500/5 border flex items-center justify-center shrink-0 mt-0.5">
              <Icon name="i-lucide-sticky-note" class="size-4 text-blue-500/70" />
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
          <!-- Tax Toggle -->
          <div class="flex items-center justify-between p-3 rounded-lg bg-muted/20 border">
            <div class="flex items-center gap-3">
              <div class="size-9 rounded-lg flex items-center justify-center" :class="dealer.isTaxApplied ? 'bg-emerald-500/10' : 'bg-muted/50'">
                <Icon name="i-lucide-percent" class="size-4" :class="dealer.isTaxApplied ? 'text-emerald-600' : 'text-muted-foreground'" />
              </div>
              <div>
                <p class="text-xs font-semibold text-foreground">Tax Applied</p>
                <p class="text-[10px] text-muted-foreground mt-0.5">{{ dealer.isTaxApplied ? 'Tax is enabled for this dealer' : 'No tax applied' }}</p>
              </div>
            </div>
            <Switch
              :checked="dealer.isTaxApplied"
              @update:checked="handleToggleTax"
              class="data-[state=checked]:bg-emerald-500"
            />
          </div>

          <!-- Tax Percentage -->
          <div v-if="dealer.isTaxApplied" class="flex items-center justify-between p-3 rounded-lg bg-muted/20 border">
            <div class="flex items-center gap-3">
              <div class="size-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Icon name="i-lucide-calculator" class="size-4 text-blue-600" />
              </div>
              <div>
                <p class="text-xs font-semibold text-foreground">Tax Percentage</p>
                <p class="text-[10px] text-muted-foreground mt-0.5">Current rate applied on all services</p>
              </div>
            </div>
            <div class="flex items-center gap-1.5">
              <Input
                type="number"
                :model-value="dealer.taxPercentage"
                @blur="handleTaxPercentageChange"
                class="w-20 h-8 text-xs tabular-nums text-right"
                step="0.01"
                min="0"
                max="100"
                placeholder="0"
              />
              <span class="text-xs text-muted-foreground font-medium">%</span>
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
              <p class="text-lg font-bold text-emerald-600 tabular-nums">{{ fmt(totalServiceValue) }}</p>
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
            <Avatar class="size-10 border-2 border-primary/10">
              <AvatarFallback class="bg-primary/5 text-primary text-sm font-semibold">
                {{ primaryContact.name.slice(0, 2).toUpperCase() }}
              </AvatarFallback>
            </Avatar>
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
            <div class="size-8 rounded-lg bg-emerald-500/5 border flex items-center justify-center shrink-0">
              <Icon name="i-lucide-calendar-plus" class="size-4 text-emerald-500/70" />
            </div>
            <div class="min-w-0">
              <p class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-0.5">Created</p>
              <p class="text-xs font-medium text-foreground">{{ fmtDate(dealer.createdAt) }}</p>
            </div>
          </div>
          <Separator class="opacity-20" />
          <div class="flex items-center gap-3">
            <div class="size-8 rounded-lg bg-blue-500/5 border flex items-center justify-center shrink-0">
              <Icon name="i-lucide-calendar-check" class="size-4 text-blue-500/70" />
            </div>
            <div class="min-w-0">
              <p class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-0.5">Last Updated</p>
              <p class="text-xs font-medium text-foreground">{{ fmtDate(dealer.updatedAt) }}</p>
            </div>
          </div>
          <Separator class="opacity-20" />
          <div class="flex items-center gap-3">
            <div class="size-8 rounded-lg bg-violet-500/5 border flex items-center justify-center shrink-0">
              <Icon name="i-lucide-hash" class="size-4 text-violet-500/70" />
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
