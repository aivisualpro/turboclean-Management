export default defineEventHandler(async (event) => {
  deleteCookie(event, 'turbo_session', { path: '/' })
  return { success: true }
})
