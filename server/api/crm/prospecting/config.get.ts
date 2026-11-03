import { getCrmDb } from '../../../utils/crm'
import { PLACES_FREE_MONTHLY_CALLS, PLACES_PRICE_PER_1000, loadProspectingConfig, placesApiKey } from '../../../utils/crm-prospecting'

/** GET /api/crm/prospecting/config — search area + whether the Google key is set (the key itself never leaves the server). */
export default defineEventHandler(async () => {
  const config = await loadProspectingConfig(await getCrmDb())
  return { config, apiKeyConfigured: !!placesApiKey(), pricing: { pricePer1000: PLACES_PRICE_PER_1000, freeMonthlyCalls: PLACES_FREE_MONTHLY_CALLS } }
})
