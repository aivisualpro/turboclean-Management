import { Buffer } from 'node:buffer'
import { connectToDatabase } from './mongodb'
import { ObjectId } from 'mongodb'
import { getCookie } from 'h3'

export async function getUserSession(event: any) {
  const token = getCookie(event, 'turbo_session')
  if (!token) return null

  try {
    const payloadText = Buffer.from(token, 'base64url').toString('utf-8')
    const payload = JSON.parse(payloadText)

    if (Date.now() - payload.iat > 7 * 24 * 60 * 60 * 1000) {
      return null
    }

    const { db } = await connectToDatabase()
    const dbUser = await db.collection('turboCleanAppUsers').findOne({ _id: new ObjectId(payload.userId) })

    if (!dbUser) return null

    return {
      id: dbUser._id.toString(),
      name: dbUser.name || payload.name,
      email: dbUser.email || payload.email,
      role: dbUser.role || payload.role,
      registerDealers: dbUser.registerDealers || []
    }
  } catch (error) {
    return null
  }
}
