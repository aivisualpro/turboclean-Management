import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { getUserSession } from '../../../../utils/auth'
import { AI_SETUP_HINT, aiConfigured, streamClaude } from '../../../../utils/automation-ai'
import { parseStudio, sanitizeEmailHtml, STUDIO_SYSTEM, studioPrompt, unknownFields } from '../../../../utils/template-studio'

/**
 * POST /api/crm/email/templates/studio — Template Studio (Server-Sent Events).
 * Body: { brief, goal?, length?, style? } to design a new email, or { html, instruction, name, subject } to refine one.
 * Events: delta {text} (as the model writes) · done {name, category, subject, notes, html, unknownFields, model} · failure {message} · ping.
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  if (!aiConfigured()) throw createError({ statusCode: 400, statusMessage: 'AI is not connected', message: `${AI_SETUP_HINT} Then Template Studio can design emails.` })
  const actor = actorFromSession(session)
  const body = (await readBody(event)) || {}
  const refining = !!(body.html && body.instruction)
  if (!refining && !String(body.brief || '').trim()) throw createError({ statusCode: 400, statusMessage: 'Describe the email first' })

  const db = await getCrmDb()
  const { MISSING_PHOTOS_HTML_V2 } = await import('../../../../utils/crm-email-seed')
  const { recordSignal } = await import('../../../../utils/brain')
  await recordSignal(db, 'design.instruction', 'design', { instruction: String(refining ? body.instruction : body.brief).slice(0, 1500), refining, goal: body.goal || null }, { actor })

  setResponseHeader(event, 'X-Accel-Buffering', 'no')
  setResponseHeader(event, 'Cache-Control', 'no-cache, no-transform')
  const stream = createEventStream(event)
  let closed = false
  const ctrl = new AbortController()
  stream.onClosed(() => { closed = true; ctrl.abort() })
  const emit = (name: string, data: any) => { if (!closed) stream.push({ event: name, data: JSON.stringify(data) }).catch(() => {}) }
  const ping = setInterval(() => emit('ping', { t: Date.now() }), 15_000)

  let pending = ''
  let last = 0
  ;(async () => {
    try {
      const r = await streamClaude({
        system: STUDIO_SYSTEM, cacheSystem: true, brain: 'design', purpose: refining ? 'studio.refine' : 'studio.create',
        prompt: studioPrompt(body, MISSING_PHOTOS_HTML_V2), maxTokens: 20_000, timeoutMs: 600_000, signal: ctrl.signal,
        onNote: note => emit('note', { text: note }),
      }, (delta) => {
        pending += delta
        // Batch small deltas so the browser repaints a few times a second, not per token.
        if (Date.now() - last > 120) { emit('delta', { text: pending }); pending = ''; last = Date.now() }
      })
      if (pending) emit('delta', { text: pending })
      const out = parseStudio(r.text)
      const html = sanitizeEmailHtml(out.html)
      if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) throw new Error('The design came back incomplete — try again or ask for a shorter email')
      emit('done', { ...out, html, unknownFields: unknownFields(html, out.subject), model: r.model })
    }
    catch (e: any) { emit('failure', { message: ctrl.signal.aborted ? 'Stopped' : (e?.message || 'Template Studio failed') }) }
    finally { clearInterval(ping); await stream.close().catch(() => {}) }
  })()
  return stream.send()
})
