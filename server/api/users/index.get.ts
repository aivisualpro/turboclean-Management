import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    const users = await db.collection('turboCleanAppUsers').find({}).sort({ createdAt: -1 }).toArray()
    return users.map(u => ({
      id: u._id.toString(),
      name: u.name || '',
      email: u.email || '',
      phone: u.phone || '',
      address: u.address || '',
      registerDealers: Array.isArray(u.registerDealers) ? u.registerDealers : [],
      role: u.role || 'User',
      status: u.status || 'Active',
      password: u.password || '', // Usually shouldn't send back to client, but doing it for simplicity based on the prompt
      createdAt: u.createdAt,
    }))
  } catch (error: any) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
