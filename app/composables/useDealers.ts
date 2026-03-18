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

  // Fetch on client init if empty
  if (import.meta.client && dealers.value.length === 0) {
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
    // For now, optimistic update UI, should add PUT /api/dealers/:id
    const idx = dealers.value.findIndex(d => d.id === id)
    if (idx === -1) return
    const existing = dealers.value[idx]!
    dealers.value[idx] = {
      id: existing.id,
      dealerName: updates.dealerName ?? existing.dealerName,
      address: updates.address ?? existing.address,
      contacts: updates.contacts ?? existing.contacts,
      status: updates.status ?? existing.status,
      isTaxApplied: updates.isTaxApplied ?? existing.isTaxApplied,
      taxPercentage: updates.taxPercentage ?? existing.taxPercentage,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }
  }

  /** Patch a dealer field and sync to backend + AppSheet */
  async function patchDealer(id: string, updates: Record<string, any>) {
    console.log('[patchDealer] called with id=', id, 'updates=', JSON.stringify(updates))
    // Optimistic: update UI immediately
    const idx = dealers.value.findIndex(d => d.id === id)
    if (idx === -1) {
      console.error('[patchDealer] dealer not found in state:', id)
      return
    }
    const snapshot = { ...dealers.value[idx]! }

    // Replace the entire array item to guarantee Vue reactivity triggers v-if etc.
    dealers.value[idx] = { ...snapshot, ...updates, updatedAt: new Date().toISOString() }
    console.log('[patchDealer] optimistic update done, isTaxApplied=', dealers.value[idx]!.isTaxApplied)

    // Background: API call
    try {
      const result = await $fetch(`/api/dealers/${id}`, {
        method: 'PATCH',
        body: updates,
      })
      console.log('[patchDealer] API success:', result)
    } catch (err) {
      // Rollback on failure
      console.error('[patchDealer] API failed:', err)
      dealers.value[idx] = snapshot
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
