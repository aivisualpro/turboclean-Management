<script setup lang="ts">
import { Plus, Search, Pencil, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const { setHeader } = usePageHeader()
setHeader({ title: 'App Users', icon: 'i-lucide-users' })

const { data: users, pending, refresh } = await useFetch<any[]>('/api/users')
const userList = computed(() => users.value || [])

// Real-time: auto-refresh when AppSheet changes users
useLiveSync('AppUsers', () => refresh())

const searchValue = ref('')
const displayList = computed(() => {
  if (!searchValue.value) return userList.value
  const q = searchValue.value.toLowerCase()
  return userList.value.filter(u => 
    u.name?.toLowerCase().includes(q) || 
    u.email?.toLowerCase().includes(q) || 
    u.role?.toLowerCase().includes(q)
  )
})

const showForm = ref(false)
const showDeleteDialog = ref(false)
const isSubmitting = ref(false)
const editingId = ref<string | null>(null)

const showPassword = ref(false)
function generatePassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$*'
  let pass = ''
  for (let i = 0; i < 12; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length))
  formData.password = pass
  showPassword.value = true
}

const formData = reactive({
  name: '',
  email: '',
  phone: '',
  address: '',
  role: 'User',
  status: 'Active',
  password: '',
})

function openAddForm() {
  editingId.value = null
  Object.assign(formData, {
    name: '',
    email: '',
    phone: '',
    address: '',
    role: 'User',
    status: 'Active',
    password: '',
  })
  showForm.value = true
}

function openEditForm(user: any) {
  editingId.value = user.id
  Object.assign(formData, {
    name: user.name || '',
    email: user.email || '',
    phone: user.phone || '',
    address: user.address || '',
    role: user.role || 'User',
    status: user.status || 'Active',
    password: user.password || '',
  })
  showForm.value = true
}

function confirmDelete(id: string) {
  editingId.value = id
  showDeleteDialog.value = true
}

async function handleDelete() {
  if (!editingId.value) return
  isSubmitting.value = true
  try {
    await $fetch(`/api/users/${editingId.value}`, { method: 'DELETE' })
    toast.success('User deleted successfully')
    showDeleteDialog.value = false
    await refresh()
  } catch (error: any) {
    toast.error(error.message || 'Failed to delete user')
  } finally {
    isSubmitting.value = false
  }
}

