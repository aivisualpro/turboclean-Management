import { Buffer } from 'node:buffer'
import process from 'node:process'
import { connectToDatabase } from '../../utils/mongodb'
export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { email, password } = body

    if (!email || !password) {
      throw createError({ statusCode: 400, statusMessage: 'Email and password are required' })
    }

    const { db } = await connectToDatabase()

    // Find user by email (case-insensitive)
    const user = await db.collection('turboCleanAppUsers').findOne({
      email: { $regex: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    })

    if (!user) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
    }

    // Check password (plain-text comparison as stored in the collection)
    if (user.password !== password) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
    }

    // Only active users can login
    if ((user.status || '').toLowerCase() !== 'active') {
      throw createError({ statusCode: 403, statusMessage: 'Your account is inactive. Please contact an administrator.' })
    }

    // Create a simple session token (base64 of id + timestamp)
    const sessionPayload = JSON.stringify({
      userId: user._id.toString(),
      email: user.email,
      name: user.name || '',
      role: user.role || 'User',
      iat: Date.now(),
    })
    const token = Buffer.from(sessionPayload).toString('base64url')

    // Set session cookie (HTTP-only, 7-day expiry)
    setCookie(event, 'turbo_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    })

    return {
      success: true,
      user: {
        id: user._id.toString(),
        name: user.name || '',
        email: user.email,
        role: user.role || 'User',
        registerDealers: user.registerDealers || [],
      },
    }
  }
  catch (error: any) {
    if (error.statusCode)
      throw error
    throw createError({ statusCode: 500, statusMessage: error.message })
  }
})
