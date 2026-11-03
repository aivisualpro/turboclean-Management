import { localDay } from '~/composables/useCrmDealerships'

export interface TimeEntry {
  id: string
  userId: string
  userName: string
  category: string
  dealershipId: string | null
  dealershipName: string
  dealershipCode: string
  date: string
  startedAt: string | null
  endedAt: string | null
  minutes: number
  capped?: boolean
  note: string
  source: 'timer' | 'manual' | 'activity'
  interactionId: string | null
}
export interface TimeReport {
  totalMinutes: number
  totalHours: number
  entries: number
  byCategory: { key: string, label: string, minutes: number, hours: number, pct: number }[]
  byWeek: { week: string, minutes: number, categories: Record<string, number> }[]
  byUser: { key: string, label: string, minutes: number, hours: number, pct: number }[]
  byDealership: { key: string, label: string, minutes: number, hours: number, pct: number }[]
  unlinkedMinutes: number
  roi: {
    hours: number, meetingsScheduled: number, meetingsHeld: number, proposals: number, won: number,
    monthlyRevenue: number, annualRevenue: number, annualProfit: number | null,
    hoursPerMeeting: number | null, hoursPerWin: number | null, annualRevenuePerHour: number | null
  }
}

/** Time tracking: the running timer (shared across the app) + entries + report. */
export function useCrmTime() {
  const running = useState<TimeEntry | null>('crm-time-running', () => null)
  const runningLoaded = useState<boolean>('crm-time-running-loaded', () => false)
  /** Bumped after any change so open pages refresh. */
  const version = useState<number>('crm-time-version', () => 0)

  async function loadRunning() {
    try { running.value = (await $fetch<{ running: TimeEntry | null }>('/api/crm/time/running')).running } catch {}
    runningLoaded.value = true
  }
  async function start(input: { category: string, dealershipId?: string | null, note?: string }) {
    const res = await $fetch<{ entry: TimeEntry, stopped: TimeEntry | null }>('/api/crm/time', { method: 'POST', body: { action: 'start', date: localDay(new Date()), ...input } })
    running.value = res.entry
    version.value++
    return res
  }
  async function stop() {
    if (!running.value) return null
    const res = await $fetch<{ entry: TimeEntry }>(`/api/crm/time/${running.value.id}`, { method: 'PATCH', body: { stop: true } })
    running.value = null
    version.value++
    return res.entry
  }
  async function updateRunning(patch: { category?: string, dealershipId?: string | null, note?: string }) {
    if (!running.value) return
    running.value = (await $fetch<{ entry: TimeEntry }>(`/api/crm/time/${running.value.id}`, { method: 'PATCH', body: patch })).entry
  }
  async function discardRunning() {
    if (!running.value) return
    await $fetch(`/api/crm/time/${running.value.id}`, { method: 'DELETE' })
    running.value = null
    version.value++
  }
  async function add(input: { category: string, minutes: number, date: string, dealershipId?: string | null, note?: string }) {
    const res = await $fetch<{ entry: TimeEntry }>('/api/crm/time', { method: 'POST', body: { action: 'add', ...input } })
    version.value++
    return res.entry
  }
  async function update(id: string, patch: Partial<Pick<TimeEntry, 'category' | 'minutes' | 'date' | 'note' | 'dealershipId'>>) {
    const res = await $fetch<{ entry: TimeEntry }>(`/api/crm/time/${id}`, { method: 'PATCH', body: patch })
    version.value++
    return res.entry
  }
  async function remove(id: string) {
    await $fetch(`/api/crm/time/${id}`, { method: 'DELETE' })
    if (running.value?.id === id) running.value = null
    version.value++
  }
  async function list(q: { from?: string, to?: string, scope?: string }) {
    return $fetch<{ entries: TimeEntry[], running: TimeEntry | null }>('/api/crm/time', { query: q })
  }
  async function report(q: { from?: string, to?: string, scope?: string }) {
    return $fetch<TimeReport>('/api/crm/time/report', { query: q })
  }
  return { running, runningLoaded, version, loadRunning, start, stop, updateRunning, discardRunning, add, update, remove, list, report }
}
