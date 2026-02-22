import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { db } = await connectToDatabase()
    
    const doc = {
      name: body.name || '',
      email: body.email || '',
      phone: body.phone || '',
      address: body.address || '',
      role: body.role || 'User',
      status: body.status || 'Active',
      password: body.password || '',
      createdAt: new Date(),
      updatedAt: new Date()
    }
    
    const result = await db.collection('turboCleanAppUsers').insertOne(doc)
    return { success: true, id: result.insertedId.toString() }
  } catch (error: any) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
