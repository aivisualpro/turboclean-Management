<script setup lang="ts">
import { Plus, Search, Pencil, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const { setHeader } = usePageHeader()
setHeader({ title: 'App Users', icon: 'i-lucide-users' })

const router = useRouter()
const { isActionAllowed } = usePermissions()
const canAdd = computed(() => isActionAllowed('users', 'Add'))
const canEdit = computed(() => isActionAllowed('users', 'Edit'))
const canDelete = computed(() => isActionAllowed('users', 'Delete'))
function goToUser(id: string) {
  router.push(`/users/${id}`)
}

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

const showDeleteDialog = ref(false)
const deletingId = ref<string | null>(null)

function confirmDelete(id: string) {
  deletingId.value = id
  showDeleteDialog.value = true
}

function handleDelete() {
  if (!deletingId.value) return
  const deleteId = deletingId.value

  // ── Optimistic: remove from UI immediately ──
  const removedUser = users.value?.find(u => u.id === deleteId)
  if (users.value) {
    users.value = users.value.filter(u => u.id !== deleteId)
  }
  showDeleteDialog.value = false
  toast.success('User deleted successfully')

  // ── Background: fire API call silently ──
  $fetch(`/api/users/${deleteId}`, { method: 'DELETE' }).catch(() => {
    // Rollback: re-add user if API failed
    if (removedUser && users.value) {
      users.value.push(removedUser)
    }
    toast.error('Failed to delete user — restored')
  })
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
              <Button v-if="canAdd" size="sm" class="h-9 px-3 gap-2" @click="goToUser('new')">
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
                <th class="p-4 text-left font-medium text-muted-foreground">Workspace</th>
                <th class="p-4 text-left font-medium text-muted-foreground">App Role</th>
                <th class="p-4 text-left font-medium text-muted-foreground">Status</th>
                <th class="p-4 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr 
                v-for="u in displayList" 
                :key="u.id" 
                class="border-b hover:bg-muted/30 transition-colors cursor-pointer"
                @click="goToUser(u.id)"
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
                  <Badge v-if="u.workspaceName && u.workspaceName !== 'None'" variant="outline" class="text-[10px] px-1.5 py-0 bg-teal-500/10 text-teal-600 border-teal-500/20">
                    {{ u.workspaceName }}
                  </Badge>
                  <span v-else class="text-muted-foreground">—</span>
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
                <td class="p-4 text-right" @click.stop>
                  <div class="flex items-center justify-end gap-1">
                    <Button v-if="canEdit" variant="ghost" size="icon" class="size-7" title="Edit" @click="goToUser(u.id)">
                      <Pencil class="size-3.5" />
                    </Button>
                    <Button v-if="canDelete" variant="ghost" size="icon" class="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive" title="Delete" @click="confirmDelete(u.id)">
                      <Trash2 class="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
              <tr v-if="pending" v-for="i in 5" :key="'loader-' + i">
                <td v-for="j in 8" :key="j" class="p-4">
                  <Skeleton class="h-4 w-full rounded" />
                </td>
              </tr>
              <tr v-else-if="displayList.length === 0">
                <td colspan="8" class="p-8 text-center text-muted-foreground">
                  No users found
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

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
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="handleDelete" class="bg-destructive text-destructive-foreground hover:bg-destructive/90">Continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
