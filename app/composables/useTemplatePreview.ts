/**
 * Live email-template previews that render exactly like a real send.
 *
 * The server returns the merge values once (sample dealership, or a real dealership's latest audit
 * and best contact — plus the ready-made HTML blocks); {{fields}} are then filled in the browser, so
 * previews update instantly while typing and while Template Studio is writing.
 */
export interface PreviewContext {
  source: 'sample' | 'dealership'
  dealershipName: string
  vars: Record<string, string>
  rawFields: string[]
  screenshotHtml: string
  hasAudit: boolean
  auditDate: string | null
  from: { name: string, email: string }
  to: { name: string, email: string }
}
export interface RenderedEmail { html: string, subject: string, preheader: string, missing: string[] }

const contexts = new Map<string, Promise<PreviewContext>>()
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const stripTags = (s: string) => String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

export function loadPreviewContext(dealershipId?: string | null): Promise<PreviewContext> {
  const key = dealershipId || 'sample'
  if (!contexts.has(key)) {
    const p = $fetch<PreviewContext>('/api/crm/email/templates/preview-context', { method: 'POST', body: { dealershipId: dealershipId || undefined } })
    p.catch(() => contexts.delete(key))
    contexts.set(key, p)
  }
  return contexts.get(key)!
}
export function forgetPreviewContexts() { contexts.clear() }

function merge(text: string, ctx: PreviewContext, html: boolean) {
  const missing = new Set<string>()
  const raw = new Set(ctx.rawFields)
  const out = String(text || '').replace(/\{\{\s*(\w+)\s*(?:\|\s*([^}]*))?\}\}/g, (_m, key: string, fallback?: string) => {
    const v = ctx.vars[key]
    if (v) return raw.has(key) ? (html ? v : stripTags(v)) : html ? esc(v) : v
    if (fallback !== undefined) return html ? esc(fallback.trim()) : fallback.trim()
    if (!raw.has(key)) missing.add(key)
    return ''
  })
  return { text: out, missing: [...missing] }
}

