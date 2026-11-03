import { getScannerSession, publicState, subscribe } from '../../../../utils/scanner-session'
import { requireActor } from '../../../../utils/automation-http'

/**
 * GET /api/scanner/sessions/:id/stream — Server-Sent Events: `frame` (JPEG screencast, ≤ ~12 fps),
 * `state`, `progress`, `log`, `result`, `failure`, `closed`.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const s = getScannerSession(getRouterParam(event, 'id')!, actor)
  const stream = createEventStream(event)
  const send = (ev: string, data: any) => { stream.push({ event: ev, data: JSON.stringify(data) }).catch(() => {}) }
  let lastFrameAt = 0
  let pendingFrame: any = null
  let frameTimer: ReturnType<typeof setTimeout> | null = null
  const flushFrame = () => { frameTimer = null; if (pendingFrame) { lastFrameAt = Date.now(); send('frame', pendingFrame); pendingFrame = null } }
  const unsub = subscribe(s, (ev, data) => {
    if (ev === 'frame') {
      pendingFrame = data
      const wait = 80 - (Date.now() - lastFrameAt)
      if (wait <= 0) flushFrame()
      else if (!frameTimer) frameTimer = setTimeout(flushFrame, wait)
      return
    }
    send(ev, data)
  })
  send('state', publicState(s))
  if (s.frame) send('frame', s.frame)
  send('progress', s.progress)
  const ping = setInterval(() => send('ping', { t: Date.now() }), 15_000)
  stream.onClosed(async () => {
    unsub()
    clearInterval(ping)
    if (frameTimer) clearTimeout(frameTimer)
    await stream.close()
  })
  return stream.send()
})
