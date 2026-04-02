import { connectToDatabase } from '../../utils/mongodb'
import { nanoid } from 'nanoid'
import { getUserSession } from '../../utils/auth'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  try {
    const session = await getUserSession(event)
    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanDealers')

    let query: any = {}
    if (session && session.registerDealers && session.registerDealers.length > 0) {
      const allowedIds = session.registerDealers.reduce((acc: any[], id: string) => {
        try { acc.push(new ObjectId(id)); return acc } catch { return acc }
      }, [])
      
      if (allowedIds.length === 0) return []
      query = { _id: { $in: allowedIds } }
    } else if (session && session.role !== 'Admin' && (!session.registerDealers || session.registerDealers.length === 0)) {
      return []
    }

    const docs = await collection.find(query).sort({ dealer: 1 }).toArray()
    
    return docs.map(doc => ({
      id: doc._id.toString(),
      dealerName: doc.dealer || '',
      address: doc.address || '',
      contacts: Array.isArray(doc.contacts) && doc.contacts.length > 0 ? doc.contacts : [{
        id: nanoid(8),
        name: 'Primary Contact',
        designation: '',
        phones: doc.phone ? [{ id: nanoid(6), number: doc.phone, type: 'mobile' }] : [],
        emails: doc.email ? [doc.email] : [],
        preferredContactMethod: 'any'
      }],
      status: doc.status || 'Pending',
      isTaxApplied: doc.isTaxApplied === true || doc.isTaxApplied === 'Y' || doc.isTaxApplied === 'true',
      taxPercentage: Number(doc.taxPercentage) || 0,
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
