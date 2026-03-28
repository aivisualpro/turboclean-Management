import { Buffer } from 'node:buffer'
import { connectToDatabase } from '../../utils/mongodb'
import { ObjectId } from 'mongodb'

export default defineEventHandler(async (event) => {
  const token = getCookie(event, 'turbo_session')

  if (!token) {
    return { user: null }
  }

  try {
    const payloadText = Buffer.from(token, 'base64url').toString('utf-8')
    const payload = JSON.parse(payloadText)

    // Check if token is expired (7 days)
    if (Date.now() - payload.iat > 7 * 24 * 60 * 60 * 1000) {
      deleteCookie(event, 'turbo_session', { path: '/' })
      return { user: null }
    }

    const { db } = await connectToDatabase()
    const dbUser = await db.collection('turboCleanAppUsers').findOne({ _id: new ObjectId(payload.userId) })

    if (!dbUser) {
      deleteCookie(event, 'turbo_session', { path: '/' })
      return { user: null }
    }

    // Resolve workspace permissions
    let workspaceMenus: Record<string, { enabled: boolean; tabs: string[] }> = {}
    if (dbUser.workspaceId) {
      try {
        const ws = await db.collection('turboCleanWorkspaces').findOne({ _id: new ObjectId(dbUser.workspaceId) })
        if (ws && ws.menus) {
          workspaceMenus = ws.menus
        }
      } catch { /* invalid ObjectId, skip */ }
    }

    return {
      user: {
        id: dbUser._id.toString(),
        name: dbUser.name || payload.name,
        email: dbUser.email || payload.email,
        role: dbUser.role || payload.role,
        registerDealers: dbUser.registerDealers || [],
        workspaceId: dbUser.workspaceId?.toString() || '',
        permissions: workspaceMenus,
      },
    }
  }
  catch (error: any) {
    deleteCookie(event, 'turbo_session', { path: '/' })
    console.error('Session Parse Error:', error)
    return { user: null }
  }
})
