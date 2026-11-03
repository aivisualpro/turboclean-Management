import { getCrmDb } from '../../../../../utils/crm'
import { scanResults } from '../../../../../utils/crm-prospecting'

/** GET /api/crm/prospecting/scans/:id — the scan + every place it found, matched against the CRM right now. */
export default defineEventHandler(async event => scanResults(await getCrmDb(), getRouterParam(event, 'id') || ''))
