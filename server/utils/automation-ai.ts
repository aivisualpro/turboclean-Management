/**
 * Claude API client for the CRM (drafts, reply classification, summaries, insights, Template Studio).
 *
 * Env: ANTHROPIC_API_KEY (required for AI), ANTHROPIC_MODEL (default claude-sonnet-5-5).
 * Every caller has a rules-based fallback, so the CRM keeps working when no key is set or the API
 * is down.
 *
 * The "brain": when a call names an area (`brain: 'writing' | 'replies' | …`) the team's playbook
 * for that area — lessons it was taught, lessons learned from approvals / edits / rejections /
 * corrections / results, and the most recent corrections as examples — is added to the system
 * prompt (see brain.ts). That block is prompt-cached, so it costs little to send every time.
 * Every call is logged (purpose, model, tokens, time) in turboCleanAiCalls.
 */
import process from 'node:process'
import type { BrainArea } from './brain'

export const AI_DEFAULT_MODEL = 'claude-sonnet-5-5'
export const aiModel = () => process.env.ANTHROPIC_MODEL || AI_DEFAULT_MODEL
export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY
export const AI_CALLS_COLLECTION = 'turboCleanAiCalls'

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
  /** Cache the system prompt too (long, stable instructions such as Template Studio's design guide). */
  cacheSystem?: boolean
}

async function systemBlocks(opts: AskOptions) {
  const blocks: any[] = [{ type: 'text', text: opts.system, ...(opts.cacheSystem ? { cache_control: { type: 'ephemeral' } } : {}) }]
  if (opts.brain) {
    try {
      const { brainContext } = await import('./brain')
      const ctx = await brainContext(opts.brain)
      // Cached: the playbook only changes when the brain learns something new.
      if (ctx) blocks.push({ type: 'text', text: ctx, cache_control: { type: 'ephemeral' } })
    } catch (e: any) { console.warn('[AI] brain context unavailable:', e?.message) }
  }
  return blocks
}

async function logCall(entry: Record<string, any>) {
  try {
    const { getCrmDb } = await import('./crm')
    const db = await getCrmDb()
    await db.collection(AI_CALLS_COLLECTION).insertOne({ at: new Date().toISOString(), ...entry })
  } catch {}
}

function usageOf(data: any) {
  const u = data?.usage || {}
  return { inputTokens: u.input_tokens || 0, outputTokens: u.output_tokens || 0, cacheReadTokens: u.cache_read_input_tokens || 0, cacheWriteTokens: u.cache_creation_input_tokens || 0 }
}

async function post(body: any, signal: AbortSignal) {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function askClaude(opts: AskOptions) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90_000)
  const t0 = Date.now()
  const model = aiModel()
  try {
    const body: any = {
      model,
      max_tokens: opts.maxTokens ?? 800,
      system: await systemBlocks(opts),
      messages: [{ role: 'user', content: opts.prompt }],
    }
    if (opts.temperature !== undefined) body.temperature = opts.temperature
    let res = await post(body, ctrl.signal)
    // Some models only accept their default sampling settings — retry without.
    if (res.status === 400 && body.temperature !== undefined) {
      const txt = await res.text()
      if (/temperature/i.test(txt)) { delete body.temperature; res = await post(body, ctrl.signal) }
      else throw new Error(`Claude API 400: ${txt.slice(0, 300)}`)
    }
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data: any = await res.json()
    const text = (data?.content || []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('').trim()
    logCall({ purpose: opts.purpose || 'other', brain: opts.brain || null, model: String(data?.model || model), ms: Date.now() - t0, ok: true, ...usageOf(data) })
    return { text, model: String(data?.model || model) }
  }
  catch (e: any) {
    logCall({ purpose: opts.purpose || 'other', brain: opts.brain || null, model, ms: Date.now() - t0, ok: false, error: String(e?.message || e).slice(0, 300) })
    throw e
  }
  finally { clearTimeout(timer) }
}

/**
 * Streaming call — `onText` receives each piece of text as Claude writes it (Template Studio shows
 * the email building live). Resolves with the full text.
 */
export async function streamClaude(opts: AskOptions & { signal?: AbortSignal }, onText: (delta: string, full: string) => void) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 300_000)
  opts.signal?.addEventListener('abort', () => ctrl.abort())
  const t0 = Date.now()
  const model = aiModel()
  let full = ''
  let usage: any = {}
  let served = model
  try {
    const body: any = { model, max_tokens: opts.maxTokens ?? 16_000, stream: true, system: await systemBlocks(opts), messages: [{ role: 'user', content: opts.prompt }] }
    const res = await post(body, ctrl.signal)
    if (!res.ok || !res.body) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const reader = res.body.getReader()
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
        const line = block.split('\n').find(l => l.startsWith('data:'))
        if (!line) continue
        let ev: any
        try { ev = JSON.parse(line.slice(5).trim()) } catch { continue }
        if (ev.type === 'message_start') { served = ev.message?.model || model; usage = { ...usage, ...ev.message?.usage } }
        else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { full += ev.delta.text; onText(ev.delta.text, full) }
        else if (ev.type === 'message_delta') usage = { ...usage, ...ev.usage }
        else if (ev.type === 'error') throw new Error(ev.error?.message || 'Claude stream error')
      }
    }
    logCall({ purpose: opts.purpose || 'stream', brain: opts.brain || null, model: served, ms: Date.now() - t0, ok: true, ...usageOf({ usage }) })
    return { text: full, model: served }
  }
  catch (e: any) {
    logCall({ purpose: opts.purpose || 'stream', brain: opts.brain || null, model, ms: Date.now() - t0, ok: false, error: String(e?.message || e).slice(0, 300) })
    throw e
  }
  finally { clearTimeout(timer) }
}

/** First {...} block of a reply, parsed. Null when there is none or it is not valid JSON. */
export function parseJsonBlock<T = any>(text: string): T | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) as T }
  catch { return null }
}

/** Ask for JSON; returns null instead of throwing so callers can fall back to rules. */
export async function askClaudeJson<T = any>(opts: AskOptions): Promise<{ data: T, model: string } | null> {
  try {
    const r = await askClaude({ ...opts, system: `${opts.system}\n\nRespond with a single JSON object and nothing else.` })
    const data = parseJsonBlock<T>(r.text)
    return data ? { data, model: r.model } : null
  }
  catch (e: any) {
    console.warn('[AI] Claude call failed:', e?.message)
    return null
  }
}
