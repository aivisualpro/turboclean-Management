/**
 * Inventory Scanner (client): drives a live, server-side Chrome session through
 * /api/scanner/* and Server-Sent Events. One instance per open scanner dialog.
 */
export type PhotoVerdict = 'real' | 'placeholder' | 'stock' | 'missing' | 'review'
export type FinalVerdict = Exclude<PhotoVerdict, 'review'>
export interface ScannerProgress { phase: 'browsing' | 'collecting' | 'analyzing' | 'done' | 'stopped' | 'error', page: number, vehicles: number, advertised: number | null, analyzed: number, toAnalyze: number, message: string, startedAt: string | null, finishedAt: string | null, pagesVisited: string[] }
export interface ScannerState { id: string, dealershipId: string, dealershipName: string, url: string, title: string, loading: boolean, navLinks: { label: string, href: string, kind: string }[], history: { canBack: boolean, canForward: boolean }, viewport: { width: number, height: number }, progress: ScannerProgress, scanning: boolean, hasResults: boolean, savedAuditId: string | null, browser: 'local' | 'remote' }
export interface ScannedVehicle {
  key: string
  title: string
  year: number | null
  make: string
  model: string
  vin: string
  stock: string
  price: string
  condition: 'new' | 'used' | 'certified' | ''
  url: string
  image: { url: string, alt: string, nw: number, nh: number } | null
  imageId: string | null
  imageCount: number
  photoCountText: string
  page: number
  verdict: PhotoVerdict
  suggested: FinalVerdict
  final: FinalVerdict
  confidence: number
  reasons: string[]
  clusterId: string | null
  override: FinalVerdict | null
}
export interface ScannedImage { id: string, url: string, ok: boolean, error: string | null, w: number | null, h: number | null, hash: string | null, thumb: string | null, text: string, ocr: boolean }
export interface ImageGroup { id: string, imageIds: string[], hash: string, vehicles: number, models: number, modelNames: string[], thumb: string, url: string, verdict: PhotoVerdict, reason: string, override: FinalVerdict | null }
export interface ScanResults {
  summary: { total: number, by: Record<FinalVerdict, number>, withoutReal: number, withoutRealPct: number | null, review: number, counts: { newTotal: number, usedTotal: number, newMissingPhotos: number, usedMissingPhotos: number }, newPct: number | null, usedPct: number | null }
  countStockAsMissing: boolean
  advertised: number | null
  pages: string[]
  vehicles: ScannedVehicle[]
  clusters: ImageGroup[]
  images: Record<string, ScannedImage>
  hasEvidence: boolean
  savedAuditId: string | null
  labels: Record<PhotoVerdict, string>
}
export interface ImageRule { id: string, hash: string, urlContains: string, verdict: FinalVerdict, label: string, thumb: string, hits: number, createdAt: string, createdBy: { name: string } | null }

