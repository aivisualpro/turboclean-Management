import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

// ── Cached logo data ────────────────────────────────────────────────────────
let _logoBase64Cache: string | null = null
let _logoFetchPromise: Promise<string | null> | null = null

async function fetchLogoBase64(): Promise<string | null> {
  if (_logoBase64Cache) return _logoBase64Cache
  if (_logoFetchPromise) return _logoFetchPromise

  _logoFetchPromise = (async () => {
    try {
      const url = 'https://raw.githubusercontent.com/aivisualpro/turboclean-Management/main/public/invoice%20logo.png'
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!response.ok) return null
      const arrayBuffer = await response.arrayBuffer()
      const base64 = Buffer.from(arrayBuffer).toString('base64')
      _logoBase64Cache = `data:image/png;base64,${base64}`
      return _logoBase64Cache
    } catch (err) {
      console.warn('[Invoice PDF] Failed to fetch logo:', err)
      return null
    }
  })()

  return _logoFetchPromise
}

// ── Logo URL for HTML emails ────────────────────────────────────────────────
function getLogoUrl(): string {
  return `https://raw.githubusercontent.com/aivisualpro/turboclean-Management/main/public/invoice%20logo.png?v=${Date.now()}`
}

// ── Shared helpers ──────────────────────────────────────────────────────────
const fmtMoney = (n: number) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'numeric', day: 'numeric', year: 'numeric' }) : ''

/**
 * Generates the styled invoice HTML for email body rendering.
 * Uses a remote URL for the logo (works in email clients).
 */
