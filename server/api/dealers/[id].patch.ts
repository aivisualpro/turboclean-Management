import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { syncToAppSheet, combineSyncOutcomes } from '../../utils/appsheet-sync'
import type { SyncOutcome } from '../../utils/appsheet-sync'
import { DealersMapper } from '../../utils/sync-mapper'

/** Map an embedded dealer-service entry to an AppSheet DealerServices row */
function toDealerServiceRow(dealerId: string, srv: any) {
  return {
    _id: String(srv.id || srv._id || ''),
    dealer: dealerId,
    service: srv.service || '',
    Amount: Number(srv.amount) || 0,
    Tax: Number(srv.tax) || 0,
    Total: Number(srv.total) || 0,
  }
}

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    const body = await readBody(event)

    if (!id || id.length !== 24) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid dealer ID' })
    }
    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanDealers')
    console.log(`[PATCH] Dealer ${id} - Body:`, JSON.stringify(body).slice(0, 600))

    let filter: any
    try {
      filter = { _id: new ObjectId(id) }
    } catch {
      filter = { _id: id }
    }

    const updateDoc: Record<string, any> = {
      updatedAt: new Date(),
      lastUpdatedBy: 'web-ui'
    }

    // Only set fields that are explicitly provided
    if (body.isTaxApplied !== undefined) updateDoc.isTaxApplied = Boolean(body.isTaxApplied)
    if (body.taxPercentage !== undefined) updateDoc.taxPercentage = Number(body.taxPercentage)
    if (body.DuplicateStock !== undefined) updateDoc.DuplicateStock = Boolean(body.DuplicateStock)
    if (body.dealer !== undefined) updateDoc.dealer = body.dealer
    if (body.phone !== undefined) updateDoc.phone = body.phone
    if (body.email !== undefined) updateDoc.email = body.email
    if (body.address !== undefined) updateDoc.address = body.address
    if (body.notes !== undefined) updateDoc.notes = body.notes
    if (body.status !== undefined) updateDoc.status = body.status
    if (body.contacts !== undefined) updateDoc.contacts = body.contacts

    // Full services-array replace — only used by import/copy flows now.
    // Single edits go through body.updatedService below (see comment there).
    if (body.services !== undefined && !body.deletedServiceId && !body.updatedService) {
      updateDoc.services = Array.isArray(body.services) ? body.services.map((srv: any) => ({
        ...srv,
        id: srv.id || srv._id || new ObjectId().toString()
      })) : []
    }

    // Snapshot existing service IDs BEFORE the update so we can diff new vs existing
    let existingServiceIds = new Set<string>()
    if (updateDoc.services !== undefined) {
      const existing = await collection.findOne(filter, { projection: { services: 1 } })
      existingServiceIds = new Set((existing?.services || []).map((s: any) => s.id || s._id || '').filter(Boolean))
    }

    // ── Targeted single-service upsert (rate edits, tax toggles, adding one service) ──
    // The UI used to send the ENTIRE services array for a one-row change. If the
    // browser's copy was stale (e.g. AppSheet had added a service meanwhile), the
    // $set wiped that service from MongoDB and the diff below even deleted it from
    // AppSheet. Updating exactly one row makes that impossible.
    let updatedServiceEntry: Record<string, any> | null = null
    if (body.updatedService && typeof body.updatedService === 'object') {
      const raw = body.updatedService
      updatedServiceEntry = {
        id: String(raw.id || raw._id || new ObjectId().toString()),
        service: raw.service || '',
        serviceName: raw.serviceName || '',
        amount: Number(raw.amount) || 0,
        tax: Number(raw.tax) || 0,
        total: Number(raw.total) || 0,
      }

      // Row-scoped stamp so the webhook can tell a genuine AppSheet edit to
      // ANOTHER service on this dealer apart from an echo of this exact row.
      updateDoc.lastWebServiceWrite = { id: updatedServiceEntry.id, at: new Date() }

      const positional = await collection.updateOne(
        { ...filter, 'services.id': updatedServiceEntry.id },
        { $set: { 'services.$': updatedServiceEntry } }
      )
      if (positional.matchedCount === 0) {
        // Not there yet → append it
        const pushResult = await collection.updateOne(
          filter,
          { $push: { services: updatedServiceEntry } } as any
        )
        if (pushResult.matchedCount === 0) {
          throw createError({ statusCode: 404, statusMessage: 'Dealer not found' })
        }
        console.log(`[PATCH] Appended new service ${updatedServiceEntry.id} to dealer ${id}`)
      } else {
        console.log(`[PATCH] Updated service ${updatedServiceEntry.id} in place for dealer ${id}`)
      }
    }

    if (body.deletedServiceId) {
      const pullResult = await collection.updateOne(
        filter,
        { $pull: { services: { id: body.deletedServiceId } } } as any
      )
      console.log(`[PATCH] Targeted delete of service ${body.deletedServiceId}: matched=${pullResult.matchedCount}, modified=${pullResult.modifiedCount}`)
    }

    const result = await collection.updateOne(
      filter,
      { $set: updateDoc }
    )
    console.log(`[PATCH] updateOne result: matched=${result.matchedCount}, modified=${result.modifiedCount}`)

    // Verify the write
    const verified = await collection.findOne(filter)

    // ── Sync to AppSheet (outbox-backed: every push is retried automatically
    //    in the background if AppSheet is unreachable — see appsheet-sync.ts) ──
    const syncJobs: Promise<SyncOutcome>[] = []

    // Dealer-level fields → Edit ONLY the changed columns (so columns Mongo
    // doesn't track are never clobbered in AppSheet), but supply the full row
    // for the Add fallback in case the dealer row is missing in AppSheet.
    const dealerRow: Record<string, any> = { _id: id }
    if (updateDoc.dealer !== undefined) dealerRow.dealer = updateDoc.dealer
    if (updateDoc.phone !== undefined) dealerRow.phone = updateDoc.phone
    if (updateDoc.email !== undefined) dealerRow.email = updateDoc.email
    if (updateDoc.address !== undefined) dealerRow.address = updateDoc.address
    if (updateDoc.notes !== undefined) dealerRow.notes = updateDoc.notes
    if (updateDoc.status !== undefined) dealerRow.status = updateDoc.status
    if (updateDoc.isTaxApplied !== undefined) dealerRow.isTaxApplied = updateDoc.isTaxApplied ? 'Y' : 'N'
    if (updateDoc.taxPercentage !== undefined) dealerRow.taxPercentage = updateDoc.taxPercentage
    if (updateDoc.DuplicateStock !== undefined) dealerRow.DuplicateStock = updateDoc.DuplicateStock ? 'Y' : 'N'

    if (verified && Object.keys(dealerRow).length > 1) {
      syncJobs.push(syncToAppSheet(db, 'Dealers', 'Upsert', [dealerRow], {
        addRows: [DealersMapper.toAppSheet(verified)],
      }))
    }

    // ── Sync service rows to the AppSheet DealerServices table ──
    if (updatedServiceEntry) {
      syncJobs.push(syncToAppSheet(db, 'DealerServices', 'Upsert', [toDealerServiceRow(id, updatedServiceEntry)]))
    }

    if (body.deletedServiceId) {
      syncJobs.push(syncToAppSheet(db, 'DealerServices', 'Delete', [{ _id: body.deletedServiceId }]))
    }

    if (updateDoc.services !== undefined && Array.isArray(updateDoc.services)) {
      const allRows = (updateDoc.services as any[])
        .map((srv: any) => toDealerServiceRow(id, srv))
        .filter(r => r._id)

      const currentServiceIds = new Set(allRows.map(r => r._id))
      const deletedRows = Array.from(existingServiceIds)
        .filter(sid => !currentServiceIds.has(sid))
        .map(sid => ({ _id: sid }))

      if (allRows.length > 0) {
        console.log(`[PATCH] Upserting ${allRows.length} service rows to AppSheet DealerServices`)
        syncJobs.push(syncToAppSheet(db, 'DealerServices', 'Upsert', allRows))
      }
      if (deletedRows.length > 0) {
        console.log(`[PATCH] Deleting ${deletedRows.length} removed service rows from AppSheet DealerServices`)
        syncJobs.push(syncToAppSheet(db, 'DealerServices', 'Delete', deletedRows))
      }
    }

    const appSheet = combineSyncOutcomes(await Promise.all(syncJobs))

    return {
      success: true,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      isTaxApplied: verified?.isTaxApplied,
      taxPercentage: verified?.taxPercentage,
      services: verified?.services,
      appSheet,
    }
  } catch (error: any) {
    if (error?.statusCode) throw error
    console.error('[PATCH] ERROR:', error.message)
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
