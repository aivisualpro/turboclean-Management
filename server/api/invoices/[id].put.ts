import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  const id = event.context.params?.id
  const body = await readBody(event)
  
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing invoice id' })

  const { db } = await connectToDatabase()
  const collection = db.collection('turboCleanInvoices')

  const updateDoc = { ...body, updatedAt: new Date().toISOString() }
  delete updateDoc._id
  delete updateDoc.id
  
  let result
  try {
    const objectId = new ObjectId(id)
    result = await collection.updateOne({ _id: objectId }, { $set: updateDoc })
  } catch (e) {
    result = await collection.updateOne({ _id: id as any }, { $set: updateDoc })
  }

  return { success: true, matchedCount: result.matchedCount }
})
