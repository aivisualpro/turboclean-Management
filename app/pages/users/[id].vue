<script setup lang="ts">
import { Plus, Search, Pencil, Trash2, Check, ChevronsUpDown, X, ArrowLeft, Save, Eye, EyeOff } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useDealers } from '~/composables/useDealers'
import { nanoid } from 'nanoid'

const route = useRoute()
const userId = route.params.id as string
const isNew = userId === 'new'

const { setHeader } = usePageHeader()
setHeader({ title: isNew ? 'Add User' : 'Edit User', icon: 'i-lucide-user' })

const { dealers, fetchDealers } = useDealers()
if (import.meta.client && dealers.value.length === 0) fetchDealers()

const { data: users, pending } = useFetch<any[]>('/api/users', { lazy: true })
const { data: workspacesRes } = useFetch<any>('/api/workspaces', { lazy: true })

const formData = reactive({
  name: '',
  email: '',
  phone: '',
  address: '',
  registerDealers: [] as string[],
  role: 'User',
  status: 'Active',
  password: '',
  workspaceId: 'none',
})

// populate on mount if editing
watchEffect(() => {
  if (!isNew && users.value) {
    const user = users.value.find(u => u.id === userId)
    if (user) {
      Object.assign(formData, {
        name: user.name || '',
        email: user.email || '',
        phone: user.phone || '',
        address: user.address || '',
        registerDealers: Array.isArray(user.registerDealers) ? [...user.registerDealers] : [],
        role: user.role || 'User',
        status: user.status || 'Active',
        password: user.password || '', 
        workspaceId: user.workspaceId || 'none',
      })
      setHeader({ title: user.name, icon: 'i-lucide-user' })
    }
  }
})

// Dealer Multi-select logic
const dealerSearch = ref('')
const dealerPopoverOpen = ref(false)

const filteredDealers = computed(() => {
  const q = dealerSearch.value.toLowerCase()
  if (!q) return dealers.value
  return dealers.value.filter((d: any) => d.dealerName.toLowerCase().includes(q))
})

function toggleDealer(dealerId: string) {
  const idx = formData.registerDealers.indexOf(dealerId)
  if (idx >= 0) {
    formData.registerDealers.splice(idx, 1)
  } else {
    formData.registerDealers.push(dealerId)
  }
}

function toggleAllDealers() {
  if (formData.registerDealers.length === dealers.value.length && dealers.value.length > 0) {
    formData.registerDealers = []
  } else {
    formData.registerDealers = dealers.value.map((d: any) => d.id)
  }
}

function getDealerName(id: string): string {
  return dealers.value.find((d: any) => d.id === id)?.dealerName || id
}

const showPassword = ref(false)
function generatePassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$*'
  let pass = ''
  for (let i = 0; i < 12; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length))
  formData.password = pass
  showPassword.value = true
}

const isSaving = ref(false)
const showDeleteDialog = ref(false)

async function handleSave() {
  if (!formData.name) {
    toast.error('Name is required')
    return
  }

  isSaving.value = true
  const snapshot = { ...formData }
  if (snapshot.workspaceId === 'none') {
    snapshot.workspaceId = ''
  }

  if (isNew) {
    try {
      const res: any = await $fetch('/api/users', { method: 'POST', body: snapshot })
      toast.success('User created successfully')
      navigateTo('/users')
    } catch (err: any) {
      toast.error(err.message || 'Failed to create user')
    }
  } else {
    try {
      await $fetch(`/api/users/${userId}`, { method: 'PUT', body: snapshot })
      toast.success('User updated successfully')
      navigateTo('/users')
    } catch (err: any) {
      toast.error(err.message || 'Failed to update user')
    }
  }
  isSaving.value = false
}

async function handleDelete() {
  if (isNew) return
  isSaving.value = true
  try {
    await $fetch(`/api/users/${userId}`, { method: 'DELETE' })
    toast.success('User deleted successfully')
    navigateTo('/users')
  } catch (err: any) {
    toast.error(err.message || 'Failed to delete user')
  } finally {
    isSaving.value = false
    showDeleteDialog.value = false
  }
}
</script>

