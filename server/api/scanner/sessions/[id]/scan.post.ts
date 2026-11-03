/** Retired: the live-session scanner was replaced by /api/scanner/preview + /api/scanner/run. Safe to delete this folder. */
export default defineEventHandler(() => {
  throw createError({ statusCode: 410, statusMessage: 'Gone', message: 'The scanner was updated — reload the page' })
})
