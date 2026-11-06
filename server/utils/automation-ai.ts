/**
 * AI client for the CRM (drafts, reply classification, summaries, insights, Template Studio, Brain).
 *
 * Providers (picked automatically from the environment):
 *  - Google Gemini  — GOOGLE_GEMINI_API_KEY (also accepts GEMINI_API_KEY / GOOGLE_GIMINI_APIKEY),
 *                     model GEMINI_MODEL (default gemini-3.8-flash). Preferred when its key is set.
 *  - Anthropic      — ANTHROPIC_API_KEY, model ANTHROPIC_MODEL (default claude-sonnet-5-5).
 *  Force one with AI_PROVIDER=gemini|anthropic. Every caller has a rules-based fallback, so the CRM
 *  keeps working when no key is set or the API is down.
 *
 * The "brain": when a call names an area (`brain: 'writing' | 'replies' | …`) the team's playbook
 * for that area is added to the system prompt (see brain.ts). Every call is logged (provider,
 * purpose, model, tokens, time) in turboCleanAiCalls.
 */
import process from 'node:process'
import type { BrainArea } from './brain'

export type AiProvider = 'gemini' | 'anthropic'
export const AI_DEFAULT_MODEL = 'claude-sonnet-5-5'
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash'
export const AI_CALLS_COLLECTION = 'turboCleanAiCalls'

const geminiKey = () => process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_GIMINI_APIKEY || process.env.GOOGLE_API_KEY || ''
const anthropicKey = () => process.env.ANTHROPIC_API_KEY || ''

export function aiProvider(): AiProvider | null {
  const forced = String(process.env.AI_PROVIDER || '').toLowerCase()
  if (forced === 'gemini') return geminiKey() ? 'gemini' : null
  if (forced === 'anthropic' || forced === 'claude') return anthropicKey() ? 'anthropic' : null
  if (geminiKey()) return 'gemini'
  if (anthropicKey()) return 'anthropic'
  return null
}
export const aiConfigured = () => aiProvider() !== null
export const aiModel = () => aiProvider() === 'gemini'
  ? (process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL)
  : (process.env.ANTHROPIC_MODEL || AI_DEFAULT_MODEL)
/** Shown in the UI: "Gemini · gemini-3.8-flash" */
export const aiLabel = () => { const p = aiProvider(); return p ? `${p === 'gemini' ? 'Gemini' : 'Claude'} · ${aiModel()}` : 'Not connected' }
/** What to tell someone who needs to connect AI. */
export const AI_SETUP_HINT = 'Add GOOGLE_GEMINI_API_KEY (or ANTHROPIC_API_KEY) to the server environment.'

export interface AskOptions {
  system: string
  prompt: string
  maxTokens?: number
  temperature?: number
  /** Add the team's playbook for this area to the system prompt. */
  brain?: BrainArea
  /** What the call is for — logged, shown on the Brain page. */
  purpose?: string
  timeoutMs?: number
  /** Cache the system prompt too (Anthropic; Gemini caches long prompts implicitly). */
  cacheSystem?: boolean
}

async function brainBlock(opts: AskOptions): Promise<string> {
  if (!opts.brain) return ''
  try {
    const { brainContext } = await import('./brain')
    return await brainContext(opts.brain)
  } catch (e: any) { console.warn('[AI] brain context unavailable:', e?.message); return '' }
}

async function logCall(entry: Record<string, any>) {
  try {
    const { getCrmDb } = await import('./crm')
    const db = await getCrmDb()
    await db.collection(AI_CALLS_COLLECTION).insertOne({ at: new Date().toISOString(), ...entry })
  } catch {}
}

const withTimeout = (ms: number, outer?: AbortSignal) => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  outer?.addEventListener('abort', () => ctrl.abort())
  return { signal: ctrl.signal, clear: () => clearTimeout(timer), aborted: () => ctrl.signal.aborted }
}

