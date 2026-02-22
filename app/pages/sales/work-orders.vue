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

const seedData: SalesDocument[] = [
  {
    id: 'q1',
    number: 'WO-2026-041',
    client: 'TechVision Inc',
    clientEmail: 'procurement@techvision.com',
    clientAddress: '1200 Innovation Blvd, San Jose, CA 95134',
    status: 'Sent',
    date: '2026-02-10',
    validUntil: '2026-03-10',
    createdBy: 'Sarah Johnson',
    notes: 'Net 30 payment terms. Volume discount applied for enterprise tier. Includes 24/7 premium support.',
    lineItems: [
      { id: 'li1', description: 'Enterprise CRM License (Annual)', quantity: 50, unitPrice: 1200, discount: 10, tax: 8.5 },
      { id: 'li2', description: 'Data Migration & Setup', quantity: 1, unitPrice: 15000, discount: 0, tax: 8.5 },
      { id: 'li3', description: 'Custom API Integration', quantity: 3, unitPrice: 8500, discount: 5, tax: 8.5 },
      { id: 'li4', description: 'Staff Training (On-site, 3 days)', quantity: 2, unitPrice: 4500, discount: 0, tax: 8.5 },
      { id: 'li5', description: '24/7 Premium Support (Annual)', quantity: 1, unitPrice: 12000, discount: 15, tax: 8.5 },
    ],
    subtotal: 108225,
    taxTotal: 9199.13,
    discountTotal: 14775,
    total: 117424.13,
    createdAt: '2026-02-10T10:30:00Z',
  },
  {
    id: 'q2',
    number: 'WO-2026-040',
    client: 'GlobalSoft',
    clientEmail: 'purchasing@globalsoft.com',
    clientAddress: '800 Market Street, Floor 12, San Francisco, CA 94102',
    status: 'Accepted',
    date: '2026-02-08',
    validUntil: '2026-03-08',
    createdBy: 'David Kim',
    notes: 'Accepted on Feb 12. Converting to invoice INV-2026-079.',
    lineItems: [
      { id: 'li6', description: 'ERP Platform License (Annual)', quantity: 25, unitPrice: 1800, discount: 5, tax: 8.5 },
      { id: 'li7', description: 'Inventory Management Module', quantity: 1, unitPrice: 8500, discount: 0, tax: 8.5 },
      { id: 'li8', description: 'Financial Reporting Add-on', quantity: 1, unitPrice: 5200, discount: 0, tax: 8.5 },
      { id: 'li9', description: 'Implementation Consulting (40 hrs)', quantity: 40, unitPrice: 175, discount: 0, tax: 8.5 },
    ],
    subtotal: 63450,
    taxTotal: 5393.25,
    discountTotal: 2250,
    total: 68843.25,
    createdAt: '2026-02-08T14:15:00Z',
  },
  {
    id: 'q3',
    number: 'WO-2026-039',
    client: 'Meridian Corp',
    clientEmail: 'ops@meridiancorp.com',
    clientAddress: '456 Oak Drive, Austin, TX 78701',
    status: 'Draft',
    date: '2026-02-12',
    validUntil: '2026-03-12',
    createdBy: 'Emily Rodriguez',
    notes: 'Awaiting internal approval. Follow up scheduled for Feb 15.',
    lineItems: [
      { id: 'li10', description: 'Business CRM Starter (Annual)', quantity: 10, unitPrice: 600, discount: 0, tax: 7 },
      { id: 'li11', description: 'Email Marketing Integration', quantity: 1, unitPrice: 3200, discount: 0, tax: 7 },
      { id: 'li12', description: 'Onboarding Package', quantity: 1, unitPrice: 2500, discount: 0, tax: 7 },
    ],
    subtotal: 11700,
    taxTotal: 819,
    discountTotal: 0,
    total: 12519,
    createdAt: '2026-02-12T09:00:00Z',
  },
  {
    id: 'q4',
    number: 'WO-2026-038',
    client: 'NexGen Solutions',
    clientEmail: 'cto@nexgensolutions.io',
    clientAddress: '2100 Greenway Plaza, Suite 800, Houston, TX 77046',
    status: 'Sent',
    date: '2026-02-06',
    validUntil: '2026-03-06',
    createdBy: 'Michael Chen',
    notes: 'Custom deployment requested. Includes dedicated server provisioning.',
    lineItems: [
      { id: 'li13', description: 'Enterprise Suite (Self-hosted)', quantity: 1, unitPrice: 45000, discount: 0, tax: 8.25 },
      { id: 'li14', description: 'Dedicated Server Provisioning', quantity: 2, unitPrice: 8000, discount: 0, tax: 8.25 },
      { id: 'li15', description: 'Security Audit & Compliance', quantity: 1, unitPrice: 12000, discount: 10, tax: 8.25 },
      { id: 'li16', description: 'Custom Dashboard Development', quantity: 1, unitPrice: 18000, discount: 5, tax: 8.25 },
      { id: 'li17', description: 'SLA Premium (Annual)', quantity: 1, unitPrice: 9500, discount: 0, tax: 8.25 },
    ],
    subtotal: 95700,
    taxTotal: 7895.25,
    discountTotal: 2100,
    total: 103595.25,
    createdAt: '2026-02-06T11:45:00Z',
  },
  {
    id: 'q5',
    number: 'WO-2026-037',
    client: 'Apex Group',
    clientEmail: 'finance@apexgroup.com',
    clientAddress: '777 Third Avenue, New York, NY 10017',
    status: 'Rejected',
    date: '2026-01-28',
    validUntil: '2026-02-28',
    createdBy: 'Sarah Johnson',
    notes: 'Client chose competitor. Follow up in Q3 for renewal discussion.',
    lineItems: [
      { id: 'li18', description: 'Full Platform License (100 seats)', quantity: 100, unitPrice: 1500, discount: 15, tax: 8.875 },
      { id: 'li19', description: 'White-label Branding Package', quantity: 1, unitPrice: 25000, discount: 0, tax: 8.875 },
      { id: 'li20', description: 'Migration from Legacy System', quantity: 1, unitPrice: 35000, discount: 10, tax: 8.875 },
    ],
    subtotal: 189000,
    taxTotal: 16773.75,
    discountTotal: 26000,
    total: 205773.75,
    createdAt: '2026-01-28T16:20:00Z',
  },
  {
    id: 'q6',
    number: 'WO-2026-036',
    client: 'DataFlow AI',
    clientEmail: 'admin@dataflowai.com',
    clientAddress: '300 Broad Street, Stamford, CT 06901',
    status: 'Accepted',
    date: '2026-01-25',
    validUntil: '2026-02-25',
    createdBy: 'David Kim',
    notes: 'Small team deployment. Net 15 payment terms.',
    lineItems: [
      { id: 'li21', description: 'Startup Plan (Annual)', quantity: 5, unitPrice: 480, discount: 0, tax: 6.35 },
      { id: 'li22', description: 'AI Analytics Add-on', quantity: 1, unitPrice: 6500, discount: 0, tax: 6.35 },
      { id: 'li23', description: 'Video Training Package', quantity: 1, unitPrice: 1200, discount: 0, tax: 6.35 },
    ],
    subtotal: 10100,
    taxTotal: 641.35,
    discountTotal: 0,
    total: 10741.35,
    createdAt: '2026-01-25T08:30:00Z',
  },
]
</script>

<template>
  <SalesDocumentPage
    store-key="sales-work-orders-v2"
    doc-type="Work Order"
    title="Work Orders"
    description="Create professional work orders with configurable line items"
    icon="i-lucide-file-text"
    :status-options="statusOptions"
    :extra-fields="extraFields"
    :initial-data="seedData"
  />
</template>
