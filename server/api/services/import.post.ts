import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async (event) => {
  try {
    const { services } = await readBody(event)
    
    if (!services || !Array.isArray(services)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid or missing services array' })
    }

    const { db } = await connectToDatabase()
    const collection = db.collection('turboCleanServices')

    // Map frontend Service payload to turboCleanServices schema
    const servicesToInsert = services.map((s: any) => ({
      service: s.service || 'Unknown Service',
      description: s.description || '',
      price: Number(s.price) || 0,
      tax: Number(s.tax) || 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))

    if (servicesToInsert.length > 0) {
      await collection.insertMany(servicesToInsert)
    }

    return {
      success: true,
      count: servicesToInsert.length
    }
  } catch (error: any) {
    console.error('Error importing services:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to import services'
    })
  }
})
