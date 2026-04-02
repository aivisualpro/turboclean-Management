import { connectToDatabase } from '../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async () => {
  const { db } = await connectToDatabase()
  const woCollection = db.collection('turboCleanWorkOrders')
  const invCollection = db.collection('turboCleanInvoices')

  // 1. Map all work orders' correct dates
  // They should all be at UTC midnight now, so d.toISOString().split('T')[0] should be perfect.
  const allWOs = await woCollection.find({}).toArray()
  const woMap = new Map<string, string>()
  allWOs.forEach(wo => {
    if (wo.date instanceof Date) {
      woMap.set(wo._id.toString(), wo.date.toISOString().split('T')[0])
    }
  })

  // 2. Map all invoices to find ones that need a fix
  const allInvoices = await invCollection.find({}).toArray()
  const invOps: any[] = []

  for (const inv of allInvoices) {
    let changed = false
    const lineItems = (inv.lineItems || []).map((li: any) => {
       const wId = li.workOrderId?.toString()
       const intendedDate = woMap.get(wId)
       
       if (intendedDate && li.date !== intendedDate) {
         changed = true
         return { ...li, date: intendedDate }
       }
       return li
    })

    if (changed) {
       // Snap invoice date if Daily
       let newInvDate = inv.date
       if (inv.type === 'Daily' && lineItems.length > 0) {
         newInvDate = lineItems[0].date
       }
       
       // Snap dueDate if date changed
       let newDueDate = inv.dueDate
       if (newInvDate !== inv.date) {
          const d = new Date(newInvDate + 'T00:00:00Z')
          d.setUTCDate(d.getUTCDate() + (inv.type === 'Daily' ? 15 : 30))
          newDueDate = d.toISOString().split('T')[0]
       }

       invOps.push({
         updateOne: {
           filter: { _id: inv._id },
           update: { $set: { 
             lineItems, 
             date: newInvDate, 
             dueDate: newDueDate,
             notes: (inv.notes || '').replace(inv.date, newInvDate) // Fix notes if they have the date
           } }
         }
       })
    }
  }

  if (invOps.length > 0) {
    await invCollection.bulkWrite(invOps)
  }

  return {
    success: true,
    invoicesUpdated: invOps.length,
    message: `Updated ${invOps.length} invoices to match their source work order dates.`
  }
})
