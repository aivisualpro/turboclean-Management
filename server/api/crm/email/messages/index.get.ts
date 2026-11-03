import { getCrmDb } from '../../../../utils/crm'
import { listEmails } from '../../../../utils/crm-email'

/**
 * GET /api/crm/email/messages
 * ?dealershipId= &direction=outbound|inbound &campaignId= &templateId= &status= &search=
 * &needsReview=1 (replies without a sentiment) &unmatched=1 (replies not attached to a dealership) &limit=
 */
export default defineEventHandler(async (event) => ({ emails: await listEmails(await getCrmDb(), getQuery(event)) }))
