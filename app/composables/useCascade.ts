import { toast } from 'vue-sonner'

/** Fields many dealerships share — when one is renamed, offer to rename the rest ("Hoffman" → "Hoffman Auto Group"). */
export const CASCADE_FIELDS = ['dealerGroup', 'route', 'territory', 'city'] as const
export type CascadeField = typeof CASCADE_FIELDS[number]
export const CASCADE_LABEL: Record<CascadeField, string> = { dealerGroup: 'Dealer group', route: 'Route', territory: 'Territory', city: 'City' }

export interface CascadeChange { field: CascadeField, from: string, to: string, id: string }
export interface CascadeOffer {
  field: CascadeField, from: string, to: string
  /** Dealerships already changed (excluded from the bulk update). */
  exceptIds: string[]
  /** How many other dealerships still carry `from`, and a few of their names. */
  others: number, names: string[]
}

export function useCascade() {
  const { dealerships, fetchDealerships } = useCrmDealerships()
  const queue = ref<CascadeOffer[]>([])
  const current = computed(() => queue.value[0] || null)
  const busy = ref(false)

  /** Look at what just changed and queue an offer for every shared value that other dealerships still have. */
  function offer(changes: CascadeChange[]) {
    const groups = new Map<string, CascadeOffer>()
    for (const c of changes) {
      const from = String(c.from || '').trim(), to = String(c.to || '').trim()
      if (!from || from === to || !CASCADE_FIELDS.includes(c.field)) continue
      const key = `${c.field}|${from}|${to}`
      const g = groups.get(key) || { field: c.field, from, to, exceptIds: [], others: 0, names: [] }
      g.exceptIds.push(c.id)
      groups.set(key, g)
    }
    for (const g of groups.values()) {
      const rest = dealerships.value.filter(d => !d.archivedAt && String(d[g.field] || '').trim() === g.from && !g.exceptIds.includes(d.id))
      if (!rest.length) continue
      g.others = rest.length
      g.names = rest.slice(0, 4).map(d => d.name)
      queue.value = [...queue.value, g]
    }
  }

  async function applyCurrent() {
    const o = current.value
    if (!o || busy.value) return
    busy.value = true
    try {
      const r = await $fetch<{ updated: number }>('/api/crm/dealerships/bulk-field', { method: 'POST', body: { field: o.field, from: o.from, to: o.to, excludeIds: o.exceptIds } })
      toast.success(`${CASCADE_LABEL[o.field]} changed on ${r.updated} more dealership${r.updated === 1 ? '' : 's'}`, { description: `"${o.from}" → "${o.to || '—'}"` })
      queue.value = queue.value.slice(1)
      await fetchDealerships().catch(() => {})
    }
    catch (e: any) { toast.error(e?.data?.statusMessage || e?.message || 'Could not apply the change to the others') }
    finally { busy.value = false }
  }
  function skipCurrent() { if (!busy.value) queue.value = queue.value.slice(1) }

  return { current, busy, pending: computed(() => queue.value.length), offer, applyCurrent, skipCurrent }
}
