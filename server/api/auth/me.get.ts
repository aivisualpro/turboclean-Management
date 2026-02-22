import { Buffer } from 'node:buffer'

export default defineEventHandler(async (event) => {
  const token = getCookie(event, 'turbo_session')

  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  try {
    const payloadText = Buffer.from(token, 'base64url').toString('utf-8')
    const payload = JSON.parse(payloadText)

    // Check if token is expired (7 days)
    if (Date.now() - payload.iat > 7 * 24 * 60 * 60 * 1000) {
      deleteCookie(event, 'turbo_session', { path: '/' })
      throw createError({ statusCode: 401, statusMessage: 'Session expired' })
    }

    return {
      user: {
        id: payload.userId,
        name: payload.name,
        email: payload.email,
        role: payload.role,
      },
    }
  }
  catch (error: any) {
    if (error.statusCode)
      throw error
    deleteCookie(event, 'turbo_session', { path: '/' })
    console.error('Session Parse Error:', error)
    throw createError({ statusCode: 401, statusMessage: error.message || 'Invalid session' })
  }
})
