<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import { Sparkles, CalendarClock, Clock, Globe, BellRing, Save, Loader2, Play } from 'lucide-vue-next'

const { setHeader } = usePageHeader()
setHeader({ title: 'General Settings', icon: 'i-lucide-settings-2' })

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const timezones = ref<string[]>([])
const loading = ref(true)
const isSaving = ref(false)

const form = ref({
  automations: {
    dailyInvoiceEmail: {
      enabled: false,
      time: '17:00',
      timezone: 'America/New_York'
    },
    weeklyInvoiceEmail: {
      enabled: false,
      day: 'Friday',
      time: '17:00',
      timezone: 'America/New_York'
    }
  }
})

onMounted(async () => {
  // Try to use modern timezone API
  try {
    if (Intl.supportedValuesOf) {
      timezones.value = Intl.supportedValuesOf('timeZone')
    } else {
      timezones.value = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo']
    }
  } catch (e) {
    timezones.value = ['America/New_York']
  }

  try {
    const res: any = await $fetch('/api/settings')
    if (res.success && res.settings?.automations) {
      form.value.automations = { ...form.value.automations, ...res.settings.automations }
    }
  } catch (err) {
    toast.error('Failed to load settings')
  } finally {
    loading.value = false
  }
})

async function saveSettings() {
  isSaving.value = true
  try {
    await $fetch('/api/settings', {
      method: 'PUT',
      body: { automations: form.value.automations }
    })
    toast.success('Settings saved successfully')
  } catch (err: any) {
    toast.error(`Save failed: ${err.message || String(err)}`)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="h-full flex flex-col p-4 sm:p-6 sm:max-w-4xl mx-auto w-full">
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <Loader2 class="size-6 animate-spin text-primary" />
    </div>

    <div v-else class="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      
      <!-- Headers -->
      <div>
        <h2 class="text-xl font-semibold tracking-tight">Platform Configurations</h2>
        <p class="text-sm text-muted-foreground mt-1">Manage global platform behaviors, automation triggers, and communications.</p>
      </div>

      <!-- Automations Card -->
      <div class="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
        <div class="border-b bg-muted/30 p-5 flex items-center gap-3">
          <div class="p-2 bg-primary/10 text-primary rounded-lg border border-primary/20 shadow-inner">
            <Sparkles class="size-5" />
          </div>
          <div>
            <h3 class="font-semibold text-base leading-none">Automations & Background Tasks</h3>
            <p class="text-sm text-muted-foreground mt-1.5">Schedule automated tasks like sending Daily and Weekly invoice emails to dealers.</p>
          </div>
        </div>
        
        <div class="p-6 space-y-8 bg-gradient-to-br from-background to-muted/10">
          
          <!-- Daily Invoice Emails -->
          <div class="grid gap-6 sm:grid-cols-[1fr_300px] relative items-start">
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                <Label class="text-sm font-semibold text-foreground">Daily Invoice Emails</Label>
                <Badge variant="secondary" :class="form.automations.dailyInvoiceEmail.enabled ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' : ''">
                  {{ form.automations.dailyInvoiceEmail.enabled ? 'Active' : 'Inactive' }}
                </Badge>
              </div>
              <p class="text-xs text-muted-foreground leading-relaxed max-w-sm">
                Automatically convert all generated daily work orders into invoices and fire an automated email to respective dealer contacts.
              </p>
              <div class="pt-3">
                <div class="flex items-center gap-2.5">
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="form.automations.dailyInvoiceEmail.enabled"
                    @click.stop.prevent="form.automations.dailyInvoiceEmail.enabled = !form.automations.dailyInvoiceEmail.enabled"
                    class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    :class="form.automations.dailyInvoiceEmail.enabled ? 'bg-primary' : 'bg-input'"
                  >
                    <span
                      class="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200 ease-in-out"
                      :class="form.automations.dailyInvoiceEmail.enabled ? 'translate-x-5' : 'translate-x-0'"
                    />
                  </button>
                  <Label class="text-xs font-medium cursor-pointer" @click="form.automations.dailyInvoiceEmail.enabled = !form.automations.dailyInvoiceEmail.enabled">Enable Daily Automation</Label>
                </div>
              </div>
            </div>

            <div class="space-y-4 rounded-xl bg-card border shadow-sm p-4 transition-all duration-300" :class="!form.automations.dailyInvoiceEmail.enabled ? 'opacity-40 grayscale pointer-events-none translate-x-2' : ''">
              <div class="grid gap-2.5">
                <Label class="text-xs flex items-center gap-1.5 font-medium text-muted-foreground">
                  <Clock class="size-3.5" /> Execution Time
                </Label>
                <Input type="time" v-model="form.automations.dailyInvoiceEmail.time" class="h-9 text-sm bg-background border-muted shadow-sm" />
              </div>
              <div class="grid gap-2.5">
                <Label class="text-xs flex items-center gap-1.5 font-medium text-muted-foreground">
                  <Globe class="size-3.5" /> Timezone
                </Label>
                <Select v-model="form.automations.dailyInvoiceEmail.timezone">
                  <SelectTrigger class="h-9 text-xs bg-background shadow-sm">
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="tz in timezones" :key="tz" :value="tz">{{ tz }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          
          <Separator class="bg-border/60" />
          
          <!-- Weekly Invoice Emails -->
          <div class="grid gap-6 sm:grid-cols-[1fr_300px] relative items-start">
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                <Label class="text-sm font-semibold text-foreground">Weekly Invoice Emails</Label>
                <Badge variant="secondary" :class="form.automations.weeklyInvoiceEmail.enabled ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' : ''">
                  {{ form.automations.weeklyInvoiceEmail.enabled ? 'Active' : 'Inactive' }}
                </Badge>
              </div>
              <p class="text-xs text-muted-foreground leading-relaxed max-w-sm">
                Automatically bundle all non-invoiced weekly work orders and deliver them on the scheduled day.
              </p>
              <div class="pt-3">
                <div class="flex items-center gap-2.5">
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="form.automations.weeklyInvoiceEmail.enabled"
                    @click.stop.prevent="form.automations.weeklyInvoiceEmail.enabled = !form.automations.weeklyInvoiceEmail.enabled"
                    class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    :class="form.automations.weeklyInvoiceEmail.enabled ? 'bg-primary' : 'bg-input'"
                  >
                    <span
                      class="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200 ease-in-out"
                      :class="form.automations.weeklyInvoiceEmail.enabled ? 'translate-x-5' : 'translate-x-0'"
                    />
                  </button>
                  <Label class="text-xs font-medium cursor-pointer" @click="form.automations.weeklyInvoiceEmail.enabled = !form.automations.weeklyInvoiceEmail.enabled">Enable Weekly Automation</Label>
                </div>
              </div>
            </div>

            <div class="space-y-4 rounded-xl bg-card border shadow-sm p-4 transition-all duration-300" :class="!form.automations.weeklyInvoiceEmail.enabled ? 'opacity-40 grayscale pointer-events-none translate-x-2' : ''">
              <div class="grid gap-2.5">
                <Label class="text-xs flex items-center gap-1.5 font-medium text-muted-foreground">
                  <CalendarClock class="size-3.5" /> Execution Day
                </Label>
                <Select v-model="form.automations.weeklyInvoiceEmail.day">
                  <SelectTrigger class="h-9 text-xs bg-background shadow-sm">
                    <SelectValue placeholder="Select day" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="d in days" :key="d" :value="d">{{ d }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="grid gap-2.5">
                <Label class="text-xs flex items-center gap-1.5 font-medium text-muted-foreground">
                   <Clock class="size-3.5" /> Time
                </Label>
                <Input type="time" v-model="form.automations.weeklyInvoiceEmail.time" class="h-9 text-sm bg-background shadow-sm" />
              </div>
              <div class="grid gap-2.5">
                <Label class="text-xs flex items-center gap-1.5 font-medium text-muted-foreground">
                  <Globe class="size-3.5" /> Timezone
                </Label>
                <Select v-model="form.automations.weeklyInvoiceEmail.timezone">
                  <SelectTrigger class="h-9 text-xs bg-background shadow-sm">
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="tz in timezones" :key="tz" :value="tz">{{ tz }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

        </div>
        
        <div class="border-t bg-muted/40 p-4 px-6 flex justify-end">
          <Button @click="saveSettings" :disabled="isSaving" class="gap-2 shadow-md relative overflow-hidden group">
            <span class="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 pointer-events-none"></span>
            <Loader2 v-if="isSaving" class="size-4 animate-spin" />
            <Save v-else class="size-4" />
            <span class="font-semibold tracking-wide text-xs">Save Configuration</span>
          </Button>
        </div>
      </div>

    </div>
  </div>
</template>
