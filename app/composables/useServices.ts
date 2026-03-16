
export interface Service {
  id: string
  service: string
  description: string
  createdAt: string
  updatedAt: string
}

export function useServices() {
  const services = useState<Service[]>('services', () => [])
  const isLoading = ref(false)

  // Initialize data from MongoDB
  async function fetchServices() {
    isLoading.value = true
    try {
      const data = await $fetch('/api/services')
      services.value = data as Service[]
    } catch (error) {
      console.error('Failed to fetch services:', error)
    } finally {
      isLoading.value = false
    }
  }

  // Fetch on client init if empty
  if (import.meta.client && services.value.length === 0) {
    fetchServices()
  }

  async function importServices(newServices: Omit<Service, 'id' | 'createdAt' | 'updatedAt'>[]) {
    try {
      const response = await $fetch<{ success: boolean; count: number }>('/api/services/import', {
        method: 'POST',
        body: { services: newServices }
      })
      await fetchServices()
      return response.count
    } catch (error) {
      console.error('Failed to import to MongoDB:', error)
      return 0
    }
  }

  function resetToDefaults() {
    services.value = []
  }

  return {
    services,
    isLoading,
    fetchServices,
    importServices,
    resetToDefaults,
  }
}
