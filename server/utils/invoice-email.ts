/**
 * Shared invoice delivery engine — builds the branded invoice email
 * (HTML body + PDF attachment + work-order photos for dailies), sends it
 * through Resend, writes the email log, and flips the invoice to Emailed.
 *
 * Mirrors the manual send flow (POST /api/invoices/send) so automated
 * deliveries are indistinguishable from hand-sent ones.
 */

import { Buffer } from 'node:buffer'
import process from 'node:process'
import { ObjectId } from 'mongodb'
import { Resend } from 'resend'
import { generateInvoiceHtml, htmlToPdfBuffer } from './invoice-pdf'
import { buildEmailHtml } from './monthly-automation'

async function fetchImageAsBuffer(url: string): Promise<{ buffer: Buffer, contentType: string } | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) return null
    const arrayBuffer = await response.arrayBuffer()
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    return { buffer: Buffer.from(arrayBuffer), contentType }
  }
  catch {
    console.warn(`[Invoice Email] Failed to fetch image: ${url}`)
    return null
  }
}

function parseUploadUrls(uploadField: string): string[] {
  if (!uploadField) return []
  return uploadField
    .split(',')
    .map(u => u.trim())
    .filter(u => u.startsWith('http'))
}

function extFromContentType(ct: string): string {
  if (ct.includes('png')) return 'png'
  if (ct.includes('gif')) return 'gif'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('svg')) return 'svg'
  return 'jpg'
}

/** Work-order photos attached to Daily invoice emails (same as manual send) */
async function buildDailyPhotoAttachments(db: any, invoice: any) {
  const attachments: { filename: string, content: Buffer, contentType: string }[] = []
  if (!invoice?.lineItems?.length) return attachments

  const woIds: any[] = []
  for (const li of invoice.lineItems) {
    if (li.workOrderId) {
      try { woIds.push(new ObjectId(li.workOrderId)) } catch {}
      woIds.push(li.workOrderId)
    }
  }
  if (woIds.length === 0) return attachments

  const workOrders = await db.collection('turboCleanWorkOrders')
    .find({ _id: { $in: woIds } })
    .project({ upload: 1, stockNumber: 1 })
    .toArray()

  const imageResults: { idx: number, filename: string, buffer: Buffer, contentType: string }[] = []
  let imageCounter = 0
  const fetchPromises: Promise<void>[] = []

  for (const wo of workOrders) {
    const urls = parseUploadUrls(wo.upload || '')
    for (const url of urls) {
      imageCounter++
      const idx = imageCounter
      const stockLabel = wo.stockNumber || 'WO'
      fetchPromises.push(
        fetchImageAsBuffer(url).then((result) => {
          if (result) {
            const ext = extFromContentType(result.contentType)
            imageResults.push({
              idx,
              filename: `${stockLabel}_photo_${idx}.${ext}`,
              buffer: result.buffer,
              contentType: result.contentType,
            })
          }
        }),
      )
    }
  }

  await Promise.all(fetchPromises)
  imageResults.sort((a, b) => a.idx - b.idx)
  for (const img of imageResults) {
    attachments.push({ filename: img.filename, content: img.buffer, contentType: img.contentType })
  }
  return attachments
}

/** Default subject line per invoice type */
export function defaultInvoiceSubject(invoice: any): string {
  const type = invoice.type || 'Weekly'
  if (type === 'Daily') return `Invoice ${invoice.number} – ${invoice.dealerName} (${invoice.date})`
  if (type === 'Weekly') {
    const range = invoice.weekNumber ? `Week ${invoice.weekNumber}, ${invoice.weekYear}` : invoice.date
    return `Weekly Invoice ${invoice.number} – ${invoice.dealerName} (${range})`
  }
  return `Monthly Invoice ${invoice.number} – ${invoice.dealerName}${invoice.monthLabel ? ` (${invoice.monthLabel})` : ''}`
}

export interface SendInvoiceResult {
  success: boolean
  emailsSent: number
  error?: string
}

/**
 * Sends one invoice to the given recipients (single email, all recipients).
 * On success the invoice is marked Emailed and the send is logged.
 */
