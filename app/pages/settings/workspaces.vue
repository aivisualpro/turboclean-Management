<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import { Boxes, Plus, Edit2, Trash2, Check, X, Shield, PlusCircle, LayoutDashboard, Users, Briefcase, Building2, FileText, Receipt, KanbanSquare, Settings2 } from 'lucide-vue-next'

const { setHeader } = usePageHeader()
setHeader({ title: 'Workspaces & Permissions' })

// ─── Available Menus Baseline ─────────
const availableMenus = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, subMenus: ['Overview', 'Dealers', 'Services'] },
  { id: 'users', label: 'App Users', icon: Users, subMenus: ['Add', 'Edit', 'Delete'] },
  { id: 'services', label: 'Services', icon: Briefcase, subMenus: ['Add', 'Edit', 'Delete'] },
  { id: 'dealers', label: 'Dealers', icon: Building2, subMenus: ['Services', 'Contacts', 'Work Orders', 'Invoices', 'Emails', 'Add', 'Edit', 'Delete'] },
  { id: 'work_orders', label: 'Work Orders', icon: FileText, subMenus: ['Edit', 'Delete'] },
  { id: 'invoices', label: 'Invoices', icon: Receipt, subMenus: ['Daily', 'Weekly'] },
  { id: 'tasks', label: 'Tasks', icon: KanbanSquare, subMenus: ['Add', 'Edit', 'Delete'] },
  { id: 'general_settings', label: 'General Settings', icon: Settings2, subMenus: [] }
]

// ─── State ──────────────────────────────
const workspaces = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const editingWorkspace = ref<any>(null)
const isSaving = ref(false)

const form = ref({
  id: '',
  name: '',
  description: '',
  status: 'Active',
  menus: {} as Record<string, { enabled: boolean; tabs: string[] }>
})

// Build default empty menus map
function getDefaultMenus() {
  const menus: any = {}
  availableMenus.forEach(m => {
    menus[m.id] = { enabled: false, tabs: [] }
  })
  return menus
}

// ─── Fetch ──────────────────────────────
async function fetchWorkspaces() {
  loading.value = true
  try {
    const res: any = await $fetch('/api/workspaces')
    if (res.success) workspaces.value = res.workspaces || []
  } catch (err: any) {
    toast.error('Failed to load workspaces')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchWorkspaces()
})

// ─── Actions ────────────────────────────
function openModal(item?: any) {
  if (item) {
    editingWorkspace.value = item
    
    // Merge existing item menus with default schema safely
    const existingMenus = item.menus || {}
    const newMenus = getDefaultMenus()
    Object.keys(existingMenus).forEach(k => {
      newMenus[k] = { 
        enabled: existingMenus[k].enabled || false, 
        tabs: existingMenus[k].tabs ? [...existingMenus[k].tabs] : [] 
      }
    })

    form.value = {
      id: item.id,
      name: item.name,
      description: item.description || '',
      status: item.status || 'Active',
      menus: newMenus
    }
  } else {
    editingWorkspace.value = null
    form.value = {
      id: '',
      name: '',
      description: '',
      status: 'Active',
      menus: getDefaultMenus()
    }
  }
  showModal.value = true
}

async function saveWorkspace() {
  if (!form.value.name) return toast.error('Workspace name is required')
  isSaving.value = true
  try {
    const payload = {
      name: form.value.name,
      description: form.value.description,
      status: form.value.status,
      menus: form.value.menus
    }
    let message = ''
    if (form.value.id) {
      const res: any = await $fetch(`/api/workspaces/${form.value.id}`, { method: 'PUT', body: payload })
      message = res.message || 'Workspace updated'
    } else {
      const res: any = await $fetch('/api/workspaces', { method: 'POST', body: payload })
      message = 'Workspace created successfully'
    }
    toast.success(message)
    showModal.value = false
    fetchWorkspaces()
  } catch (err: any) {
    toast.error(err.statusMessage || 'Failed to save workspace')
  } finally {
    isSaving.value = false
  }
}

