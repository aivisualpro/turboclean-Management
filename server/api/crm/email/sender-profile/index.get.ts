import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { getSenderProfile } from '../../../../utils/crm-email'
import { getUserSession } from '../../../../utils/auth'

/** GET /api/crm/email/sender-profile — the signed-in user's signature details used in templates. */
export default defineEventHandler(async event => ({ profile: await getSenderProfile(await getCrmDb(), actorFromSession(await getUserSession(event))) }))
