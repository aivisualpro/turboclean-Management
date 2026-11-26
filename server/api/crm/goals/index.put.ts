import { actorFromSession, getCrmDb, str } from '../../../utils/crm'
import { saveGoalConfig } from '../../../utils/crm-goals'
import { getUserSession } from '../../../utils/auth'

/** PUT /api/crm/goals — { config, today: 'YYYY-MM-DD' }. Saved as a new version that starts today. */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) || {}
  const doc = await saveGoalConfig(await getCrmDb(), body.config, str(body.today, 10), actorFromSession(await getUserSession(event)))
  const latest = doc.versions[doc.versions.length - 1]!
  return { config: latest.config, seeded: false, history: doc.versions.map(v => ({ effectiveFrom: v.effectiveFrom, savedAt: v.savedAt, savedBy: v.savedBy })).reverse() }
})
