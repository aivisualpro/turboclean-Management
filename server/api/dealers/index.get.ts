import { connectToDatabase } from '../../utils/mongodb'
import { nanoid } from 'nanoid'

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanDealers')
    const docs = await collection.find({}).sort({ _id: -1 }).toArray()
    
    return docs.map(doc => ({
      id: doc._id.toString(),
      dealerName: doc.dealer || '',
      address: doc.address || '',
      contacts: [{
        id: nanoid(8),
        name: 'Primary Contact',
        designation: '',
        phones: doc.phone ? [{ id: nanoid(6), number: doc.phone, type: 'mobile' }] : [],
        emails: doc.email ? [doc.email] : [],
        preferredContactMethod: 'any'
      }],
      status: doc.status || 'Pending',
      services: doc.services || [],
      createdAt: doc.createdAt?.toISOString() || doc._id.getTimestamp().toISOString(),
      updatedAt: doc.updatedAt?.toISOString() || doc._id.getTimestamp().toISOString(),
      notes: doc.notes || ''
    }))
  } catch (error: any) {
    console.error('Error fetching dealers:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch dealers'
    })
  }
})
