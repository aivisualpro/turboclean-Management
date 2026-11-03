/**
 * Inventory Scanner: close every headless Chrome when the server stops or the dev server reloads,
 * so no browser processes are left running in the background.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', async () => {
    try {
      const { closeAllScannerSessions } = await import('../utils/scanner-session')
      await closeAllScannerSessions()
    } catch {}
  })
})
