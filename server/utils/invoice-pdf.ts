import puppeteer from 'puppeteer'
import { readFileSync } from 'fs'
import { join } from 'path'

// Cached logo base64 (loaded once, then reused)
let _logoBase64: string | null = null

function getLogoBase64(): string {
  // Use a highly available absolute URL, plus cache buster to fetch the latest logo
  return `https://raw.githubusercontent.com/aivisualpro/turboclean-Management/main/public/invoice%20logo.png?v=${Date.now()}`
}

/**
 * Generates the styled invoice HTML with the logo embedded as base64.
 * This works in both browser preview and email contexts.
 */
export function generateInvoiceHtml(doc: any): string {
  const fmtMoney = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const formattedDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'numeric', day: 'numeric', year: 'numeric' }) : ''
  const logoSrc = getLogoBase64()

  const lineRows = (doc.lineItems || []).map((li: any, i: number) => {
    const bg = i % 2 !== 0 ? '#f3f4f6' : '#ffffff'
    return `
    <tr style="background:${bg};border-bottom:1px solid #e2e8f0">
      <td style="padding:8px 8px;color:#334155;font-size:11px;font-family:'Inter',Arial,sans-serif">${formattedDate(li.date || doc.date)}</td>
      <td style="padding:8px 8px;color:#334155;font-size:11px;font-family:'Inter',Arial,sans-serif">${li.stockNumber || ''}</td>
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
 * Converts invoice HTML to a PDF buffer using Puppeteer.
 */
export async function htmlToPdfBuffer(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 })
    // Ensure fonts and images have time to render over the network
    await new Promise(r => setTimeout(r, 1500))
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '20px', right: '0', bottom: '20px', left: '0' },
    })
    return Buffer.from(pdfBuffer)
  } finally {
    await browser.close()
  }
}
