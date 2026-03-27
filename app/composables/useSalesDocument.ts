import { nanoid } from 'nanoid'

// ── Types ────────────────────────────────────────────
export interface LineItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  discount: number // percentage
  tax: number // percentage
  date?: string
  stockNumber?: string
  vin?: string
  serviceName?: string
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
    date: partial?.date || '',
    stockNumber: partial?.stockNumber || '',
    vin: partial?.vin || '',
    serviceName: partial?.serviceName || '',
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
    if (import.meta.server) return
    try {
      const stored = localStorage.getItem(`fsc_${storeKey}`)
      if (stored) {
        items.value = JSON.parse(stored)
      } else {
        items.value = initialData.map(item => ({ ...item, id: item.id || nanoid(8) }))
        save()
      }
    } catch {
      items.value = initialData.map(item => ({ ...item, id: item.id || nanoid(8) }))
    }
    isLoaded.value = true
  }

  function save() {
    if (import.meta.server) return
    try {
      localStorage.setItem(`fsc_${storeKey}`, JSON.stringify(items.value))
    } catch { /* quota exceeded */ }
  }

  function createDoc(doc: Partial<T>): T {
    const newDoc = {
      ...doc,
      id: nanoid(8),
      createdAt: new Date().toISOString(),
      lineItems: doc.lineItems || [],
    } as unknown as T
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
export function generatePDF(doc: any, docType: 'Work Order' | 'Invoice' | 'Order') {
  const fmtMoney = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  if (docType === 'Invoice') {
    const formattedDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }) : ''
    
    const isWeekly = doc.type === 'Weekly'
    const topBarBg = isWeekly ? 'linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%)' : 'linear-gradient(90deg, #34d399 0%, #10b981 100%)'
    const highlightColor = isWeekly ? '#f59e0b' : '#10b981'
    const thAccentColor = isWeekly ? '#fbbf24' : '#34d399'
    
    const lineRows = (doc.lineItems || []).map((li: any, i: number) => {
      const bg = i % 2 !== 0 ? '#f3f4f6' : '#ffffff'
      return `
      <tr style="background:${bg};border-bottom:1px solid #e2e8f0">
        <td style="padding:8px 8px;color:#334155;font-size:11px;font-family:'Inter',Arial,sans-serif">${formattedDate(li.date || doc.date)}</td>
        <td style="padding:8px 8px;color:#334155;font-size:11px;font-family:'Inter',Arial,sans-serif">${li.stockNumber || ''}</td>
        <td style="padding:8px 8px;color:#475569;font-size:11px;font-family:'Inter',monospace">${li.vin || ''}</td>
        <td style="padding:8px 8px;color:#0f172a;font-size:11px;font-family:'Inter',Arial,sans-serif;font-weight:600;text-transform:uppercase">${li.serviceName || li.description || ''}</td>
        <td style="padding:8px 8px;color:#334155;font-size:11px;font-family:'Inter',Arial,sans-serif;text-align:right">${fmtMoney(li.unitPrice || 0)}</td>
        <td style="padding:8px 8px;color:#64748b;font-size:11px;font-family:'Inter',Arial,sans-serif;text-align:right">${fmtMoney(li.tax || 0)}</td>
        <td style="padding:8px 8px;color:#0f172a;font-size:12px;font-family:'Inter',Arial,sans-serif;text-align:right;font-weight:800">${fmtMoney((li.unitPrice || 0) + (li.tax || 0))}</td>
      </tr>`
    }).join('')

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
      <title>Invoice ${doc.number}</title>
      <style>
        @media print {
          body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          .print-wrapper { box-shadow: none !important; border: none !important; margin: 0 !important; max-width: 100% !important; border-radius: 0 !important; }
          .print-inner { padding: 20px !important; }
        }
      </style>
    </head>
    <body style="margin:0;padding:0;font-family:'Inter',Arial,sans-serif;background:#f8fafc;color:#0f172a">
      <div class="print-wrapper" style="max-width:820px;margin:20px auto;background:#fff;border-radius:12px;box-shadow:0 10px 30px -5px rgba(0,0,0,0.05);overflow:hidden;border:1px solid #e2e8f0;box-sizing:border-box">
        <!-- Top Banner Bar -->
        <div style="height:12px;background:${topBarBg};width:100%"></div>
        
        <div class="print-inner" style="padding:40px 40px;box-sizing:border-box">
          <!-- Header Matrix -->
          <table style="width:100%;border-collapse:collapse;margin-bottom:45px">
            <tr>
              <!-- Left Side: Invoice Cards -->
              <td style="width:38%;vertical-align:top;padding-right:15px">
                <div style="background:#f8fafc;padding:18px 24px;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:16px">
                  <div style="font-size:10px;text-transform:uppercase;color:#64748b;letter-spacing:1px;font-weight:700;margin-bottom:6px">Invoice For</div>
                  <div style="font-size:16px;color:#0f172a;font-weight:800;letter-spacing:-0.4px">${doc.client || ''}</div>
                </div>
                <div style="background:#fff;padding:18px 24px;border-radius:12px;border:1px solid #e2e8f0;border-left:4px solid #ef4444;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05)">
                  <div style="font-size:10px;text-transform:uppercase;color:#64748b;letter-spacing:1px;font-weight:700;margin-bottom:6px">Invoice #</div>
                  <div style="font-size:15px;color:#dc2626;font-weight:800;font-family:monospace">${doc.number || ''}</div>
                </div>
              </td>
              
              <!-- Center: Logo -->
              <td style="width:24%;text-align:center;vertical-align:top;padding:0 10px">
                <img src="${origin}/invoice%20logo.png?v=${Date.now()}" style="max-width:140px;height:auto;object-fit:contain;margin-top:15px" alt="ZRZ OPS" onerror="this.style.display='none'" />
              </td>
              
              <!-- Right Side: Date & Financials -->
              <td style="width:38%;vertical-align:top;padding-left:15px">
                <div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05)">
                  <div style="background:#f8fafc;padding:18px 24px;border-bottom:1px solid #e2e8f0">
                    <table style="width:100%;border-collapse:collapse">
                    ${doc.type === 'Weekly' ? `
                      <tr>
                        <td style="font-size:12px;color:#64748b;font-weight:600;padding-bottom:10px">Date From</td>
                        <td style="font-size:12px;color:#0f172a;font-weight:800;text-align:right;padding-bottom:10px">${formattedDate(doc.weekStart || doc.date)}</td>
                      </tr>
                      <tr>
                        <td style="font-size:12px;color:#64748b;font-weight:600">Date To</td>
                        <td style="font-size:12px;color:#0f172a;font-weight:800;text-align:right">${formattedDate(doc.weekEnd || doc.date)}</td>
                      </tr>
                    ` : `
                      <tr>
                        <td style="font-size:12px;color:#64748b;font-weight:600">Date</td>
                        <td style="font-size:12px;color:#0f172a;font-weight:800;text-align:right">${formattedDate(doc.date)}</td>
                      </tr>
                    `}
                    </table>
                  </div>
                  <div style="background:#fff;padding:18px 24px">
                    <table style="width:100%;border-collapse:collapse">
                      <tr>
                        <td style="font-size:12px;color:#64748b;padding-bottom:10px;font-weight:600">Subtotal</td>
                        <td style="font-size:13px;color:#0f172a;font-weight:700;text-align:right;padding-bottom:10px">${fmtMoney(doc.subtotal || 0)}</td>
                      </tr>
                      <tr>
                        <td style="font-size:12px;color:#64748b;padding-bottom:16px;font-weight:600">Tax</td>
                        <td style="font-size:13px;color:#0f172a;font-weight:700;text-align:right;padding-bottom:16px">${fmtMoney(doc.taxTotal || 0)}</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#0f172a;font-weight:700;padding-top:16px;border-top:2px dashed #e2e8f0">Total</td>
                        <td style="font-size:18px;color:${highlightColor};font-weight:800;text-align:right;padding-top:16px;border-top:2px dashed #e2e8f0">${fmtMoney(doc.total || 0)}</td>
                      </tr>
                    </table>
                  </div>
                </div>
              </td>
            </tr>
          </table>
          
          <!-- Master Grid Container -->
          <div style="border:2px solid #0f172a;border-radius:8px;overflow:hidden;box-shadow:4px 4px 0px 0px rgba(15,23,42,0.06)">
            <table style="width:100%;border-collapse:collapse;table-layout:fixed;background:#fff">
              <thead>
                <tr style="background:#0f172a;color:${thAccentColor}">
                  <th style="padding:10px 8px;text-align:left;font-size:10px;font-family:'Inter',sans-serif;white-space:nowrap;width:12%;letter-spacing:0.5px">DATE</th>
                  <th style="padding:10px 8px;text-align:left;font-size:10px;font-family:'Inter',sans-serif;width:13%;letter-spacing:0.5px">STOCK #</th>
                  <th style="padding:10px 8px;text-align:left;font-size:10px;font-family:'Inter',sans-serif;width:19%;letter-spacing:0.5px">VIN</th>
                  <th style="padding:10px 8px;text-align:left;font-size:10px;font-family:'Inter',sans-serif;width:24%;letter-spacing:0.5px">SERVICE</th>
                  <th style="padding:10px 8px;text-align:right;font-size:10px;font-family:'Inter',sans-serif;white-space:nowrap;width:11%;letter-spacing:0.5px">AMOUNT</th>
                  <th style="padding:10px 8px;text-align:right;font-size:10px;font-family:'Inter',sans-serif;white-space:nowrap;width:10%;letter-spacing:0.5px">TAX</th>
                  <th style="padding:10px 8px;text-align:right;font-size:10px;font-family:'Inter',sans-serif;white-space:nowrap;width:11%;letter-spacing:0.5px">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                ${lineRows}
              </tbody>
            </table>
          </div>
          
          <div style="margin-top:40px;text-align:center;color:#64748b;font-size:12px;font-weight:500">
            Thank you for your business!
          </div>
          
        </div>
      </div>
    </body></html>`
  }

  // Work Orders logic fallback
  const lineRowsFallback = (doc.lineItems || []).map((li: any, i: number) => `
    <tr>
      <td style="padding:8px 6px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:11px;text-align:center">${i + 1}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:11px;font-weight:500;word-break:break-word">${li.description}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:11px;text-align:center">${li.quantity}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:11px;text-align:right;white-space:nowrap">${fmtMoney(li.unitPrice || 0)}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:11px;text-align:right;white-space:nowrap">${fmtMoney((li.unitPrice || 0) * ((li.tax || 0) / 100))}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:11px;text-align:right;font-weight:600;white-space:nowrap">${fmtMoney(calcLineTotal(li) + calcLineTotal(li) * ((li.tax || 0) / 100))}</td>
    </tr>
  `).join('')

  const statusColorMap: Record<string, string> = {
    Draft: '#6b7280', Sent: '#3b82f6', Paid: '#10b981', Overdue: '#ef4444', Cancelled: '#6b7280',
  }
  const statusColor = statusColorMap[doc.status] || '#6b7280'

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${docType} ${doc.number}</title></head><body style="margin:0;padding:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff;color:#111827">
    <div style="max-width:100%;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #111827">
        <div style="display:flex;align-items:center;gap:12px">
          <img src="${origin}/logo.png" style="height:42px;width:auto" alt="Turbo Clean" onerror="this.style.display='none'" />
          <div>
            <h1 style="margin:0;font-size:22px;font-weight:800;color:#111827;letter-spacing:-0.5px">Turbo Clean</h1>
            <p style="margin:2px 0 0;color:#6b7280;font-size:11px">Car Detailing & Cleaning Services<br>info@turboclean.com</p>
          </div>
        </div>
        <div style="text-align:right">
          <div style="display:inline-block;padding:4px 12px;border-radius:20px;background:${statusColor}15;color:${statusColor};font-size:10px;font-weight:600;border:1px solid ${statusColor}30">${doc.status}</div>
          <h2 style="margin:8px 0 0;font-size:16px;font-weight:700;color:#111827">${docType} ${doc.number}</h2>
          <p style="margin:2px 0 0;color:#6b7280;font-size:11px">Date: ${doc.date}</p>
        </div>
      </div>

      <div style="display:flex;gap:24px;margin-bottom:24px">
        <div style="flex:1;padding:14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
          <p style="margin:0 0 4px;font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;font-weight:600">Bill To</p>
          <p style="margin:0;font-size:14px;font-weight:600;color:#111827">${doc.client}</p>
          ${doc.clientEmail ? `<p style="margin:2px 0 0;font-size:11px;color:#6b7280">${doc.clientEmail}</p>` : ''}
          ${doc.clientAddress ? `<p style="margin:1px 0 0;font-size:11px;color:#6b7280">${doc.clientAddress}</p>` : ''}
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;table-layout:fixed">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:7px 6px;text-align:center;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb;width:30px">#</th>
            <th style="padding:7px 6px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Description</th>
            <th style="padding:7px 6px;text-align:center;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb;width:35px">Qty</th>
            <th style="padding:7px 6px;text-align:right;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb;width:80px">Amount</th>
            <th style="padding:7px 6px;text-align:right;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb;width:70px">Tax</th>
            <th style="padding:7px 6px;text-align:right;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb;width:85px">Total</th>
          </tr>
        </thead>
        <tbody>${lineRowsFallback}</tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;margin-bottom:24px">
        <table style="width:220px;border-collapse:collapse">
          <tr><td style="padding:6px 8px;color:#6b7280;font-size:12px">Subtotal</td><td style="padding:6px 8px;text-align:right;color:#111827;font-size:12px;font-weight:500">${fmtMoney(doc.subtotal || 0)}</td></tr>
          <tr><td style="padding:6px 8px;color:#6b7280;font-size:12px">Tax</td><td style="padding:6px 8px;text-align:right;color:#111827;font-size:12px">${fmtMoney(doc.taxTotal || 0)}</td></tr>
          <tr style="border-top:2px solid #111827"><td style="padding:8px 8px;color:#111827;font-size:14px;font-weight:700">Total</td><td style="padding:8px 8px;text-align:right;color:#111827;font-size:14px;font-weight:700">${fmtMoney(doc.total || 0)}</td></tr>
        </table>
      </div>

    </div>
  </body></html>`
}

export function downloadPDF(doc: any, docType: 'Work Order' | 'Invoice' | 'Order') {
  const html = generatePDF(doc, docType)
  const printWindow = window.open('', '_blank')
  if (printWindow) {
    printWindow.document.write(html)
    printWindow.document.close()
    setTimeout(() => { printWindow.print() }, 300)
  }
}
