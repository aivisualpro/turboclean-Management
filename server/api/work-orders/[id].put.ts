import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    if (!id || !ObjectId.isValid(id)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })
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
    if (body.dealerServiceId !== undefined) updateData.dealerServiceId = body.dealerServiceId
    if (body.upload !== undefined) updateData.upload = body.upload
    if (body.vin !== undefined) updateData.vin = body.vin
    if (body.stockNumber !== undefined) updateData.stockNumber = body.stockNumber
    if (body.poNumber !== undefined) updateData.poNumber = body.poNumber
    if (body.date !== undefined) updateData.date = new Date(body.date)
    
    updateData.lastUpdatedBy = 'Admin' // or extract from session if available
    updateData.updatedAt = new Date()

    const result = await collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateData },
      { returnDocument: 'after' }
    )

    if (!result) {
      throw createError({ statusCode: 404, statusMessage: 'Work Order not found' })
    }

    // Fire-and-forget background tasks (AppSheet sync + Invoice Propagation)
    ;(async () => {
      try {
        // 1. AppSheet Sync
        const { appSheetEdit } = await import('../../utils/appsheet')
        const { WorkOrdersMapper } = await import('../../utils/sync-mapper')
        appSheetEdit('WorkOrders', [WorkOrdersMapper.toAppSheet(result)]).catch(err => {
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
              const svcName = result.dealerServiceId || li.serviceName
              return {
                ...li,
                amount: Number(result.amount) || 0,
                tax: Number(result.tax) || 0,
                total: Number(result.total) || 0,
                stockNumber: result.stockNumber || '',
                poNumber: result.poNumber || '',
                vin: result.vin || '',
                serviceName: svcName,
                description: `${svcName} – Stock# ${result.stockNumber || 'N/A'} (PO#: ${result.poNumber || 'N/A'}) (VIN: ${result.vin || 'N/A'})`
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
