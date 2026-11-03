import { getCrmDb } from '../../../../utils/crm'
import { listTemplates } from '../../../../utils/crm-email'

/** GET /api/crm/email/templates?archived=1 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  return { templates: await listTemplates(await getCrmDb(), q.archived === '1') }
})