<template>
  <div class="h-[calc(100dvh-54px-3rem)] overflow-auto -m-4 lg:-m-6 p-4 lg:p-6 bg-muted/20">
    <div class="max-w-4xl mx-auto space-y-6">
      
      <!-- Teleport header actions -->
      <ClientOnly>
        <Teleport to="#page-header-actions">
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" class="h-8" @click="$router.push('/users')">
              <ArrowLeft class="size-3.5 mr-1.5" /> Back to Users
            </Button>
            <Button v-if="!isNew" variant="outline" size="icon" class="h-8 w-8 text-destructive hover:bg-destructive/10 border-destructive/20" @click="showDeleteDialog = true">
              <Trash2 class="size-3.5" />
            </Button>
          </div>
        </Teleport>
      </ClientOnly>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      
        <!-- Basic Info Card -->
        <Card class="shadow-sm border-muted">
          <CardHeader>
            <CardTitle class="text-lg">Basic Information</CardTitle>
            <CardDescription>Primary contact details and credentials.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="space-y-1.5">
              <Label>Name</Label>
              <Input v-model="formData.name" placeholder="John Doe" />
            </div>
            
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-1.5">
                <Label>Email</Label>
                <Input v-model="formData.email" placeholder="john@example.com" type="email" />
              </div>
              <div class="space-y-1.5">
                <Label>Phone</Label>
                <Input v-model="formData.phone" placeholder="+1..." />
              </div>
            </div>

            <div class="space-y-1.5">
              <Label>Address</Label>
              <Input v-model="formData.address" placeholder="123 Main St..." />
            </div>

            <div class="space-y-1.5 pt-2">
              <div class="flex items-center justify-between">
                <Label>Password</Label>
                <button type="button" class="text-[11px] text-primary font-medium hover:underline" @click="generatePassword">Suggest password</button>
              </div>
              <div class="relative">
                <Input v-model="formData.password" placeholder="••••••••" :type="showPassword ? 'text' : 'password'" />
                <Button variant="ghost" size="icon" type="button" class="absolute right-0 top-0 size-9 text-muted-foreground" @click="showPassword = !showPassword">
                  <EyeOff v-if="showPassword" class="size-4" />
                  <Eye v-else class="size-4" />
                </Button>
              </div>
              <p class="text-[10px] text-muted-foreground" v-if="!isNew">Leave blank to keep current password</p>
            </div>
          </CardContent>
        </Card>

        <div class="space-y-6">
          <!-- Assignments Card -->
          <Card class="shadow-sm border-muted">
            <CardHeader>
              <CardTitle class="text-lg">Assignments & Access</CardTitle>
              <CardDescription>Role, status, and associated dealerships.</CardDescription>
            </CardHeader>
            <CardContent class="space-y-6">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="space-y-1.5">
                  <Label>Workspace</Label>
                  <Select v-model="formData.workspaceId">
                    <SelectTrigger>
                      <SelectValue placeholder="No workspace..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Workspace</SelectItem>
                      <SelectItem v-for="ws in (workspacesRes?.workspaces || [])" :key="ws.id" :value="ws.id">
                        {{ ws.name || ws.workspaceName || 'Unnamed' }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div class="space-y-1.5">
                  <Label>App Role</Label>
                  <Select v-model="formData.role">
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Admin">Admin</SelectItem>
                      <SelectItem value="User">User</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div class="space-y-1.5">
                  <Label>Status</Label>
                  <Select v-model="formData.status">
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div class="space-y-2">
                <Label>Registered Dealers</Label>
                <div class="p-3 border rounded-lg bg-card/50 space-y-3">
                  <Popover v-model:open="dealerPopoverOpen">
                    <PopoverTrigger as-child>
                      <Button variant="outline" role="combobox" :aria-expanded="dealerPopoverOpen" class="w-full justify-between h-auto min-h-9 font-normal">
                        <span class="text-muted-foreground">Add dealer assignment...</span>
                        <ChevronsUpDown class="ml-2 size-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent class="w-[--reka-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput v-model="dealerSearch" placeholder="Search dealers..." />
                        <CommandEmpty>No dealers found.</CommandEmpty>
                        <CommandList class="max-h-48">
                          <CommandGroup>
                            <CommandItem
                              value="Select All"
                              @select.prevent="toggleAllDealers"
                              class="cursor-pointer font-medium"
                              v-if="dealers.length > 0 && !dealerSearch"
                            >
                              <div class="flex items-center gap-2 w-full">
                                <div class="size-4 shrink-0 rounded border flex items-center justify-center" :class="formData.registerDealers.length === dealers.length ? 'bg-primary border-primary' : 'border-muted-foreground/30'">
                                  <Check v-if="formData.registerDealers.length === dealers.length" class="size-3 text-primary-foreground" />
                                </div>
                                <span class="truncate">Select All</span>
                              </div>
                            </CommandItem>
                            <CommandItem
                              v-for="d in filteredDealers"
                              :key="d.id"
                              :value="d.dealerName"
                              @select.prevent="toggleDealer(d.id)"
                              class="cursor-pointer"
                            >
                              <div class="flex items-center gap-2 w-full">
                                <div class="size-4 shrink-0 rounded border flex items-center justify-center" :class="formData.registerDealers.includes(d.id) ? 'bg-primary border-primary' : 'border-muted-foreground/30'">
                                  <Check v-if="formData.registerDealers.includes(d.id)" class="size-3 text-primary-foreground" />
                                </div>
                                <span class="truncate">{{ d.dealerName }}</span>
                              </div>
                            </CommandItem>
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  <!-- Selected Badges -->
                  <div v-if="formData.registerDealers.length" class="flex flex-wrap gap-1.5 pt-1">
                    <Badge v-for="dId in formData.registerDealers" :key="dId" variant="secondary" class="text-xs px-2 py-0.5 gap-1 shrink-0 bg-blue-500/10 text-blue-600 border-blue-500/20 hover:bg-blue-500/20">
                      {{ getDealerName(dId) }}
                      <X class="size-3 cursor-pointer opacity-60 hover:opacity-100" @click.stop="toggleDealer(dId)" />
                    </Badge>
                  </div>
                  <div v-else class="text-sm text-center text-muted-foreground py-2 border border-dashed rounded bg-muted/30">
                    No dealers assigned yet.
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <div class="flex justify-end pt-4">
             <Button class="gap-2 w-full md:w-auto" :disabled="isSaving || pending" @click="handleSave">
               <Save class="size-4" />
               {{ isSaving ? 'Saving...' : 'Save User Settings' }}
             </Button>
          </div>
        </div>

      </div>
    </div>
    
    <!-- Delete Confirmation -->
    <AlertDialog v-model:open="showDeleteDialog">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this user from the system. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="handleDelete" class="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {{ isSaving ? 'Deleting...' : 'Continue' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
