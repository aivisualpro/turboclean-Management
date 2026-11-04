import { streamScanRun } from '~/composables/useInventoryScanner'
import type { ScannerProgress } from '~/composables/useInventoryScanner'

/**
 * Batch scanning ("Mission Control"): this browser drives a stored batch — it claims the next queued
 * dealership, streams its scan, and moves on, with `concurrency` scans at once. Everything is kept
 * on the server as it happens (claims are atomic, scans auto-save their audits), so closing the
 * console pauses the batch and Resume picks it up — from any browser.
 */
export type ItemStatus = 'queued' | 'running' | 'done' | 'stopped' | 'failed' | 'skipped' | 'cancelled'
export interface BatchItem {
  /** How many times this dealership has been claimed (auto-retries stop at 3). */
  attempts?: number
  /** Continue a paused scan instead of starting over (set by the server when a stopped item is queued again). */
  resumeFrom?: string | null
  dealershipId: string, name: string, website: string, urls: string[], status: ItemStatus, scanId: string | null, auditId: string | null
  summary: { total: number, withoutReal: number, withoutRealPct: number | null, by?: Record<string, number> } | null
  error: string | null, claimedAt: string | null, finishedAt: string | null
  email: { mode: 'now' | 'queue', status: 'sent' | 'queued' | 'failed' | 'skipped', emailId?: string | null, draftId?: string | null, to?: string, subject?: string, templateName?: string, error?: string | null, at: string } | null
}
export interface Batch {
  id: string, name: string, status: 'running' | 'done', items: BatchItem[], concurrency: number, autoSave: boolean, createdAt: string, createdBy: { id: string, name: string } | null, finishedAt?: string
  counts: Record<'total' | ItemStatus, number>, totals: { vehicles: number, withoutReal: number, emailed: number }, finished: boolean
}
/** Live state of one dealership while this browser scans it. */
export interface LiveRun { dealershipId: string, progress: ScannerProgress | null, log: { at: string, text: string }[], frame: string | null, startedAt: number, lastEvent: number, scanId: string | null }
export interface EmailDealer { dealershipId: string, stage: string, city: string, state: string, contacts: { id: string, name: string, email: string, title: string, doNotEmail: boolean, bounced: boolean, isPrimary: boolean }[], bestContactId: string | null, lastEmail: { subject: string, sentAt: string, to: string, templateName: string, replied: boolean } | null }

