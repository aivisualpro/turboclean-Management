import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')

    if (!id) {
      throw createError({ statusCode: 400, statusMessage: 'Missing dealer ID' })
    }

    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanDealers')

    let filter: any
    try {
      filter = { _id: new ObjectId(id) }
    } catch {
      filter = { _id: id }
    }

    const doc = await collection.findOne(filter)

    if (!doc) {
      throw createError({ statusCode: 404, statusMessage: 'Dealer not found' })
    }

    return {
      dealer: {
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
        services: Array.isArray(doc.services) ? [...doc.services].sort((a, b) => (a.service || '').localeCompare(b.service || '')) : [],
        createdAt: doc.createdAt?.toISOString() || doc._id.getTimestamp().toISOString(),
        updatedAt: doc.updatedAt?.toISOString() || doc._id.getTimestamp().toISOString(),
        notes: doc.notes || ''
      }
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    console.error('Error fetching dealer:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch dealer'
    })
  }
})
