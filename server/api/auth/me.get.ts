export default defineEventHandler(async (event) => {
  const token = getCookie(event, 'turbo_session')

  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'))

    // Check if token is expired (7 days)
    if (Date.now() - payload.iat > 7 * 24 * 60 * 60 * 1000) {
      deleteCookie(event, 'turbo_session')
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
  } catch (error: any) {
    if (error.statusCode) throw error
    deleteCookie(event, 'turbo_session')
    throw createError({ statusCode: 401, statusMessage: 'Invalid session' })
  }
})
