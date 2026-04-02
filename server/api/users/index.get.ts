import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async (event) => {
  try {
    const { db } = await connectToDatabase()
    
    // Fetch users AND workspaces for resolution
    const [users, workspaces] = await Promise.all([
      db.collection('turboCleanAppUsers').find({}).sort({ createdAt: -1 }).toArray(),
      db.collection('turboCleanWorkspaces').find({}).toArray()
    ])
    
    const wsMap = new Map()
    for (const w of workspaces) {
      wsMap.set(w._id.toString(), w.name || '')
    }

    return users.map(u => ({
      id: u._id.toString(),
      name: u.name || '',
      email: u.email || '',
      phone: u.phone || '',
      address: u.address || '',
      password: u.password || '',
      registerDealers: Array.isArray(u.registerDealers) ? u.registerDealers : [],
      role: u.role || 'User',
      status: u.status || 'Active',
      workspaceId: u.workspaceId || '',
      workspaceName: wsMap.get(u.workspaceId?.toString()) || 'None',
      createdAt: u.createdAt,
    }))
  } catch (error: any) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
