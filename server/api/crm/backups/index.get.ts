import { getCrmDb } from '../../../utils/crm'
import { BACKUP_KEEP_DAYS, listBackups } from '../../../utils/crm-dataquality'

/** GET /api/crm/backups — saved snapshots (daily automatic + manual), newest first. */
export default defineEventHandler(async () => ({ backups: await listBackups(await getCrmDb()), keepDays: BACKUP_KEEP_DAYS }))