export const VERDICT_META: Record<PhotoVerdict, { label: string, short: string, dot: string, pill: string, ring: string, hex: string }> = {
  real: { label: 'Real photo', short: 'Real', dot: 'bg-emerald-500', pill: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30', ring: 'ring-emerald-500/40', hex: '#10b981' },
  // A placeholder ("Vehicle photos unavailable", "coming soon"…) means the car has no photo.
  placeholder: { label: 'No photo', short: 'No photo', dot: 'bg-rose-500', pill: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/30', ring: 'ring-rose-500/50', hex: '#f43f5e' },
  stock: { label: 'Stock image', short: 'Stock', dot: 'bg-violet-500', pill: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-violet-500/30', ring: 'ring-violet-500/50', hex: '#8b5cf6' },
  missing: { label: 'No photo', short: 'No photo', dot: 'bg-rose-500', pill: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/30', ring: 'ring-rose-500/50', hex: '#f43f5e' },
  review: { label: 'Needs review', short: 'Review', dot: 'bg-sky-500', pill: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30', ring: 'ring-sky-500/50', hex: '#0ea5e9' },
}

export function useInventoryScanner() {
  const state = ref<ScannerState | null>(null)
  const progress = ref<ScannerProgress | null>(null)
  const results = ref<ScanResults | null>(null)
  const log = ref<{ at: string, text: string }[]>([])
  const frame = ref<{ data: string, w: number, h: number, ts: number } | null>(null)
  const connected = ref(false)
  const error = ref<string | null>(null)
  const ended = ref<string | null>(null)
  let es: EventSource | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let lastFrameAt = 0

  const base = () => `/api/scanner/sessions/${state.value?.id}`

  function listen() {
    if (!state.value) return
    es?.close()
    es = new EventSource(`${base()}/stream`)
    es.onopen = () => { connected.value = true }
    es.onerror = async () => {
      connected.value = false
      // The server restarted (or the session timed out): stop retrying and tell the user.
      try { await $fetch(base()) }
      catch (e: any) { if (e?.statusCode === 404 || e?.response?.status === 404) { ended.value = 'The scanner session ended (the server restarted or it was idle too long)'; es?.close() } }
    }
    es.addEventListener('frame', (e: MessageEvent) => { frame.value = JSON.parse(e.data); lastFrameAt = Date.now() })
    es.addEventListener('state', (e: MessageEvent) => { state.value = JSON.parse(e.data); progress.value = state.value!.progress })
    es.addEventListener('progress', (e: MessageEvent) => { progress.value = JSON.parse(e.data) })
    es.addEventListener('log', (e: MessageEvent) => { log.value = [...log.value.slice(-80), JSON.parse(e.data)] })
    es.addEventListener('result', (e: MessageEvent) => { results.value = JSON.parse(e.data) })
    es.addEventListener('failure', (e: MessageEvent) => { try { error.value = JSON.parse(e.data).message } catch {} })
    es.addEventListener('closed', (e: MessageEvent) => { try { ended.value = JSON.parse(e.data).reason || 'closed' } catch { ended.value = 'closed' } es?.close() })
    // Fallback: if no frames arrive over SSE (proxy buffering), poll the latest frame.
    pollTimer = setInterval(async () => {
      if (!state.value || ended.value || Date.now() - lastFrameAt < 4000) return
      try {
        const blob = await $fetch<Blob>(`${base()}/frame`, { responseType: 'blob' })
        if (blob && (blob as any).size) {
          const data = await new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.readAsDataURL(blob) })
          frame.value = { data, w: state.value.viewport.width, h: state.value.viewport.height, ts: Date.now() }
        }
      } catch {}
    }, 1000)
  }

  async function open(dealershipId: string, url?: string) {
    error.value = null; ended.value = null; results.value = null; log.value = []; frame.value = null
    state.value = await $fetch<ScannerState>('/api/scanner/sessions', { method: 'POST', body: { dealershipId, url } })
    progress.value = state.value.progress
    listen()
  }
  async function close() {
    es?.close(); es = null
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
    const id = state.value?.id
    state.value = null
    if (id) await fetch(`/api/scanner/sessions/${id}`, { method: 'DELETE', keepalive: true, credentials: 'same-origin' }).catch(() => {})
  }
  // Input is fire-and-forget, batched so fast mouse moves don't flood the server.
  let queue: any[] = []
  let flushing = false
  async function flush() {
    if (flushing || !queue.length || !state.value) return
    flushing = true
    const events = queue.splice(0, 50)
    try { await $fetch(`${base()}/input`, { method: 'POST', body: { events } }) } catch {}
    flushing = false
    if (queue.length) flush()
  }
  function input(e: any) {
    if (e.type === 'move') { const last = queue[queue.length - 1]; if (last?.type === 'move') { queue[queue.length - 1] = e; return } }
    if (e.type === 'wheel') { const last = queue[queue.length - 1]; if (last?.type === 'wheel') { last.dy += e.dy; last.dx += e.dx; last.x = e.x; last.y = e.y; return } }
    queue.push(e)
    flush()
  }
  const go = (body: { url?: string, action?: 'back' | 'forward' | 'reload' }) => $fetch(`${base()}/navigate`, { method: 'POST', body })
  async function scan(opts: { allPages?: boolean, append?: boolean } = {}) {
    error.value = null
    if (!opts.append) results.value = null
    const s = await $fetch<ScannerState>(`${base()}/scan`, { method: 'POST', body: opts })
    state.value = s; progress.value = s.progress
  }
  const stop = () => $fetch(`${base()}/stop`, { method: 'POST' })
  async function review(body: { vehicles?: { key: string, verdict: FinalVerdict | null }[], clusters?: { id: string, verdict: FinalVerdict | null }[], countStockAsMissing?: boolean, reapplyRules?: boolean }) {
    results.value = await $fetch<ScanResults>(`${base()}/review`, { method: 'POST', body })
  }
  async function save() {
    const r = await $fetch<{ audit: any, summary: any }>(`${base()}/save`, { method: 'POST' })
    if (results.value) results.value = { ...results.value, savedAuditId: r.audit?.id || 'saved' }
    return r
  }
  async function refreshResults() {
    const r = await $fetch<{ results: ScanResults | null }>(base())
    if (r.results) results.value = r.results
  }
  const status = () => $fetch<{ ok: boolean, kind: string, binary: string | null }>('/api/scanner/status')
  const listRules = () => $fetch<{ rules: ImageRule[] }>('/api/scanner/rules')
  const addRule = (body: { hash?: string, urlContains?: string, verdict: FinalVerdict, label?: string, thumb?: string }) => $fetch<{ rule: ImageRule }>('/api/scanner/rules', { method: 'POST', body })
  const removeRule = (id: string) => $fetch(`/api/scanner/rules/${id}`, { method: 'DELETE' })

  onBeforeUnmount(() => { close() })
  return { state, progress, results, log, frame, connected, error, ended, open, close, input, go, scan, stop, review, save, refreshResults, status, listRules, addRule, removeRule }
}
