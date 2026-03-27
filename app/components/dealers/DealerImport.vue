<script setup lang="ts">
import { Upload } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { nanoid } from 'nanoid'
import type { Dealer, DealerStatus } from '~/composables/useDealers'
import { useDealers } from '~/composables/useDealers'

const { importDealers } = useDealers()

const isOpen = defineModel<boolean>('open', { default: false })
const fileInput = ref<HTMLInputElement | null>(null)
const csvPreview = ref<string[][]>([])
const fileName = ref('')

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return

  const file = input.files[0]
  if (!file) return
  fileName.value = file.name

  const reader = new FileReader()
  reader.onload = (e) => {
    const text = (e.target?.result as string) || ''
    const lines = text.split(/\r?\n|\r/).filter(line => line.trim())
    
    const rows = lines.map(row => {
      const cols = []
      let inQuotes = false
      let currentVal = ''
      for (let i = 0; i < row.length; i++) {
        const char = row[i]
        if (char === '"') {
          inQuotes = !inQuotes
        } else if (char === ',' && !inQuotes) {
          cols.push(currentVal.trim().replace(/^"|"$/g, ''))
          currentVal = ''
        } else {
          currentVal += char
        }
      }
      cols.push(currentVal.trim().replace(/^"|"$/g, ''))
      return cols
    })
    
    csvPreview.value = rows.filter(r => r.some(c => !!c))
  }
  reader.readAsText(file)
}

async function doImport() {
  if (csvPreview.value.length < 2) {
    toast.error('CSV must have at least a header row and one data row')
    return
  }

  const headerRow = csvPreview.value[0]
  if (!headerRow) return
  const header = headerRow.map(h => h.toLowerCase().trim())
  
  const nameIdx = header.findIndex(h => h === 'dealer name' || h === 'name' || h === 'dealer')
  const addressIdx = header.findIndex(h => h === 'address')
  const contactIdx = header.findIndex(h => h === 'primary contact' || h === 'contact name' || h === 'contact')
  const phoneIdx = header.findIndex(h => h === 'phone' || h === 'phone number')
  const emailIdx = header.findIndex(h => h === 'email' || h === 'email address')
  const statusIdx = header.findIndex(h => h === 'status')

  if (nameIdx === -1) {
    toast.error('CSV must have a "Dealer Name" column')
    return
  }

  const payload: Omit<Dealer, 'id' | 'createdAt' | 'updatedAt'>[] = csvPreview.value.slice(1).map((row) => {
    const dealerName = row[nameIdx] || ''
    const address = addressIdx !== -1 ? (row[addressIdx] || '') : ''
    const contactName = contactIdx !== -1 ? (row[contactIdx] || '') : ''
    const phone = phoneIdx !== -1 ? (row[phoneIdx] || '') : ''
    const email = emailIdx !== -1 ? (row[emailIdx] || '') : ''
    const statusVal = statusIdx !== -1 ? (row[statusIdx] || 'Pending') : 'Pending'
    
    // basic mapping for status
    let status: DealerStatus = 'Pending'
    if (['Authorised', 'Pending', 'Rejected', 'In Followup'].includes(statusVal)) {
      status = statusVal as DealerStatus
    } else if (statusVal.toLowerCase() === 'authorised' || statusVal.toLowerCase() === 'authorized') {
      status = 'Authorised'
    }

    const contacts = []
    if (contactName || phone || email) {
      contacts.push({
        id: nanoid(8),
        name: contactName,
        designation: '',
        phones: phone ? [{ id: nanoid(8), number: phone, type: 'mobile' as const }] : [],
        emails: email ? [email] : [],
        preferredContactMethod: 'any' as const
      })
    }

    return {
      dealerName,
      address,
      status,
      contacts,
      services: [],
      isTaxApplied: false,
      taxPercentage: 0
    }
  }).filter(d => d.dealerName)

  try {
    const count = await importDealers(payload)
    toast.success(`Successfully imported ${count} dealers`)
    isOpen.value = false
    csvPreview.value = []
    fileName.value = ''
  } catch (error) {
    toast.error('Failed to import dealers')
  }
}

function cancel() {
  isOpen.value = false
  csvPreview.value = []
  fileName.value = ''
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Upload class="size-5" />
          Import Dealers
        </DialogTitle>
        <DialogDescription>
          Upload a CSV file to bulk-import dealers. Expected columns: Dealer Name, Address, Primary Contact, Phone, Email, Status.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <div
          class="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
          @click="fileInput?.click()"
        >
          <input
            ref="fileInput"
            type="file"
            accept=".csv"
            class="hidden"
            @change="onFileChange"
          />
          <Upload class="size-8 mx-auto text-muted-foreground/50 mb-2" />
          <p class="text-sm text-muted-foreground">
            {{ fileName || 'Click to select a CSV file' }}
          </p>
        </div>

        <!-- Preview -->
        <div v-if="csvPreview.length > 1" class="space-y-2">
          <p class="text-sm font-medium">
            Preview ({{ csvPreview.length - 1 }} rows)
          </p>
          <ScrollArea class="h-48 border rounded-lg">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b bg-muted/50">
                  <th
                    v-for="(h, i) in csvPreview[0]"
                    :key="i"
                    class="p-2 text-left font-medium whitespace-nowrap"
                  >
                    {{ h }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, ri) in csvPreview.slice(1, 6)"
                  :key="ri"
                  class="border-b"
                >
                  <td v-for="(cell, ci) in row" :key="ci" class="p-2 whitespace-nowrap max-w-[150px] truncate" :title="cell">
                    {{ cell }}
                  </td>
                </tr>
              </tbody>
            </table>
          </ScrollArea>
          <p v-if="csvPreview.length > 6" class="text-xs text-muted-foreground">
            ... and {{ csvPreview.length - 6 }} more rows
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="cancel">
          Cancel
        </Button>
        <Button :disabled="csvPreview.length < 2" @click="doImport">
          Import {{ csvPreview.length > 1 ? `(${csvPreview.length - 1})` : '' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