async function deleteWorkspace(id: string) {
  if (!confirm('Are you sure you want to delete this workspace?')) return
  try {
    const res: any = await $fetch(`/api/workspaces/${id}`, { method: 'DELETE' })
    toast.success(res.message || 'Deleted successfully')
    fetchWorkspaces()
  } catch (err: any) {
    toast.error(err.statusMessage || 'Failed to delete workspace')
  }
}

function toggleSubMenu(menuId: string, tabName: string) {
  const tabs = form.value.menus[menuId]!.tabs
  const idx = tabs.indexOf(tabName)
  if (idx > -1) {
    tabs.splice(idx, 1) // Remove if exists
  } else {
    tabs.push(tabName)  // Add if missing
  }
}

</script>

<template>
  <div class="absolute inset-0 flex flex-col overflow-hidden bg-background">
    <!-- Header Actions -->
    <ClientOnly>
      <Teleport to="#page-header-actions">
        <Button size="sm" class="h-8" @click="openModal()">
          <Plus class="mr-1.5 size-4" /> New Workspace
        </Button>
      </Teleport>
    </ClientOnly>

    <div class="flex-1 min-h-0 flex gap-4 p-4 max-w-7xl mx-auto w-full">
      <div class="flex-1 flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
        
        <div class="flex-1 overflow-auto">
          <table class="w-full text-sm caption-bottom border-collapse">
            <TableHeader class="sticky top-0 z-10 bg-card/80 backdrop-blur shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              <TableRow>
                <TableHead>Workspace Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Enabled Modules</TableHead>
                <TableHead class="w-24">Status</TableHead>
                <TableHead class="w-20 text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <!-- Loading Skeleton -->
              <tr v-if="loading" v-for="i in 5" :key="i">
                <td v-for="j in 5" :key="j" class="p-4">
                  <Skeleton class="h-4 w-full rounded" />
                </td>
              </tr>
              
              <TableRow v-for="ws in workspaces" :key="ws.id" class="hover:bg-muted/50 cursor-pointer" @click="openModal(ws)">
                <TableCell class="font-medium whitespace-nowrap">
                  <div class="flex items-center gap-2">
                    <Shield class="w-4 h-4 text-primary" />
                    {{ ws.name }}
                  </div>
                </TableCell>
                <TableCell class="text-xs text-muted-foreground">{{ ws.description || '—' }}</TableCell>
                <TableCell>
                  <div class="flex flex-wrap gap-1">
                    <template v-for="(v, k) in ws.menus" :key="k">
                      <Badge v-if="v.enabled" variant="secondary" class="text-[10px] font-mono px-1.5 bg-primary/10 text-primary hover:bg-primary/20">
                        {{ availableMenus.find(m => m.id === String(k))?.label || k }}
                        <span v-if="v.tabs?.length" class="ml-1 opacity-70 border-l border-primary/20 pl-1 shrink-0">({{ v.tabs.length }} sub)</span>
                      </Badge>
                    </template>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge :variant="ws.status === 'Active' ? 'default' : 'secondary'" class="text-[10px]" :class="ws.status === 'Active' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : ''">
                    {{ ws.status }}
                  </Badge>
                </TableCell>
                <TableCell class="text-right whitespace-nowrap">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground" @click.stop>
                        <Icon name="lucide:more-horizontal" class="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem @click.stop="openModal(ws)">
                        <Edit2 class="mr-2 size-4 opacity-70" /> Edit Settings
                      </DropdownMenuItem>
                      <DropdownMenuItem @click.stop="deleteWorkspace(ws.id)" class="text-destructive">
                        <Trash2 class="mr-2 size-4 opacity-70" /> Delete Workspace
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
              
              <TableRow v-if="!loading && workspaces.length === 0">
                <TableCell colspan="5" class="py-12 text-center text-muted-foreground">
                  <Boxes class="size-10 mx-auto opacity-30 mb-3" />
                  <p class="text-sm font-medium text-foreground">No Workspaces Found</p>
                  <p class="text-xs mt-1">Create your first workspace to configure user permissions.</p>
                  <Button variant="outline" size="sm" class="mt-4" @click="openModal()">Create Workspace</Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </table>
        </div>
      </div>
    </div>


    <!-- Editing Modal -->
    <Dialog v-model:open="showModal">
      <DialogContent class="sm:max-w-[700px] h-[85vh] flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader class="px-6 py-4 border-b bg-muted/20 shrink-0">
          <DialogTitle>{{ form.id ? 'Edit Workspace' : 'Create Workspace' }}</DialogTitle>
          <DialogDescription>
            Configure the UI menu and sub-menu access controls for this workspace role.
          </DialogDescription>
        </DialogHeader>

        <div class="flex-1 overflow-y-auto p-6 space-y-6">
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label>Workspace Name</Label>
              <Input v-model="form.name" placeholder="e.g. Sales Team, Cleaners, Admins..." autofocus />
            </div>
            <div class="space-y-2">
              <Label>Description</Label>
              <Input v-model="form.description" placeholder="Brief scope of these permissions" />
            </div>
          </div>

          <!-- Permissions Builder -->
          <div class="space-y-3">
            <h3 class="text-sm font-semibold flex items-center gap-2">
              <Shield class="w-4 h-4 text-primary" /> Module Authorizations
            </h3>
            
            <div class="rounded-lg border bg-card/50 overflow-hidden divide-y">
              <div v-for="mod in availableMenus" :key="mod.id" class="p-4 transition-colors hover:bg-muted/10">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div class="p-2 rounded bg-muted">
                      <component :is="mod.icon" class="w-4 h-4 opacity-70 text-primary" />
                    </div>
                    <div>
                      <h4 class="text-sm font-medium">{{ mod.label }}</h4>
                      <p class="text-xs text-muted-foreground">Toggle visibility and configure tabs</p>
                    </div>
                  </div>
                  
                  <Switch v-model="form.menus[mod.id]!.enabled" />
                </div>

                <!-- Expanded Config if Enabled -->
                <div v-if="form.menus[mod.id]?.enabled && mod.subMenus.length > 0" class="mt-4 pt-4 border-t border-dashed animate-in slide-in-from-top-2">
                  <div class="mb-3">
                    <Label class="text-xs text-muted-foreground uppercase font-semibold">Sub-Permissions</Label>
                  </div>
                  
                  <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <label 
                      v-for="sub in mod.subMenus" :key="sub" 
                      class="flex items-center gap-2.5 p-2 rounded-md border cursor-pointer transition-colors shadow-sm select-none"
                      :class="form.menus[mod.id]!.tabs.includes(sub) ? 'bg-primary/5 border-primary/30' : 'bg-background hover:bg-muted/50'"
                    >
                      <input type="checkbox" :checked="form.menus[mod.id]!.tabs.includes(sub)" @change="toggleSubMenu(mod.id, sub)" class="sr-only" />
                      <div 
                        class="size-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors"
                        :class="form.menus[mod.id]!.tabs.includes(sub) ? 'bg-primary border-primary text-primary-foreground' : 'border-input bg-card'"
                      >
                         <Check v-if="form.menus[mod.id]!.tabs.includes(sub)" class="size-3" stroke-width="3" />
                      </div>
                      <span class="text-xs font-medium" :class="form.menus[mod.id]!.tabs.includes(sub) ? 'text-primary' : 'text-foreground'">
                        {{ sub }}
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        <DialogFooter class="px-6 py-4 border-t bg-muted/20 shrink-0">
          <Button variant="outline" @click="showModal = false" :disabled="isSaving">Cancel</Button>
          <Button @click="saveWorkspace" :disabled="isSaving">
            <Icon v-if="isSaving" name="lucide:loader-2" class="mr-2 size-4 animate-spin" />
            Save Workspace Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

  </div>
</template>