export function useBatchScan() {
  const batch = ref<Batch | null>(null)
  const live = ref<Record<string, LiveRun>>({})
  const driving = ref(false)
  const concurrency = ref(2)
  const error = ref<string | null>(null)
  const feed = ref<{ at: number, dealershipId: string, name: string, text: string, kind: 'info' | 'ok' | 'warn' | 'err' }[]>([])
  let stopRequested = false
  let aborts: AbortController[] = []
  let refreshTimer: ReturnType<typeof setInterval> | null = null
  /** Called when every worker has stopped (batch finished, paused or cancelled). */
  let onFinished: ((b: Batch | null, reason: 'finished' | 'paused') => void) | null = null
  const whenFinished = (fn: typeof onFinished) => { onFinished = fn }

  const say = (dealershipId: string, name: string, text: string, kind: 'info' | 'ok' | 'warn' | 'err' = 'info') => { feed.value = [...feed.value.slice(-299), { at: Date.now(), dealershipId, name, text, kind }] }

  async function create(dealershipIds: string[], opts: { pages?: Record<string, string[]>, concurrency?: number, name?: string } = {}) {
    error.value = null
    const r = await $fetch<{ batch: Batch }>('/api/scanner/batches', { method: 'POST', body: { dealershipIds, pages: opts.pages, concurrency: opts.concurrency ?? concurrency.value, name: opts.name } })
    batch.value = r.batch
    concurrency.value = r.batch.concurrency
    return r.batch
  }
  async function load(id: string) {
    const r = await $fetch<{ batch: Batch }>(`/api/scanner/batches/${id}`)
    batch.value = r.batch
    return r.batch
  }
  const list = () => $fetch<{ batches: Batch[] }>('/api/scanner/batches')

  /** Scan one claimed dealership and stream it into `live`. */
  async function runItem(item: BatchItem) {
    const b = batch.value!
    const ctrl = new AbortController()
    aborts.push(ctrl)
    const run: LiveRun = { dealershipId: item.dealershipId, progress: null, log: [], frame: null, startedAt: Date.now(), lastEvent: Date.now(), scanId: null }
    live.value = { ...live.value, [item.dealershipId]: run }
    say(item.dealershipId, item.name, `Starting — ${item.urls.length} page${item.urls.length === 1 ? '' : 's'}`)
    const touch = () => { run.lastEvent = Date.now(); live.value = { ...live.value } }
    let failure: string | null = null
    try {
      if (item.resumeFrom) say(item.dealershipId, item.name, 'Continuing the paused scan — keeping what it found', 'info')
      const r = await streamScanRun({ dealershipId: item.dealershipId, urls: item.urls, allPages: true, batchId: b.id, autoSave: b.autoSave !== false, appendTo: item.resumeFrom || undefined }, (name, data) => {
        if (name === 'scan') run.scanId = data.id
        else if (name === 'progress') run.progress = data
        else if (name === 'log') { run.log = [...run.log.slice(-60), data]; say(item.dealershipId, item.name, data.text) }
        else if (name === 'frame') run.frame = `data:image/jpeg;base64,${data.data}`
        else if (name === 'done') say(item.dealershipId, item.name, `${data.summary.total} vehicles · ${data.summary.withoutReal} without a real photo (${data.summary.withoutRealPct ?? 0}%)`, 'ok')
        else if (name === 'failure') { failure = data.message; say(item.dealershipId, item.name, data.message, 'err') }
        else if (name === 'saved') say(item.dealershipId, item.name, 'Audit saved to the CRM', 'ok')
        touch()
      }, ctrl.signal)
      if (!r.finished && r.scanId) {
        // The stream broke (network blip, proxy timeout) but the server keeps scanning — follow it by polling.
        say(item.dealershipId, item.name, 'Connection dropped — following the scan on the server', 'warn')
        failure = await followStored(r.scanId, run, item, ctrl.signal)
      }
    }
    catch (e: any) {
      if (ctrl.signal.aborted) say(item.dealershipId, item.name, 'Paused — will resume with the batch', 'warn')
      else say(item.dealershipId, item.name, e?.message || 'Could not start', 'err')
    }
    finally {
      aborts = aborts.filter(a => a !== ctrl)
      const next = { ...live.value }
      delete next[item.dealershipId]
      live.value = next
      await load(b.id).catch(() => {})
      // The cloud browser died under it (not the dealer's fault) → try again, keeping what it found.
      if (failure && BROWSER_GONE.test(failure) && (item.attempts || 1) < 3 && !stopRequested && batch.value) {
        say(item.dealershipId, item.name, `Browser crashed — trying again (attempt ${(item.attempts || 1) + 1} of 3), keeping what it found`, 'warn')
        await $fetch<{ batch: Batch }>(`/api/scanner/batches/${batch.value.id}/requeue`, { method: 'POST', body: { dealershipId: item.dealershipId, resume: true } }).then(r => { batch.value = r.batch }).catch(() => {})
      }
    }
  }
  const BROWSER_GONE = /connection is closed|Target closed|Session closed|target crashed|browser (has )?disconnected|No target with given id|Cut off by the server/i
  /** Poll a scan the server is still running until it ends; mirrors progress/log into the live card. Returns the failure message, if any. */
  async function followStored(scanId: string, run: LiveRun, item: BatchItem, signal: AbortSignal): Promise<string | null> {
    const until = Date.now() + 20 * 60_000
    let seenLogs = 0
    while (Date.now() < until && !signal.aborted) {
      await new Promise(r => setTimeout(r, 4000))
      let p: any
      try { p = await $fetch<any>(`/api/scanner/scans/${scanId}`) } catch { continue }
      const sc = p?.scan
      if (!sc) continue
      run.progress = sc.progress
      const logs: { at: string, text: string }[] = sc.log || []
      if (logs.length > seenLogs) { for (const l of logs.slice(seenLogs)) say(item.dealershipId, item.name, l.text); run.log = [...run.log.slice(-60), ...logs.slice(seenLogs)]; seenLogs = logs.length }
      run.lastEvent = Date.now(); live.value = { ...live.value }
      if (sc.status === 'running' || sc.status === 'interrupted') continue
      if (sc.status === 'failed') return sc.error || 'Scan failed'
      // Cut off on the server (host teardown) → counts as a crash so it is picked up again.
      if (sc.status === 'stopped' && /cut off/i.test(sc.error || '')) return 'Cut off by the server'
      return null
    }
    return null
  }

  /** Drive the batch: keep `concurrency` scans running until nothing is queued. */
  async function drive() {
    if (!batch.value || driving.value) return
    driving.value = true
    stopRequested = false
    error.value = null
    refreshTimer = setInterval(() => { if (batch.value) load(batch.value.id).catch(() => {}) }, 8000)
    const workers: Promise<void>[] = []
    const worker = async () => {
      while (!stopRequested && batch.value) {
        let claimed: { item: BatchItem | null, batch: Batch }
        try { claimed = await $fetch(`/api/scanner/batches/${batch.value.id}/claim`, { method: 'POST' }) }
        catch (e: any) { error.value = e?.data?.statusMessage || 'Lost contact with the server'; await new Promise(r => setTimeout(r, 5000)); continue }
        batch.value = claimed.batch
        if (!claimed.item) return
        await runItem(claimed.item)
      }
    }
    try {
      for (let i = 0; i < Math.max(1, concurrency.value); i++) { workers.push(worker()); await new Promise(r => setTimeout(r, 1500)) }
      await Promise.all(workers)
    }
    finally {
      if (refreshTimer) clearInterval(refreshTimer)
      refreshTimer = null
      driving.value = false
      if (batch.value) await load(batch.value.id).catch(() => {})
      onFinished?.(batch.value, stopRequested ? 'paused' : 'finished')
    }
  }
  /** Queue every paused (stopped) dealership again so Resume continues where it left off. */
  async function resumeStopped() {
    if (!batch.value) return 0
    const id = batch.value.id
    const stopped = batch.value.items.filter(i => i.status === 'stopped')
    for (const i of stopped) {
      const r = await $fetch<{ batch: Batch }>(`/api/scanner/batches/${id}/requeue`, { method: 'POST', body: { dealershipId: i.dealershipId } }).catch(() => null)
      if (r) batch.value = r.batch
    }
    return stopped.length
  }

  /** Pause: stop claiming; running scans are asked to stop and keep what they found. */
  async function pause() {
    stopRequested = true
    const ids = Object.values(live.value).map(r => r.scanId).filter(Boolean) as string[]
    await Promise.all(ids.map(id => $fetch(`/api/scanner/scans/${id}/stop`, { method: 'POST' }).catch(() => {})))
  }
  /** Cancel everything still queued (running scans stop and keep what they found). */
  async function cancel() {
    stopRequested = true
    if (!batch.value) return
    const r = await $fetch<{ batch: Batch }>(`/api/scanner/batches/${batch.value.id}/cancel`, { method: 'POST' })
    batch.value = r.batch
  }
  async function requeue(dealershipId: string, urls?: string[]) {
    if (!batch.value) return
    const r = await $fetch<{ batch: Batch }>(`/api/scanner/batches/${batch.value.id}/requeue`, { method: 'POST', body: { dealershipId, urls } })
    batch.value = r.batch
    if (!driving.value) drive()
  }
  function dispose() {
    stopRequested = true
    for (const a of aborts) a.abort()
    aborts = []
    if (refreshTimer) clearInterval(refreshTimer)
    refreshTimer = null
    driving.value = false
  }

  // ── Email step ──
  const emailDealers = ref<EmailDealer[]>([])
  async function loadEmailContext() {
    if (!batch.value) return
    const r = await $fetch<{ batch: Batch, dealers: EmailDealer[] }>(`/api/scanner/batches/${batch.value.id}/email-context`)
    batch.value = r.batch
    emailDealers.value = r.dealers
  }
  async function send(assignments: { dealershipId: string, templateId: string, contactId?: string | null, mode: 'now' | 'queue', allowDuplicate?: boolean }[]) {
    if (!batch.value) throw new Error('No batch')
    const r = await $fetch<{ results: any[], batch: Batch }>(`/api/scanner/batches/${batch.value.id}/send`, { method: 'POST', body: { assignments } })
    batch.value = r.batch
    return r.results
  }

  onBeforeUnmount(dispose)
  return { batch, live, driving, concurrency, error, feed, create, load, list, drive, pause, cancel, requeue, resumeStopped, whenFinished, dispose, emailDealers, loadEmailContext, send }
}
