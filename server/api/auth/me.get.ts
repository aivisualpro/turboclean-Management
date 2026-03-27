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

    return {
      user: {
        id: dbUser._id.toString(),
        name: dbUser.name || payload.name,
        email: dbUser.email || payload.email,
        role: dbUser.role || payload.role,
        registerDealers: dbUser.registerDealers || []
      },
    }
  }
  catch (error: any) {
    deleteCookie(event, 'turbo_session', { path: '/' })
    console.error('Session Parse Error:', error)
    return { user: null }
  }
})
