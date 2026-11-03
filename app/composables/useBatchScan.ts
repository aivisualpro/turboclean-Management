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
    try {
      const r = await streamScanRun({ dealershipId: item.dealershipId, urls: item.urls, allPages: true, batchId: b.id, autoSave: b.autoSave !== false }, (name, data) => {
        if (name === 'scan') run.scanId = data.id
        else if (name === 'progress') run.progress = data
        else if (name === 'log') { run.log = [...run.log.slice(-60), data]; say(item.dealershipId, item.name, data.text) }
        else if (name === 'frame') run.frame = `data:image/jpeg;base64,${data.data}`
        else if (name === 'done') say(item.dealershipId, item.name, `${data.summary.total} vehicles · ${data.summary.withoutReal} without a real photo (${data.summary.withoutRealPct ?? 0}%)`, 'ok')
        else if (name === 'failure') say(item.dealershipId, item.name, data.message, 'err')
        else if (name === 'saved') say(item.dealershipId, item.name, 'Audit saved to the CRM', 'ok')
        touch()
      }, ctrl.signal)
      if (!r.finished && r.scanId) say(item.dealershipId, item.name, 'Connection dropped — the scan continues on the server', 'warn')
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
    }
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
    }
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
  return { batch, live, driving, concurrency, error, feed, create, load, list, drive, pause, cancel, requeue, dispose, emailDealers, loadEmailContext, send }
}
