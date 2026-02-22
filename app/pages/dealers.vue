<script setup lang="ts">
import type { Dealer, DealerStatus } from '~/composables/useDealers'
import { Plus, Search, Download } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'

const { setHeader } = usePageHeader()
setHeader({ title: 'Dealers', icon: 'i-lucide-building-2' })

const { dealers, authorised, pending, rejected, updateDealer, deleteDealer } = useDealers()

const selectedDealer = ref<string | undefined>()
const searchValue = ref('')
const debouncedSearch = refDebounced(searchValue, 250)

const showForm = ref(false)
const editingDealer = ref<Dealer | null>(null)

// Navigation state
const activeTab = ref<'all' | 'authorised' | 'pending' | 'rejected'>('all')
const isCollapsed = ref(false)

const navLinks = computed(() => [
  { id: 'all', title: 'All Dealers', icon: 'lucide:building-2', count: dealers.value.length },
  { id: 'authorised', title: 'Authorised', icon: 'lucide:check-circle', count: authorised.value.length },
  { id: 'pending', title: 'Pending', icon: 'lucide:clock', count: pending.value.length },
  { id: 'rejected', title: 'Rejected', icon: 'lucide:x-circle', count: rejected.value.length },
])

const activeData = computed(() => {
  switch (activeTab.value) {
    case 'authorised': return authorised.value
    case 'pending': return pending.value
    case 'rejected': return rejected.value
    default: return dealers.value
  }
})

