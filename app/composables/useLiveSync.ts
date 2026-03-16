/**
 * Composable for real-time sync via Server-Sent Events (SSE)
 *
 * Listens to /api/sync/events and triggers a callback when
 * data changes for the specified table(s).
 *
 * Usage:
 *   useLiveSync('AppUsers', () => refresh())
 *   useLiveSync(['Dealers', 'DealerServices'], () => refresh())
 */

export function useLiveSync(
  tables: string | string[],
  onUpdate: (event: { table: string; action: string; id: string }) => void,
) {
  // Only run on client side
  if (import.meta.server) return

  const tableList = Array.isArray(tables) ? tables : [tables]
  let eventSource: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connect() {
    if (eventSource) {
      eventSource.close()
    }

    eventSource = new EventSource('/api/sync/events')

    eventSource.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data)

        // Ignore connection/heartbeat messages
        if (data.type === 'connected') return

        // Only trigger for matching tables
        if (tableList.includes(data.table)) {
          console.log(`[LiveSync] ${data.action} on ${data.table}`, data.id)
          onUpdate(data)
        }
      } catch {
        // Ignore parse errors
      }
    }

    eventSource.onerror = () => {
      // Auto-reconnect after 5 seconds
      eventSource?.close()
      eventSource = null
      reconnectTimer = setTimeout(connect, 5000)
    }
  }

  // Connect on mount
  onMounted(connect)

  // Cleanup on unmount
  onUnmounted(() => {
    eventSource?.close()
    eventSource = null
    if (reconnectTimer) clearTimeout(reconnectTimer)
  })
}
