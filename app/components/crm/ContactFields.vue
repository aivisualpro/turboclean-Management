<script setup lang="ts">
import type { ContactInput } from '~/composables/useCrmDealerships'
import { Mail, Phone, Smartphone } from 'lucide-vue-next'
import { CONTACT_METHODS, CONTACT_ROLES } from '~/constants/crm'

/** Reusable field group for a contact — used by add, edit and handover flows. */
const form = defineModel<ContactInput>({ required: true })
withDefaults(defineProps<{ errors?: Record<string, string>, idPrefix?: string, showPrimary?: boolean }>(), { showPrimary: true })

function onRoleChange(v: any) {
  const role = String(v)
  const prev = form.value.role
  // Keep job title in sync with the role until the user customises it.
  if (!form.value.jobTitle || form.value.jobTitle === prev || CONTACT_ROLES.includes(form.value.jobTitle as any))
    form.value.jobTitle = role === 'Other' ? '' : role
  form.value.role = role
}
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1.5">
        <Label :for="`${idPrefix || 'c'}-first`">First name <span class="text-destructive">*</span></Label>
        <Input :id="`${idPrefix || 'c'}-first`" v-model="form.firstName" placeholder="Jordan" :aria-invalid="!!errors?.name" autofocus />
      </div>
      <div class="space-y-1.5">
        <Label :for="`${idPrefix || 'c'}-last`">Last name</Label>
        <Input :id="`${idPrefix || 'c'}-last`" v-model="form.lastName" placeholder="Reyes" :aria-invalid="!!errors?.name" />
      </div>
      <p v-if="errors?.name" class="col-span-2 -mt-2 text-xs text-destructive">{{ errors.name }}</p>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1.5">
        <Label>Role</Label>
        <Select :model-value="form.role" @update:model-value="onRoleChange">
          <SelectTrigger class="w-full"><SelectValue placeholder="Select role" /></SelectTrigger>
          <SelectContent class="max-h-72">
            <SelectItem v-for="r in CONTACT_ROLES" :key="r" :value="r">{{ r }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="space-y-1.5">
        <Label :for="`${idPrefix || 'c'}-title`">Job title</Label>
        <Input :id="`${idPrefix || 'c'}-title`" v-model="form.jobTitle" placeholder="As printed on their card" />
      </div>
    </div>
    <div class="space-y-1.5">
      <Label :for="`${idPrefix || 'c'}-email`">Email</Label>
      <div class="relative">
        <Mail class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input :id="`${idPrefix || 'c'}-email`" v-model="form.email" type="email" placeholder="jordan@dealership.com" class="pl-9" :aria-invalid="!!errors?.email" />
      </div>
      <p v-if="errors?.email" class="text-xs text-destructive">{{ errors.email }}</p>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1.5">
        <Label :for="`${idPrefix || 'c'}-phone`">Office phone</Label>
        <div class="relative">
          <Phone class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input :id="`${idPrefix || 'c'}-phone`" v-model="form.phone" inputmode="tel" placeholder="(512) 555-0100" class="pl-9" />
        </div>
      </div>
      <div class="space-y-1.5">
        <Label :for="`${idPrefix || 'c'}-mobile`">Mobile</Label>
        <div class="relative">
          <Smartphone class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input :id="`${idPrefix || 'c'}-mobile`" v-model="form.mobile" inputmode="tel" placeholder="(512) 555-0199" class="pl-9" />
        </div>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-3 items-end">
      <div class="space-y-1.5">
        <Label>Preferred contact method</Label>
        <Select v-model="form.preferredContactMethod">
          <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="m in CONTACT_METHODS" :key="m.value" :value="m.value">{{ m.label }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <label v-if="showPrimary" class="flex items-center justify-between gap-3 rounded-md border px-3 h-9 cursor-pointer select-none hover:bg-accent/40 transition-colors">
        <span class="text-sm">Primary contact</span>
        <Switch :model-value="!!form.isPrimary" @update:model-value="form.isPrimary = $event" />
      </label>
    </div>
    <div class="space-y-1.5">
      <Label :for="`${idPrefix || 'c'}-notes`">Notes</Label>
      <Textarea :id="`${idPrefix || 'c'}-notes`" v-model="form.notes" rows="3" class="resize-none" placeholder="How they like to be approached, decision authority, best time to call…" />
    </div>
  </div>
</template>
