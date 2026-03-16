import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanServices')
    const docs = await collection.find({}).sort({ _id: -1 }).toArray()
    
    return docs.map(doc => ({
      id: doc._id.toString(),
      service: doc.service || '',
      description: doc.description || '',
      createdAt: doc.createdAt?.toISOString() || doc._id.getTimestamp().toISOString(),
      updatedAt: doc.updatedAt?.toISOString() || doc._id.getTimestamp().toISOString()
    }))
  } catch (error: any) {
    console.error('Error fetching services:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch services'
    })
  }
})
