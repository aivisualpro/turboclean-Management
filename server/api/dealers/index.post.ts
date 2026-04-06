import { connectToDatabase } from '../../utils/mongodb'
import { appSheetAdd } from '../../utils/appsheet'
import { getUserSession } from '../../utils/auth'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  try {
    const session = await getUserSession(event)
    const body = await readBody(event)
    
    if (!body || !body.dealerName) {
      throw createError({ statusCode: 400, statusMessage: 'Dealer name is required' })
    }

    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanDealers')

    // Ensure every service has its own NEW unique ID (essential since it's a new dealer)
    const services = Array.isArray(body.services) ? body.services.map((srv: any) => ({
      ...srv,
      id: new ObjectId().toString()
    })) : []

    const newDealer: Record<string, any> = {
      dealer: body.dealerName,
      address: body.address || '',
      contacts: body.contacts || [],
      status: body.status || 'Pending',
      isTaxApplied: body.isTaxApplied || false,
      taxPercentage: body.taxPercentage || 0,
      services: services,
      DuplicateStock: body.DuplicateStock !== undefined ? Boolean(body.DuplicateStock) : false,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: body.notes || ''
    }

    // Map primary contact phones/emails for backwards compatibility
    const primaryContact = Array.isArray(body.contacts) && body.contacts.length > 0 ? body.contacts[0] : null
    if (primaryContact) {
      if (primaryContact.phones && primaryContact.phones.length > 0) newDealer.phone = primaryContact.phones[0].number
      if (primaryContact.emails && primaryContact.emails.length > 0) newDealer.email = primaryContact.emails[0]
    }

    const result = await collection.insertOne(newDealer)
    const newId = result.insertedId.toString()

    // 1. Automatically add this dealer to the creating user's permitted list
    if (session && session.id) {
      try {
        const usersCol = db.collection('turboCleanAppUsers')
        const updateResult = await usersCol.updateOne(
          { _id: new ObjectId(session.id) },
          { $addToSet: { registerDealers: newId } }
        )
        console.log(`[DEALERS POST] Added dealer ${newId} to registerDealers for user ${session.email}. Updated: ${updateResult.modifiedCount}`)
      } catch (err) {
        console.error('[DEALERS POST] Failed to append new dealer ID to user permissions:', err)
      }
    }

    // Sync to AppSheet Dealers table
    const appSheetRow: Record<string, any> = {
      _id: newId,
      dealer: newDealer.dealer,
      address: newDealer.address,
      status: newDealer.status,
      isTaxApplied: newDealer.isTaxApplied ? 'Y' : 'N',
      taxPercentage: newDealer.taxPercentage,
      phone: newDealer.phone || '',
      email: newDealer.email || '',
      notes: newDealer.notes || '',
      DuplicateStock: newDealer.DuplicateStock ? 'Y' : 'N'
    }

    const syncPromises: Promise<any>[] = []

    syncPromises.push(
      await appSheetAdd('Dealers', [appSheetRow])
        .catch(e => console.error('[POST] AppSheet Dealers ADD failed:', e?.message))
    )

    // Sync services to AppSheet if any were copied
    if (newDealer.services && newDealer.services.length > 0) {
      const serviceRows = newDealer.services.map((srv: any) => ({
        _id: srv.id || srv._id || '',
        dealer: newId,
        service: srv.service || '',
        Amount: Number(srv.amount) || 0,
        Tax: Number(srv.tax) || 0,
        Total: Number(srv.total) || 0,
      })).filter((r: any) => r._id)

      if (serviceRows.length > 0) {
        syncPromises.push(
          await appSheetAdd('DealerServices', serviceRows)
            .catch(e => console.error('[POST] AppSheet DealerServices ADD failed:', e?.message))
        )
      }
    }

    if (syncPromises.length > 0) await Promise.allSettled(syncPromises)

    return {
      success: true,
      id: newId
    }

  } catch (error: any) {
    console.error('Error adding dealer:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to add dealer'
    })
  }
})
