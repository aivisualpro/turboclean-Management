import { getCrmDb } from '../../../../utils/crm'
import { listCampaigns } from '../../../../utils/crm-email'

/** GET /api/crm/email/campaigns */
export default defineEventHandler(async () => ({ campaigns: await listCampaigns(await getCrmDb()) }))