// ───────────────────────── Anthropic ─────────────────────────
function anthropicUsage(data: any) {
  const u = data?.usage || {}
  return { inputTokens: u.input_tokens || 0, outputTokens: u.output_tokens || 0, cacheReadTokens: u.cache_read_input_tokens || 0, cacheWriteTokens: u.cache_creation_input_tokens || 0 }
}
async function anthropicPost(body: any, signal: AbortSignal) {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'x-api-key': anthropicKey(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
async function anthropicSystem(opts: AskOptions) {
  const blocks: any[] = [{ type: 'text', text: opts.system, ...(opts.cacheSystem ? { cache_control: { type: 'ephemeral' } } : {}) }]
  const ctx = await brainBlock(opts)
  if (ctx) blocks.push({ type: 'text', text: ctx, cache_control: { type: 'ephemeral' } })
  return blocks
}
async function askAnthropic(opts: AskOptions, model: string, signal: AbortSignal) {
  const body: any = { model, max_tokens: opts.maxTokens ?? 800, system: await anthropicSystem(opts), messages: [{ role: 'user', content: opts.prompt }] }
  if (opts.temperature !== undefined) body.temperature = opts.temperature
  let res = await anthropicPost(body, signal)
  if (res.status === 400 && body.temperature !== undefined) {
    const txt = await res.text()
    if (/temperature/i.test(txt)) { delete body.temperature; res = await anthropicPost(body, signal) }
    else throw new Error(`Claude API 400: ${txt.slice(0, 300)}`)
  }
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data: any = await res.json()
  const text = (data?.content || []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('').trim()
  return { text, model: String(data?.model || model), usage: anthropicUsage(data) }
}
async function streamAnthropic(opts: AskOptions, model: string, signal: AbortSignal, onText: (d: string, full: string) => void) {
  const body: any = { model, max_tokens: opts.maxTokens ?? 16_000, stream: true, system: await anthropicSystem(opts), messages: [{ role: 'user', content: opts.prompt }] }
  const res = await anthropicPost(body, signal)
  if (!res.ok || !res.body) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  let full = '', usage: any = {}, served = model
  for await (const ev of sseEvents(res.body)) {
    if (ev.type === 'message_start') { served = ev.message?.model || model; usage = { ...usage, ...ev.message?.usage } }
    else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { full += ev.delta.text; onText(ev.delta.text, full) }
    else if (ev.type === 'message_delta') usage = { ...usage, ...ev.usage }
    else if (ev.type === 'error') throw new Error(ev.error?.message || 'Claude stream error')
  }
  return { text: full, model: served, usage: anthropicUsage({ usage }) }
}

// ───────────────────────── Gemini ─────────────────────────
function geminiUsage(data: any) {
  const u = data?.usageMetadata || {}
  return { inputTokens: u.promptTokenCount || 0, outputTokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), cacheReadTokens: u.cachedContentTokenCount || 0, cacheWriteTokens: 0 }
}
async function geminiBody(opts: AskOptions, maxTokens: number) {
  const ctx = await brainBlock(opts)
  const body: any = {
    systemInstruction: { parts: [{ text: ctx ? `${opts.system}\n\n${ctx}` : opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}) },
    safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map(category => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
  }
  return body
}
const geminiUrl = (model: string, method: 'generateContent' | 'streamGenerateContent') => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}${method === 'streamGenerateContent' ? '?alt=sse' : ''}`
const geminiHeaders = () => ({ 'x-goog-api-key': geminiKey(), 'content-type': 'application/json' })
const geminiText = (data: any) => ((data?.candidates?.[0]?.content?.parts || []) as any[]).filter(p => typeof p?.text === 'string' && !p.thought).map(p => p.text).join('')
function geminiBlocked(data: any) {
  const reason = data?.promptFeedback?.blockReason || (data?.candidates?.[0]?.finishReason === 'SAFETY' ? 'SAFETY' : '')
  return reason ? `Gemini blocked the request (${reason})` : ''
}
/**
 * Google answers 503 "high demand" / 429 / 500 quite often at peak times. Every Gemini call is
 * retried with a short back-off, then on the fallback models (GEMINI_FALLBACK_MODELS, comma-separated,
 * default "<model>-lite"). Streaming only retries while nothing has been written yet.
 */
const GEMINI_RETRY_WAITS = [1500, 4000, 8000]
const geminiRetryable = (status: number) => status === 503 || status === 429 || status === 500 || status === 502 || status === 504
export function geminiModels(primary: string) {
  const extra = (process.env.GEMINI_FALLBACK_MODELS || '').split(',').map(s => s.trim()).filter(Boolean)
  const auto = /-flash$/.test(primary) && !extra.length ? [`${primary}-lite`] : []
  return [primary, ...extra, ...auto].filter((m, i, a) => a.indexOf(m) === i)
}
class GeminiHttpError extends Error { constructor(public status: number, body: string) { super(`Gemini API ${status}: ${body.slice(0, 300)}`) } }
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Timed out')) }, { once: true })
})
function geminiFriendly(e: any, tried: string[], attempts: number) {
  if (e instanceof GeminiHttpError && geminiRetryable(e.status)) {
    const why = e.status === 429 ? 'rate limit (HTTP 429)' : `overloaded (HTTP ${e.status})`
    return new Error(`Gemini is ${why} right now — tried ${attempts}× on ${tried.join(', ')}. Try again in a minute${tried.length === 1 ? ', or set GEMINI_FALLBACK_MODELS' : ''}.`)
  }
  return e
}
/** Run `attempt(model)` with retries and model fallbacks. `started()` tells whether output already began (no retry then). */
async function geminiWithRetries<T>(primary: string, signal: AbortSignal, attempt: (model: string) => Promise<T>, started: () => boolean, onRetry?: (note: string) => void) {
  const models = geminiModels(primary)
  let last: any = null, attempts = 0
  for (const model of models) {
    for (let i = 0; i <= GEMINI_RETRY_WAITS.length; i++) {
      attempts++
      try { return await attempt(model) }
      catch (e: any) {
        last = e
        if (signal.aborted || started() || !(e instanceof GeminiHttpError) || !geminiRetryable(e.status)) throw geminiFriendly(e, models.slice(0, models.indexOf(model) + 1), attempts)
        const wait = GEMINI_RETRY_WAITS[i]
        if (wait === undefined) break
        onRetry?.(`${model} answered ${e.status} — retrying in ${wait / 1000}s`)
        await sleep(wait, signal)
      }
    }
    onRetry?.(models.indexOf(model) < models.length - 1 ? `${model} unavailable — switching to ${models[models.indexOf(model) + 1]}` : `${model} unavailable`)
  }
  throw geminiFriendly(last, models, attempts)
}
async function askGemini(opts: AskOptions, model: string, signal: AbortSignal) {
  const body = JSON.stringify(await geminiBody(opts, opts.maxTokens ?? 800))
  return geminiWithRetries(model, signal, async (m) => {
    const res = await fetch(geminiUrl(m, 'generateContent'), { method: 'POST', signal, headers: geminiHeaders(), body })
    if (!res.ok) throw new GeminiHttpError(res.status, await res.text())
    const data: any = await res.json()
    const blocked = geminiBlocked(data)
    if (blocked) throw new Error(blocked)
    return { text: geminiText(data).trim(), model: String(data?.modelVersion || m), usage: geminiUsage(data) }
  }, () => false)
}
async function streamGemini(opts: AskOptions & { onNote?: (note: string) => void }, model: string, signal: AbortSignal, onText: (d: string, full: string) => void) {
  const body = JSON.stringify(await geminiBody(opts, opts.maxTokens ?? 16_000))
  let full = ''
  return geminiWithRetries(model, signal, async (m) => {
    const res = await fetch(geminiUrl(m, 'streamGenerateContent'), { method: 'POST', signal, headers: geminiHeaders(), body })
    if (!res.ok || !res.body) throw new GeminiHttpError(res.status, await res.text())
    let last: any = null, served = m
    for await (const chunk of sseEvents(res.body)) {
      last = chunk
      if (chunk?.modelVersion) served = chunk.modelVersion
      const blocked = geminiBlocked(chunk)
      if (blocked) throw new Error(blocked)
      const t = geminiText(chunk)
      if (t) { full += t; onText(t, full) }
    }
    return { text: full, model: served, usage: geminiUsage(last) }
  }, () => full.length > 0, opts.onNote)
}

/** Parse a Server-Sent Events body into JSON data objects. */
async function* sseEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('')
      if (!data || data === '[DONE]') continue
      try { yield JSON.parse(data) } catch {}
    }
  }
}

const isOverload = (e: any) => /^Gemini is (overloaded|rate limit)/.test(String(e?.message || ''))

// ───────────────────────── Vision (Gemini) ─────────────────────────
/** Gemini key present → photo checks can use vision. */
export const visionConfigured = () => !!geminiKey() && String(process.env.SCANNER_AI || '').toLowerCase() !== 'off'
/** The vision model: SCANNER_VISION_MODEL, else GEMINI_MODEL, else the default flash model. */
export const visionModel = () => process.env.SCANNER_VISION_MODEL || process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL
let thinkingParam: 'level' | 'none' = 'level'
/**
 * One Gemini call with several images (inline JPEGs) → JSON. Fast settings: temperature 0, low
 * thinking, JSON output. Retries / fallback models like every other Gemini call.
 */
export async function askGeminiVision(opts: { system: string, prompt: string, images: { label: string, mime: string, b64: string }[], maxTokens?: number, timeoutMs?: number, purpose?: string }) {
  if (!geminiKey()) throw new Error('GOOGLE_GEMINI_API_KEY is not set')
  const model = visionModel()
  const t = withTimeout(opts.timeoutMs ?? 45_000)
  const t0 = Date.now()
  const parts: any[] = [{ text: opts.prompt }]
  for (const im of opts.images) { parts.push({ text: im.label }); parts.push({ inlineData: { mimeType: im.mime, data: im.b64 } }) }
  const make = () => JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: opts.maxTokens ?? 4000, temperature: 0, responseMimeType: 'application/json', ...(thinkingParam === 'level' ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) },
  })
  try {
    const r = await geminiWithRetries(model, t.signal, async (m) => {
      let res = await fetch(geminiUrl(m, 'generateContent'), { method: 'POST', signal: t.signal, headers: geminiHeaders(), body: make() })
      if (res.status === 400 && thinkingParam === 'level') {
        const txt = await res.text()
        if (!/thinking/i.test(txt)) throw new GeminiHttpError(400, txt)
        thinkingParam = 'none' // this model has no thinking level — ask without it from now on
        res = await fetch(geminiUrl(m, 'generateContent'), { method: 'POST', signal: t.signal, headers: geminiHeaders(), body: make() })
      }
      if (!res.ok) throw new GeminiHttpError(res.status, await res.text())
      const data: any = await res.json()
      const blocked = geminiBlocked(data)
      if (blocked) throw new Error(blocked)
      return { text: geminiText(data).trim(), model: String(data?.modelVersion || m), usage: geminiUsage(data) }
    }, () => false)
    logCall({ provider: 'gemini', purpose: opts.purpose || 'vision', brain: null, model: r.model, ms: Date.now() - t0, ok: true, images: opts.images.length, ...r.usage })
    return { data: parseJsonBlock(r.text), model: r.model, ms: Date.now() - t0 }
  }
  catch (e: any) {
    logCall({ provider: 'gemini', purpose: opts.purpose || 'vision', brain: null, model, ms: Date.now() - t0, ok: false, images: opts.images.length, error: String(e?.message || e).slice(0, 300) })
    throw e
  }
  finally { t.clear() }
}

/** Claude vision for the photo check — the most capable model by default, falling back if it is unavailable. */
export const claudeVisionConfigured = () => !!anthropicKey()
export const claudeVisionModels = () => [process.env.SCANNER_VISION_MODEL && /^claude/.test(process.env.SCANNER_VISION_MODEL) ? process.env.SCANNER_VISION_MODEL : 'claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5'].filter((m, i, a) => a.indexOf(m) === i)
let claudeEffortOk = true
/**
 * One Claude call with several images → JSON. Adaptive thinking (always on for the top models) +
 * `output_config.effort` (SCANNER_VISION_EFFORT, default "medium" — photo judging needs care, not essays).
 * Overloaded / unknown model → next model in the chain.
 */
export async function askClaudeVision(opts: { system: string, prompt: string, images: { label: string, mime: string, b64: string }[], maxTokens?: number, timeoutMs?: number, purpose?: string }) {
  if (!anthropicKey()) throw new Error('ANTHROPIC_API_KEY is not set')
  const t = withTimeout(opts.timeoutMs ?? 90_000)
  const t0 = Date.now()
  const content: any[] = [{ type: 'text', text: opts.prompt }]
  for (const im of opts.images) { content.push({ type: 'text', text: im.label }); content.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.b64 } }) }
  const effort = (['low', 'medium', 'high', 'xhigh', 'max'].includes(String(process.env.SCANNER_VISION_EFFORT)) ? process.env.SCANNER_VISION_EFFORT : 'medium') as string
  let lastErr: any = null
  try {
    for (const model of claudeVisionModels()) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const body: any = { model, max_tokens: opts.maxTokens ?? 8000, system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content }] }
        if (claudeEffortOk) body.output_config = { effort }
        const res = await anthropicPost(body, t.signal)
        if (res.ok) {
          const data: any = await res.json()
          const text = (data?.content || []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('').trim()
          logCall({ provider: 'anthropic', purpose: opts.purpose || 'vision', brain: null, model: String(data?.model || model), ms: Date.now() - t0, ok: true, images: opts.images.length, ...anthropicUsage(data) })
          return { data: parseJsonBlock(text), model: String(data?.model || model), ms: Date.now() - t0 }
        }
        const txt = await res.text()
        lastErr = new Error(`Claude API ${res.status} (${model}): ${txt.slice(0, 240)}`)
        if (res.status === 400 && claudeEffortOk && /output_config|effort/i.test(txt)) { claudeEffortOk = false; continue }
        if (res.status === 404 || (res.status === 400 && /model/i.test(txt)) || res.status === 403) break // model not available → next model
        if (res.status === 429 || res.status === 529 || res.status >= 500) { await new Promise(r => setTimeout(r, [2000, 5000, 9000][attempt])); continue }
        throw lastErr
      }
    }
    throw lastErr || new Error('No Claude model answered')
  }
  catch (e: any) {
    logCall({ provider: 'anthropic', purpose: opts.purpose || 'vision', brain: null, model: claudeVisionModels()[0], ms: Date.now() - t0, ok: false, images: opts.images.length, error: String(e?.message || e).slice(0, 300) })
    throw e
  }
  finally { t.clear() }
}

// ───────────────────────── Public API ─────────────────────────
export async function askClaude(opts: AskOptions) {
  const provider = aiProvider()
  if (!provider) throw new Error(AI_SETUP_HINT)
  const model = aiModel()
  const t = withTimeout(opts.timeoutMs ?? 90_000)
  const t0 = Date.now()
  try {
    const r = provider === 'gemini' ? await askGemini(opts, model, t.signal) : await askAnthropic(opts, model, t.signal)
    logCall({ provider, purpose: opts.purpose || 'other', brain: opts.brain || null, model: r.model, ms: Date.now() - t0, ok: true, ...r.usage })
    return { text: r.text, model: r.model }
  }
  catch (e: any) {
    logCall({ provider, purpose: opts.purpose || 'other', brain: opts.brain || null, model, ms: Date.now() - t0, ok: false, error: String(e?.message || e).slice(0, 300) })
    // Gemini overloaded and a Claude key is also configured → answer with Claude instead of failing.
    if (provider === 'gemini' && isOverload(e) && anthropicKey() && !t.signal.aborted) {
      const m2 = process.env.ANTHROPIC_MODEL || AI_DEFAULT_MODEL
      const r = await askAnthropic(opts, m2, t.signal)
      logCall({ provider: 'anthropic', purpose: opts.purpose || 'other', brain: opts.brain || null, model: r.model, ms: Date.now() - t0, ok: true, ...r.usage })
      return { text: r.text, model: r.model }
    }
    throw e
  }
  finally { t.clear() }
}

/**
 * Streaming call — `onText` receives each piece of text as the model writes it (Template Studio
 * shows the email building live). Resolves with the full text.
 */
export async function streamClaude(opts: AskOptions & { signal?: AbortSignal, /** Retry / fallback notes ("gemini-… answered 503 — retrying in 4s") */ onNote?: (note: string) => void }, onText: (delta: string, full: string) => void) {
  const provider = aiProvider()
  if (!provider) throw new Error(AI_SETUP_HINT)
  const model = aiModel()
  const t = withTimeout(opts.timeoutMs ?? 300_000, opts.signal)
  const t0 = Date.now()
  try {
    const r = provider === 'gemini' ? await streamGemini(opts, model, t.signal, onText) : await streamAnthropic(opts, model, t.signal, onText)
    logCall({ provider, purpose: opts.purpose || 'stream', brain: opts.brain || null, model: r.model, ms: Date.now() - t0, ok: true, ...r.usage })
    return { text: r.text, model: r.model }
  }
  catch (e: any) {
    logCall({ provider, purpose: opts.purpose || 'stream', brain: opts.brain || null, model, ms: Date.now() - t0, ok: false, error: String(e?.message || e).slice(0, 300) })
    if (provider === 'gemini' && isOverload(e) && anthropicKey() && !t.signal.aborted) {
      const m2 = process.env.ANTHROPIC_MODEL || AI_DEFAULT_MODEL
      opts.onNote?.(`Gemini unavailable — switching to Claude (${m2})`)
      const r = await streamAnthropic(opts, m2, t.signal, onText)
      logCall({ provider: 'anthropic', purpose: opts.purpose || 'stream', brain: opts.brain || null, model: r.model, ms: Date.now() - t0, ok: true, ...r.usage })
      return { text: r.text, model: r.model }
    }
    throw e
  }
  finally { t.clear() }
}

/** First {...} block of a reply, parsed. Null when there is none or it is not valid JSON. */
export function parseJsonBlock<T = any>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try { return JSON.parse(cleaned.slice(start, end + 1)) as T }
  catch { return null }
}

/** Ask for JSON; returns null instead of throwing so callers can fall back to rules. */
export async function askClaudeJson<T = any>(opts: AskOptions): Promise<{ data: T, model: string } | null> {
  try {
    const r = await askClaude({ ...opts, system: `${opts.system}\n\nRespond with a single JSON object and nothing else — no markdown fences.` })
    const data = parseJsonBlock<T>(r.text)
    return data ? { data, model: r.model } : null
  }
  catch (e: any) {
    console.warn('[AI] call failed:', e?.message)
    return null
  }
}
