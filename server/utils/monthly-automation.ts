import type { Buffer } from 'node:buffer'
import process from 'node:process'
import { ObjectId } from 'mongodb'
import { Resend } from 'resend'
import { generateInvoiceHtml, htmlToPdfBuffer } from './invoice-pdf'

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ── Timezone helpers ─────────────────────────────────────────────────────────

/** Returns current date/time parts in the given IANA timezone */
export function nowInTimezone(tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (type: string) => parts.find(p => p.type === type)?.value || '00'
  const year = Number(get('year'))
  const month = Number(get('month'))
  const day = Number(get('day'))
  const hour = Number(get('hour')) % 24 // Intl can return "24" for midnight
  const minute = Number(get('minute'))
  return { year, month, day, hour, minute }
}

/** Computes the scheduled day-of-month for a given month based on the automation's rule */
export function getScheduledDay(cfg: any, year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()

  if (cfg.scheduleType === 'nth_weekday') {
    const targetDow = WEEKDAYS.indexOf(cfg.weekday || 'Monday') // 0-6
    if (cfg.nth === 'Last') {
      for (let d = lastDay; d >= 1; d--) {
        if (new Date(Date.UTC(year, month - 1, d)).getUTCDay() === targetDow)
          return d
      }
      return lastDay
    }
    const nthIndex = ['First', 'Second', 'Third', 'Fourth'].indexOf(cfg.nth || 'First') // 0-3
    let count = 0
    for (let d = 1; d <= lastDay; d++) {
      if (new Date(Date.UTC(year, month - 1, d)).getUTCDay() === targetDow) {
        if (count === nthIndex)
          return d
        count++
      }
    }
    return lastDay
  }

  // day_of_month
  if (cfg.dayOfMonth === 'last')
    return lastDay
  return Math.min(Number(cfg.dayOfMonth) || 1, lastDay)
}

// ── Invoice generation + sending ─────────────────────────────────────────────

function buildLineItem(li: any) {
  const amount = Math.round((Number(li.amount) || 0) * 100) / 100
  const tax = Math.round((Number(li.tax) || 0) * 100) / 100
  return {
    serviceName: li.serviceName || li.description || '',
    description: li.description || li.serviceName || '',
    amount,
    tax,
    total: Math.round((amount + tax) * 100) / 100,
    isCustom: true,
  }
}

/** Wraps the invoice HTML with an optional custom message paragraph for the email body */
export function buildEmailHtml(invoiceHtml: string, emailBody?: string): string {
  if (!emailBody || !emailBody.trim())
    return invoiceHtml
  const safeBody = emailBody
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
  const messageBlock = `
    <div style="max-width:820px;margin:20px auto 0;padding:20px 28px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;font-family:'Inter',Arial,sans-serif;color:#334155;font-size:14px;line-height:1.65">
      ${safeBody}
    </div>`
  // Inject the message right after <body ...>
  return invoiceHtml.replace(/(<body[^>]*>)/i, `$1${messageBlock}`)
}

/**
 * Executes one monthly automation:
 *  1. Creates (or reuses) the Monthly invoice for the billing month
 *  2. Emails it to the automation's recipients (fallback: dealer receiveInvoices contacts)
 *  3. Updates the automation's run bookkeeping
 */
