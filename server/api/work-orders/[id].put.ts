import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    if (!id) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })
    }

    let queryId: any = id;
    if (id.length === 24 && /^[0-9a-fA-F]{24}$/.test(id)) {
      queryId = new ObjectId(id);
    }

    const body = await readBody(event)

    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanWorkOrders')

    // Prepare update data
    const updateData: any = {}
    if (body.amount !== undefined) updateData.amount = Number(body.amount)
    if (body.tax !== undefined) updateData.tax = Number(body.tax)
    if (body.total !== undefined) updateData.total = Number(body.total)
    if (body.notes !== undefined) updateData.notes = body.notes
    if (body.dealerServiceId !== undefined) {
      try {
        updateData.dealerServiceId = new ObjectId(body.dealerServiceId)
      } catch {
        updateData.dealerServiceId = body.dealerServiceId
      }
    }
    if (body.upload !== undefined) updateData.upload = body.upload
    if (body.vin !== undefined) updateData.vin = body.vin
    if (body.stockNumber !== undefined) updateData.stockNumber = typeof body.stockNumber === 'string' ? body.stockNumber.toUpperCase() : body.stockNumber
    if (body.poNumber !== undefined) updateData.poNumber = body.poNumber
    if (body.date !== undefined) {
      const d = new Date(body.date)
      if (!isNaN(d.getTime())) {
        updateData.date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
      }
    }
    
    const session = await import('../../utils/auth').then(m => m.getUserSession(event))
    updateData.lastUpdatedBy = session?.id || 'Admin'
    updateData.updatedAt = new Date()

    const result = await collection.findOneAndUpdate(
      { _id: queryId },
      { $set: updateData },
      { returnDocument: 'after' }
    )

    if (!result) {
      throw createError({ statusCode: 404, statusMessage: 'Work Order not found' })
    }

    const finalDoc = result.value || result;

    // Fire-and-forget background tasks (AppSheet sync + Invoice Propagation)
    ;(async () => {
      try {
        // 1. AppSheet Sync
        const { appSheetEdit } = await import('../../utils/appsheet')
        const { WorkOrdersMapper } = await import('../../utils/sync-mapper')
        await appSheetEdit('WorkOrders', [WorkOrdersMapper.toAppSheet(finalDoc)]).catch(err => {
          console.error('[AppSheet Sync Error] Failed to sync WorkOrder update:', err)
        })

        // 2. Auto-Update Parent Invoices (daily + weekly)
        // Uses the centralized sync endpoint which fully rebuilds both daily and weekly invoices
        await $fetch('/api/invoices/sync-work-order', {
          method: 'POST',
          body: { workOrderId: id }
        }).catch((err: any) => {
          console.error('[Invoice Propagation Error]', err.message || err)
        })
      } catch (err) {
        console.error('[Background Propagation Error]:', err)
      }
    })()

    return { success: true, message: 'Work Order updated successfully' }
  } catch (error: any) {
    console.error('Error updating work order:', error)
    throw createError({
      statusCode: error.statusCode || 500,
      statusMessage: error.statusMessage || 'Failed to update work order'
    })
  }
})
