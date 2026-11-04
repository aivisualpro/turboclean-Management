import type { ScannerProgress } from '~/composables/useInventoryScanner'

/**
 * Batch scanning ("Mission Control") — AUTOPILOT. The batch runs on the server: each dealership is
 * scanned in its own server invocation and the next one starts by itself; a cron restarts anything
 * that stalls from its last checkpoint. This composable only WATCHES (polls `/live` every ~2.5 s):
 * closing the window, losing the internet or a flat battery does not stop or lose anything —
 * reopen and it shows exactly where the batch is.
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
  mode?: 'server' | 'browser', paused?: boolean
}
/** Live state of one running dealership (mirrored from the server every poll). */
export interface LiveRun { dealershipId: string, progress: (ScannerProgress & { doneUrls?: string[], resumeAt?: { url: string, href: string, page: number } | null }) | null, log: { at: string, text: string }[], frame: string | null, startedAt: number, lastEvent: number, scanId: string | null }
export interface EmailDealer { dealershipId: string, stage: string, city: string, state: string, contacts: { id: string, name: string, email: string, title: string, doNotEmail: boolean, bounced: boolean, isPrimary: boolean }[], bestContactId: string | null, lastEmail: { subject: string, sentAt: string, to: string, templateName: string, replied: boolean } | null }

