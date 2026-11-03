import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { updateTemplate } from '../../../../utils/crm-email'
import { getUserSession } from '../../../../utils/auth'

/** PATCH /api/crm/email/templates/:id — name/category/description/archived; subject/body changes create a new version. */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const body = (await readBody(event)) || {}
  const db = await getCrmDb()
  const actor = actorFromSession(session)
  const template = await updateTemplate(db, getRouterParam(event, 'id')!, body, actor)
  if (body.studio && body.newVersion) {
    const { recordSignal } = await import('../../../../utils/brain')
    await recordSignal(db, 'design.saved', 'design', { name: template?.name, brief: String(body.studio.brief || '').slice(0, 1500), turns: Number(body.studio.turns) || 0, asVersion: true }, { actor, refId: getRouterParam(event, 'id') || null })
  }
  return { template }
})
