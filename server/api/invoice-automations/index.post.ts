import { ObjectId } from 'mongodb'
import { connectToDatabase } from '../../utils/mongodb'
import { AUTOMATIONS_COLLECTION, WEEKDAY_NAMES } from '../../utils/invoice-automation'

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const body = await readBody(event) || {}
    const { id } = body

    const frequency = body.frequency === 'weekly' ? 'weekly' : 'daily'
    const dealerScope = body.dealerScope === 'selected' ? 'selected' : 'all'

    // ── Validate & resolve dealer scope ──
    let dealerIds: string[] = []
    let dealerNames: string[] = []
    if (dealerScope === 'selected') {
      dealerIds = (Array.isArray(body.dealerIds) ? body.dealerIds : []).map(String).filter(Boolean)
      if (dealerIds.length === 0) {
        return { success: false, message: 'Select at least one dealer (or switch scope to All dealers)' }
      }
      const variants: any[] = []
      for (const did of dealerIds) {
        variants.push(did)
        try { variants.push(new ObjectId(did)) } catch {}
      }
      const dealers = await db.collection('turboCleanDealers')
        .find({ _id: { $in: variants } })
        .project({ dealer: 1 })
        .toArray()
      const nameById = new Map(dealers.map((d: any) => [d._id.toString(), d.dealer || '']))
      dealerIds = dealerIds.filter(did => nameById.has(did))
      dealerNames = dealerIds.map(did => nameById.get(did) || '')
      if (dealerIds.length === 0) {
        return { success: false, message: 'None of the selected dealers were found' }
      }
    }

    const time = TIME_RE.test(body.time || '') ? body.time : '07:00'
    const weekday = WEEKDAY_NAMES.includes(body.weekday) ? body.weekday : 'Monday'
    const runDays = (Array.isArray(body.runDays) ? body.runDays : []).filter((d: string) => WEEKDAY_NAMES.includes(d))

    // An invalid IANA timezone would crash every schedule computation — reject it here
    let timezone = body.timezone || 'America/New_York'
    try {
      // eslint-disable-next-line no-new
      new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    } catch {
      return { success: false, message: `"${timezone}" is not a valid timezone` }
    }

    if (frequency === 'daily' && runDays.length === 0) {
      return { success: false, message: 'Pick at least one run day for a daily automation' }
    }

    const doc = {
      name: (body.name || '').trim()
        || (frequency === 'weekly' ? 'Weekly invoice automation' : 'Daily invoice automation'),
      frequency,
      enabled: body.enabled !== false,
      dealerScope,
      dealerIds,
      dealerNames,
      runDays: frequency === 'daily' ? runDays : [],
      weekday,
      time,
      timezone,
      billingDay: body.billingDay === 'same' ? 'same' : 'previous',
      autoSend: body.autoSend !== false,
      useDealerContacts: body.useDealerContacts !== false,
      emails: Array.isArray(body.emails)
        ? body.emails.map((e: string) => (e || '').trim().replace(/,+$/, '')).filter(Boolean)
        : [],
      emailSubject: (body.emailSubject || '').trim(),
      emailBody: body.emailBody || '',
      endDate: body.endDate || '',
      disabledReason: '',
      updatedAt: new Date().toISOString(),
    }

    // Delivery sanity: auto-send with no possible recipients is a footgun
    if (doc.autoSend && !doc.useDealerContacts && doc.emails.length === 0) {
      return { success: false, message: 'Auto-send is on but there are no recipients — enable dealer contacts or add emails' }
    }

    const collection = db.collection(AUTOMATIONS_COLLECTION)

    // ── Double-billing guard: warn when a daily and a weekly auto-send
    //    automation cover the same dealers (the weekly rollup re-bills the
    //    same work orders the daily already emailed). ──
    let warning = ''
    if (doc.autoSend) {
      const otherFrequency = frequency === 'daily' ? 'weekly' : 'daily'
      const others = await collection.find({
        frequency: otherFrequency,
        enabled: true,
        autoSend: true,
        ...(id ? { _id: { $ne: (() => { try { return new ObjectId(id) } catch { return id } })() } } : {}),
      }).project({ name: 1, dealerScope: 1, dealerIds: 1 }).toArray()

      const overlapping = others.find((o: any) => {
        if (doc.dealerScope === 'all' || o.dealerScope !== 'selected') return true
        const mine = new Set(doc.dealerIds)
        return (o.dealerIds || []).some((did: string) => mine.has(did))
      })
      if (overlapping) {
        warning = `Heads up: "${overlapping.name}" (${otherFrequency}) covers some of the same dealers — they would receive the same work on both a daily and a weekly invoice. Consider splitting the dealer scopes.`
      }
    }

    if (id) {
      let objectId: any = id
      try { objectId = new ObjectId(id) } catch {}
      const result = await collection.updateOne({ _id: objectId }, { $set: doc })
      if (result.matchedCount === 0) {
        return { success: false, message: 'Automation not found' }
      }
      return { success: true, message: `Automation "${doc.name}" updated.`, id, warning }
    }

    const insertRes = await collection.insertOne({
      ...doc,
      lastRunKey: '',
      lastRunAt: '',
      lastRunStatus: '',
      lastRunSummary: '',
      runsCount: 0,
      createdAt: new Date().toISOString(),
    } as any)

    return { success: true, message: `Automation "${doc.name}" created.`, id: insertRes.insertedId.toString(), warning }
  }
  catch (error: any) {
    console.error('Error saving invoice automation:', error)
    throw createError({ statusCode: 500, statusMessage: error.message || 'Failed to save automation' })
  }
})
