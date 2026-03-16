<script setup lang="ts">
import { Upload } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useServices } from '~/composables/useServices'

const { importServices } = useServices()

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
          // We can optionally keep the quote or drop it; we'll drop it after
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
  
  const serviceIdx = header.findIndex(h => h.includes('service') || h.includes('name'))
  const descriptionIdx = header.findIndex(h => h.includes('description') || h.includes('desc'))

  if (serviceIdx === -1) {
    toast.error('CSV must have a "Service" column')
    return
  }

  const newServices = csvPreview.value.slice(1).map((row) => {
    return {
      service: row[serviceIdx] || 'Unknown Service',
      description: descriptionIdx !== -1 ? (row[descriptionIdx] || '') : '',
    }
  }).filter(s => s.service && s.service !== 'Unknown Service')

  try {
    const count = await importServices(newServices)
    toast.success(`Successfully imported ${count} service(s)`)
    isOpen.value = false
    csvPreview.value = []
    fileName.value = ''
  } catch (error) {
    toast.error('Failed to import services')
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
          Import Services
        </DialogTitle>
        <DialogDescription>
          Upload a CSV file to bulk-import services. Expected columns: Service, Description
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
                    class="p-2 text-left font-medium"
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
                  <td v-for="(cell, ci) in row" :key="ci" class="p-2">
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
