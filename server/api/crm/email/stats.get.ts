import { getCrmDb, str } from '../../../utils/crm'
import { emailStats } from '../../../utils/crm-email'

/** GET /api/crm/email/stats?groupBy=none|template|campaign|user|followUp&from=YYYY-MM-DD&to=&campaignId=&templateId=&userId= */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const groupBy = ['template', 'campaign', 'user', 'followUp'].includes(String(q.groupBy)) ? q.groupBy as any : 'none'
  return emailStats(await getCrmDb(), {
    groupBy, from: str(q.from, 10) || undefined, to: str(q.to, 10) || undefined,
    campaignId: str(q.campaignId, 64) || undefined, templateId: str(q.templateId, 64) || undefined, userId: str(q.userId, 64) || undefined,
  })
})
