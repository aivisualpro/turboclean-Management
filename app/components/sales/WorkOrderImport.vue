<script setup lang="ts">
import { Upload } from 'lucide-vue-next'
import { ref } from 'vue'
import { toast } from 'vue-sonner'

const isOpen = defineModel<boolean>('open', { default: false })
const fileInput = ref<HTMLInputElement | null>(null)
const csvPreview = ref<string[][]>([])
const fileName = ref('')
const isImporting = ref(false)

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
  const header = headerRow.map(h => h.toLowerCase().trim().replace(/\s+/g, ''))
  
  const dealerIdx = header.findIndex(h => h === 'dealer' || h === 'dealerid' || h.includes('dealer'))
  const dateIdx = header.findIndex(h => h === 'date')
  const stockNumberIdx = header.findIndex(h => h === 'stocknumber' || h === 'stock')
  const vinIdx = header.findIndex(h => h === 'vin')
  const dealerServiceIdIdx = header.findIndex(h => h === 'dealerserviceid' || h === 'serviceid' || h.includes('dealerservice'))
  const amountIdx = header.findIndex(h => h === 'amount')
  const taxIdx = header.findIndex(h => h === 'tax')
  const totalIdx = header.findIndex(h => h === 'total')
  const notesIdx = header.findIndex(h => h === 'notes' || h === 'note')
  const isInvoicedIdx = header.findIndex(h => h === 'isinvoiced' || h === 'invoiced')

  const parseCurrency = (val: string) => {
    if (!val) return 0
    const parsed = Number(val.replace(/[^0-9.-]+/g, ''))
    return isNaN(parsed) ? 0 : parsed
  }

  if (dealerIdx === -1) {
    toast.error('CSV must have a "dealer" column')
    return
  }

  const payload = csvPreview.value.slice(1).map((row) => {
    const isInvVal = isInvoicedIdx !== -1 ? (row[isInvoicedIdx] || '').toLowerCase().trim() : ''
    return {
      dealer: dealerIdx !== -1 ? row[dealerIdx] : '',
      date: dateIdx !== -1 ? row[dateIdx] : new Date().toISOString(),
      stockNumber: stockNumberIdx !== -1 ? row[stockNumberIdx] : '',
      vin: vinIdx !== -1 ? row[vinIdx] : '',
      dealerServiceId: dealerServiceIdIdx !== -1 ? row[dealerServiceIdIdx] : '',
      amount: amountIdx !== -1 ? parseCurrency(row[amountIdx] || '') : 0,
      tax: taxIdx !== -1 ? parseCurrency(row[taxIdx] || '') : 0,
      total: totalIdx !== -1 ? parseCurrency(row[totalIdx] || '') : 0,
      notes: notesIdx !== -1 ? row[notesIdx] : '',
      isInvoiced: isInvVal === 'true' || isInvVal === 'yes' || isInvVal === '1',
    }
  }).filter(d => !!d.dealer)

  try {
    isImporting.value = true
    const response = await $fetch('/api/work-orders/import', {
      method: 'POST',
      body: { workOrders: payload }
    })
    
    // @ts-ignore
    toast.success(`Successfully imported ${response.count || payload.length} work orders`)
    isOpen.value = false
    csvPreview.value = []
    fileName.value = ''
  } catch (error: any) {
    toast.error(error.message || 'Failed to import work orders')
  } finally {
    isImporting.value = false
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
    <DialogContent class="sm:max-w-4xl max-h-[90vh] flex flex-col">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Upload class="size-5" />
          Import Work Orders
        </DialogTitle>
        <DialogDescription>
          Upload a CSV file to bulk-import work orders. Expected columns: dealer, date, stockNumber, vin, dealerServiceId, amount, tax, total, notes, isInvoiced.
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

        <div v-if="csvPreview.length > 1" class="space-y-2 flex-1 min-h-0 flex flex-col">
          <p class="text-sm font-medium shrink-0">
            Preview ({{ csvPreview.length - 1 }} rows)
          </p>
          <div class="flex-1 overflow-auto border rounded-lg min-h-[200px]">
            <table class="w-full text-xs">
              <thead class="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                <tr class="border-b">
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
          </div>
          <p v-if="csvPreview.length > 6" class="text-xs text-muted-foreground shrink-0">
            ... and {{ csvPreview.length - 6 }} more rows
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="cancel" :disabled="isImporting">
          Cancel
        </Button>
        <Button :disabled="csvPreview.length < 2 || isImporting" @click="doImport">
          <span v-if="isImporting">Importing...</span>
          <span v-else>Import {{ csvPreview.length > 1 ? `(${csvPreview.length - 1})` : '' }}</span>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
