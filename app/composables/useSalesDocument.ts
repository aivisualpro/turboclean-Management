import { nanoid } from 'nanoid'

// ── Types ────────────────────────────────────────────
export interface LineItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  discount: number // percentage
  tax: number // percentage
}

export interface SalesDocument {
  id: string
  number: string
  client: string
  clientEmail: string
  clientAddress: string
  status: string
  date: string
  notes: string
  lineItems: LineItem[]
  subtotal: number
  taxTotal: number
  discountTotal: number
  total: number
  createdAt: string
  [key: string]: any
}

// ── Helpers ──────────────────────────────────────────
export function createLineItem(partial?: Partial<LineItem>): LineItem {
  return {
    id: nanoid(6),
    description: partial?.description || '',
    quantity: partial?.quantity || 1,
    unitPrice: partial?.unitPrice || 0,
    discount: partial?.discount || 0,
    tax: partial?.tax || 0,
  }
}

export function calcLineTotal(item: LineItem): number {
  const base = item.quantity * item.unitPrice
  const discountAmt = base * (item.discount / 100)
  return base - discountAmt
}

export function calcLineTax(item: LineItem): number {
  const afterDiscount = calcLineTotal(item)
  return afterDiscount * (item.tax / 100)
}

export function calcDocumentTotals(lineItems: LineItem[]) {
  const subtotal = lineItems.reduce((s, li) => s + calcLineTotal(li), 0)
  const taxTotal = lineItems.reduce((s, li) => s + calcLineTax(li), 0)
  const discountTotal = lineItems.reduce((s, li) => {
    const base = li.quantity * li.unitPrice
    return s + base * (li.discount / 100)
  }, 0)
  const total = subtotal + taxTotal
  return { subtotal, taxTotal, discountTotal, total }
}

// ── Composable ───────────────────────────────────────
export function useSalesDocument<T extends SalesDocument>(storeKey: string, initialData: T[] = []) {
  const items = ref<T[]>([]) as Ref<T[]>
  const isLoaded = ref(false)

  function load() {
    if (import.meta.server)
      return
    try {
      const stored = localStorage.getItem(`fsc_${storeKey}`)
      if (stored) {
        items.value = JSON.parse(stored)
      }
      else {
        items.value = initialData.map(item => ({ ...item, id: item.id || nanoid(8) }))
        save()
      }
    }
    catch {
      items.value = initialData.map(item => ({ ...item, id: item.id || nanoid(8) }))
    }
    isLoaded.value = true
  }

  function save() {
    if (import.meta.server)
      return
    try {
      localStorage.setItem(`fsc_${storeKey}`, JSON.stringify(items.value))
    }
    catch { /* quota exceeded */ }
  }

  function createDoc(doc: Partial<T>): T {
    const newDoc = {
      ...doc,
      id: nanoid(8),
      createdAt: new Date().toISOString(),
      lineItems: doc.lineItems || [],
    } as unknown as T
    // recalculate totals
    const totals = calcDocumentTotals(newDoc.lineItems)
    Object.assign(newDoc, totals)
    items.value.unshift(newDoc)
    save()
    return newDoc
  }

  function updateDoc(id: string, data: Partial<T>) {
    const index = items.value.findIndex((i: any) => i.id === id)
    if (index !== -1) {
      const updated = { ...items.value[index], ...data } as T
      if (data.lineItems) {
        const totals = calcDocumentTotals(updated.lineItems)
        Object.assign(updated, totals)
      }
      items.value[index] = updated
      save()
    }
  }

  function removeDoc(id: string) {
    items.value = items.value.filter((i: any) => i.id !== id)
    save()
  }

  function resetDocs() {
    items.value = initialData.map(item => ({ ...item, id: item.id || nanoid(8) }))
    save()
  }

  onMounted(load)

  return { items, isLoaded, createDoc, updateDoc, removeDoc, resetDocs, save }
}

