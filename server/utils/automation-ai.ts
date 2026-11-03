/**
 * Thin Claude API client for the automations (drafts, reply classification, summaries, insights).
 * Uses ANTHROPIC_API_KEY (+ optional ANTHROPIC_MODEL). Every caller has a rules-based fallback,
 * so the CRM keeps working when no key is set or the API is down.
 */
import process from 'node:process'

export const aiModel = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'
export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY

export async function askClaude(opts: { system: string, prompt: string, maxTokens?: number, temperature?: number }) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 45_000)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: aiModel(),
        max_tokens: opts.maxTokens ?? 800,
        temperature: opts.temperature ?? 0.3,
        system: opts.system,
        messages: [{ role: 'user', content: opts.prompt }],
      }),
    })
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data: any = await res.json()
    const text = (data?.content || []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('').trim()
    return { text, model: String(data?.model || aiModel()) }
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
export async function askClaudeJson<T = any>(opts: { system: string, prompt: string, maxTokens?: number }): Promise<{ data: T, model: string } | null> {
  try {
    const r = await askClaude({ ...opts, system: `${opts.system}\n\nRespond with a single JSON object and nothing else.` })
    const data = parseJsonBlock<T>(r.text)
    return data ? { data, model: r.model } : null
  }
  catch (e: any) {
    console.warn('[Automations] Claude call failed:', e?.message)
    return null
  }
}
