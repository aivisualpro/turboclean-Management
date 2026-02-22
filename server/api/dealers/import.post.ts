import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async (event) => {
  try {
    const { dealers } = await readBody(event)
    
    if (!dealers || !Array.isArray(dealers)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid or missing dealers array' })
    }

    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanDealers')

    // Map frontend Dealer payload to turboCleanDealers schema
    const dealersToInsert = dealers.map((d: any) => ({
      dealer: d.dealerName || '',
      phone: d.contacts?.[0]?.phones?.[0]?.number || '',
      email: d.contacts?.[0]?.emails?.[0] || '',
      address: d.address || '',
      notes: d.notes || '', // Map notes if exists, otherwise empty
      status: d.status || 'Pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    }))

    if (dealersToInsert.length > 0) {
      await collection.insertMany(dealersToInsert)
    }

    return {
      success: true,
      count: dealersToInsert.length
    }
  } catch (error: any) {
    console.error('Error importing dealers:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to import dealers'
    })
  }
})
