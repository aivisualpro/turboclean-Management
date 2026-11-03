/**
 * Inventory Scanner (client). Works the same on a laptop and on serverless hosting (Vercel):
 *  - preview(): a full-page snapshot of a dealer page (scrollable, not clickable) + shortcuts
 *  - run():     one streaming request that collects every vehicle and checks every photo, with
 *               progress, a log and low-res live frames; the scan is stored as it goes, so if the
 *               stream drops we fall back to polling the stored scan.
 *  - review / save work on the stored scan by id.
 */
export type PhotoVerdict = 'real' | 'placeholder' | 'stock' | 'missing' | 'review'
export type FinalVerdict = Exclude<PhotoVerdict, 'review'>
export interface ScannerProgress { phase: 'collecting' | 'analyzing' | 'done' | 'stopped' | 'error', page: number, vehicles: number, advertised: number | null, analyzed: number, toAnalyze: number, message: string, startedAt: string | null, finishedAt: string | null, pagesVisited: string[] }
export type ScanStatus = 'running' | 'done' | 'stopped' | 'failed' | 'saved' | 'interrupted'
export interface ScanMeta { id: string, dealershipId: string, status: ScanStatus, startUrl: string, allPages: boolean, progress: ScannerProgress, log: { at: string, text: string }[], error: string | null, auditId: string | null, createdAt: string, createdBy: { id: string, name: string }, savedAt: string | null, vehicles: number }
export interface NavLink { label: string, href: string, kind: string }
export interface Hotspot { x: number, y: number, w: number, h: number, href: string, label: string, children?: { label: string, href: string }[] }
export interface SitePage { label: string, href: string, kind: string, nav: boolean }
export interface PagePreview { url: string, title: string, screenshot: string, width: number, height: number, pageHeight: number, httpStatus: number | null, navLinks: NavLink[], hotspots: Hotspot[], pages: SitePage[], detected: { cards: number, advertised: number | null, strategy: string | null } }
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
export interface ScannedImage { id: string, url: string, ok: boolean, error: string | null, w: number | null, h: number | null, hash: string | null, text: string, ocr: boolean }
export interface ImageGroup { id: string, imageIds: string[], hash: string, vehicles: number, models: number, modelNames: string[], thumb: string, url: string, verdict: PhotoVerdict, reason: string, override: FinalVerdict | null }
export interface ScanResults {
  scanId: string
  summary: { total: number, by: Record<FinalVerdict, number>, withoutReal: number, withoutRealPct: number | null, review: number, counts: { newTotal: number, usedTotal: number, newMissingPhotos: number, usedMissingPhotos: number }, newPct: number | null, usedPct: number | null }
  countStockAsMissing: boolean
  advertised: number | null
  pages: string[]
  vehicles: ScannedVehicle[]
  clusters: ImageGroup[]
  images: Record<string, ScannedImage>
  savedAuditId: string | null
  labels: Record<PhotoVerdict, string>
  finishedAt: string | null
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

const errMsg = (e: any, fallback: string) => e?.data?.message || e?.data?.statusMessage || e?.statusMessage || e?.message || fallback

export function useInventoryScanner() {
  const preview = ref<PagePreview | null>(null)
  const previewing = ref(false)
  const previewError = ref<string | null>(null)
  const scan = ref<ScanMeta | null>(null)
  const progress = ref<ScannerProgress | null>(null)
  const results = ref<ScanResults | null>(null)
  const log = ref<{ at: string, text: string }[]>([])
  const frame = ref<{ data: string, w: number, h: number, ts: number } | null>(null)
  const error = ref<string | null>(null)
  const running = ref(false)
  let abort: AbortController | null = null
  let previewSeq = 0
  let poll: ReturnType<typeof setInterval> | null = null
  let disposed = false

  const status = () => $fetch<{ ok: boolean, kind: string, binary: string | null }>('/api/scanner/status')

  let previewAbort: AbortController | null = null
  async function loadPreview(dealershipId: string, url?: string) {
    const seq = ++previewSeq
    previewAbort?.abort()
    previewAbort = new AbortController()
    previewing.value = true
    previewError.value = null
    try {
      const p = await $fetch<PagePreview>('/api/scanner/preview', { method: 'POST', body: { dealershipId, url }, signal: previewAbort.signal })
      if (seq === previewSeq) preview.value = p
    }
    catch (e: any) { if (seq === previewSeq && e?.name !== 'AbortError') previewError.value = errMsg(e, 'Could not open that page') }
    finally { if (seq === previewSeq) previewing.value = false }
  }

  function apply(p: { scan: ScanMeta | null, results: ScanResults | null }) {
    scan.value = p.scan
    if (p.scan) { progress.value = p.scan.progress; if (p.scan.log?.length) log.value = p.scan.log }
    results.value = p.results
  }

  /** The dealership's last scan — shows "last scanned …" and lets you reopen its results. */
  async function loadLatest(dealershipId: string) {
    disposed = false
    const p = await $fetch<{ scan: ScanMeta | null, results: ScanResults | null }>('/api/scanner/scans', { query: { dealershipId } })
    apply(p)
    if (p.scan?.status === 'running') watchStored(p.scan.id)
    return p
  }

  async function refresh(id = scan.value?.id) {
    if (!id) return null
    const p = await $fetch<{ scan: ScanMeta, results: ScanResults | null }>(`/api/scanner/scans/${id}`)
    apply(p)
    return p
  }

  /** Poll a stored scan until it finishes (a scan started elsewhere, or after the stream dropped). Resolves when done. */
  function watchStored(id: string): Promise<void> {
    stopPolling()
    running.value = true
    return new Promise((resolve) => {
      let failures = 0
      poll = setInterval(async () => {
        if (disposed) { stopPolling(); running.value = false; resolve(); return }
        try {
          const p = await refresh(id)
          failures = 0
          if (p && p.scan.status !== 'running') { stopPolling(); running.value = false; resolve() }
        }
        catch { if (++failures > 20) { stopPolling(); running.value = false; error.value = 'Lost contact with the server — reopen the scanner to see the last scan'; resolve() } }
      }, 3000)
    })
  }
  function stopPolling() { if (poll) clearInterval(poll); poll = null }

  /** Run a scan in one streaming request. Resolves when it is finished (or failed). */
  async function run(dealershipId: string, opts: { url?: string, allPages?: boolean, appendTo?: string | null } = {}) {
    disposed = false
    error.value = null
    frame.value = null
    log.value = []
    if (!opts.appendTo) results.value = null
    running.value = true
    progress.value = { phase: 'collecting', page: 0, vehicles: 0, advertised: null, analyzed: 0, toAnalyze: 0, message: 'Starting a private browser…', startedAt: new Date().toISOString(), finishedAt: null, pagesVisited: [] }
    abort?.abort()
    abort = new AbortController()
    let scanId: string | null = null
    let finished = false
    let lastEvent = Date.now()
    const watchdog = setInterval(() => { if (Date.now() - lastEvent > 40_000) abort?.abort() }, 5000)
    try {
      const res = await fetch('/api/scanner/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({ dealershipId, url: opts.url, allPages: opts.allPages !== false, appendTo: opts.appendTo || undefined }),
        signal: abort.signal,
        credentials: 'same-origin',
      })
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message || body?.statusMessage || `The scan could not start (${res.status})`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      const handle = (name: string, data: any) => {
        lastEvent = Date.now()
        switch (name) {
          case 'scan': scanId = data.id; break
          case 'progress': progress.value = data; break
          case 'log': log.value = [...log.value.slice(-80), data]; break
          case 'frame': frame.value = data; break
          case 'done': finished = true; break
          case 'failure': finished = true; error.value = data.message; break
        }
      }
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          let name = 'message'
          let data = ''
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) name = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          if (data) { try { handle(name, JSON.parse(data)) } catch {} }
        }
      }
    }
    catch (e: any) {
      if (!scanId) { running.value = false; error.value = errMsg(e, 'The scan could not start'); clearInterval(watchdog); throw new Error(error.value!) }
    }
    finally { clearInterval(watchdog) }
    if (!scanId || disposed) { running.value = false; return }
    // Load the stored scan (results, final progress). If the stream dropped mid-scan, poll until it ends.
    let p = await refresh(scanId).catch(() => null)
    if (!p) { for (let i = 0; i < 5 && !p; i++) { await new Promise(r => setTimeout(r, 2000)); p = await refresh(scanId).catch(() => null) } }
    if (p?.scan.status === 'running' && !finished) await watchStored(scanId)
    else if (!p) error.value = error.value || 'The scan finished but its results could not be loaded — reopen the scanner to see them'
    running.value = false
  }

  async function stop() {
    const id = scan.value?.id
    if (id) await $fetch(`/api/scanner/scans/${id}/stop`, { method: 'POST' }).catch(() => {})
  }

  /** Close the dialog: a running scan is asked to stop (what it found is still checked and kept). */
  function dispose() {
    disposed = true
    if (running.value && scan.value?.id) fetch(`/api/scanner/scans/${scan.value.id}/stop`, { method: 'POST', keepalive: true, credentials: 'same-origin' }).catch(() => {})
    abort?.abort()
    abort = null
    stopPolling()
    running.value = false
  }

  async function review(body: { vehicles?: { key: string, verdict: FinalVerdict | null }[], clusters?: { id: string, verdict: FinalVerdict | null }[], countStockAsMissing?: boolean, reapplyRules?: boolean }) {
    if (!results.value) return
    results.value = await $fetch<ScanResults>(`/api/scanner/scans/${results.value.scanId}/review`, { method: 'POST', body })
  }
  async function save() {
    if (!results.value) throw new Error('Nothing to save')
    const r = await $fetch<{ audit: any, summary: any }>(`/api/scanner/scans/${results.value.scanId}/save`, { method: 'POST' })
    results.value = { ...results.value, savedAuditId: r.audit?.id || 'saved' }
    if (scan.value) scan.value = { ...scan.value, status: 'saved', auditId: r.audit?.id || null, savedAt: new Date().toISOString() }
    return r
  }
  const listRules = () => $fetch<{ rules: ImageRule[] }>('/api/scanner/rules')
  const addRule = (body: { hash?: string, urlContains?: string, verdict: FinalVerdict, label?: string, thumb?: string }) => $fetch<{ rule: ImageRule }>('/api/scanner/rules', { method: 'POST', body })
  const removeRule = (id: string) => $fetch(`/api/scanner/rules/${id}`, { method: 'DELETE' })

  function reset() {
    dispose()
    preview.value = null; previewError.value = null; previewing.value = false
    scan.value = null; progress.value = null; results.value = null; log.value = []; frame.value = null; error.value = null
  }

  onBeforeUnmount(dispose)
  return { preview, previewing, previewError, scan, progress, results, log, frame, error, running, status, loadPreview, loadLatest, refresh, run, stop, dispose, reset, review, save, listRules, addRule, removeRule }
}
