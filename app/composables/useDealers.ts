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

export interface Dealer {
  id: string
  dealerName: string
  address: string
  contacts: DealerContact[]
  status: DealerStatus
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

  function updateDealer(id: string, updates: Partial<Pick<Dealer, 'dealerName' | 'address' | 'status' | 'contacts'>>) {
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
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
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
    deleteDealer,
    importDealers,
    resetToDefaults,
    formatPhoneNumber,
  }
}