export function generateInvoiceHtml(doc: any): string {
  const logoSrc = getLogoUrl()

  const lineRows = (doc.lineItems || []).map((li: any, i: number) => {
    const bg = i % 2 !== 0 ? '#f3f4f6' : '#ffffff'
    return `
    <tr style="background:${bg};border-bottom:1px solid #e2e8f0">
      <td style="padding:8px 8px;color:#334155;font-size:11px;font-family:'Inter',Arial,sans-serif">${fmtDate(li.date || doc.date)}</td>
      <td style="padding:8px 8px;color:#334155;font-size:11px;font-family:'Inter',Arial,sans-serif;text-transform:uppercase">${(li.stockNumber || '').toUpperCase()}</td>
      <td style="padding:8px 8px;color:#334155;font-size:11px;font-family:'Inter',Arial,sans-serif">${li.poNumber || ''}</td>
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
        table { page-break-inside: auto; }
        tr { page-break-inside: avoid; page-break-after: auto; }
        thead { display: table-header-group; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;font-family:'Inter',Arial,sans-serif;background:#f8fafc;color:#0f172a">
    <div class="print-wrapper" style="max-width:820px;margin:20px auto;background:#fff;border-radius:12px;box-shadow:0 10px 30px -5px rgba(0,0,0,0.05);overflow:hidden;border:1px solid #e2e8f0;box-sizing:border-box">
      <!-- Top Banner Bar -->
      <div style="height:12px;background:linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%);width:100%"></div>
      
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
              ${logoSrc ? `<img src="${logoSrc}" style="max-width:140px;height:auto;object-fit:contain;margin-top:15px" alt="ZRZ OPS" />` : ''}
            </td>
            
            <!-- Right Side: Date & Financials -->
            <td style="width:38%;vertical-align:top;padding-left:15px">
              <div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05)">
                <div style="background:#f8fafc;padding:18px 24px;border-bottom:1px solid #e2e8f0">
                  <table style="width:100%;border-collapse:collapse">
                  ${doc.type === 'Weekly' ? `
                    <tr>
                      <td style="font-size:12px;color:#64748b;font-weight:600;padding-bottom:10px">Date From</td>
                      <td style="font-size:12px;color:#0f172a;font-weight:800;text-align:right;padding-bottom:10px">${fmtDate(doc.weekStart || doc.date)}</td>
                    </tr>
                    <tr>
                      <td style="font-size:12px;color:#64748b;font-weight:600">Date To</td>
                      <td style="font-size:12px;color:#0f172a;font-weight:800;text-align:right">${fmtDate(doc.weekEnd || doc.date)}</td>
                    </tr>
                  ` : `
                    <tr>
                      <td style="font-size:12px;color:#64748b;font-weight:600">Date</td>
                      <td style="font-size:12px;color:#0f172a;font-weight:800;text-align:right">${fmtDate(doc.date)}</td>
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
                      <td style="font-size:18px;color:#f59e0b;font-weight:800;text-align:right;padding-top:16px;border-top:2px dashed #e2e8f0">${fmtMoney(doc.total || 0)}</td>
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
              <tr style="background:#0f172a;color:#fbbf24">
                <th style="padding:10px 8px;text-align:left;font-size:10px;font-family:'Inter',sans-serif;white-space:nowrap;width:12%;letter-spacing:0.5px">DATE</th>
                <th style="padding:10px 8px;text-align:left;font-size:10px;font-family:'Inter',sans-serif;width:10%;letter-spacing:0.5px">STOCK #</th>
                <th style="padding:10px 8px;text-align:left;font-size:10px;font-family:'Inter',sans-serif;width:10%;letter-spacing:0.5px">PO #</th>
                <th style="padding:10px 8px;text-align:left;font-size:10px;font-family:'Inter',sans-serif;width:16%;letter-spacing:0.5px">VIN</th>
                <th style="padding:10px 8px;text-align:left;font-size:10px;font-family:'Inter',sans-serif;width:20%;letter-spacing:0.5px">CLEAN TYPE</th>
                <th style="padding:10px 8px;text-align:right;font-size:10px;font-family:'Inter',sans-serif;white-space:nowrap;width:11%;letter-spacing:0.5px">AMOUNT</th>
                <th style="padding:10px 8px;text-align:right;font-size:10px;font-family:'Inter',sans-serif;white-space:nowrap;width:10%;letter-spacing:0.5px">TAX 6.35%</th>
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

/**
 * Converts invoice data to a PDF buffer using jsPDF (pure JavaScript — no Chromium needed).
 * Works on Vercel, AWS Lambda, and all serverless environments.
 */
export async function htmlToPdfBuffer(html: string, invoiceData?: any): Promise<Buffer> {
  // If we have structured invoice data, use it directly for a clean PDF
  // Otherwise, generate a basic text-based PDF from whatever we have
  const doc = invoiceData || extractDataFromHtml(html)
  return await generatePdfFromData(doc)
}

/**
 * Generates a PDF buffer directly from structured invoice data.
 * This is the primary PDF generation method — no browser needed.
 */
export async function generatePdfFromData(data: any): Promise<Buffer> {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const margin = 40
  const contentWidth = pageWidth - margin * 2

  // ── Brand bar at top ──────────────────────────────────────────────────
  pdf.setFillColor(251, 191, 36) // amber-400
  pdf.rect(0, 0, pageWidth, 12, 'F')

  let y = 36

  // ── Try to add logo ───────────────────────────────────────────────────
  try {
    const logoData = await fetchLogoBase64()
    if (logoData) {
      const logoWidth = 50
      const logoX = (pageWidth - logoWidth) / 2
      pdf.addImage(logoData, 'PNG', logoX, y, logoWidth, 50)
    }
  } catch { /* graceful fallback — skip logo */ }

  y += 60

  // ── Invoice title ─────────────────────────────────────────────────────
  pdf.setFontSize(20)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(15, 23, 42) // slate-900
  const invoiceLabel = data.invoiceType === 'Weekly' ? 'WEEKLY INVOICE' : 'INVOICE'
  pdf.text(invoiceLabel, margin, y)

  // Invoice number on the right
  pdf.setFontSize(12)
  pdf.setTextColor(220, 38, 38) // red-600
  pdf.text(`#${data.invoiceNumber || data.number || ''}`, pageWidth - margin, y, { align: 'right' })

  y += 28

  // ── Info grid ─────────────────────────────────────────────────────────
  pdf.setFontSize(9)
  pdf.setTextColor(100, 116, 139) // slate-500
  pdf.setFont('helvetica', 'normal')

  const leftCol = margin
  const rightCol = pageWidth / 2 + 20

  // Left: Invoice For
  pdf.text('INVOICE FOR', leftCol, y)
  y += 14
  pdf.setFontSize(13)
  pdf.setTextColor(15, 23, 42)
  pdf.setFont('helvetica', 'bold')
  pdf.text(data.dealerName || data.client || '', leftCol, y)

  // Right: Date info
  let ry = y - 14
  pdf.setFontSize(9)
  pdf.setTextColor(100, 116, 139)
  pdf.setFont('helvetica', 'normal')

  if (data.invoiceType === 'Weekly' || data.type === 'Weekly') {
    pdf.text('DATE FROM', rightCol, ry)
    ry += 14
    pdf.setFontSize(10)
    pdf.setTextColor(15, 23, 42)
    pdf.setFont('helvetica', 'bold')
    pdf.text(fmtDate(data.weekStart || data.date), rightCol, ry)
    ry += 18

    pdf.setFontSize(9)
    pdf.setTextColor(100, 116, 139)
    pdf.setFont('helvetica', 'normal')
    pdf.text('DATE TO', rightCol, ry)
    ry += 14
    pdf.setFontSize(10)
    pdf.setTextColor(15, 23, 42)
    pdf.setFont('helvetica', 'bold')
    pdf.text(fmtDate(data.weekEnd || data.date), rightCol, ry)
  } else {
    pdf.text('DATE', rightCol, ry)
    ry += 14
    pdf.setFontSize(10)
    pdf.setTextColor(15, 23, 42)
    pdf.setFont('helvetica', 'bold')
    pdf.text(fmtDate(data.date), rightCol, ry)
  }

  y += 40

  // ── Separator ─────────────────────────────────────────────────────────
  pdf.setDrawColor(226, 232, 240) // slate-200
  pdf.setLineWidth(1)
  pdf.line(margin, y, pageWidth - margin, y)
  y += 16

  // ── Line Items Table ──────────────────────────────────────────────────
  const items = data.lineItems || []
  const tableData = items.map((li: any) => [
    fmtDate(li.date || data.date),
    (li.stockNumber || '').toUpperCase(),
    li.poNumber || '',
    li.vin || '',
    (li.serviceName || li.description || '').toUpperCase(),
    fmtMoney(li.unitPrice || li.amount || 0),
    fmtMoney(li.tax || 0),
    fmtMoney((li.unitPrice || li.amount || 0) + (li.tax || 0)),
  ])

  autoTable(pdf, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['DATE', 'STOCK #', 'PO #', 'VIN', 'CLEAN TYPE', 'AMOUNT', 'TAX 6.35%', 'TOTAL']],
    body: tableData,
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 6,
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
      textColor: [51, 65, 85], // slate-700
      font: 'helvetica',
    },
    headStyles: {
      fillColor: [15, 23, 42], // slate-900
      textColor: [251, 191, 36], // amber-400
      fontStyle: 'bold',
      fontSize: 7.5,
      halign: 'left',
      cellPadding: 8,
    },
    columnStyles: {
      0: { cellWidth: 55 },  // Date
      1: { cellWidth: 55 },  // Stock #
      2: { cellWidth: 50 },  // PO #
      3: { cellWidth: 80 },  // VIN
      4: { cellWidth: 'auto' },  // Clean Type
      5: { halign: 'right', cellWidth: 55 },  // Amount
      6: { halign: 'right', cellWidth: 50 },  // Tax
      7: { halign: 'right', cellWidth: 55, fontStyle: 'bold', textColor: [15, 23, 42] },  // Total
    },
    alternateRowStyles: {
      fillColor: [243, 244, 246], // gray-100
    },
    didDrawPage: () => {
      // Re-draw brand bar on every page
      pdf.setFillColor(251, 191, 36)
      pdf.rect(0, 0, pageWidth, 6, 'F')
    },
  })

  // ── Totals section below table ────────────────────────────────────────
  const finalY = (pdf as any).lastAutoTable?.finalY || y + 100
  let ty = finalY + 24

  const totalsX = pageWidth - margin - 180
  const totalsValueX = pageWidth - margin

  // Subtotal
  pdf.setFontSize(10)
  pdf.setTextColor(100, 116, 139)
  pdf.setFont('helvetica', 'normal')
  pdf.text('Subtotal', totalsX, ty)
  pdf.setTextColor(15, 23, 42)
  pdf.setFont('helvetica', 'bold')
  pdf.text(fmtMoney(data.subtotal || 0), totalsValueX, ty, { align: 'right' })
  ty += 18

  // Tax
  pdf.setTextColor(100, 116, 139)
  pdf.setFont('helvetica', 'normal')
  pdf.text('Tax (6.35%)', totalsX, ty)
  pdf.setTextColor(15, 23, 42)
  pdf.setFont('helvetica', 'bold')
  pdf.text(fmtMoney(data.taxTotal || 0), totalsValueX, ty, { align: 'right' })
  ty += 6

  // Dashed line
  pdf.setDrawColor(226, 232, 240)
  pdf.setLineDashPattern([4, 2], 0)
  pdf.line(totalsX - 10, ty, totalsValueX, ty)
  pdf.setLineDashPattern([], 0)
  ty += 18

  // Total
  pdf.setFontSize(14)
  pdf.setTextColor(100, 116, 139)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Total', totalsX, ty)
  pdf.setTextColor(245, 158, 11) // amber-500
  pdf.setFontSize(16)
  pdf.text(fmtMoney(data.total || 0), totalsValueX, ty, { align: 'right' })
  ty += 40

  // ── Footer ────────────────────────────────────────────────────────────
  pdf.setFontSize(10)
  pdf.setTextColor(100, 116, 139)
  pdf.setFont('helvetica', 'normal')
  pdf.text('Thank you for your business!', pageWidth / 2, ty, { align: 'center' })

  // Convert to Buffer
  const arrayBuffer = pdf.output('arraybuffer')
  return Buffer.from(arrayBuffer)
}

/**
 * Attempts to extract basic invoice data from HTML when structured data isn't available.
 * This is a fallback — the structured data path is always preferred.
 */
function extractDataFromHtml(html: string): any {
  // Basic regex extraction for fallback
  const numberMatch = html.match(/Invoice\s+#?\s*([A-Z0-9-]+)/i)
  return {
    invoiceNumber: numberMatch?.[1] || 'Unknown',
    dealerName: '',
    date: new Date().toISOString(),
    lineItems: [],
    subtotal: 0,
    taxTotal: 0,
    total: 0,
  }
}