// ── PDF Generation (browser-based) ───────────────────
export function generatePDF(doc: SalesDocument, docType: 'Work Order' | 'Invoice' | 'Order') {
  const lineRows = doc.lineItems.map((li, i) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px">${i + 1}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:13px;font-weight:500">${li.description}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;text-align:center">${li.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;text-align:right">$${li.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;text-align:center">${li.discount}%</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;text-align:center">${li.tax}%</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:13px;text-align:right;font-weight:600">$${calcLineTotal(li).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
    </tr>
  `).join('')

  const statusColorMap: Record<string, string> = {
    Draft: '#6b7280',
    Sent: '#3b82f6',
    Accepted: '#10b981',
    Rejected: '#ef4444',
    Expired: '#f59e0b',
    Paid: '#10b981',
    Overdue: '#ef4444',
    Cancelled: '#6b7280',
    Pending: '#f59e0b',
    Processing: '#3b82f6',
    Shipped: '#8b5cf6',
    Delivered: '#10b981',
  }
  const statusColor = statusColorMap[doc.status] || '#6b7280'

  const extraFields = docType === 'Invoice'
    ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:12px">Due Date:</td><td style="padding:6px 0;color:#111827;font-size:12px;font-weight:500">${doc.dueDate || '—'}</td></tr>
       <tr><td style="padding:6px 0;color:#6b7280;font-size:12px">Paid:</td><td style="padding:6px 0;color:#10b981;font-size:12px;font-weight:600">$${(doc.paidAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>`
    : docType === 'Work Order'
      ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:12px">Valid Until:</td><td style="padding:6px 0;color:#111827;font-size:12px;font-weight:500">${doc.validUntil || '—'}</td></tr>`
      : docType === 'Order'
        ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:12px">Tracking:</td><td style="padding:6px 0;color:#111827;font-size:12px;font-weight:500">${doc.tracking || '—'}</td></tr>`
        : ''

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${docType} ${doc.number}</title></head><body style="margin:0;padding:40px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff;color:#111827">
    <div style="max-width:800px;margin:0 auto">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px">
        <div>
          <h1 style="margin:0;font-size:28px;font-weight:800;color:#111827;letter-spacing:-0.5px">FullStack CRM</h1>
          <p style="margin:4px 0 0;color:#6b7280;font-size:13px">123 Business Avenue, Suite 400<br>San Francisco, CA 94102<br>contact@fullstackcrm.io</p>
        </div>
        <div style="text-align:right">
          <div style="display:inline-block;padding:6px 16px;border-radius:20px;background:${statusColor}15;color:${statusColor};font-size:12px;font-weight:600;border:1px solid ${statusColor}30">${doc.status}</div>
          <h2 style="margin:12px 0 0;font-size:22px;font-weight:700;color:#111827">${docType} ${doc.number}</h2>
          <p style="margin:4px 0 0;color:#6b7280;font-size:13px">Date: ${doc.date}</p>
        </div>
      </div>

      <!-- Bill To -->
      <div style="display:flex;gap:40px;margin-bottom:32px">
        <div style="flex:1;padding:20px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb">
          <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;font-weight:600">Bill To</p>
          <p style="margin:0;font-size:15px;font-weight:600;color:#111827">${doc.client}</p>
          <p style="margin:4px 0 0;font-size:12px;color:#6b7280">${doc.clientEmail || ''}</p>
          <p style="margin:2px 0 0;font-size:12px;color:#6b7280">${doc.clientAddress || ''}</p>
        </div>
        <div style="width:220px">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#6b7280;font-size:12px">${docType} #:</td><td style="padding:6px 0;color:#111827;font-size:12px;font-weight:500">${doc.number}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;font-size:12px">Date:</td><td style="padding:6px 0;color:#111827;font-size:12px;font-weight:500">${doc.date}</td></tr>
            ${extraFields}
          </table>
        </div>
      </div>

      <!-- Line Items Table -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">#</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Description</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Qty</th>
            <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Price</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Disc.</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Tax</th>
            <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Total</th>
          </tr>
        </thead>
        <tbody>${lineRows}</tbody>
      </table>

      <!-- Totals -->
      <div style="display:flex;justify-content:flex-end;margin-bottom:32px">
        <table style="width:280px;border-collapse:collapse">
          <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px">Subtotal</td><td style="padding:8px 12px;text-align:right;color:#111827;font-size:13px;font-weight:500">$${doc.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px">Discount</td><td style="padding:8px 12px;text-align:right;color:#ef4444;font-size:13px">-$${doc.discountTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px">Tax</td><td style="padding:8px 12px;text-align:right;color:#111827;font-size:13px">$${doc.taxTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
          <tr style="border-top:2px solid #111827"><td style="padding:12px 12px;color:#111827;font-size:16px;font-weight:700">Total</td><td style="padding:12px 12px;text-align:right;color:#111827;font-size:16px;font-weight:700">$${doc.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
        </table>
      </div>

      ${doc.notes ? `<div style="padding:16px 20px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;margin-bottom:32px"><p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;font-weight:600">Notes</p><p style="margin:0;font-size:13px;color:#374151;line-height:1.6">${doc.notes}</p></div>` : ''}

      <!-- Footer -->
      <div style="text-align:center;padding-top:24px;border-top:1px solid #e5e7eb">
        <p style="margin:0;color:#9ca3af;font-size:11px">Thank you for your business! • FullStack CRM & ERP Platform</p>
      </div>
    </div>
  </body></html>`

  return html
}

export function downloadPDF(doc: SalesDocument, docType: 'Work Order' | 'Invoice' | 'Order') {
  const html = generatePDF(doc, docType)
  const printWindow = window.open('', '_blank')
  if (printWindow) {
    printWindow.document.write(html)
    printWindow.document.close()
    setTimeout(() => { printWindow.print() }, 300)
  }
}
