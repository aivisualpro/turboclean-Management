import { actorFromSession, getCrmDb, str } from '../../../utils/crm'
import { importDealerships } from '../../../utils/crm-dataquality'
import { getUserSession } from '../../../utils/auth'

/** POST /api/crm/import/dealerships — { rows: [{ name, state, city, website, … contactEmail }], dryRun?, ownerId?, ownerName? } */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in first' })
  const b = (await readBody(event)) || {}
  return importDealerships(await getCrmDb(), b.rows, { dryRun: !!b.dryRun, ownerId: str(b.ownerId, 64), ownerName: str(b.ownerName, 120) }, actorFromSession(session))
})
