import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { getUserSession } from '../../../../utils/auth'
import { AI_SETUP_HINT, aiConfigured, aiLabel, streamClaude } from '../../../../utils/automation-ai'
import { isCampaignBrief, parseStudio, repairEmailHtml, sanitizeEmailHtml, STUDIO_SYSTEM, studioPrompt, unknownFields } from '../../../../utils/template-studio'

/**
 * POST /api/crm/email/templates/studio — Template Studio (Server-Sent Events).
 * Body: { brief, goal?, length?, style?, audience?, quality?: 'fast'|'best', campaign?: boolean } to design
 * a new email, or { html, instruction, name, subject } to refine one.
 *
 * Events
 *  - status  {phase, elapsed, chars, model}   every ~2 s (also the keep-alive) — phases: connecting · thinking · writing · checking
 *  - thought {text}                            the model's plan while it thinks (Gemini thought summaries)
 *  - note    {text}                            retries / model switches
 *  - delta   {text}                            the email as it is written
 *  - done    {name, category, subject, notes, html, unknownFields, model, repaired, campaign, ms}
 *  - failure {message}
 *
 * Time budget: the whole design must finish in STUDIO_TIMEOUT (default 5 min); an attempt that
 * sends nothing for 75 s is abandoned and retried on the fallback model. It can no longer hang.
 */
const STUDIO_TIMEOUT = 300_000
const STUDIO_IDLE = 75_000

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  if (!aiConfigured()) throw createError({ statusCode: 400, statusMessage: 'AI is not connected', message: `${AI_SETUP_HINT} Then Template Studio can design emails.` })
  const actor = actorFromSession(session)
  const body = (await readBody(event)) || {}
  const refining = !!(body.html && body.instruction)
  if (!refining && !String(body.brief || '').trim()) throw createError({ statusCode: 400, statusMessage: 'Describe the email first' })
  const campaign = body.campaign === true || (body.campaign !== false && isCampaignBrief(`${body.brief || ''} ${body.instruction || ''}`))
  const thinking = body.quality === 'best' ? 'high' : 'low'

  const db = await getCrmDb()
  const { MISSING_PHOTOS_HTML_V2 } = await import('../../../../utils/crm-email-seed')
  const { recordSignal } = await import('../../../../utils/brain')
  recordSignal(db, 'design.instruction', 'design', { instruction: String(refining ? body.instruction : body.brief).slice(0, 1500), refining, goal: body.goal || null, campaign, quality: body.quality || 'fast' }, { actor }).catch(() => {})

  setResponseHeader(event, 'X-Accel-Buffering', 'no')
  setResponseHeader(event, 'Cache-Control', 'no-cache, no-transform')
  const stream = createEventStream(event)
  let closed = false
  const ctrl = new AbortController()
  stream.onClosed(() => { closed = true; ctrl.abort() })
  const emit = (name: string, data: any) => { if (!closed) stream.push({ event: name, data: JSON.stringify(data) }).catch(() => {}) }

  const t0 = Date.now()
  let phase: 'connecting' | 'thinking' | 'writing' | 'checking' = 'connecting'
  let chars = 0
  const model = aiLabel()
  const status = () => emit('status', { phase, elapsed: Date.now() - t0, chars, model })
  status()
  const tick = setInterval(status, 2000)

  let pending = ''
  let last = 0
  let thoughtBuf = ''
  let thoughtAt = 0
  ;(async () => {
    try {
      const r = await streamClaude({
        system: STUDIO_SYSTEM, cacheSystem: true, brain: 'design', purpose: refining ? 'studio.refine' : 'studio.create',
        prompt: studioPrompt({ ...body, campaign }, MISSING_PHOTOS_HTML_V2),
        maxTokens: 32_000, timeoutMs: STUDIO_TIMEOUT, idleMs: STUDIO_IDLE, signal: ctrl.signal, thinking,
        onNote: note => emit('note', { text: note }),
        onThought: (t) => {
          if (phase === 'connecting') phase = 'thinking'
          thoughtBuf += `${thoughtBuf ? '\n\n' : ''}${t.trim()}`
          if (Date.now() - thoughtAt > 400) { emit('thought', { text: thoughtBuf }); thoughtBuf = ''; thoughtAt = Date.now() }
        },
      }, (delta) => {
        phase = 'writing'
        chars += delta.length
        pending += delta
        // Batch small deltas so the browser repaints a few times a second, not per token.
        if (Date.now() - last > 120) { emit('delta', { text: pending }); pending = ''; last = Date.now() }
      })
      if (thoughtBuf) emit('thought', { text: thoughtBuf })
      if (pending) emit('delta', { text: pending })
      phase = 'checking'
      status()
      const out = parseStudio(r.text)
      const fixed = repairEmailHtml(sanitizeEmailHtml(out.html))
      if (!fixed) throw new Error(r.finish === 'MAX_TOKENS' ? 'The design ran out of room before it started the email — try the Short length' : 'The AI did not return an email this time — try again')
      const html = fixed.html
      const notes = fixed.repaired ? `${out.notes || 'Designed.'} (The AI ran out of room near the end — the last section was closed automatically; ask for “shorter” if anything is missing.)` : out.notes
      emit('done', { ...out, notes, html, unknownFields: unknownFields(html, out.subject), model: r.model, repaired: fixed.repaired, campaign, ms: Date.now() - t0 })
    }
    catch (e: any) { emit('failure', { message: ctrl.signal.aborted && closed ? 'Stopped' : (e?.message || 'Template Studio failed') }) }
    finally { clearInterval(tick); await stream.close().catch(() => {}) }
  })()
  return stream.send()
})