// Search filter
function filterBySearch(list: Dealer[]) {
  const q = debouncedSearch.value?.trim()?.toLowerCase()
  if (!q)
    return list
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

const filteredList = computed(() => filterBySearch(activeData.value))
const selectedDealerData = computed(() => dealers.value.find(d => d.id === selectedDealer.value))

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
</script>

<template>
  <div class="-m-4 lg:-m-6">
    <TooltipProvider :delay-duration="0">
      <ResizablePanelGroup
        id="dealer-panel-group"
        direction="horizontal"
        class="h-full max-h-[calc(100dvh-54px-3rem)] items-stretch"
      >
        <!-- Left panel: Sidebar Tabs -->
        <ResizablePanel
          id="dealer-list-panel"
          :default-size="20"
          :min-size="15"
          :max-size="30"
          collapsible
          :class="cn(isCollapsed && 'min-w-[50px] transition-all duration-300 ease-in-out')"
          @collapse="isCollapsed = true"
          @expand="isCollapsed = false"
        >
          <div :class="cn('flex h-[52px] items-center', isCollapsed ? 'h-[52px] justify-center' : 'px-4 justify-between')">
            <h2 v-if="!isCollapsed" class="font-semibold px-2">
              Dealers
            </h2>
            <Icon v-else name="lucide:building-2" class="size-5 text-muted-foreground" />
          </div>
          <Separator />

          <div class="group flex flex-col gap-4 py-2" :data-collapsed="isCollapsed">
            <nav class="grid gap-1 px-2 group-[[data-collapsed=true]]:justify-center group-[[data-collapsed=true]]:px-2">
              <template v-for="link in navLinks" :key="link.id">
                <Tooltip v-if="isCollapsed" :delay-duration="0">
                  <TooltipTrigger as-child>
                    <button
                      :class="cn(
                        buttonVariants({ variant: activeTab === link.id ? 'default' : 'ghost', size: 'icon' }),
                        'h-9 w-9',
                        activeTab === link.id
                          && 'dark:bg-muted dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-white',
                      )"
                      @click="activeTab = link.id as any; selectedDealer = undefined"
                    >
                      <Icon :name="link.icon" class="size-4" />
                      <span class="sr-only">{{ link.title }}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" class="flex items-center gap-4">
                    {{ link.title }}
                    <span class="ml-auto text-muted-foreground">
                      {{ link.count }}
                    </span>
                  </TooltipContent>
                </Tooltip>

                <button
                  v-else
                  :class="cn(
                    buttonVariants({ variant: activeTab === link.id ? 'default' : 'ghost', size: 'sm' }),
                    activeTab === link.id
                      && 'dark:bg-muted dark:text-white dark:hover:bg-muted dark:hover:text-white',
                    'justify-start',
                  )"
                  @click="activeTab = link.id as any; selectedDealer = undefined"
                >
                  <Icon :name="link.icon" class="mr-2 size-4" />
                  {{ link.title }}
                  <span
                    :class="cn(
                      'ml-auto',
                      activeTab === link.id
                        ? 'text-background dark:text-white'
                        : 'text-muted-foreground',
                    )"
                  >
                    {{ link.count }}
                  </span>
                </button>
              </template>
            </nav>
          </div>
        </ResizablePanel>

        <ResizableHandle id="dealer-resize-handle" with-handle />

        <!-- Right panel: Detail or Table -->
        <ResizablePanel id="dealer-table-panel" :default-size="80" :min-size="40">
          <DealersDealerDetail
            v-if="selectedDealerData"
            :dealer="selectedDealerData"
            @close="selectedDealer = undefined"
            @edit="handleEdit"
            @delete="handleDelete"
            @status-change="(id, status) => handleStatusChange(id, status)"
          />
          <div v-else class="h-full flex flex-col">
            <div class="flex items-center px-4 py-2 h-[52px]">
              <h1 class="text-xl font-bold truncate">
                {{ navLinks.find(l => l.id === activeTab)?.title }}
              </h1>
              <div class="ml-auto flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="ghost" size="icon" class="size-8" @click="exportToCsv">
                      <Download class="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Export to CSV</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button size="icon" class="size-8" @click="openAddForm">
                      <Plus class="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Add Dealer</TooltipContent>
                </Tooltip>
              </div>
            </div>

            <Separator />

            <div class="bg-background/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <form @submit.prevent>
                <div class="relative">
                  <Search class="absolute left-2 top-2.5 size-4 text-muted-foreground" />
                  <Input v-model="searchValue" placeholder="Search dealers..." class="pl-8 bg-background" />
                </div>
              </form>
            </div>

            <ScrollArea class="flex-1">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b bg-muted/50">
                    <th class="p-4 text-left font-medium text-muted-foreground">
                      Dealer Name
                    </th>
                    <th class="p-4 text-left font-medium text-muted-foreground">
                      Address
                    </th>
                    <th class="p-4 text-left font-medium text-muted-foreground">
                      Primary Contact
                    </th>
                    <th class="p-4 text-left font-medium text-muted-foreground">
                      Phone
                    </th>
                    <th class="p-4 text-left font-medium text-muted-foreground">
                      Email
                    </th>
                    <th class="p-4 text-left font-medium text-muted-foreground whitespace-nowrap">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="d in filteredList"
                    :key="d.id"
                    class="border-b cursor-pointer transition-colors hover:bg-muted/30"
                    :class="{ 'bg-muted/50': selectedDealer === d.id }"
                    @click="selectedDealer = d.id"
                  >
                    <td class="p-4 font-medium">
                      {{ d.dealerName }}
                    </td>
                    <td class="p-4 text-muted-foreground text-xs max-w-[200px] truncate">
                      {{ d.address }}
                    </td>
                    <td class="p-4">
                      <span v-if="d.contacts.length">{{ d.contacts[0]?.name }}</span>
                      <span v-else class="text-muted-foreground">—</span>
                    </td>
                    <td class="p-4 text-xs tabular-nums">
                      <span v-if="d.contacts.length && d.contacts[0]?.phones?.length">{{ d.contacts[0]?.phones?.[0]?.number }}</span>
                      <span v-else class="text-muted-foreground">—</span>
                    </td>
                    <td class="p-4 text-xs">
                      <span v-if="d.contacts.length && d.contacts[0]?.emails?.length">{{ d.contacts[0]?.emails?.[0] }}</span>
                      <span v-else class="text-muted-foreground">—</span>
                    </td>
                    <td class="p-4">
                      <Badge
                        variant="outline"
                        :class="{
                          'bg-emerald-500/10 text-emerald-600 border-emerald-500/20': d.status === 'Authorised',
                          'bg-amber-500/10 text-amber-600 border-amber-500/20': d.status === 'Pending',
                          'bg-red-500/10 text-red-600 border-red-500/20': d.status === 'Rejected',
                          'bg-blue-500/10 text-blue-600 border-blue-500/20': d.status === 'In Followup',
                        }"
                        class="text-[10px] px-1.5 py-0"
                      >
                        {{ d.status }}
                      </Badge>
                    </td>
                  </tr>
                  <tr v-if="filteredList.length === 0">
                    <td colspan="6" class="p-8 text-center text-muted-foreground">
                      No dealers found
                    </td>
                  </tr>
                </tbody>
              </table>
            </ScrollArea>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </TooltipProvider>

    <!-- Dialogs -->
    <DealersDealerForm v-model:open="showForm" :dealer="editingDealer" @saved="selectedDealer = undefined" />
  </div>
</template>
