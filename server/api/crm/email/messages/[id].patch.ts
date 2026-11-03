import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { updateEmailMessage } from '../../../../utils/crm-email'
import { getUserSession } from '../../../../utils/auth'

/**
 * PATCH /api/crm/email/messages/:id
 *  inbound:  { sentiment: 'positive'|'neutral'|'negative'|null }  or  { dealershipId, inReplyToEmailId? } to attach an unmatched reply
 *  outbound: { outcomes: { conversation?, meeting?, opportunity?, proposal?, won? } } manual credit
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  return { email: await updateEmailMessage(await getCrmDb(), getRouterParam(event, 'id')!, (await readBody(event)) || {}, actorFromSession(session)) }
})
