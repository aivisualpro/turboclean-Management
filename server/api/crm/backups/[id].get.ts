import { getCrmDb } from '../../../utils/crm'
import { readBackup } from '../../../utils/crm-dataquality'
import { getUserSession } from '../../../utils/auth'

/** GET /api/crm/backups/:id — download a saved snapshot. */
export default defineEventHandler(async (event) => {
  if (!(await getUserSession(event))) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const { meta, gz } = await readBackup(await getCrmDb(), getRouterParam(event, 'id')!)
  setHeader(event, 'Content-Type', 'application/gzip')
  setHeader(event, 'Content-Disposition', `attachment; filename="crm-backup-${String(meta.createdAt).slice(0, 16).replace(':', '')}-${meta.kind}.json.gz"`)
  return gz
})