export function useBatchScan() {
  const batch = ref<Batch | null>(null)
  const live = ref<Record<string, LiveRun>>({})
  /** True while the server is working on the batch (not paused, not finished). */
  const driving = ref(false)
  const concurrency = ref(2)
  const error = ref<string | null>(null)
  /** Seconds since the last successful poll — the UI shows "reconnecting…" when it grows. */
  const offlineFor = ref(0)
  const feed = ref<{ at: number, dealershipId: string, name: string, text: string, kind: 'info' | 'ok' | 'warn' | 'err' }[]>([])
  let timer: ReturnType<typeof setTimeout> | null = null
  let watching = false
  let lastOk = Date.now()
  let pollMs = 2500
  /** Called when the batch stops moving (finished or paused). */
  let onFinished: ((b: Batch | null, reason: 'finished' | 'paused') => void) | null = null
  const whenFinished = (fn: typeof onFinished) => { onFinished = fn }
  const say = (dealershipId: string, name: string, text: string, kind: 'info' | 'ok' | 'warn' | 'err' = 'info', at = Date.now()) => { feed.value = [...feed.value.slice(-399), { at, dealershipId, name, text, kind }] }
  const kindOf = (t: string): 'info' | 'ok' | 'warn' | 'err' => /failed|could not|blocked|error|gave up/i.test(t) ? 'err' : /crash|restart|waiting|paus|slow|rate-limit|skipped/i.test(t) ? 'warn' : /saved|done in|vehicles · |verified/i.test(t) ? 'ok' : 'info'

  // What has already been shown in the feed (so a poll only adds new lines / status changes).
  const seenLog = new Map<string, string>()
  const lastStatus = new Map<string, string>()
  function absorb(b: Batch, liveRows: Record<string, any>) {
    const prevDriving = driving.value
    batch.value = b
    concurrency.value = b.concurrency || concurrency.value
    const next: Record<string, LiveRun> = {}
    for (const [dealershipId, l] of Object.entries(liveRows || {})) {
      const name = b.items.find(i => i.dealershipId === dealershipId)?.name || ''
      const logs: { at: string, text: string }[] = l.log || []
      const lastSeen = seenLog.get(dealershipId)
      const from = lastSeen ? logs.findIndex(x => `${x.at}|${x.text}` === lastSeen) + 1 : Math.max(0, logs.length - 4)
      for (const x of logs.slice(from)) say(dealershipId, name, x.text, kindOf(x.text), new Date(x.at).getTime())
      if (logs.length) seenLog.set(dealershipId, `${logs[logs.length - 1]!.at}|${logs[logs.length - 1]!.text}`)
      const prev = live.value[dealershipId]
      next[dealershipId] = { dealershipId, scanId: l.scanId, progress: l.progress, log: logs, frame: l.frame || prev?.frame || null, startedAt: new Date(l.startedAt || Date.now()).getTime(), lastEvent: new Date(l.heartbeatAt || Date.now()).getTime() }
    }
    live.value = next
    for (const i of b.items) {
      const before = lastStatus.get(i.dealershipId)
      if (before && before !== i.status) {
        if (i.status === 'done') say(i.dealershipId, i.name, `${i.summary?.total ?? 0} vehicles · ${i.summary?.withoutReal ?? 0} without a real photo (${i.summary?.withoutRealPct ?? 0}%) — audit saved`, 'ok')
        else if (i.status === 'failed') say(i.dealershipId, i.name, i.error || 'Failed', 'err')
        else if (i.status === 'queued' && (before === 'stopped' || before === 'failed' || before === 'running')) say(i.dealershipId, i.name, i.resumeFrom ? 'Back in the queue — will continue from its checkpoint' : 'Back in the queue', 'warn')
        else if (i.status === 'stopped') say(i.dealershipId, i.name, i.auditId ? 'Stopped — what it found is saved' : 'Paused — progress saved', 'warn')
      }
      lastStatus.set(i.dealershipId, i.status)
    }
    driving.value = !b.finished && !b.paused
    if (prevDriving && !driving.value) onFinished?.(b, b.finished ? 'finished' : 'paused')
  }

  async function poll() {
    if (!batch.value) return
    try {
      const r = await $fetch<{ batch: Batch, live: Record<string, any> }>(`/api/scanner/batches/${batch.value.id}/live`, { query: { frames: document.hidden ? '0' : '1' }, timeout: 20_000 })
      absorb(r.batch, r.live)
      error.value = null
      lastOk = Date.now()
      offlineFor.value = 0
      pollMs = driving.value ? 2500 : 10_000
    }
    catch (e: any) {
      offlineFor.value = Math.round((Date.now() - lastOk) / 1000)
      error.value = navigator.onLine === false ? 'You are offline — the batch keeps running on the server' : 'Reconnecting… the batch keeps running on the server'
      pollMs = Math.min(15_000, pollMs * 1.5)
    }
  }
  function schedule() {
    if (!watching) return
    timer = setTimeout(async () => { await poll(); schedule() }, pollMs)
  }
  /** Start watching the batch (safe to call repeatedly). */
  function watchBatch() {
    if (watching) return
    watching = true
    poll().then(schedule)
  }
  function unwatch() { watching = false; if (timer) clearTimeout(timer); timer = null }
  const onOnline = () => { if (watching) { pollMs = 500; if (timer) clearTimeout(timer); schedule() } }
  const onVisible = () => { if (!document.hidden) onOnline() }
  if (import.meta.client) { window.addEventListener('online', onOnline); document.addEventListener('visibilitychange', onVisible) }

  async function create(dealershipIds: string[], opts: { pages?: Record<string, string[]>, concurrency?: number, name?: string } = {}) {
    error.value = null
    const r = await $fetch<{ batch: Batch }>('/api/scanner/batches', { method: 'POST', body: { dealershipIds, pages: opts.pages, concurrency: opts.concurrency ?? concurrency.value, name: opts.name } })
    batch.value = r.batch
    concurrency.value = r.batch.concurrency
    seenLog.clear(); lastStatus.clear(); feed.value = []
    return r.batch
  }
  async function load(id: string) {
    const r = await $fetch<{ batch: Batch, live: Record<string, any> }>(`/api/scanner/batches/${id}/live`)
    if (batch.value?.id !== id) { seenLog.clear(); lastStatus.clear(); feed.value = [] }
    absorb(r.batch, r.live)
    return r.batch
  }
  const list = () => $fetch<{ batches: Batch[] }>('/api/scanner/batches')

  /** Start / resume autopilot on the server, then watch it. */
  async function drive() {
    if (!batch.value) return
    const r = await $fetch<{ batch: Batch }>(`/api/scanner/batches/${batch.value.id}/start`, { method: 'POST' })
    absorb(r.batch, {})
    driving.value = !r.batch.finished
    watchBatch()
  }
  /** Paused dealerships are resumed by `drive()` on the server; kept for the component API. */
  async function resumeStopped() { return 0 }
  /** Pause: running scans save where they are and stop; Resume continues from that exact page. */
  async function pause() {
    if (!batch.value) return
    const r = await $fetch<{ batch: Batch }>(`/api/scanner/batches/${batch.value.id}/pause`, { method: 'POST' })
    absorb(r.batch, live.value)
    driving.value = false
  }
  /** Cancel everything still queued (running scans stop and keep what they found). */
  async function cancel() {
    if (!batch.value) return
    const r = await $fetch<{ batch: Batch }>(`/api/scanner/batches/${batch.value.id}/cancel`, { method: 'POST' })
    absorb(r.batch, live.value)
  }
  async function requeue(dealershipId: string, urls?: string[]) {
    if (!batch.value) return
    const r = await $fetch<{ batch: Batch }>(`/api/scanner/batches/${batch.value.id}/requeue`, { method: 'POST', body: { dealershipId, urls } })
    absorb(r.batch, live.value)
    watchBatch()
  }
  /** Stop watching (the batch itself keeps running on the server). */
  function dispose() { unwatch() }

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

  onBeforeUnmount(() => { unwatch(); if (import.meta.client) { window.removeEventListener('online', onOnline); document.removeEventListener('visibilitychange', onVisible) } })
  return { batch, live, driving, concurrency, error, offlineFor, feed, watchBatch, unwatch, create, load, list, drive, pause, cancel, requeue, resumeStopped, whenFinished, dispose, emailDealers, loadEmailContext, send }
}
