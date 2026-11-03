import { getCrmDb } from '../../../utils/crm'
import { buildBackup } from '../../../utils/crm-dataquality'
import { getUserSession } from '../../../utils/auth'

/** GET /api/crm/backups/now — download a fresh full CRM backup (gzipped Extended JSON). */
export default defineEventHandler(async (event) => {
  if (!(await getUserSession(event))) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const { gz } = await buildBackup(await getCrmDb())
  setHeader(event, 'Content-Type', 'application/gzip')
  setHeader(event, 'Content-Disposition', `attachment; filename="crm-backup-${new Date().toISOString().slice(0, 16).replace(':', '')}.json.gz"`)
  return gz
})
