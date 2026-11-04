import { getCrmDb } from '../../../../utils/crm'
import { listTrash, TRASH_KEEP_DAYS } from '../../../../utils/crm-trash'
import { getUserSession } from '../../../../utils/auth'

/** GET /api/crm/dealerships/trash — dealerships deleted in the last 30 days that can be restored. */
export default defineEventHandler(async (event) => {
  if (!(await getUserSession(event))) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  return { items: await listTrash(await getCrmDb()), keepDays: TRASH_KEEP_DAYS }
})
