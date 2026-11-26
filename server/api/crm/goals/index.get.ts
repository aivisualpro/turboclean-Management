import { getCrmDb } from '../../../utils/crm'
import { loadGoalDoc } from '../../../utils/crm-goals'

/** GET /api/crm/goals — the goals in force now, plus the history of changes. */
export default defineEventHandler(async () => {
  const doc = await loadGoalDoc(await getCrmDb())
  const latest = doc.versions[doc.versions.length - 1]!
  return {
    config: latest.config,
    seeded: !!doc.seeded,
    history: doc.seeded ? [] : doc.versions.map(v => ({ effectiveFrom: v.effectiveFrom, savedAt: v.savedAt, savedBy: v.savedBy })).reverse(),
  }
})
