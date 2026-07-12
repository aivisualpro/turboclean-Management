import { ObjectId } from 'mongodb'
import { connectToDatabase } from '../../utils/mongodb'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Builds a clean line item from user-provided custom data
function buildCustomLineItem(li: any) {
  const amount = Math.round((Number(li.amount) || 0) * 100) / 100
  const tax = Math.round((Number(li.tax) || 0) * 100) / 100
  return {
    date: (li.date || '').split('T')[0],
    stockNumber: li.stockNumber || '',
    poNumber: li.poNumber || '',
    vin: li.vin || '',
    serviceName: li.serviceName || li.description || '',
    description: li.description || li.serviceName || '',
    amount,
    tax,
    total: Math.round((amount + tax) * 100) / 100,
    notes: li.notes || '',
    isCustom: true,
  }
}

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const body = await readBody(event) || {}
    const { id, dealerId, monthKey, notes } = body
    const rawLineItems: any[] = Array.isArray(body.lineItems) ? body.lineItems : []

    if (!dealerId)
      return { success: false, message: 'Dealer is required' }
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey))
      return { success: false, message: 'Billing month is required (YYYY-MM)' }
    if (rawLineItems.length === 0)
      return { success: false, message: 'At least one line item is required' }

    // ── Resolve dealer ────────────────────────────────────────────────────
    const possibleDealerIds: any[] = [dealerId]
    try { possibleDealerIds.push(new ObjectId(dealerId)) }
    catch { }
    const dealer = await db.collection('turboCleanDealers').findOne({ _id: { $in: possibleDealerIds } })
    if (!dealer)
      return { success: false, message: 'Dealer not found' }

    // ── Month metadata ────────────────────────────────────────────────────
    const [yearStr, monthStr] = monthKey.split('-')
    const year = Number(yearStr)
    const month = Number(monthStr) // 1-12
    const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const monthEndStr = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`

    // ── Line items & totals ───────────────────────────────────────────────
    const lineItems = rawLineItems.map(buildCustomLineItem)
    lineItems.sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    const subtotal = lineItems.reduce((s, li) => s + li.amount, 0)
    const taxTotal = lineItems.reduce((s, li) => s + li.tax, 0)
    const total = lineItems.reduce((s, li) => s + li.total, 0)

    const invoicesCollection = db.collection('turboCleanInvoices')

    // ── Update existing invoice ───────────────────────────────────────────
    if (id) {
      let objectId: any = id
      try { objectId = new ObjectId(id) }
      catch { }
      const existing = await invoicesCollection.findOne({ _id: objectId })
      if (!existing)
        return { success: false, message: 'Invoice not found' }
      if (existing.type !== 'Monthly')
        return { success: false, message: 'Only Monthly invoices can be edited here' }

      await invoicesCollection.updateOne({ _id: objectId }, {
        $set: {
          dealerId: dealer._id.toString(),
          dealerName: dealer.dealer || dealerId,
          dealerEmail: dealer.email || '',
          dealerPhone: dealer.phone || '',
          dealerAddress: dealer.address || '',
          monthKey,
          monthLabel,
          date: monthEndStr,
          lineItems,
          subtotal: Math.round(subtotal * 100) / 100,
          taxTotal: Math.round(taxTotal * 100) / 100,
          total: Math.round(total * 100) / 100,
          notes: notes || existing.notes || '',
          updatedAt: new Date().toISOString(),
        },
      })
      return { success: true, message: `Monthly invoice ${existing.number} updated.`, number: existing.number }
    }

    // ── Create new invoice ────────────────────────────────────────────────
    // Number format: M-INV-YYYY-MMDD-#### (MMDD = creation date)
    const now = new Date()
    const createdYear = now.getFullYear()
    const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const monthlyCount = await invoicesCollection.countDocuments({ type: 'Monthly' })
    const invNumber = `M-INV-${createdYear}-${mmdd}-${String(monthlyCount + 1).padStart(4, '0')}`

    const invoiceDoc = {
      number: invNumber,
      type: 'Monthly',
      dealerId: dealer._id.toString(),
      dealerName: dealer.dealer || dealerId,
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
      subtotal: Math.round(subtotal * 100) / 100,
      taxTotal: Math.round(taxTotal * 100) / 100,
      total: Math.round(total * 100) / 100,
      paidAmount: 0,
      paymentMethod: '',
      notes: notes || `Monthly Invoice for ${dealer.dealer || dealerId} – ${monthLabel}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await invoicesCollection.insertOne(invoiceDoc as any)
    return { success: true, message: `Monthly invoice ${invNumber} created for ${monthLabel}.`, number: invNumber }
  }
  catch (error: any) {
    console.error('Error creating monthly invoice:', error)
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to create monthly invoice' })
  }
})