export async function runMonthlyAutomation(db: any, automation: any, opts: { force?: boolean } = {}) {
  const invoicesCol = db.collection('turboCleanInvoices')
  const emailLogsCol = db.collection('turboCleanEmailLogs')
  const automationsCol = db.collection('turboCleanMonthlyAutomations')

  const tz = automation.timezone || 'America/New_York'
  const now = nowInTimezone(tz)

  // ── Billing month (current or previous relative to run date) ──────────────
  let year = now.year
  let month = now.month
  if (automation.billingMonth === 'previous') {
    month -= 1
    if (month === 0) {
      month = 12
      year -= 1
    }
  }
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const monthEndStr = `${monthKey}-${String(lastDay).padStart(2, '0')}`

  // ── Resolve dealer ─────────────────────────────────────────────────────────
  const possibleDealerIds: any[] = [automation.dealerId]
  try { possibleDealerIds.push(new ObjectId(automation.dealerId)) }
  catch { }
  const dealer = await db.collection('turboCleanDealers').findOne({ _id: { $in: possibleDealerIds } })
  if (!dealer)
    return { success: false, error: `Dealer not found for automation "${automation.name || automation._id}"` }

  // ── Line items & totals ────────────────────────────────────────────────────
  const lineItems = (automation.lineItems || []).map(buildLineItem)
  if (lineItems.length === 0)
    return { success: false, error: 'Automation has no line items' }

  const subtotal = Math.round(lineItems.reduce((s: number, li: any) => s + li.amount, 0) * 100) / 100
  const taxTotal = Math.round(lineItems.reduce((s: number, li: any) => s + li.tax, 0) * 100) / 100
  const total = Math.round(lineItems.reduce((s: number, li: any) => s + li.total, 0) * 100) / 100

  // ── Create or reuse the invoice for this automation + billing month ───────
  const automationId = automation._id.toString()
  let invoice = await invoicesCol.findOne({ type: 'Monthly', automationId, monthKey })

  if (!invoice) {
    const created = new Date()
    const mmdd = `${String(created.getMonth() + 1).padStart(2, '0')}${String(created.getDate()).padStart(2, '0')}`
    const monthlyCount = await invoicesCol.countDocuments({ type: 'Monthly' })
    const invNumber = `M-INV-${created.getFullYear()}-${mmdd}-${String(monthlyCount + 1).padStart(4, '0')}`

    const invoiceDoc = {
      number: invNumber,
      type: 'Monthly',
      automationId,
      automationName: automation.name || '',
      dealerId: dealer._id.toString(),
      dealerName: dealer.dealer || automation.dealerId,
      dealerEmail: dealer.email || '',
      dealerPhone: dealer.phone || '',
      dealerAddress: dealer.address || '',
      status: 'Draft',
      monthKey,
      monthLabel,
      date: monthEndStr,
      dueDate: (() => {
        const d = new Date(`${monthEndStr}T00:00:00Z`)
        d.setUTCDate(d.getUTCDate() + 30)
        return d.toISOString().split('T')[0]
      })(),
      lineItems,
      subtotal,
      taxTotal,
      total,
      paidAmount: 0,
      paymentMethod: '',
      notes: `Auto-generated by automation "${automation.name || 'Monthly Automation'}" – ${monthLabel}`,
      generatedByAutomation: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const insertRes = await invoicesCol.insertOne(invoiceDoc as any)
    invoice = { ...invoiceDoc, _id: insertRes.insertedId }
  }

  // ── Resolve recipients ─────────────────────────────────────────────────────
  let targetEmails: string[] = (automation.emails || [])
    .map((e: string) => (e || '').trim().replace(/,+$/, ''))
    .filter(Boolean)

  if (targetEmails.length === 0) {
    // Fallback: dealer contacts flagged receiveInvoices
    targetEmails = (dealer.contacts || [])
      .filter((c: any) => c.receiveInvoices && c.emails?.length > 0)
      .flatMap((c: any) => c.emails.flatMap((e: string) => typeof e === 'string' ? e.split(',') : []).map((e: string) => e.trim().replace(/,+$/, '')).filter(Boolean))
  }

  if (targetEmails.length === 0) {
    return {
      success: false,
      invoiceNumber: invoice.number,
      error: 'No recipients: automation has no emails and dealer has no receiveInvoices contacts',
    }
  }

  // ── Build email ────────────────────────────────────────────────────────────
  const invoiceData = {
    invoiceNumber: invoice.number,
    number: invoice.number,
    invoiceType: 'Monthly',
    type: 'Monthly',
    date: invoice.date,
    dueDate: invoice.dueDate,
    monthKey,
    monthLabel,
    dealerName: invoice.dealerName,
    dealerEmail: invoice.dealerEmail,
    dealerAddress: invoice.dealerAddress,
    client: invoice.dealerName,
    lineItems: (invoice.lineItems || []).map((li: any) => ({ ...li, unitPrice: li.amount ?? li.unitPrice ?? 0 })),
    subtotal: invoice.subtotal,
    taxTotal: invoice.taxTotal,
    total: invoice.total,
  }

  const invoiceHtml = generateInvoiceHtml(invoiceData)
  const emailHtml = buildEmailHtml(invoiceHtml, automation.emailBody)

  let pdfBuffer: Buffer | null = null
  try {
    pdfBuffer = await htmlToPdfBuffer(invoiceHtml, invoiceData)
  }
  catch (pdfErr: any) {
    console.error('[Monthly Automation] PDF generation failed:', pdfErr.message)
  }

  const attachments: { filename: string, content: Buffer, contentType: string }[] = []
  if (pdfBuffer)
    attachments.push({ filename: `${invoice.number}.pdf`, content: pdfBuffer, contentType: 'application/pdf' })

  const subject = (automation.emailSubject || '').trim()
    || `Monthly Invoice ${invoice.number} – ${invoice.dealerName} (${monthLabel})`

  // ── Send ───────────────────────────────────────────────────────────────────
  const resend = new Resend(process.env.RESEND_API_KEY)
  let emailsSent = 0
  let emailsFailed = 0
  const errors: any[] = []

  for (const toEmail of targetEmails) {
    try {
      const sendResult: any = await resend.emails.send({
        from: 'ZRZ Monthly <billing@zrzops.com>',
        to: toEmail,
        subject,
        html: emailHtml,
        ...(attachments.length > 0 ? { attachments } : {}),
      })

      // Resend resolves with { data, error } instead of throwing on API failures
      if (sendResult?.error) {
        throw new Error(sendResult.error.message || sendResult.error.name || 'Resend rejected the email')
      }

      await emailLogsCol.insertOne({
        dealerId: invoice.dealerId,
        invoiceId: invoice._id.toString(),
        automationId,
        email: toEmail,
        subject,
        type: 'Invoice',
        invoiceType: 'Monthly',
        attachmentCount: attachments.length,
        status: 'Sent',
        sentAt: new Date().toISOString(),
        sentByAutomation: !opts.force,
        folder: 'sent',
        from: 'billing@zrzops.com',
        to: toEmail,
        bodyHtml: emailHtml,
        receivedAt: new Date().toISOString(),
        attachments: attachments.map(att => ({ filename: att.filename })),
      })
      emailsSent++
    }
    catch (sendErr: any) {
      emailsFailed++
      errors.push({ toEmail, error: sendErr.message })
    }
  }

  // ── Bookkeeping ────────────────────────────────────────────────────────────
  if (emailsSent > 0)
    await invoicesCol.updateOne({ _id: invoice._id }, { $set: { status: 'Emailed', updatedAt: new Date().toISOString() } })

  await automationsCol.updateOne(
    { _id: automation._id },
    {
      $set: {
        lastRunKey: `${now.year}-${String(now.month).padStart(2, '0')}`,
        lastRunAt: new Date().toISOString(),
        lastInvoiceNumber: invoice.number,
        lastRunStatus: emailsSent > 0 ? 'Sent' : 'Failed',
        updatedAt: new Date().toISOString(),
      },
      $inc: { runsCount: 1 },
    },
  )

  return {
    success: emailsSent > 0,
    invoiceNumber: invoice.number,
    monthLabel,
    emailsSent,
    emailsFailed,
    recipients: targetEmails,
    errors,
  }
}
