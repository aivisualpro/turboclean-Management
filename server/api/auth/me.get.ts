import { Buffer } from 'node:buffer'

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
    deleteCookie(event, 'turbo_session', { path: '/' })
    console.error('Session Parse Error:', error)
    return { user: null }
  }
})
