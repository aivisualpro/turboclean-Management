import { nanoid } from 'nanoid'

export type DealerStatus = 'Authorised' | 'Pending' | 'Rejected' | 'In Followup'
export type PhoneType = 'mobile' | 'landline' | 'fax'
export type PreferredContactMethod = 'phone' | 'email' | 'any'

export interface DealerPhone {
  id: string
  number: string
  type: PhoneType
}

export interface DealerContact {
  id: string
  name: string
  designation: string
  phones: DealerPhone[]
  emails: string[]
  preferredContactMethod: PreferredContactMethod
}

export interface DealerService {
  id?: string
  service: string
  amount: number
  tax: number
  total: number
}

export interface Dealer {
  id: string
  dealerName: string
  address: string
  contacts: DealerContact[]
  status: DealerStatus
  isTaxApplied: boolean
  taxPercentage: number
  services?: DealerService[]
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = 'turbo-clean-dealers'

function formatPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function createSeedData(): Dealer[] {
  return []
}

export function useDealers() {
  const dealers = useState<Dealer[]>('dealers', () => [])
  const isLoading = ref(false)

  // Initialize data from MongoDB
  async function fetchDealers() {
    isLoading.value = true
    try {
      const data = await $fetch('/api/dealers')
      dealers.value = data as Dealer[]
    } catch (error) {
      console.error('Failed to fetch dealers:', error)
    } finally {
      isLoading.value = false
    }
  }

  // Fetch on client init (always, to ensure fresh data)
  if (import.meta.client) {
    fetchDealers()
  }

  function addDealer(dealer: Omit<Dealer, 'id' | 'createdAt' | 'updatedAt'>) {
    // For now, optimistic update UI, should add POST /api/dealers
    const now = new Date().toISOString()
    dealers.value.unshift({
      ...dealer,
      id: nanoid(8),
      createdAt: now,
      updatedAt: now,
    })
  }

  function updateDealer(id: string, updates: Partial<Pick<Dealer, 'dealerName' | 'address' | 'status' | 'contacts' | 'isTaxApplied' | 'taxPercentage'>>) {
    // Call patchDealer to handle both optimistic UI and API persistence
    return patchDealer(id, updates)
  }

  /** Patch a dealer field and sync to backend + AppSheet */
  async function patchDealer(id: string, updates: Record<string, any>) {
    console.log('[patchDealer] called with id=', id, 'updates=', JSON.stringify(updates))
    // Optimistic: update UI immediately (if dealer is in local state)
    const idx = dealers.value.findIndex(d => d.id === id)
    let snapshot: Dealer | null = null

    if (idx !== -1) {
      snapshot = { ...dealers.value[idx]! }
      // Use splice to guarantee Vue reactivity triggers consistently in Nuxt useState arrays
      const newSnapshot = { ...snapshot, ...updates, updatedAt: new Date().toISOString() }
      dealers.value.splice(idx, 1, newSnapshot)
      console.log('[patchDealer] optimistic update done, isTaxApplied=', dealers.value[idx]!.isTaxApplied)
    } else {
      console.warn('[patchDealer] dealer not found in state — will still call API. id=', id)
    }

    // Always make the API call regardless of local state
    try {
      console.log(`[patchDealer] sending PATCH to /api/dealers/${id} with body=${JSON.stringify(updates)}`)
      const result: any = await $fetch(`/api/dealers/${id}`, {
        method: 'PATCH',
        body: updates,
      })
      console.log('[patchDealer] API success:', result)

      // Sync confirmed values from the API response into local state.
      // Re-find index as it may have changed if dealers were refetched.
      const confirmedIdx = dealers.value.findIndex(d => d.id === id)
      if (result && confirmedIdx !== -1) {
        const current = dealers.value[confirmedIdx]
        if (current) {
          const updatedCurrent = {
            ...current,
            isTaxApplied: result.isTaxApplied !== undefined ? result.isTaxApplied : current.isTaxApplied,
            taxPercentage: result.taxPercentage !== undefined ? result.taxPercentage : current.taxPercentage,
            services: result.services !== undefined ? result.services : current.services,
          }
          dealers.value.splice(confirmedIdx, 1, updatedCurrent)
          console.log('[patchDealer] confirmed from DB — isTaxApplied=', dealers.value[confirmedIdx]!.isTaxApplied, 'taxPercentage=', dealers.value[confirmedIdx]!.taxPercentage)
        }
      }

      // If dealers weren't loaded yet, trigger a refresh to load fresh data
      if (idx === -1) {
        console.log('[patchDealer] dealers state was empty, fetching fresh data...')
        await fetchDealers()
      }
    } catch (err) {
      // Rollback on failure (only if we had a snapshot)
      console.error('[patchDealer] API failed:', err)
      if (snapshot && idx !== -1 && dealers.value[idx]) {
        dealers.value.splice(idx, 1, snapshot)
      }
      throw err // Re-throw so callers can handle it
    }
  }

  function deleteDealer(id: string) {
    // For now, optimistic delete, should add DELETE
    dealers.value = dealers.value.filter(d => d.id !== id)
  }

  async function importDealers(newDealers: Omit<Dealer, 'id' | 'createdAt' | 'updatedAt'>[]) {
    try {
      const response = await $fetch<{ success: boolean; count: number }>('/api/dealers/import', {
        method: 'POST',
        body: { dealers: newDealers }
      })
      await fetchDealers()
      return response.count
    } catch (error) {
      console.error('Failed to import to MongoDB:', error)
      return 0
    }
  }

  async function importDealerServices(services: { dealer: string; service: string; amount: number; tax: number; total: number }[]) {
    try {
      const response = await $fetch<{ success: boolean; count: number }>('/api/dealers/services/import', {
        method: 'POST',
        body: { services }
      })
      await fetchDealers()
      return response.count
    } catch (error) {
      console.error('Failed to import dealer services:', error)
      return 0
    }
  }

  async function deleteAllDealerServices() {
    if (!import.meta.client) return 0
    if (!window.confirm('Are you sure you want to delete ALL services from ALL dealers? This cannot be undone.')) {
      return 0
    }
    
    try {
      const response = await $fetch<{ success: boolean; count: number }>('/api/dealers/services/delete-all', {
        method: 'DELETE'
      })
      await fetchDealers()
      return response.count
    } catch (error) {
      console.error('Failed to delete all dealer services:', error)
      return 0
    }
  }

  function resetToDefaults() {
    dealers.value = []
  }

  const authorised = computed(() => dealers.value.filter(d => d.status === 'Authorised'))
  const pending = computed(() => dealers.value.filter(d => d.status === 'Pending'))
  const rejected = computed(() => dealers.value.filter(d => d.status === 'Rejected'))
  const inFollowup = computed(() => dealers.value.filter(d => d.status === 'In Followup'))

  return {
    dealers,
    isLoading,
    authorised,
    pending,
    rejected,
    inFollowup,
    fetchDealers,
    addDealer,
    updateDealer,
    patchDealer,
    deleteDealer,
    importDealers,
    importDealerServices,
    deleteAllDealerServices,
    resetToDefaults,
    formatPhoneNumber,
  }
}
