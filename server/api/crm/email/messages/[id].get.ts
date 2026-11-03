import { getCrmDb } from '../../../../utils/crm'
import { getEmail } from '../../../../utils/crm-email'

/** GET /api/crm/email/messages/:id — the message (with body + event log) and its whole thread. */
export default defineEventHandler(async event => await getEmail(await getCrmDb(), getRouterParam(event, 'id')!))
