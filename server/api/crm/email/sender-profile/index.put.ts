import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { saveSenderProfile } from '../../../../utils/crm-email'
import { getUserSession } from '../../../../utils/auth'

/** PUT /api/crm/email/sender-profile — { displayName, title, company, phone, email, tagline, region } */
export default defineEventHandler(async event => ({ profile: await saveSenderProfile(await getCrmDb(), actorFromSession(await getUserSession(event)), await readBody(event)) }))
