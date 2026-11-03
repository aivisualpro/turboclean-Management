import { getCrmDb } from '../../../utils/crm'
import { qualityReport } from '../../../utils/crm-dataquality'

/** GET /api/crm/data-quality — duplicates, missing information, non-standard values. */
export default defineEventHandler(async () => qualityReport(await getCrmDb()))
