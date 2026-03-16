/**
 * Server-side Event Bus for real-time sync notifications
 * Uses Node.js EventEmitter to broadcast changes from webhook to SSE clients
 */

import { EventEmitter } from 'node:events'

export interface SyncEvent {
  table: string       // e.g. 'AppUsers', 'Dealers', etc.
  action: string      // 'add', 'edit', 'delete'
  id: string          // The affected record ID
  timestamp: number
}

// Global singleton event bus (persists across hot reloads)
declare global {
  var _syncEventBus: EventEmitter | undefined
}

export const syncEventBus: EventEmitter = globalThis._syncEventBus || new EventEmitter()
globalThis._syncEventBus = syncEventBus

// Increase max listeners since multiple SSE clients can connect
syncEventBus.setMaxListeners(100)

/**
 * Emit a sync event to all connected SSE clients
 */
export function emitSyncEvent(event: Omit<SyncEvent, 'timestamp'>) {
  const fullEvent: SyncEvent = { ...event, timestamp: Date.now() }
  syncEventBus.emit('sync', fullEvent)
  console.log(`[SSE] Emitted sync event:`, fullEvent)
}
