/**
 * Server-Sent Events (SSE) endpoint for real-time sync
 * 
 * The browser connects to this endpoint and receives events
 * whenever the webhook processes a change from AppSheet.
 * 
 * Usage in browser: new EventSource('/api/sync/events')
 */

import { syncEventBus, type SyncEvent } from '../../utils/sync-events'

export default defineEventHandler(async (event) => {
  // Set SSE headers
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  // Send initial connection confirmation
  const send = (data: string) => {
    event.node.res.write(`data: ${data}\n\n`)
  }

  send(JSON.stringify({ type: 'connected', timestamp: Date.now() }))

  // Listen for sync events and forward to this client
  const onSync = (syncEvent: SyncEvent) => {
    try {
      send(JSON.stringify(syncEvent))
    } catch {
      // Client disconnected, will be cleaned up below
    }
  }

  syncEventBus.on('sync', onSync)

  // Send a heartbeat every 30s to keep the connection alive
  const heartbeat = setInterval(() => {
    try {
      event.node.res.write(': heartbeat\n\n')
    } catch {
      clearInterval(heartbeat)
    }
  }, 30000)

  // Cleanup when client disconnects
  event.node.req.on('close', () => {
    syncEventBus.off('sync', onSync)
    clearInterval(heartbeat)
    console.log('[SSE] Client disconnected')
  })

  // Keep the connection open by returning a promise that never resolves
  // (until the client disconnects)
  await new Promise(() => {
    // This intentionally never resolves
  })
})
