import { connectToDatabase } from '../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async () => {
  const { db } = await connectToDatabase()
  const woCollection = db.collection('turboCleanWorkOrders')
  const invCollection = db.collection('turboCleanInvoices')

  // Find a work order that was likely shifted (I already fixed them to 00:00:00Z)
  // Let's find one that is CURRENTLY at T00:00:00Z but has an ID that starts with 69cd (from my previous sample)
  const wo = await woCollection.findOne({
      _id: new ObjectId("69cd8c2008e4ef02c76bb00c")
  })
  
  const inv = await invCollection.findOne({
      "lineItems.workOrderId": "69cd8c2008e4ef02c76bb00c"
  })

  return {
    wo: wo ? { id: wo._id, date: wo.date } : 'None',
    inv: inv ? { id: inv._id, date: inv.date, lineItem: (inv.lineItems || []).find(l => l.workOrderId === "69cd8c2008e4ef02c76bb00c") } : 'None'
  }
})
