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

        // 2. Auto-Update Parent Invoices
        // If this work order is linked to any daily or weekly invoice, propagate the changes directly.
        const invoicesCollection = db.collection('turboCleanInvoices')
        const relatedInvoices = await invoicesCollection.find({ 'lineItems.workOrderId': id }).toArray()

        for (const inv of relatedInvoices) {
          let updatedLineItems = false
          const nextLineItems = inv.lineItems.map((li: any) => {
            if (li.workOrderId === id) {
              updatedLineItems = true
              const svcName = finalDoc.dealerServiceId || li.serviceName
              return {
                ...li,
                amount: Number(finalDoc.amount) || 0,
                tax: Number(finalDoc.tax) || 0,
                total: Number(finalDoc.total) || 0,
                stockNumber: finalDoc.stockNumber || '',
                poNumber: finalDoc.poNumber || '',
                vin: finalDoc.vin || '',
                serviceName: svcName,
                description: `${svcName} – Stock# ${finalDoc.stockNumber || 'N/A'} (PO#: ${finalDoc.poNumber || 'N/A'}) (VIN: ${finalDoc.vin || 'N/A'})`
              }
            }
            return li
          })

          if (updatedLineItems) {
            const subtotal = nextLineItems.reduce((s: number, li: any) => s + (li.amount || 0), 0)
            const taxTotal = nextLineItems.reduce((s: number, li: any) => s + (li.tax || 0), 0)
            const total = nextLineItems.reduce((s: number, li: any) => s + (li.total || 0), 0)
            
            await invoicesCollection.updateOne(
              { _id: inv._id },
              { $set: { lineItems: nextLineItems, subtotal, taxTotal, total } }
            )
          }
        }
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
