/**
 * Composable for real-time sync via Server-Sent Events (SSE)
 *
 * Instead of auto-refreshing (which disrupts active users),
 * this shows a non-intrusive toast notification with a "Refresh" button.
 * The user decides when to load the new data.
 *
 * Usage:
 *   useLiveSync('AppUsers', () => refresh())
 *   useLiveSync(['Dealers', 'DealerServices'], () => refresh())
 */

import { toast } from 'vue-sonner'

// Track if a toast is already visible per table to avoid spam
const activeToasts = new Set<string>()

// Human-friendly table names
const TABLE_LABELS: Record<string, string> = {
  AppUsers: 'Users',
  Dealers: 'Dealers',
  DealerServices: 'Dealer Services',
  Services: 'Services',
  WorkOrders: 'Work Orders',
}

export function useLiveSync(
  tables: string | string[],
  onRefresh: () => void,
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

        // Only handle matching tables
        if (!tableList.includes(data.table)) return

        // Don't spam toasts — one per table group at a time
        const toastKey = tableList.join(',')
        if (activeToasts.has(toastKey)) return
        activeToasts.add(toastKey)

        const label = TABLE_LABELS[data.table] || data.table
        const actionLabel = data.action === 'added' || data.action === 'add'
          ? 'added to'
          : data.action === 'deleted' || data.action === 'delete'
            ? 'deleted from'
            : 'updated in'

        toast.info(`Data ${actionLabel} ${label} from AppSheet`, {
          description: 'Click refresh to load the latest data.',
          duration: 15000,
          action: {
            label: 'Refresh',
            onClick: () => {
              onRefresh()
              activeToasts.delete(toastKey)
            },
          },
          onDismiss: () => {
            activeToasts.delete(toastKey)
          },
          onAutoClose: () => {
            activeToasts.delete(toastKey)
          },
        })
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
