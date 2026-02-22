<script setup lang="ts">
import type { SalesDocument } from '~/composables/useSalesDocument'

const statusOptions = [
  { label: 'Draft', value: 'Draft' },
  { label: 'Sent', value: 'Sent' },
  { label: 'Accepted', value: 'Accepted' },
  { label: 'Rejected', value: 'Rejected' },
  { label: 'Expired', value: 'Expired' },
]

const extraFields = [
  { key: 'validUntil', label: 'Valid Until', type: 'date' },
  { key: 'createdBy', label: 'Sales Rep', placeholder: 'Name of sales representative' },
]



const { data: mongoWorkOrders, status } = await useFetch('/api/work-orders')
const workOrdersData = computed(() => mongoWorkOrders.value || [])

const showImportModal = ref(false)
</script>

<template>
  <div>
    <SalesDocumentPage
      v-if="status !== 'pending' || mongoWorkOrders"
      :store-key="'sales-work-orders-v' + Date.now()"
      doc-type="Work Order"
      title="Work Orders"
      description="Create professional work orders with configurable line items"
      icon="i-lucide-file-text"
      :status-options="statusOptions"
      :extra-fields="extraFields"
      :initial-data="workOrdersData as any"
      show-import
      @import="showImportModal = true"
    >
      <template #actions>
        <Button variant="outline" size="sm">
          <Icon name="lucide:download" class="mr-2 h-4 w-4" />
          Export
        </Button>
      </template>
    </SalesDocumentPage>
    <SalesWorkOrderImport v-model:open="showImportModal" />
  </div>
</template>
