import { ObjectId } from 'mongodb'
import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async (event) => {
  const id = event.context.params?.id
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'Missing invoice id' })

  const { db } = await connectToDatabase()
  const collection = db.collection('turboCleanInvoices')

  let objectId: any = id
  try { objectId = new ObjectId(id) }
  catch { }

  const invoice = await collection.findOne({ _id: objectId })
  if (!invoice)
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })

  // Safety: only custom Monthly invoices can be deleted (Daily/Weekly are system-generated)
  if (invoice.type !== 'Monthly') {
    throw createError({ statusCode: 403, statusMessage: 'Only Monthly invoices can be deleted' })
  }

  await collection.deleteOne({ _id: objectId })
  return { success: true, message: `Invoice ${invoice.number} deleted.` }
})
