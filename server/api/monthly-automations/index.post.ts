import { ObjectId } from 'mongodb'
import { connectToDatabase } from '../../utils/mongodb'

function cleanLineItem(li: any) {
  const amount = Math.round((Number(li.amount) || 0) * 100) / 100
  const tax = Math.round((Number(li.tax) || 0) * 100) / 100
  return {
    serviceName: (li.serviceName || li.description || '').trim(),
    amount,
    tax,
    total: Math.round((amount + tax) * 100) / 100,
  }
}

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const body = await readBody(event) || {}
    const { id } = body

    if (!body.dealerId)
      return { success: false, message: 'Dealer is required' }

    const rawLineItems: any[] = Array.isArray(body.lineItems) ? body.lineItems : []
    const lineItems = rawLineItems.map(cleanLineItem).filter(li => li.serviceName || li.amount > 0)
    if (lineItems.length === 0)
      return { success: false, message: 'At least one line item is required' }

    // Resolve dealer for a denormalized name
    const possibleDealerIds: any[] = [body.dealerId]
    try { possibleDealerIds.push(new ObjectId(body.dealerId)) }
    catch { }
    const dealer = await db.collection('turboCleanDealers').findOne({ _id: { $in: possibleDealerIds } })
    if (!dealer)
      return { success: false, message: 'Dealer not found' }

    const doc = {
      name: (body.name || '').trim() || `${dealer.dealer || 'Dealer'} – Monthly`,
      dealerId: dealer._id.toString(),
      dealerName: dealer.dealer || body.dealerId,
      enabled: body.enabled !== false,
      lineItems,
      scheduleType: body.scheduleType === 'nth_weekday' ? 'nth_weekday' : 'day_of_month',
      dayOfMonth: body.dayOfMonth === 'last' ? 'last' : (Number(body.dayOfMonth) || 1),
      nth: body.nth || 'First',
      weekday: body.weekday || 'Monday',
      time: body.time || '09:00',
      timezone: body.timezone || 'America/New_York',
      billingMonth: body.billingMonth === 'previous' ? 'previous' : 'current',
      endDate: body.endDate || '',
      emails: Array.isArray(body.emails) ? body.emails.map((e: string) => (e || '').trim()).filter(Boolean) : [],
      emailSubject: (body.emailSubject || '').trim(),
      emailBody: body.emailBody || '',
      updatedAt: new Date().toISOString(),
    }

    const collection = db.collection('turboCleanMonthlyAutomations')

    if (id) {
      let objectId: any = id
      try { objectId = new ObjectId(id) }
      catch { }
      const result = await collection.updateOne({ _id: objectId }, { $set: doc })
      if (result.matchedCount === 0)
        return { success: false, message: 'Automation not found' }
      return { success: true, message: `Automation "${doc.name}" updated.`, id }
    }

    const insertRes = await collection.insertOne({
      ...doc,
      lastRunKey: '',
      lastRunAt: '',
      lastInvoiceNumber: '',
      lastRunStatus: '',
      runsCount: 0,
      createdAt: new Date().toISOString(),
    } as any)

    return { success: true, message: `Automation "${doc.name}" created.`, id: insertRes.insertedId.toString() }
  }
  catch (error: any) {
    console.error('Error saving monthly automation:', error)
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to save automation' })
  }
})
