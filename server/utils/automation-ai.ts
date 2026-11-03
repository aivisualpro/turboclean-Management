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
async function askGemini(opts: AskOptions, model: string, signal: AbortSignal) {
  const res = await fetch(geminiUrl(model, 'generateContent'), { method: 'POST', signal, headers: geminiHeaders(), body: JSON.stringify(await geminiBody(opts, opts.maxTokens ?? 800)) })
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data: any = await res.json()
  const blocked = geminiBlocked(data)
  if (blocked) throw new Error(blocked)
  return { text: geminiText(data).trim(), model: String(data?.modelVersion || model), usage: geminiUsage(data) }
}
async function streamGemini(opts: AskOptions, model: string, signal: AbortSignal, onText: (d: string, full: string) => void) {
  const res = await fetch(geminiUrl(model, 'streamGenerateContent'), { method: 'POST', signal, headers: geminiHeaders(), body: JSON.stringify(await geminiBody(opts, opts.maxTokens ?? 16_000)) })
  if (!res.ok || !res.body) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  let full = '', last: any = null, served = model
  for await (const chunk of sseEvents(res.body)) {
    last = chunk
    if (chunk?.modelVersion) served = chunk.modelVersion
    const blocked = geminiBlocked(chunk)
    if (blocked) throw new Error(blocked)
    const t = geminiText(chunk)
    if (t) { full += t; onText(t, full) }
  }
  return { text: full, model: served, usage: geminiUsage(last) }
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
    throw e
  }
  finally { t.clear() }
}

/**
 * Streaming call — `onText` receives each piece of text as the model writes it (Template Studio
 * shows the email building live). Resolves with the full text.
 */
export async function streamClaude(opts: AskOptions & { signal?: AbortSignal }, onText: (delta: string, full: string) => void) {
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
