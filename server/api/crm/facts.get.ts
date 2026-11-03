import { getCrmDb } from '../../utils/crm'
import { buildFacts } from '../../utils/crm-facts'

/** GET /api/crm/facts — per-dealership facts (counts, funnel dates, roles, photos…) for advanced filtering. */
export default defineEventHandler(async () => ({ facts: await buildFacts(await getCrmDb()) }))
