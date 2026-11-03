import { getCrmDb } from '../../../../utils/crm'
import { listScans } from '../../../../utils/crm-prospecting'

/** GET /api/crm/prospecting/scans — recent scans + this month's Google Places usage. */
export default defineEventHandler(async () => listScans(await getCrmDb()))
