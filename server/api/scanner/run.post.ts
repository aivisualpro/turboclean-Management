import { getCrmDb } from '../../utils/crm'
import { createScan } from '../../utils/scanner-session'
import { requireActor } from '../../utils/automation-http'

/**
 * POST /api/scanner/run { dealershipId, url?, allPages?, appendTo? }
 * Runs the whole scan inside this one request and streams it as Server-Sent Events:
 * scan {id} · progress · log · frame · done {id,status,summary} · failure {message} · ping.
 * The scan is also stored as it goes, so GET /api/scanner/scans/:id works if the stream drops.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const db = await getCrmDb()
  const { run } = await createScan(db, (await readBody(event)) || {}, actor)

  setResponseHeader(event, 'X-Accel-Buffering', 'no')
  setResponseHeader(event, 'Cache-Control', 'no-cache, no-transform')
  const stream = createEventStream(event)
  let closed = false
  stream.onClosed(() => { closed = true })
  const emit = (name: string, data: any) => {
    if (closed) return
    stream.push({ event: name, data: JSON.stringify(data) }).catch(() => {})
  }
  const ping = setInterval(() => emit('ping', { t: Date.now() }), 15_000)
  // The scan keeps going (and keeps saving) even if the browser disconnects. On Vercel the
  // function would otherwise be torn down the moment the client drops — waitUntil keeps it alive
  // until the scan has finished (the client re-attaches by polling GET /api/scanner/scans/:id).
  const work = run(emit, { isClosed: () => closed })
    .catch(() => {})
    .finally(async () => { clearInterval(ping); await stream.close().catch(() => {}) })
  ;(event as any).waitUntil?.(work)
  ;(event.context as any)?.waitUntil?.(work)
  return stream.send()
})