async function handleSave() {
  if (!formData.name) {
    toast.error('Name is required')
    return
  }
  isSubmitting.value = true
  try {
    if (editingId.value) {
      await $fetch(`/api/users/${editingId.value}`, {
        method: 'PUT',
        body: formData
      })
      toast.success('User updated successfully')
    } else {
      await $fetch('/api/users', {
        method: 'POST',
        body: formData
      })
      toast.success('User created successfully')
    }
    showForm.value = false
    await refresh()
  } catch (error: any) {
    toast.error(error.message || 'Failed to save user')
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="-m-4 lg:-m-6 h-[calc(100dvh-54px-3rem)]">
    <div class="h-full flex flex-col bg-background/50 border rounded-xl overflow-hidden backdrop-blur supports-[backdrop-filter]:bg-background/50">
      
      <div class="h-full flex flex-col relative overflow-hidden">
        <ClientOnly>
          <Teleport to="#page-header-actions">
            <form @submit.prevent class="relative w-48 xl:w-64 max-w-sm">
              <Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input v-model="searchValue" placeholder="Search users..." class="pl-9 h-9 bg-background cursor-text" />
            </form>
            <div class="flex items-center gap-2 shrink-0">
              <Button size="sm" class="h-9 px-3 gap-2" @click="openAddForm">
                <Plus class="size-4" />
                <span class="hidden lg:inline">Add User</span>
              </Button>
            </div>
          </Teleport>
        </ClientOnly>

        <div class="flex-1 overflow-auto relative">
          <table class="w-full text-sm">
            <thead class="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80 shadow-[0_1px_0_var(--border)]">
              <tr>
                <th class="p-4 text-left font-medium text-muted-foreground">Name</th>
                <th class="p-4 text-left font-medium text-muted-foreground">Phone</th>
                <th class="p-4 text-left font-medium text-muted-foreground">Email</th>
                <th class="p-4 text-left font-medium text-muted-foreground">Address</th>
                <th class="p-4 text-left font-medium text-muted-foreground">App Role</th>
                <th class="p-4 text-left font-medium text-muted-foreground">Status</th>
                <th class="p-4 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr 
                v-for="u in displayList" 
                :key="u.id" 
                class="border-b hover:bg-muted/30 transition-colors"
                v-if="!pending"
              >
                <td class="p-4 font-medium">
                  {{ u.name }}
                </td>
                <td class="p-4 text-muted-foreground tabular-nums">
                  {{ u.phone || '—' }}
                </td>
                <td class="p-4 text-muted-foreground">
                  {{ u.email || '—' }}
                </td>
                <td class="p-4 text-muted-foreground max-w-[200px] truncate">
                  {{ u.address || '—' }}
                </td>
                <td class="p-4">
                  <Badge variant="outline" class="text-[10px] px-1.5 py-0" :class="u.role === 'Admin' ? 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20' : 'bg-gray-500/10 text-gray-600 border-gray-500/20'">
                    {{ u.role }}
                  </Badge>
                </td>
                <td class="p-4">
                  <Badge variant="outline" class="text-[10px] px-1.5 py-0" :class="u.status === 'Active' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-red-500/10 text-red-600 border-red-500/20'">
                    {{ u.status }}
                  </Badge>
                </td>
                <td class="p-4 text-right">
                  <div class="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" class="size-7" title="Edit" @click="openEditForm(u)">
                      <Pencil class="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" class="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive" title="Delete" @click="confirmDelete(u.id)">
                      <Trash2 class="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
              <tr v-if="pending">
                <td colspan="7" class="p-8 text-center text-muted-foreground">
                  Loading users...
                </td>
              </tr>
              <tr v-else-if="displayList.length === 0">
                <td colspan="7" class="p-8 text-center text-muted-foreground">
                  No users found
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- User Form Sidebar -->
    <Sheet v-model:open="showForm">
      <SheetContent side="right" class="sm:max-w-md w-full overflow-y-auto p-0 flex flex-col">
        <SheetHeader class="px-6 py-4 border-b shrink-0">
          <SheetTitle>{{ editingId ? 'Edit User' : 'Add User' }}</SheetTitle>
          <SheetDescription>Enter user configuration details.</SheetDescription>
        </SheetHeader>

        <div class="space-y-4 px-6 py-6 flex-1">
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

          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <Label>Password</Label>
              <button type="button" class="text-xs text-primary font-medium hover:underline" @click="generatePassword">Suggest password</button>
            </div>
            <div class="relative">
              <Input v-model="formData.password" placeholder="••••••••" :type="showPassword ? 'text' : 'password'" />
              <Button variant="ghost" size="icon" type="button" class="absolute right-0 top-0 size-9 text-muted-foreground" @click="showPassword = !showPassword">
                <Icon :name="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="size-4" />
              </Button>
            </div>
            <p class="text-[10px] text-muted-foreground" v-if="editingId">Leave blank to keep current password</p>
          </div>
          
          <div class="grid grid-cols-2 gap-4">
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
        </div>

        <SheetFooter class="gap-2 px-6 py-4 border-t shrink-0">
          <Button variant="outline" @click="showForm = false" :disabled="isSubmitting">Cancel</Button>
          <Button @click="handleSave" :disabled="isSubmitting">
            <span v-if="isSubmitting">Saving...</span>
            <span v-else>Save User</span>
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>

    <!-- Delete Confirmation -->
    <AlertDialog v-model:open="showDeleteDialog">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this user from the <code class="bg-muted px-1 rounded">turboCleanAppUsers</code> collection.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isSubmitting">Cancel</AlertDialogCancel>
          <AlertDialogAction @click="handleDelete" class="bg-destructive text-destructive-foreground hover:bg-destructive/90" :disabled="isSubmitting">
            <span v-if="isSubmitting">Deleting...</span>
            <span v-else>Continue</span>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