function textToHtml(text: string) {
  const paras = esc(text.trim()).split(/\n{2,}/).map(p => p.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>'))
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:28px 32px;background:#ffffff;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111;max-width:600px">${paras.map(p => `<p style="margin:0 0 14px">${p}</p>`).join('')}</div></body></html>`
}

/** Render a template version (HTML or plain text) + subject with a preview context. */
export function renderEmail(v: { format?: string, html?: string, body?: string }, subject: string, ctx: PreviewContext | null): RenderedEmail {
  if (!ctx) return { html: '', subject, preheader: '', missing: [] }
  const s = merge(subject || '', ctx, false)
  if (v.format === 'html') {
    const m = merge(v.html || '', ctx, true)
    const html = m.text.replace(/__AUDIT_SCREENSHOT__/g, ctx.screenshotHtml)
    const pre = html.match(/<div[^>]*display:\s*none[^>]*>([\s\S]*?)<\/div>/i)?.[1] || ''
    return { html, subject: s.text.trim(), preheader: stripTags(pre).replace(/[ ﻿͏‌]|&#\d+;/g, '').slice(0, 140), missing: [...new Set([...s.missing, ...m.missing])] }
  }
  const m = merge(v.body || '', ctx, false)
  const text = m.text.replace(/__AUDIT_SCREENSHOT__/g, '').trim()
  return { html: textToHtml(text), subject: s.text.trim(), preheader: text.replace(/\s+/g, ' ').slice(0, 140), missing: [...new Set([...s.missing, ...m.missing])] }
}

/** Reactive preview: pick sample data or a dealership, get a render function. */
export function useTemplatePreview(initialDealershipId: string | null = null) {
  const dealershipId = ref<string | null>(initialDealershipId)
  const ctx = shallowRef<PreviewContext | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  async function load() {
    loading.value = true
    error.value = null
    try { ctx.value = await loadPreviewContext(dealershipId.value) }
    catch (e: any) { error.value = e?.data?.message || e?.data?.statusMessage || 'Could not load preview data' }
    finally { loading.value = false }
  }
  watch(dealershipId, load, { immediate: true })
  const render = (v: { format?: string, html?: string, body?: string }, subject = '') => renderEmail(v, subject, ctx.value)
  return { dealershipId, ctx, loading, error, render, reload: () => { contexts.delete(dealershipId.value || 'sample'); return load() } }
}

// ───────────────────────── Inbox check (spam-filter friendliness) ─────────────────────────
export interface InboxCheckItem { label: string, status: 'ok' | 'warn' | 'fail', detail: string }
const SPAM_WORDS = ['free', 'guarantee', 'guaranteed', 'act now', 'limited time', 'urgent', 'winner', 'click here', 'risk-free', 'risk free', '100%', 'cash', 'buy now', 'order now', 'earn', 'no cost', 'no obligation', 'special promotion', 'congratulations', 'cheap', 'lowest price', 'best price', 'deal of', 'once in a lifetime', '$$$', 'double your', 'miracle']
const SHORTENERS = /(bit\.ly|tinyurl|goo\.gl|t\.co|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly)\//i

/**
 * Checks what spam filters look at: subject, wording, HTML weight (Gmail clips at 102 KB), images
 * vs text, links, opt-out line, preview text and personalization. Content-only — the domain side
 * (SPF / DKIM / DMARC) is on Email → Settings.
 */
export function inboxCheck(r: RenderedEmail, source: { html?: string, body?: string, format?: string }): { score: number, items: InboxCheckItem[] } {
  const items: InboxCheckItem[] = []
  const html = r.html || ''
  const text = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(style|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()
  const words = text ? text.split(' ').length : 0
  const subj = r.subject || ''
  // Subject
  const capsWords = (subj.match(/\b[A-Z]{4,}\b/g) || []).length
  const subjSpam = SPAM_WORDS.filter(w => subj.toLowerCase().includes(w))
  if (!subj) items.push({ label: 'Subject line', status: 'fail', detail: 'Missing' })
  else if (subj.includes('!') || capsWords || subjSpam.length) items.push({ label: 'Subject line', status: 'warn', detail: [subj.includes('!') ? 'has “!”' : '', capsWords ? 'has ALL-CAPS words' : '', subjSpam.length ? `trigger words: ${subjSpam.join(', ')}` : ''].filter(Boolean).join(' · ') })
  else if (subj.length > 70) items.push({ label: 'Subject line', status: 'warn', detail: `${subj.length} characters — under 60 reads better on phones` })
  else items.push({ label: 'Subject line', status: 'ok', detail: `${subj.length} characters, no trigger words` })
  // Wording
  const lower = text.toLowerCase()
  const bodySpam = SPAM_WORDS.filter(w => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\$]/g, '\\$&')}([^a-z]|$)`).test(lower))
  const bangs = (text.match(/!/g) || []).length
  items.push(bodySpam.length > 2 || bangs > 2
    ? { label: 'Wording', status: 'warn', detail: [bodySpam.length ? `trigger words: ${bodySpam.slice(0, 5).join(', ')}` : '', bangs > 2 ? `${bangs} exclamation marks` : ''].filter(Boolean).join(' · ') }
    : { label: 'Wording', status: 'ok', detail: bodySpam.length ? `only mild words (${bodySpam.join(', ')})` : 'no spam-trigger words' })
  // Weight
  const kb = Math.round(new Blob([html]).size / 1024)
  items.push(kb > 100 ? { label: 'Email size', status: 'fail', detail: `${kb} KB — Gmail cuts emails over 102 KB` } : kb > 60 ? { label: 'Email size', status: 'warn', detail: `${kb} KB — lighter emails land better` } : { label: 'Email size', status: 'ok', detail: `${kb} KB` })
  // Images vs text
  const imgs = (html.match(/<img\b/gi) || []).length
  const b64 = /<img[^>]+src=["']data:/i.test(html)
  items.push(b64 ? { label: 'Images', status: 'fail', detail: 'Embedded (base64) images are often blocked' } : imgs > 3 && words < 120 ? { label: 'Images', status: 'warn', detail: `${imgs} images, little text — image-heavy emails look like promotions` } : { label: 'Images', status: 'ok', detail: imgs ? `${imgs} image${imgs === 1 ? '' : 's'} with plenty of text` : 'No images — reads as a personal email' })
  // Links
  const links = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1]!).filter(h => !/^mailto:|^tel:|^#/.test(h))
  const shortened = links.filter(l => SHORTENERS.test(l))
  items.push(shortened.length ? { label: 'Links', status: 'fail', detail: 'URL shorteners are a strong spam signal' } : links.length > 10 ? { label: 'Links', status: 'warn', detail: `${links.length} links — keep cold emails under ~8` } : { label: 'Links', status: 'ok', detail: `${links.length} web link${links.length === 1 ? '' : 's'}` })
  // Text amount
  items.push(words < 40 ? { label: 'Text', status: 'warn', detail: `Only ${words} words of text` } : { label: 'Text', status: 'ok', detail: `${words} words` })
  // Opt-out
  items.push(/unsubscribe|no thanks|opt[ -]?out|won.t follow up|stop (these|emailing)/i.test(text) ? { label: 'Opt-out line', status: 'ok', detail: 'Easy way to say no (plus one-click unsubscribe header)' } : { label: 'Opt-out line', status: 'warn', detail: 'Add a line like “Reply ‘no thanks’ and we won’t follow up”' })
  // Preview text
  if (source.format === 'html') items.push(r.preheader ? { label: 'Preview text', status: 'ok', detail: r.preheader.slice(0, 80) } : { label: 'Preview text', status: 'warn', detail: 'No hidden preheader — inboxes will show the first words of the layout' })
  // Personalization
  const src = `${source.html || ''} ${source.body || ''}`
  items.push(/\{\{\s*(firstName|dealership)/.test(src) ? { label: 'Personal', status: 'ok', detail: 'Uses their name / dealership' } : { label: 'Personal', status: 'warn', detail: 'Mention {{dealership}} or {{firstName}} — personal emails land in Primary' })
  // Blank fields
  if (r.missing.length) items.push({ label: 'Blank fields', status: 'warn', detail: `No data for ${r.missing.map(m => `{{${m}}}`).join(', ')}` })
  const score = Math.round(100 * items.reduce((a, i) => a + (i.status === 'ok' ? 1 : i.status === 'warn' ? 0.5 : 0), 0) / Math.max(1, items.length))
  return { score, items }
}
