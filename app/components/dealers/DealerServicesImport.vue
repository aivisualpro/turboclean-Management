<script setup lang="ts">
import { Upload } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useDealers } from '~/composables/useDealers'

const { importDealerServices } = useDealers()

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
  
  const dealerIdx = header.findIndex(h => h === 'dealer' || h === 'dealer id' || h.startsWith('dealer ('))
  const serviceIdx = header.findIndex(h => h === 'service' || h === 'service name' || h === 'service id' || h.startsWith('service ('))
  const amountIdx = header.findIndex(h => h === 'amount' || h.startsWith('amount ('))
  const taxIdx = header.findIndex(h => h === 'tax' || h.startsWith('tax ('))
  const totalIdx = header.findIndex(h => h === 'total' || h.startsWith('total ('))

  if (dealerIdx === -1 || serviceIdx === -1) {
    toast.error('CSV must have "dealer" (or "dealer id") and "service" columns')
    return
  }

  const payload = csvPreview.value.slice(1).map((row) => {
    return {
      dealer: row[dealerIdx] || '',
      service: row[serviceIdx] || '',
      amount: amountIdx !== -1 ? (parseFloat((row[amountIdx] || '').replace(/[^0-9.-]+/g, '')) || 0) : 0,
      tax: taxIdx !== -1 ? (parseFloat((row[taxIdx] || '').replace(/[^0-9.-]+/g, '')) || 0) : 0,
      total: totalIdx !== -1 ? (parseFloat((row[totalIdx] || '').replace(/[^0-9.-]+/g, '')) || 0) : 0,
    }
  }).filter(s => s.dealer && s.service)

  try {
    const count = await importDealerServices(payload)
    toast.success(`Successfully imported ${count} dealer service limits/entries`)
    isOpen.value = false
    csvPreview.value = []
    fileName.value = ''
  } catch (error) {
    toast.error('Failed to import dealer services')
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
          Import Dealer Services
        </DialogTitle>
        <DialogDescription>
          Upload a CSV file to bulk-import services for dealers. Expected columns: dealer, service, amount, tax, total (where dealer and service are MongoDB IDs).
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
          <div class="h-48 border rounded-lg overflow-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b bg-muted/50">
                  <th
                    v-for="(h, i) in csvPreview[0]"
                    :key="i"
                    class="p-2 text-left font-medium whitespace-nowrap bg-muted/50"
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
          </div>
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
