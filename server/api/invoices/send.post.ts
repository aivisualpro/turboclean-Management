import { Resend } from 'resend'
import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { generateInvoiceHtml, htmlToPdfBuffer } from '../../utils/invoice-pdf'

/**
 * Fetches an image from a URL and returns it as a Buffer.
 * Returns null if the fetch fails (graceful degradation).
 */
async function fetchImageAsBuffer(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) return null
    const arrayBuffer = await response.arrayBuffer()
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    return { buffer: Buffer.from(arrayBuffer), contentType }
  } catch {
    console.warn(`[Invoice Email] Failed to fetch image: ${url}`)
    return null
  }
}

/**
 * Extracts individual image URLs from a work order upload field.
 * The upload field can be a comma-separated list of URLs.
 */
function parseUploadUrls(uploadField: string): string[] {
  if (!uploadField) return []
  return uploadField
    .split(',')
    .map(u => u.trim())
    .filter(u => u.startsWith('http'))
}

/**
 * Gets a file extension from a content-type header.
 */
function extFromContentType(ct: string): string {
  if (ct.includes('png')) return 'png'
  if (ct.includes('gif')) return 'gif'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('svg')) return 'svg'
  return 'jpg'
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { email, html, subject, dealerId, invoiceId, invoiceType, invoiceNumber, invoiceData } = body

  if (!email || !subject) {
    throw createError({ statusCode: 400, statusMessage: 'Missing parameters' })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)

  try {
    // ── Generate server-side HTML with embedded logo ─────────────────
    let emailHtml = html || ''
    let pdfHtml = html || ''

    // If we have invoice data, generate HTML server-side with embedded logo
    if (invoiceData) {
      pdfHtml = generateInvoiceHtml(invoiceData)
      emailHtml = pdfHtml // Use the same HTML with embedded logo for the email body
    }

    // ── Build Attachments ────────────────────────────────────────────
    const attachments: { filename: string; content: Buffer; contentType?: string }[] = []

    if (invoiceType === 'Daily') {
      // 1. Generate PDF from invoice data — MUST be attachment[0]
      try {
        const pdfBuffer = await htmlToPdfBuffer(pdfHtml, invoiceData)
        attachments.push({
          filename: `${invoiceNumber || 'Invoice'}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        })
      } catch (err: any) {
        console.error('[Invoice Email] Daily PDF generation failed:', err.message, err.stack)
      }

      // 2. Fetch all work order upload images (collected separately to guarantee ordering)
      if (invoiceId) {
        const { db } = await connectToDatabase()

        let invoice: any = null
        try {
          invoice = await db.collection('turboCleanInvoices').findOne({ _id: new ObjectId(invoiceId) })
        } catch {
          invoice = await db.collection('turboCleanInvoices').findOne({ _id: invoiceId as any })
        }

        if (invoice?.lineItems?.length) {
          const woIds: any[] = []
          for (const li of invoice.lineItems) {
            if (li.workOrderId) {
              try { woIds.push(new ObjectId(li.workOrderId)) } catch {}
              woIds.push(li.workOrderId)
            }
          }

          if (woIds.length > 0) {
            const workOrders = await db.collection('turboCleanWorkOrders')
              .find({ _id: { $in: woIds } })
              .project({ upload: 1, stockNumber: 1 })
              .toArray()

            // Build ordered image results (index-keyed to preserve sequence)
            const imageResults: { idx: number; filename: string; buffer: Buffer; contentType: string }[] = []
            let imageCounter = 0
            const fetchPromises: Promise<void>[] = []

            for (const wo of workOrders) {
              const urls = parseUploadUrls(wo.upload || '')
              for (const url of urls) {
                imageCounter++
                const idx = imageCounter
                const stockLabel = wo.stockNumber || 'WO'

                fetchPromises.push(
                  fetchImageAsBuffer(url).then(result => {
                    if (result) {
                      const ext = extFromContentType(result.contentType)
                      imageResults.push({
                        idx,
                        filename: `${stockLabel}_photo_${idx}.${ext}`,
                        buffer: result.buffer,
                        contentType: result.contentType,
                      })
                    }
                  })
                )
              }
            }

            await Promise.all(fetchPromises)

            // Sort by index and append after the PDF
            imageResults.sort((a, b) => a.idx - b.idx)
            for (const img of imageResults) {
              attachments.push({
                filename: img.filename,
                content: img.buffer,
                contentType: img.contentType,
              })
            }
          }
        }
      }
    } else if (invoiceType === 'Weekly') {
      // Weekly: Attach only the weekly invoice PDF
      try {
        const pdfBuffer = await htmlToPdfBuffer(pdfHtml, invoiceData)
        attachments.push({
          filename: `${invoiceNumber || 'Weekly-Invoice'}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        })
      } catch (err: any) {
        console.error('[Invoice Email] Weekly PDF generation failed:', err.message, err.stack)
      }
    }

    const fromName = invoiceType === 'Daily' ? 'ZRZ Daily' : 'ZRZ Weekly'
    const fromAddress = `${fromName} <billing@zrzops.com>`

    // ── Send Email ──────────────────────────────────────────────────
    const data = await resend.emails.send({
      from: fromAddress,
      to: email,
      subject: subject,
      html: emailHtml,
      ...(attachments.length > 0 ? { attachments } : {}),
    })

    // ── Log the email ───────────────────────────────────────────────
    if (dealerId) {
      const { db } = await connectToDatabase()
      await db.collection('turboCleanEmailLogs').insertOne({
        dealerId,
        invoiceId,
        email, // Legacy
        subject,
        type: 'Invoice',
        invoiceType: invoiceType || 'Unknown',
        attachmentCount: attachments.length,
        status: 'Sent',
        sentAt: new Date().toISOString(),
        
        // Mailbox UI Support Fields:
        folder: 'sent',
        from: fromAddress,
        to: email,
        bodyHtml: emailHtml,
        receivedAt: new Date().toISOString(), // Fallback for unified sorting
        attachments: attachments.map(att => ({
          filename: att.filename,
          content: `data:${att.contentType || 'application/pdf'};base64,${Buffer.isBuffer(att.content) ? att.content.toString('base64') : Buffer.from(att.content).toString('base64')}`
        }))
      })
    }

    return { success: true, data, attachmentCount: attachments.length }
  } catch (error: any) {
    console.error('[Invoice Email] Error:', error)
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to send email' })
  }
})