export async function sendInvoiceByEmail(
  db: any,
  invoice: any,
  recipients: string[],
  opts: {
    subject?: string
    emailBody?: string
    sentByAutomation?: boolean
    automationId?: string
  } = {},
): Promise<SendInvoiceResult> {
  const targetEmails = (recipients || [])
    .flatMap(e => typeof e === 'string' ? e.split(',') : [])
    .map(e => e.trim().replace(/,+$/, ''))
    .filter(Boolean)

  if (targetEmails.length === 0) {
    return { success: false, emailsSent: 0, error: 'No valid recipients' }
  }

  const type = invoice.type || 'Weekly'

  const invoiceData = {
    invoiceNumber: invoice.number,
    number: invoice.number,
    invoiceType: type,
    type,
    date: invoice.date,
    dueDate: invoice.dueDate,
    weekNumber: invoice.weekNumber,
    weekYear: invoice.weekYear,
    weekStart: invoice.weekStart,
    weekEnd: invoice.weekEnd,
    monthKey: invoice.monthKey,
    monthLabel: invoice.monthLabel,
    dealerName: invoice.dealerName,
    dealerEmail: invoice.dealerEmail,
    dealerAddress: invoice.dealerAddress,
    client: invoice.dealerName,
    lineItems: (invoice.lineItems || []).map((li: any) => ({ ...li, unitPrice: li.amount ?? li.unitPrice ?? 0 })),
    subtotal: invoice.subtotal,
    taxTotal: invoice.taxTotal,
    total: invoice.total,
  }

  try {
    const invoiceHtml = generateInvoiceHtml(invoiceData)
    const emailHtml = buildEmailHtml(invoiceHtml, opts.emailBody)

    // ── Attachments: PDF first, then work-order photos for dailies ──
    const attachments: { filename: string, content: Buffer, contentType?: string }[] = []
    try {
      const pdfBuffer = await htmlToPdfBuffer(invoiceHtml, invoiceData)
      attachments.push({ filename: `${invoice.number || 'Invoice'}.pdf`, content: pdfBuffer, contentType: 'application/pdf' })
    }
    catch (err: any) {
      console.error(`[Invoice Email] ${type} PDF generation failed:`, err.message)
    }

    if (type === 'Daily') {
      try {
        const photos = await buildDailyPhotoAttachments(db, invoice)
        attachments.push(...photos)
      }
      catch (err: any) {
        console.error('[Invoice Email] Photo attachment build failed:', err.message)
      }
    }

    const fromName = type === 'Daily' ? 'ZRZ Daily' : type === 'Monthly' ? 'ZRZ Monthly' : 'ZRZ Weekly'
    const fromAddress = `${fromName} <billing@zrzops.com>`
    const subject = (opts.subject || '').trim() || defaultInvoiceSubject(invoice)

    const resend = new Resend(process.env.RESEND_API_KEY)
    const sendResult: any = await resend.emails.send({
      from: fromAddress,
      to: targetEmails,
      subject,
      html: emailHtml,
      ...(attachments.length > 0 ? { attachments } : {}),
    })

    // Resend does NOT throw on API failures — it resolves with { data, error }.
    // Treating an error as success would mark the invoice Emailed while nothing
    // was delivered, so it must fail loudly here (the run reports it as Failed
    // and the invoice stays Draft for the next attempt).
    if (sendResult?.error) {
      const msg = sendResult.error.message || sendResult.error.name || JSON.stringify(sendResult.error)
      console.error(`[Invoice Email] Resend rejected ${invoice.number}:`, msg)
      return { success: false, emailsSent: 0, error: msg }
    }

    // ── Log the email (same shape as manual sends, mailbox-UI compatible) ──
    await db.collection('turboCleanEmailLogs').insertOne({
      dealerId: invoice.dealerId,
      invoiceId: invoice._id?.toString?.() || '',
      automationId: opts.automationId || '',
      email: targetEmails.join(', '),
      subject,
      type: 'Invoice',
      invoiceType: type,
      attachmentCount: attachments.length,
      status: 'Sent',
      sentAt: new Date().toISOString(),
      sentByAutomation: opts.sentByAutomation !== false,
      folder: 'sent',
      from: fromAddress,
      to: targetEmails,
      bodyHtml: emailHtml,
      receivedAt: new Date().toISOString(),
      attachments: attachments.map(att => ({ filename: att.filename })),
    }).catch((e: any) => console.error('[Invoice Email] Failed to write email log:', e?.message))

    // ── Mark the invoice Emailed ──
    if (invoice._id) {
      await db.collection('turboCleanInvoices').updateOne(
        { _id: invoice._id },
        { $set: { status: 'Emailed', updatedAt: new Date().toISOString() } },
      ).catch(() => {})
    }

    return { success: true, emailsSent: targetEmails.length }
  }
  catch (error: any) {
    console.error(`[Invoice Email] Failed to send ${invoice.number}:`, error.message)
    return { success: false, emailsSent: 0, error: error.message }
  }
}

/** Resolve a dealer's invoice recipients (contacts flagged receiveInvoices) */
export function dealerInvoiceRecipients(dealer: any): string[] {
  return (dealer?.contacts || [])
    .filter((c: any) => c.receiveInvoices && c.emails?.length > 0)
    .flatMap((c: any) => c.emails
      .flatMap((e: string) => typeof e === 'string' ? e.split(',') : [])
      .map((e: string) => e.trim().replace(/,+$/, ''))
      .filter(Boolean))
}
