import { getCrmDb, str } from '../../../utils/crm'
import { templateExperiments } from '../../../utils/crm-email'

/**
 * GET /api/crm/email/experiments?level=template|version|subject|combo&model=email|sequence&from=&to=&templateId=&campaignId=
 * Per template / version / subject line: sent, delivery, replies, positive replies, meetings,
 * opportunities, won dealerships, revenue.
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  return templateExperiments(await getCrmDb(), {
    level: str(q.level, 20), model: str(q.model, 20), from: str(q.from, 10) || undefined, to: str(q.to, 10) || undefined,
    templateId: str(q.templateId, 64) || undefined, campaignId: str(q.campaignId, 64) || undefined,
  })
})
