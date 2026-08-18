import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async () => {
  try {
    const { db } = await connectToDatabase()

    // Fetch users AND workspaces for resolution
    const [users, workspaces] = await Promise.all([
      db.collection('turboCleanAppUsers').find({}).sort({ name: 1 }).toArray(),
      db.collection('turboCleanWorkspaces').find({}).toArray()
    ])

    const wsMap = new Map()
    for (const w of workspaces) {
      wsMap.set(w._id.toString(), w.name || '')
    }

    // ── Resolve dealer names for registerDealers so the UI never shows raw IDs ──
    const allDealerIds = new Set<string>()
    for (const u of users) {
      if (Array.isArray(u.registerDealers)) {
        for (const rid of u.registerDealers) {
          if (rid) allDealerIds.add(String(rid))
        }
      }
    }

    const dealerNameMap = new Map<string, string>()
    if (allDealerIds.size > 0) {
      const objectIds = Array.from(allDealerIds)
        .filter(rid => ObjectId.isValid(rid))
        .map(rid => new ObjectId(rid))
      if (objectIds.length > 0) {
        const dealerDocs = await db
          .collection('turboCleanDealers')
          .find({ _id: { $in: objectIds } }, { projection: { dealer: 1 } })
          .toArray()
        for (const d of dealerDocs) {
          dealerNameMap.set(d._id.toString(), d.dealer || '')
        }
      }
    }

    return users.map(u => {
      const registerDealers = Array.isArray(u.registerDealers) ? u.registerDealers.map(String) : []
      return {
        id: u._id.toString(),
        name: u.name || '',
        email: u.email || '',
        phone: u.phone || '',
        address: u.address || '',
        password: u.password || '',
        registerDealers,
        // id → resolved dealer name. Non-ObjectId values were stored as names
        // by AppSheet-created users, so they ARE the display name already.
        // null = a real id whose dealer no longer exists.
        registerDealersInfo: registerDealers.map(rid => ({
          id: rid,
          name: dealerNameMap.get(rid) || (ObjectId.isValid(rid) ? null : rid),
        })),
        role: u.role || 'User',
        status: u.status || 'Active',
        workspaceId: u.workspaceId || '',
        workspaceName: wsMap.get(u.workspaceId?.toString()) || 'None',
        createdAt: u.createdAt,
      }
    })
  } catch (error: any) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
